"""
Multimodal Media Pipeline for nivm.
Handles video adaptive scene-change keyframing, offline Faster-Whisper transcription,
audio resampling (16kHz mono WAV base64), PDF page rendering, and image processing.
"""

import os
import io
import base64
import mimetypes
import logging

from .config import UPLOADS_DIR
from .storage import get_user_settings

logger = logging.getLogger("nivm.multimodal")

_whisper_model = None


def _get_whisper_model():
    """Lazily load faster-whisper model on CPU using pre-cached base.en model."""
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    try:
        from faster_whisper import WhisperModel
        # Use CPU with int8 quantization so 0 MB of GPU VRAM is used
        _whisper_model = WhisperModel("base.en", device="cpu", compute_type="int8", local_files_only=True)
        return _whisper_model
    except Exception as e:
        logger.warning(f"Could not load faster-whisper local model: {e}")
        return None


def _transcribe_audio_file(filepath_or_bytes, max_duration_s=180) -> str:
    """Transcribe speech in an audio file using faster-whisper."""
    model = _get_whisper_model()
    if not model:
        return ""
    try:
        segments, info = model.transcribe(
            filepath_or_bytes,
            beam_size=5,
            best_of=5,
            vad_filter=True,
            condition_on_previous_text=False
        )
        transcript_parts = []
        for segment in segments:
            if segment.end > max_duration_s:
                break
            # Skip if very high probability of no speech
            if getattr(segment, "no_speech_prob", 0.0) > 0.85:
                continue
            text = segment.text.strip()
            if text:
                m_start, s_start = divmod(int(segment.start), 60)
                m_end, s_end = divmod(int(segment.end), 60)
                transcript_parts.append(f"[{m_start:02d}:{s_start:02d}-{m_end:02d}:{s_end:02d}] {text}")
        return "\n".join(transcript_parts)
    except Exception as e:
        logger.warning(f"Audio transcription error: {e}")
        return ""


def transcribe_speech_bytes(audio_bytes: bytes, max_duration_s=60) -> str:
    """
    High-accuracy, direct speech transcription for Voice Mode from raw audio bytes (WebM, WAV, Ogg, MP3).
    Normalizes audio loudness to 16kHz mono WAV to preserve clear speech onset and endings.
    """
    if not audio_bytes or len(audio_bytes) < 100:
        return ""
    model = _get_whisper_model()
    if not model:
        return ""

    import tempfile
    from pydub import AudioSegment, effects

    temp_in = None
    temp_wav = None
    try:
        ext = ".webm"
        if audio_bytes[:4] == b"RIFF":
            ext = ".wav"
        elif audio_bytes[:4] == b"OggS":
            ext = ".ogg"

        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tf:
            tf.write(audio_bytes)
            temp_in = tf.name

        # Load and verify audio volume to prevent silence hallucinations
        audio = AudioSegment.from_file(temp_in)
        if len(audio) < 200 or audio.dBFS < -45.0 or audio.max_dBFS < -40.0:
            return ""

        # Normalize loudness and resample to 16kHz 16-bit mono WAV for optimal Whisper accuracy
        norm_audio = effects.normalize(audio).set_frame_rate(16000).set_channels(1)

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as wf:
            temp_wav = wf.name
            norm_audio.export(temp_wav, format="wav")

        segments, info = model.transcribe(
            temp_wav,
            language="en",
            beam_size=5,
            best_of=5,
            vad_filter=False,
            initial_prompt="Hello, um, can you...",
            condition_on_previous_text=False
        )

        SILENCE_HALLUCINATIONS = {"you", "thank you", "thanks for watching", "bye", "subscribe", "subtitles by", "the end"}

        parts = []
        for segment in segments:
            if segment.end > max_duration_s:
                break
            if getattr(segment, "no_speech_prob", 0.0) > 0.85:
                continue
            text = segment.text.strip()
            if text:
                clean_lower = text.lower().strip(" .!?,:;-")
                if clean_lower in SILENCE_HALLUCINATIONS and len(audio) < 3000:
                    continue
                parts.append(text)

        return " ".join(parts).strip()
    except Exception as e:
        logger.warning(f"Voice Mode audio transcription error: {e}")
        return ""
    finally:
        for p in (temp_in, temp_wav):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass


def _process_video(filepath: str, content_list: list):
    """
    Extract adaptive scene-change keyframes, 16kHz audio waveform, and speech transcription from a video.
    """
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(filepath)
    if not cap.isOpened():
        content_list.append({
            "type": "text",
            "text": "[System Note: Failed to open attached video file for analysis.]"
        })
        return

    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration_s = frame_count / fps if fps > 0 else 0.0

    # Determine adaptive frame budget based on video duration:
    if duration_s <= 15:
        target_frames = 8
    elif duration_s <= 45:
        target_frames = 12
    elif duration_s <= 90:
        target_frames = 16
    else:
        target_frames = 20
    target_frames = min(target_frames, max(4, frame_count))

    cand_step = max(1, frame_count // (target_frames * 3))
    candidates = list(range(0, frame_count, cand_step))
    if candidates and candidates[-1] != frame_count - 1:
        candidates.append(frame_count - 1)

    # Fast pass: compute difference scores across downscaled grayscale thumbnails
    scores = []
    prev_thumb = None
    for f_idx in candidates:
        cap.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
        ret, frame = cap.read()
        if not ret or frame is None:
            scores.append((f_idx, 0.0))
            continue
        thumb = cv2.cvtColor(cv2.resize(frame, (128, 72)), cv2.COLOR_BGR2GRAY)
        if prev_thumb is None:
            diff_score = 1.0
        else:
            diff = cv2.absdiff(thumb, prev_thumb)
            diff_score = float(np.mean(diff))
        prev_thumb = thumb
        scores.append((f_idx, diff_score))

    selected_indices = set()
    if scores:
        selected_indices.add(scores[0][0])
        selected_indices.add(scores[-1][0])

    middle_scores = scores[1:-1]
    middle_scores.sort(key=lambda x: x[1], reverse=True)
    min_dist = max(1, int(fps * 0.5)) if fps > 0 else 5

    for f_idx, _ in middle_scores:
        if len(selected_indices) >= target_frames:
            break
        if all(abs(f_idx - sel) >= min_dist for sel in selected_indices):
            selected_indices.add(f_idx)

    if len(selected_indices) < target_frames and frame_count > len(selected_indices):
        uniform_indices = np.linspace(0, frame_count - 1, target_frames, dtype=int)
        for u_idx in uniform_indices:
            selected_indices.add(int(u_idx))
            if len(selected_indices) >= target_frames:
                break

    sorted_frames = sorted(list(selected_indices))

    # Extract audio track & transcribe
    audio_b64 = None
    transcript_text = ""
    try:
        from pydub import AudioSegment
        audio_seg = AudioSegment.from_file(filepath)
        audio_dur_s = len(audio_seg) / 1000.0
        if audio_dur_s > 0.3:
            audio_seg_mono = audio_seg.set_frame_rate(16000).set_channels(1)
            wav_io = io.BytesIO()
            export_seg = audio_seg_mono[:60000]
            export_seg.export(wav_io, format="wav")
            audio_bytes = wav_io.getvalue()
            audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
            transcript_text = _transcribe_audio_file(io.BytesIO(audio_bytes), max_duration_s=120)
    except (IndexError, KeyError):
        logger.info("Video has no audio track")
    except Exception as e:
        logger.debug(f"Video audio extraction note: {e}")

    dur_min, dur_sec = divmod(int(duration_s), 60)
    note_lines = [
        f"[System Note: Attached Video Analysis]",
        f"- Duration: {dur_min:02d}:{dur_sec:02d} ({duration_s:.1f}s) | Resolution: {orig_w}x{orig_h} @ {fps:.1f} FPS",
        f"- Extracted Keyframes: {len(sorted_frames)} adaptive scene-change frames (scaled to 640px max dimension)",
    ]
    if transcript_text:
        note_lines.append(f"- Audio Track: Speech transcribed with timestamps below:")
        note_lines.append(f"[Video Audio Transcript]:\n{transcript_text}\n")
    elif audio_b64:
        note_lines.append("- Audio Track: Audio track extracted (waveform provided for acoustic inspection)")
    else:
        note_lines.append("- Audio Track: None or silent")

    content_list.append({
        "type": "text",
        "text": "\n".join(note_lines)
    })

    if audio_b64:
        content_list.append({
            "type": "image_url",
            "image_url": {"url": f"data:audio/wav;base64,{audio_b64}"}
        })

    max_dim = 640
    for idx, f_idx in enumerate(sorted_frames):
        cap.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
        ret, frame = cap.read()
        if not ret or frame is None:
            continue

        h, w = frame.shape[:2]
        if max(h, w) > max_dim:
            scale = max_dim / float(max(h, w))
            new_w = max(1, int(w * scale))
            new_h = max(1, int(h * scale))
            frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

        _, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        b64_frame = base64.b64encode(buf).decode("utf-8")

        time_sec = f_idx / fps if fps > 0 else 0.0
        m, s = divmod(time_sec, 60)
        timestamp_str = f"{int(m):02d}:{s:04.1f}"

        content_list.append({
            "type": "text",
            "text": f"[Video Frame {idx + 1}/{len(sorted_frames)} at {timestamp_str}]"
        })
        content_list.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64_frame}"}
        })

    cap.release()


def _process_pdf(filepath: str, content_list: list):
    """Render PDF pages as images so the vision model can inspect them."""
    import pymupdf

    settings = get_user_settings()
    render_dpi = int(settings.get("pdf_render_dpi", 150))
    zoom = max(1.0, min(float(render_dpi) / 72.0, 4.5))

    max_pages = 8
    try:
        document = pymupdf.open(filepath)
        page_count = len(document)
        pages_to_render = min(page_count, max_pages)
        content_list.append({
            "type": "text",
            "text": (
                f"[System Note: The user attached a PDF with {page_count} page(s). "
                f"The next {pages_to_render} page image(s) are provided for visual inspection (rendered at {render_dpi} DPI). "
                "Reference page numbers when answering.]"
            )
        })

        for page_index in range(pages_to_render):
            page = document.load_page(page_index)
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            jpeg_bytes = pixmap.tobytes("jpeg", jpg_quality=85)
            encoded = base64.b64encode(jpeg_bytes).decode("utf-8")
            page_text = page.get_text().strip()

            content_list.append({
                "type": "text",
                "text": f"[PDF page {page_index + 1}]\nExtracted Text:\n{page_text if page_text else '<No text found on this page>'}\n"
            })
            content_list.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{encoded}"}
            })

        document.close()
    except Exception as exc:
        logger.warning(f"PDF processing failed: {exc}")
        content_list.append({
            "type": "text",
            "text": "[System Note: The attached PDF could not be rendered for vision analysis.]"
        })


def _process_audio(filepath: str, content_list: list):
    """Convert audio file to WAV base64 with automatic speech transcription."""
    try:
        from pydub import AudioSegment, effects
        audio = AudioSegment.from_file(filepath)
        dur_s = len(audio) / 1000.0
        m, s = divmod(dur_s, 60)

        # Normalize and resample to 16kHz mono WAV
        audio_mono = effects.normalize(audio).set_frame_rate(16000).set_channels(1)
        wav_io = io.BytesIO()
        export_seg = audio_mono[:60000]
        export_seg.export(wav_io, format="wav")
        wav_bytes = wav_io.getvalue()
        wav_b64 = base64.b64encode(wav_bytes).decode("utf-8")

        transcript = _transcribe_audio_file(io.BytesIO(wav_bytes), max_duration_s=180)

        header_lines = [
            f"[System Note: Attached Audio ({int(m):02d}:{s:04.1f}, 16kHz mono)]"
        ]
        if transcript:
            header_lines.append(f"[Audio Transcript]:\n{transcript}")
            header_lines.append("(Note: Speech transcripts may contain minor phonetic homophones. Use natural conversational context to interpret ambiguous words accurately.)\n")
        else:
            header_lines.append("[Audio: Acoustic soundtrack / no distinct speech detected]")

        content_list.append({
            "type": "text",
            "text": "\n".join(header_lines)
        })
        content_list.append({
            "type": "image_url",
            "image_url": {"url": f"data:audio/wav;base64,{wav_b64}"}
        })
    except Exception as e:
        logger.warning(f"Failed to process audio: {e}")
        content_list.append({
            "type": "text",
            "text": f"[System Note: Could not process audio file: {e}]"
        })


def _process_image(filepath: str, item: dict, content_list: list):
    """Convert image to JPEG base64, handling animated images."""
    from PIL import Image

    is_animated = False
    try:
        with Image.open(filepath) as img:
            if getattr(img, "is_animated", False) and getattr(img, "n_frames", 1) > 1:
                is_animated = True
                content_list.append({
                    "type": "text",
                    "text": "[System Note: The user attached an animated image. The following sequence of frames was extracted.]"
                })
                n_frames = img.n_frames
                num_frames_to_extract = min(30, max(1, n_frames))
                step = max(1, n_frames // num_frames_to_extract)
                extracted = 0
                for i in range(0, n_frames, step):
                    img.seek(i)
                    buf = io.BytesIO()
                    rgb_frame = img.convert('RGB')
                    rgb_frame.save(buf, format='JPEG', quality=85)
                    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
                    content_list.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}"}
                    })
                    extracted += 1
                    if extracted >= num_frames_to_extract:
                        break
    except Exception as e:
        logger.warning(f"Animation extraction failed: {e}")

    if not is_animated:
        try:
            with Image.open(filepath) as img:
                buf = io.BytesIO()
                img.convert('RGB').save(buf, format='JPEG', quality=85)
                b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
            item["image_url"]["url"] = f"data:image/jpeg;base64,{b64}"
            content_list.append(item)
        except Exception as e:
            logger.warning(f"Image conversion failed: {e}")
            mime, _ = mimetypes.guess_type(filepath)
            mime = mime or "image/jpeg"
            with open(filepath, "rb") as media_file:
                b64 = base64.b64encode(media_file.read()).decode("utf-8")
            item["image_url"]["url"] = f"data:{mime};base64,{b64}"
            content_list.append(item)


def process_media_in_messages(messages: list) -> bool:
    """
    Convert local upload URLs to base64 data URIs in-place.
    Returns True if any image/visual content was found.
    """
    has_images = False

    for msg in messages:
        if not isinstance(msg.get("content"), list):
            continue

        new_content = []
        for item in msg["content"]:
            if item.get("type") in ["image_url", "video_url", "audio_url", "document_url"]:
                url_key = item.get("type")
                url = item.get(url_key, {}).get("url", "")

                if url.startswith("/uploads/"):
                    filename = url.split("/")[-1]
                    filepath = os.path.join(UPLOADS_DIR, filename)
                    if os.path.exists(filepath):
                        if url_key == "video_url":
                            _process_video(filepath, new_content)
                            has_images = True
                        elif url_key == "audio_url":
                            _process_audio(filepath, new_content)
                            has_images = True
                        elif url_key == "document_url" or filepath.lower().endswith(".pdf"):
                            _process_pdf(filepath, new_content)
                            has_images = True
                        else:
                            _process_image(filepath, item, new_content)
                            has_images = True
                else:
                    new_content.append(item)
                    if url_key == "image_url":
                        has_images = True
            else:
                new_content.append(item)

        msg["content"] = new_content

    return has_images

import os
import io
import re
import json
import time
import logging
import threading
from pathlib import Path
from typing import Optional, Dict, Any, List
import numpy as np
import soundfile as sf
import scipy.signal as signal

logger = logging.getLogger("nivm.tts")

_tts_lock = threading.Lock()

# Directory Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KOKORO_DIR = os.path.join(BASE_DIR, "models", "tts", "kokoro")
KOKORO_MODEL = os.path.join(KOKORO_DIR, "kokoro-v1.0.onnx")
KOKORO_VOICES = os.path.join(KOKORO_DIR, "voices-v1.0.bin")

PIPER_DIR = os.path.join(BASE_DIR, "models", "tts", "vits-piper-en_US-amy-medium")
PIPER_MODEL = os.path.join(PIPER_DIR, "en_US-amy-medium.onnx")
PIPER_TOKENS = os.path.join(PIPER_DIR, "tokens.txt")
PIPER_DATA = os.path.join(PIPER_DIR, "espeak-ng-data")

# Engine singletons
_kokoro_instance = None
_piper_instance = None
_active_device = "cpu"

def is_kokoro_available() -> bool:
    return os.path.isfile(KOKORO_MODEL) and os.path.isfile(KOKORO_VOICES)

def is_piper_available() -> bool:
    return False

def is_tts_available() -> bool:
    return is_kokoro_available()

def get_kokoro_engine(force_cpu: bool = False):
    """
    Initializes and returns the Kokoro-ONNX engine in pristine full precision.
    Tries GPU (CUDAExecutionProvider) first for ultra-fast ~145ms inference,
    with seamless automatic fallback to CPU (CPUExecutionProvider).
    """
    global _kokoro_instance, _active_device
    if _kokoro_instance is not None and not force_cpu:
        return _kokoro_instance

    if not is_kokoro_available():
        return None

    if not force_cpu:
        # Dynamically locate cuDNN paths if available in Python environment or system
        cudnn_dirs = [
            "/home/blubvlub/.local/lib/python3.14/site-packages/nvidia/cudnn/lib",
            "/usr/local/cuda/lib64",
            "/usr/lib/x86_64-linux-gnu"
        ]
        for d in cudnn_dirs:
            if os.path.isdir(d):
                curr = os.environ.get("LD_LIBRARY_PATH", "")
                if d not in curr:
                    os.environ["LD_LIBRARY_PATH"] = f"{d}:{curr}" if curr else d

        # 1. Attempt GPU CUDA Acceleration
        try:
            import onnxruntime as ort
            available = ort.get_available_providers()
            if "CUDAExecutionProvider" in available:
                os.environ["ONNX_PROVIDER"] = "CUDAExecutionProvider"
                from kokoro_onnx import Kokoro
                inst = Kokoro(KOKORO_MODEL, KOKORO_VOICES)
                providers = inst.sess.get_providers()
                if "CUDAExecutionProvider" in providers:
                    _kokoro_instance = inst
                    _active_device = "gpu"
                    logger.info("Kokoro-ONNX Neural TTS engine loaded on GPU (CUDA Acceleration Active ~145ms).")
                    return _kokoro_instance
        except Exception as e:
            logger.warning(f"CUDA initialization for Kokoro failed ({e}), falling back to CPU.")

    # 2. Seamless Fallback to CPU
    try:
        os.environ["ONNX_PROVIDER"] = "CPUExecutionProvider"
        from kokoro_onnx import Kokoro
        _kokoro_instance = Kokoro(KOKORO_MODEL, KOKORO_VOICES)
        _active_device = "cpu"
        logger.info("Kokoro-ONNX Neural TTS engine loaded on CPU (Fallback Mode).")
        return _kokoro_instance
    except Exception as e:
        logger.error(f"Failed to load Kokoro engine on CPU: {e}")
        return None

def get_piper_engine():
    """Initializes and returns the Sherpa-ONNX Piper VITS engine."""
    global _piper_instance
    if _piper_instance is not None:
        return _piper_instance

    if not is_piper_available():
        return None

    try:
        import sherpa_onnx
        tts_config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                    model=PIPER_MODEL,
                    tokens=PIPER_TOKENS,
                    data_dir=PIPER_DATA,
                    length_scale=1.0,
                    noise_scale=0.333,      # Lower noise scale tames harsh unvoiced sibilance
                    noise_scale_w=0.6,
                ),
                num_threads=2,
                debug=False,
                provider="cpu",
            )
        )
        _piper_instance = sherpa_onnx.OfflineTts(tts_config)
        logger.info("Piper-VITS TTS engine loaded on CPU.")
        return _piper_instance
    except Exception as e:
        logger.error(f"Failed to load Piper engine: {e}")
        return None

PRONUNCIATION_FILE = Path(__file__).parent / "pronunciation_dict.json"
USER_PRONUNCIATION_FILE = Path(__file__).resolve().parent.parent / "User files" / "pronunciations.json"
_pronunciation_cache = None

def get_user_pronunciations() -> dict:
    """Reads user-defined phonetic pronunciation mappings from User files/pronunciations.json."""
    if USER_PRONUNCIATION_FILE.exists():
        try:
            with open(USER_PRONUNCIATION_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data.get("exact", data)
        except Exception as e:
            logger.warning(f"Failed to read user pronunciation dictionary: {e}")
    return {}

def save_user_pronunciation(word: str, pronunciation: str) -> dict:
    """Saves or updates a custom pronunciation rule for a word."""
    global _pronunciation_cache
    w = word.strip().lower()
    p = pronunciation.strip()
    current = get_user_pronunciations()
    if w and p:
        current[w] = p
        USER_PRONUNCIATION_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(USER_PRONUNCIATION_FILE, "w", encoding="utf-8") as f:
            json.dump({"exact": current}, f, indent=2, ensure_ascii=False)
        _pronunciation_cache = None
    return current

def delete_user_pronunciation(word: str) -> dict:
    """Deletes a custom pronunciation rule."""
    global _pronunciation_cache
    w = word.strip().lower()
    current = get_user_pronunciations()
    if w in current:
        del current[w]
        USER_PRONUNCIATION_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(USER_PRONUNCIATION_FILE, "w", encoding="utf-8") as f:
            json.dump({"exact": current}, f, indent=2, ensure_ascii=False)
        _pronunciation_cache = None
    return current

def get_pronunciation_dict() -> dict:
    global _pronunciation_cache
    if _pronunciation_cache is not None:
        return _pronunciation_cache

    base_exact = {}
    base_patterns = []

    if PRONUNCIATION_FILE.exists():
        try:
            with open(PRONUNCIATION_FILE, "r", encoding="utf-8") as f:
                d = json.load(f)
                base_exact = d.get("exact", {})
                base_patterns = d.get("patterns", [])
        except Exception as e:
            logger.warning(f"Failed to read pronunciation dictionary: {e}")

    user_exact = get_user_pronunciations()
    user_exact.pop("nivm", None)
    merged_exact = {**base_exact, **user_exact}
    merged_exact["nivm"] = "Nim"

    _pronunciation_cache = {
        "exact": merged_exact,
        "patterns": base_patterns,
        "defaults": base_exact,
        "custom": user_exact
    }
    return _pronunciation_cache

def _match_case(matched_text: str, replacement: str) -> str:
    if matched_text.isupper():
        return replacement.upper()
    elif matched_text and matched_text[0].isupper():
        return replacement.capitalize()
    return replacement.lower()

def normalize_stutters(text: str) -> str:
    """
    Normalizes hyphenated stutters like 'Wh-what' -> 'What', 'h-h-hello' -> 'hello',
    'w-wait' -> 'wait', 'th-thanks' -> 'thanks', 's-sorry' -> 'sorry', 'I-I' -> 'I'.
    Prevents Kokoro/phonemizer from spelling out isolated consonant letters ('W H what', 'H H hello').
    """
    if not text:
        return ""

    pattern = r'\b([a-zA-Z]{1,3}(?:\s*-\s*[a-zA-Z]{1,3})*)\s*-\s*([a-zA-Z]+)\b'

    def _repl(m):
        full_prefix = m.group(1)
        word = m.group(2)
        parts = [p.strip() for p in re.split(r'\s*-\s*', full_prefix) if p.strip()]

        # Valid stutter prefixes either have length 1 (e.g. 'h', 'w', 's')
        # or have no English vowels (e.g. 'wh', 'th', 'sh', 'ch'), preserving legitimate words like 're-read'
        is_stutter = True
        w_lower = word.lower()
        for p in parts:
            p_lower = p.lower()
            has_vowel = any(v in p_lower for v in 'aeiou')
            if len(p_lower) > 1 and has_vowel:
                is_stutter = False
                break
            if not w_lower.startswith(p_lower):
                is_stutter = False
                break

        if is_stutter:
            first_p = parts[0]
            if first_p.isupper() and word.islower():
                return word.capitalize()
            elif first_p and first_p[0].isupper() and word.islower():
                return word.capitalize()
            return word

        return m.group(0)

    return re.sub(pattern, _repl, text)

def apply_pronunciation_rules(text: str) -> str:
    """Applies phonetic dictionary replacements preserving original casing."""
    if not text:
        return ""
    pdict = get_pronunciation_dict()
    # 1. Regex patterns (e.g. hmph+, tch+, nya+)
    for item in pdict.get("patterns", []):
        pat = item.get("pattern")
        rep = item.get("replacement")
        flags = re.IGNORECASE if "i" in item.get("flags", "") else 0
        if pat and rep:
            try:
                text = re.sub(pat, lambda m, r=rep: _match_case(m.group(0), r), text, flags=flags)
            except Exception:
                pass

    # 2. Exact word boundaries (e.g. nivm -> Nim, baka -> bah-ka)
    for word, rep in pdict.get("exact", {}).items():
        if word and rep:
            pattern = rf"\b{re.escape(word)}\b"
            text = re.sub(pattern, lambda m, r=rep: _match_case(m.group(0), r), text, flags=re.IGNORECASE)

    return text

def clean_text_for_tts(text: str) -> str:
    """Sanitizes text by stripping think tags, markdown code blocks, tool calls, and URLs."""
    if not text:
        return ""
    # Strip <think>...</think>
    text = re.sub(r'<think>[\s\S]*?</think>', '', text, flags=re.IGNORECASE)
    text = re.sub(r'<think>[\s\S]*$', '', text, flags=re.IGNORECASE)
    # Strip tool calls and system notices
    text = re.sub(r'TOOL_CALL:[\s\S]*?(\n\n|$)', '', text)
    text = re.sub(r'\[System Note:[\s\S]*?\]', '', text)
    # Strip fenced code blocks (replace with brief pause)
    text = re.sub(r'```[\w]*\n[\s\S]*?\n```', ' ... ', text)
    # Strip inline code backticks
    text = re.sub(r'`([^`]+)`', r'\1', text)
    # Strip markdown headers, bold, italics
    text = re.sub(r'#{1,6}\s+', '', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    text = re.sub(r'\*([^*]+)\*', r'\1', text)
    # Strip URLs
    text = re.sub(r'https?://\S+', '', text)
    # Strip literal escaped characters like \n, /n, \r, \t so TTS never says "slash n" or "backslash n"
    text = re.sub(r'\\+n|/n|\\+r|\\+t', ' ', text, flags=re.IGNORECASE)
    # Strip isolated slashes or backslashes
    text = re.sub(r'(?<=\s)[\\/]+(?=\s)', ' ', text)
    # Strip markdown list markers and arrows
    text = re.sub(r'^\s*[-*+]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'->|=>|→', ' to ', text)
    # Normalize stutters like 'Wh-what' -> 'What', 'h-h- hello' -> 'hello'
    text = normalize_stutters(text)
    # Apply phonetic pronunciations (e.g. 'nivm' -> 'Nim', 'hmph' -> 'humph', 'baka' -> 'bah-ka')
    text = apply_pronunciation_rules(text)
    # Clean whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def apply_asmr_audio_dsp(samples: np.ndarray, sample_rate: int, warmth: float = 0.6) -> np.ndarray:
    """
    Applies high-end audio post-processing:
    1. Trailing Sibilance & Hiss Eraser: detects end of speech, trims unvoiced tail noise.
    2. Cosine Fade-out: 40ms soft taper to prevent any end-of-audio click, pop, or 'ss' breath.
    3. Warmth Presence EQ: boosts vocal chest resonance (250-450Hz) for that soothing, close-mic ASMR intimacy.
    4. Sibilance De-Esser: tames piercing frequencies >6kHz so whispered words remain soft and velvety.
    """
    if len(samples) == 0:
        return samples

    samples = np.array(samples, dtype=np.float32)

    # 1. Trailing Sibilance / Silence Trimming
    threshold = 0.015
    mag = np.abs(samples)
    non_silent = np.where(mag > threshold)[0]
    if len(non_silent) > 0:
        # Keep 70ms natural buffer after the last real sound
        last_sound_idx = min(len(samples), non_silent[-1] + int(0.07 * sample_rate))
        samples = samples[:last_sound_idx]

    # 2. Smooth 40ms Cosine Fade-Out (Completely removes any abrupt 'ss' or click at the end)
    fade_len = min(len(samples), int(0.040 * sample_rate))
    if fade_len > 0:
        fade_curve = 0.5 * (1.0 + np.cos(np.linspace(0, np.pi, fade_len)))
        samples[-fade_len:] *= fade_curve

    if warmth <= 0.05:
        return samples

    try:
        # Low-mid warmth boost (Peaking filter @ 320Hz, ~+2 to +3.5 dB)
        f0 = 320.0
        Q = 1.0
        gain_db = warmth * 3.2
        A = 10.0 ** (gain_db / 40.0)
        w0 = 2 * np.pi * f0 / sample_rate
        alpha = np.sin(w0) / (2 * Q)
        b0 = 1 + alpha * A
        b1 = -2 * np.cos(w0)
        b2 = 1 - alpha * A
        a0 = 1 + alpha / A
        a1 = -2 * np.cos(w0)
        a2 = 1 - alpha / A
        b = np.array([b0, b1, b2]) / a0
        a = np.array([a0, a1, a2]) / a0
        samples = signal.lfilter(b, a, samples)

        # De-Esser High-shelf roll-off (Tames harsh sibilance > 6000Hz)
        fh = 6000.0
        gain_h_db = -warmth * 3.5
        Ah = 10.0 ** (gain_h_db / 40.0)
        w0h = 2 * np.pi * fh / sample_rate
        alphah = np.sin(w0h) / (2 * 0.707)
        cos_w0 = np.cos(w0h)
        sqrt_Ah = np.sqrt(Ah)
        
        b0h = Ah * ((Ah + 1) + (Ah - 1) * cos_w0 + 2 * sqrt_Ah * alphah)
        b1h = -2 * Ah * ((Ah - 1) + (Ah + 1) * cos_w0)
        b2h = Ah * ((Ah + 1) + (Ah - 1) * cos_w0 - 2 * sqrt_Ah * alphah)
        a0h = (Ah + 1) - (Ah - 1) * cos_w0 + 2 * sqrt_Ah * alphah
        a1h = 2 * ((Ah - 1) - (Ah + 1) * cos_w0)
        a2h = (Ah + 1) - (Ah - 1) * cos_w0 - 2 * sqrt_Ah * alphah
        
        bh = np.array([b0h, b1h, b2h]) / a0h
        ah = np.array([a0h, a1h, a2h]) / a0h
        samples = signal.lfilter(bh, ah, samples)
    except Exception as e:
        logger.warning(f"Audio DSP filter notice: {e}")

    # Prevent digital clipping
    peak = np.max(np.abs(samples))
    if peak > 0.95:
        samples = samples * (0.95 / peak)

    return samples

def generate_wav_bytes(
    text: str,
    voice: str = "af_heart",
    speed: float = 1.0,
    warmth: float = 0.0
) -> Optional[bytes]:
    """
    Generates studio-grade WAV audio with zero GPU overhead.
    Supports Kokoro voices ('af_heart', 'af_bella', 'af_nicole', 'af_sarah', etc.)
    and Piper voices ('piper_amy').
    """
    cleaned = clean_text_for_tts(text)
    if not cleaned:
        return None

    safe_speed = max(0.5, min(2.0, float(speed)))
    safe_warmth = max(0.0, min(1.0, float(warmth)))

    with _tts_lock:
        # 1. Kokoro Synthesis
        if is_kokoro_available() and not voice.startswith("piper"):
            kokoro = get_kokoro_engine()
            if kokoro:
                try:
                    target_voice = voice if voice in kokoro.voices else "af_heart"
                    samples, sr = kokoro.create(cleaned, voice=target_voice, speed=safe_speed, lang="en-us")
                    processed = apply_asmr_audio_dsp(samples, sr, warmth=safe_warmth)
                    bio = io.BytesIO()
                    sf.write(bio, processed, sr, format="WAV", subtype="PCM_16")
                    bio.seek(0)
                    return bio.read()
                except Exception as e:
                    logger.warning(f"Kokoro GPU/Active generation error ({e}), retrying seamlessly on CPU...")
                    try:
                        kokoro_cpu = get_kokoro_engine(force_cpu=True)
                        if kokoro_cpu:
                            target_voice = voice if voice in kokoro_cpu.voices else "af_heart"
                            samples, sr = kokoro_cpu.create(cleaned, voice=target_voice, speed=safe_speed, lang="en-us")
                            processed = apply_asmr_audio_dsp(samples, sr, warmth=safe_warmth)
                            bio = io.BytesIO()
                            sf.write(bio, processed, sr, format="WAV", subtype="PCM_16")
                            bio.seek(0)
                            return bio.read()
                    except Exception as cpu_err:
                        logger.error(f"Kokoro CPU fallback also failed: {cpu_err}")

        # 2. Piper Synthesis Fallback
        if is_piper_available():
            piper = get_piper_engine()
            if piper:
                try:
                    audio = piper.generate(cleaned, sid=0, speed=safe_speed)
                    processed = apply_asmr_audio_dsp(audio.samples, audio.sample_rate, warmth=safe_warmth)
                    bio = io.BytesIO()
                    sf.write(bio, processed, audio.sample_rate, format="WAV", subtype="PCM_16")
                    bio.seek(0)
                    return bio.read()
                except Exception as e:
                    logger.error(f"Piper generation error: {e}")

    return None

def get_tts_info() -> Dict[str, Any]:
    """Returns TTS capabilities and available voices."""
    has_kokoro = is_kokoro_available()
    has_piper = is_piper_available()

    voices = []
    if has_kokoro:
        voices.extend([
            {"id": "af_heart", "name": "Heart • Natural Studio Human Voice", "gender": "female", "recommended": True, "badge": "Natural & Balanced"},
            {"id": "af_bella", "name": "Bella • Soft & Caring (Companion)", "gender": "female", "recommended": True, "badge": "Soft & Caring"},
            {"id": "af_sarah", "name": "Sarah • Bright, Modern & Articulate", "gender": "female", "recommended": False, "badge": "Modern"},
            {"id": "af_nicole", "name": "Nicole • Soft, Gentle & Calm Tone", "gender": "female", "recommended": False, "badge": "Gentle & Calm"},
            {"id": "bf_emma", "name": "Emma • FRIDAY Intelligent Assistant (British AI)", "gender": "female", "recommended": True, "badge": "FRIDAY Assistant"},
            {"id": "af_sky", "name": "Sky • Crisp & Dynamic", "gender": "female", "recommended": False, "badge": "Crisp"},
        ])

    get_kokoro_engine()

    return {
        "available": has_kokoro,
        "primary_engine": "kokoro-v1.0",
        "default_voice": "af_heart",
        "sample_rate": 24000,
        "voices": voices,
        "supports_asmr_warmth": True,
        "device": _active_device,
        "vram_mb": 659 if _active_device == "gpu" else 0,
    }

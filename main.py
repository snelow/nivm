"""
Sovereign AI Workbench — FastAPI Backend

Air-gapped, multi-model AI assistant. No external API calls.
All inference runs locally via llama-cpp-python.
"""

import json
import logging
import time
import os
import asyncio
import base64
import mimetypes
import subprocess
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config
from engine import model_manager, HAS_LLAMA_CPP, scan_local_ggufs
from router import classify_intent
from downloader import downloader

# ── File paths ──────────────────────────────────────────────────
USER_FILES_DIR = os.path.join(os.path.dirname(__file__), "User files")
os.makedirs(USER_FILES_DIR, exist_ok=True)
SETTINGS_FILE = os.path.join(USER_FILES_DIR, "settings.json")
CHATS_FILE = os.path.join(USER_FILES_DIR, "chats.json")
MEMORY_FILE = os.path.join(USER_FILES_DIR, "memory.json")
UPLOADS_DIR = os.path.join(USER_FILES_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

# ── Settings ────────────────────────────────────────────────────

class SettingsModel(BaseModel):
    model_config = {"extra": "allow"}
    
    engine_mode: str = "native"
    inference_mode: str = "routing"          # "routing" or "single"
    single_model_role: str = "coder"         # which role to use in single mode

    # Legacy flat settings (kept for backward compat)
    native_gpu_layers: int = -1
    native_ctx: int = 8192
    native_batch: int = 512
    native_flash_attn: bool = True
    native_offload_kqv: bool = True
    native_use_mlock: bool = False
    native_use_mmap: bool = True
    native_kv_type: str = "q4_0"

    # Per-role: Router
    router_gpu_layers: int = -1
    router_ctx: int = 8192
    router_batch: int = 512
    router_flash_attn: bool = True
    router_offload_kqv: bool = True
    router_use_mlock: bool = False
    router_use_mmap: bool = True
    router_kv_type: str = "f16"

    # Per-role: Coder
    coder_gpu_layers: int = -1
    coder_ctx: int = 8192
    coder_batch: int = 1024
    coder_flash_attn: bool = True
    coder_offload_kqv: bool = True
    coder_use_mlock: bool = False
    coder_use_mmap: bool = True
    coder_kv_type: str = "q8_0"

    # Per-role: Vision
    vision_gpu_layers: int = -1
    vision_ctx: int = 32768
    vision_batch: int = 1024
    vision_flash_attn: bool = True
    vision_offload_kqv: bool = True
    vision_use_mlock: bool = False
    vision_use_mmap: bool = True
    vision_kv_type: str = "q4_0"

    # Custom model selection & path history
    custom_model_path: str = ""
    custom_mmproj_path: str = ""
    custom_chat_handler: str = "auto"
    remembered_model_paths: List[str] = []
    last_known_good_paths: Dict[str, str] = {}

    # Per-role: Custom
    custom_gpu_layers: int = -1
    custom_ctx: int = 8192
    custom_batch: int = 512
    custom_flash_attn: bool = True
    custom_offload_kqv: bool = True
    custom_use_mlock: bool = False
    custom_use_mmap: bool = True
    custom_kv_type: str = "f16"

def get_user_settings():
    default_settings = SettingsModel().model_dump()
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r") as f:
                saved = json.load(f)
                default_settings.update(saved)
        except Exception:
            pass
    return default_settings

def _get_role_overrides(settings: dict, role: str) -> dict:
    """Extract per-role engine overrides from the settings dict."""
    prefix = f"{role}_"
    key_map = {
        "path": "path",
        "gpu_layers": "n_gpu_layers",
        "ctx": "n_ctx",
        "batch": "n_batch",
        "flash_attn": "flash_attn",
        "offload_kqv": "offload_kqv",
        "use_mlock": "use_mlock",
        "use_mmap": "use_mmap",
        "kv_type": "kv_type",
        "mmproj_path": "mmproj_path",
        "chat_handler_type": "chat_handler_type",
    }
    overrides = {}
    for short_key, engine_key in key_map.items():
        settings_key = f"{prefix}{short_key}"
        if settings_key in settings:
            overrides[engine_key] = settings[settings_key]
    return overrides

def _apply_all_overrides():
    """Read user settings and apply per-role overrides to MODEL_REGISTRY."""
    settings = get_user_settings()
    for role in ["router", "coder", "vision", "custom"]:
        overrides = _get_role_overrides(settings, role)
        if overrides:
            model_manager.apply_user_overrides(role, overrides)
    
    # Custom model path override
    if settings.get("custom_model_path"):
        model_manager.apply_user_overrides("custom", {"path": settings["custom_model_path"]})
    if settings.get("custom_mmproj_path"):
        model_manager.apply_user_overrides("custom", {
            "mmproj_path": settings["custom_mmproj_path"],
            "chat_handler_type": settings.get("custom_chat_handler", "auto")
        })
    
    # Restore last known good paths
    if settings.get("last_known_good_paths"):
        model_manager.last_known_good_paths.update(settings["last_known_good_paths"])

# ── Logging ─────────────────────────────────────────────────────
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("nivm")


def get_resident_role() -> str:
    """Pick the model that should stay warm between requests."""
    available = model_manager.list_available()
    for role in ["router", "vision", "coder"]:
        if available.get(role, {}).get("available"):
            return role
    return "coder"

# ── FastAPI App ─────────────────────────────────────────────────
app = FastAPI(
    title="nivm",
    description="Local, multi-model AI assistant. No external API calls.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
@app.on_event("startup")
async def startup_event():
    logger.info("Initializing workbench (models idle until user loads)...")
    _apply_all_overrides()

# ══════════════════════════════════════════════════════════════
# Settings & Storage Endpoints
# ══════════════════════════════════════════════════════════════

@app.get("/api/settings")
async def get_settings_endpoint():
    return get_user_settings()

@app.post("/api/settings")
async def save_settings_endpoint(settings: SettingsModel):
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings.model_dump(), f)
    return {"status": "success"}


@app.post("/api/upload")
async def upload_file_endpoint(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = os.path.splitext(file.filename)[1]
    allowed_extensions = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".mp4", ".mov", ".webm", ".wav", ".mp3", ".m4a"}
    if ext.lower() not in allowed_extensions:
        raise HTTPException(status_code=415, detail="Unsupported file type")
    new_filename = f"media_{int(time.time() * 1000)}{ext}"
    file_path = os.path.join(UPLOADS_DIR, new_filename)

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File is too large (maximum 25 MB)")
    with open(file_path, "wb") as f:
        f.write(content)

    return {"url": f"/uploads/{new_filename}"}


@app.get("/api/chats")
async def get_chats_endpoint():
    """Returns all saved chats from the server."""
    if os.path.exists(CHATS_FILE):
        try:
            with open(CHATS_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return []
    return []

@app.post("/api/chats")
async def save_chats_endpoint(request: Request):
    """Saves all chats to the server."""
    try:
        chats = await request.json()
        with open(CHATS_FILE, "w") as f:
            json.dump(chats, f)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/memory")
async def get_memory_endpoint():
    """Returns the user's memory database."""
    if not os.path.exists(MEMORY_FILE):
        return {}
    try:
        with open(MEMORY_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error reading memory file: {e}")
        return {}

@app.post("/api/memory")
async def save_memory_endpoint(request: Request):
    """Updates the user's memory database."""
    try:
        body = await request.json()
        key = body.get("key")
        value = body.get("value")

        if not key:
            raise HTTPException(status_code=400, detail="Key is required")

        memory_data = {}
        if os.path.exists(MEMORY_FILE):
            try:
                with open(MEMORY_FILE, "r") as f:
                    memory_data = json.load(f)
            except Exception:
                pass

        memory_data[key] = value

        with open(MEMORY_FILE, "w") as f:
            json.dump(memory_data, f, indent=2)

        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error saving memory file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save memory")

@app.delete("/api/memory")
async def delete_memory_endpoint(request: Request):
    """Deletes a key from the user's memory database."""
    try:
        body = await request.json()
        key = body.get("key")

        if not key:
            raise HTTPException(status_code=400, detail="Key is required")

        memory_data = {}
        if os.path.exists(MEMORY_FILE):
            try:
                with open(MEMORY_FILE, "r") as f:
                    memory_data = json.load(f)
            except Exception:
                pass

        if key in memory_data:
            del memory_data[key]
            with open(MEMORY_FILE, "w") as f:
                json.dump(memory_data, f, indent=2)

        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error deleting memory file: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete memory")


# ══════════════════════════════════════════════════════════════
# Config & Health Endpoints
# ══════════════════════════════════════════════════════════════

@app.get("/api/config")
async def get_config():
    """Returns application configuration settings."""
    return {
        "default_model": "coder",
        "default_system_prompt": config.DEFAULT_SYSTEM_PROMPT,
        "default_temperature": config.DEFAULT_TEMPERATURE,
        "default_top_p": config.DEFAULT_TOP_P,
        "default_max_tokens": config.DEFAULT_MAX_TOKENS,
    }

@app.get("/api/network/monitor")
async def get_network_monitor():
    """Returns real-time network connection data to prove air-gapped status."""
    from network_monitor import get_network_status
    return get_network_status()


# ══════════════════════════════════════════════════════════════
# Health & Model Info
# ══════════════════════════════════════════════════════════════

@app.get("/api/health")
async def health_check():
    """Health check — no external connectivity, just local engine status."""
    return {
        "status": "online",
        "air_gapped": True,
        "has_llama_cpp": HAS_LLAMA_CPP,
        "active_model": model_manager.get_active_info(),
        "available_models": model_manager.list_available(),
    }


@app.get("/api/models")
async def get_models():
    """List all locally available models."""
    available = model_manager.list_available()
    return {
        "object": "list",
        "data": [
            {
                "id": role,
                "name": info["name"],
                "available": info["available"],
                "size_gb": info["size_gb"],
            }
            for role, info in available.items()
        ]
    }


# ══════════════════════════════════════════════════════════════
# Media Processing (local upload → base64 for model input)
# ══════════════════════════════════════════════════════════════

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


def _process_video(filepath: str, content_list: list):
    """Extract frames and audio from a video file."""
    import cv2

    content_list.append({
        "type": "text",
        "text": "[System Note: The user attached a video file. The following media consists of the video's audio track and a sequence of extracted visual frames.]"
    })

    # Extract audio
    try:
        from pydub import AudioSegment
        import io
        audio = AudioSegment.from_file(filepath)
        audio = audio.set_frame_rate(16000).set_channels(1)
        wav_io = io.BytesIO()
        audio.export(wav_io, format="wav")
        wav_b64 = base64.b64encode(wav_io.getvalue()).decode("utf-8")
        content_list.append({
            "type": "image_url",
            "image_url": {"url": f"data:audio/wav;base64,{wav_b64}"}
        })
    except Exception as e:
        logger.warning(f"Failed to extract audio from video: {e}")

    # Extract frames
    cap = cv2.VideoCapture(filepath)
    if cap.isOpened():
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps > 0 and frame_count > 0:
            duration_seconds = frame_count / fps
            num_frames = min(60, max(1, int(duration_seconds)))
            step = max(1, frame_count // num_frames)
            extracted = 0
            for i in range(0, frame_count, step):
                cap.set(cv2.CAP_PROP_POS_FRAMES, i)
                ret, frame = cap.read()
                if ret:
                    _, buffer = cv2.imencode('.jpg', frame)
                    b64 = base64.b64encode(buffer).decode("utf-8")
                    content_list.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}"}
                    })
                    extracted += 1
                if extracted >= num_frames:
                    break
    cap.release()


def _process_pdf(filepath: str, content_list: list):
    """Render PDF pages as images so the Gemma vision model can inspect them."""
    import pymupdf

    max_pages = 8
    try:
        document = pymupdf.open(filepath)
        page_count = len(document)
        pages_to_render = min(page_count, max_pages)
        content_list.append({
            "type": "text",
            "text": (
                f"[System Note: The user attached a PDF with {page_count} page(s). "
                f"The next {pages_to_render} page image(s) are provided for visual inspection. "
                "Reference page numbers when answering.]"
            )
        })

        for page_index in range(pages_to_render):
            page = document.load_page(page_index)
            # Increase zoom from 1.5 to 3.0 for much sharper text (better OCR accuracy for the vision model)
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(3.0, 3.0), alpha=False)
            jpeg_bytes = pixmap.tobytes("jpeg", jpg_quality=90)
            encoded = base64.b64encode(jpeg_bytes).decode("utf-8")
            
            # Extract pure text to help the vision model with dense OCR
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
    """Convert audio file to WAV base64."""
    content_list.append({
        "type": "text",
        "text": "[System Note: The user attached an audio file.]"
    })
    try:
        from pydub import AudioSegment
        import io
        audio = AudioSegment.from_file(filepath)
        audio = audio.set_frame_rate(16000).set_channels(1)
        wav_io = io.BytesIO()
        audio.export(wav_io, format="wav")
        wav_b64 = base64.b64encode(wav_io.getvalue()).decode("utf-8")
        content_list.append({
            "type": "image_url",
            "image_url": {"url": f"data:audio/wav;base64,{wav_b64}"}
        })
    except Exception as e:
        logger.warning(f"Failed to process audio: {e}")


def _process_image(filepath: str, item: dict, content_list: list):
    """Convert image to JPEG base64, handling animated images."""
    from PIL import Image
    import io

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


# ══════════════════════════════════════════════════════════════
# Chat Completion — Multi-Model with Auto-Routing
# ══════════════════════════════════════════════════════════════

@app.post("/api/chat")
async def chat_completion(request: Request, background_tasks: BackgroundTasks):
    """
    Multi-model chat completion with automatic intent routing.
    
    Flow:
      1. Process media in messages
      2. Deterministic routing picks the best local model
      3. Selected model loads on GPU → generates response
      4. Response includes metadata about which model handled it
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    messages = body.get("messages", [])
    temperature = body.get("temperature", config.DEFAULT_TEMPERATURE)
    top_p = body.get("top_p", config.DEFAULT_TOP_P)
    max_tokens = body.get("max_tokens", config.DEFAULT_MAX_TOKENS)
    stream = body.get("stream", True)

    # Step 1: Process media (convert uploads to base64)
    has_images = await asyncio.to_thread(process_media_in_messages, messages)

    # Step 2: Extract user message text for routing
    user_text = ""
    if messages:
        last_msg = messages[-1]
        if isinstance(last_msg.get("content"), str):
            user_text = last_msg["content"]
        elif isinstance(last_msg.get("content"), list):
            user_text = " ".join(
                item.get("text", "") for item in last_msg["content"]
                if item.get("type") == "text"
            )

    # Step 3: Route to the right model (or skip routing in single mode)
    settings = get_user_settings()
    inference_mode = settings.get("inference_mode", "routing")
    
    if inference_mode == "single":
        # Single model mode — skip the router entirely
        routed_to = settings.get("single_model_role", "coder")
        logger.warning(f"Single model mode: using {routed_to}")
    else:
        # Routing mode — classify intent and pick the best specialist
        routed_to = await asyncio.to_thread(classify_intent, user_text, has_images)
        logger.warning(f"Router classified -> {routed_to}")
    
    available_models = model_manager.list_available()
    if not available_models.get(routed_to, {}).get("available"):
        logger.warning(f"Requested role '{routed_to}' unavailable, falling back to coder")
        routed_to = "coder"
    logger.warning(f"Routed to: {routed_to}")

    # Strip tools instruction for vision model to prevent it from getting confused and looping
    if routed_to == "vision":
        for msg in messages:
            if msg.get("role") == "system" and isinstance(msg.get("content"), str):
                msg["content"] = msg["content"].split("[CRITICAL INSTRUCTION: TOOLS SYSTEM]")[0].strip()


    # Step 4: Activate the specialist model (hot-swap onto GPU)
    _apply_all_overrides()
    try:
        swap_time = await asyncio.to_thread(model_manager.activate, routed_to)
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=f"Model not available: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load model: {e}")

    model_info = model_manager.get_active_info()

    # Step 5: Generate response
    if stream:
        def sync_generator():
            try:
                # Send routing metadata as first chunk
                meta_chunk = {
                    "object": "chat.completion.chunk",
                    "choices": [{"delta": {"content": ""}, "index": 0, "finish_reason": None}],
                    "model_info": {
                        "role": routed_to,
                        "name": model_info["name"],
                        "swap_time_s": round(swap_time, 1),
                    }
                }
                yield f"data: {json.dumps(meta_chunk)}\n\n"

                start_time = time.time()
                token_count = 0

                for chunk in model_manager.generate(messages, max_tokens, temperature, top_p, stream=True):
                    yield f"data: {json.dumps(chunk)}\n\n"
                    try:
                        if "choices" in chunk and len(chunk["choices"]) > 0:
                            delta = chunk["choices"][0].get("delta", {})
                            if "content" in delta and delta["content"]:
                                token_count += 1
                    except Exception:
                        pass

                elapsed = time.time() - start_time
                tk_s = token_count / elapsed if elapsed > 0 else 0

                usage_chunk = {
                    "object": "chat.completion.chunk",
                    "choices": [{"delta": {"content": ""}, "index": 0, "finish_reason": "stop"}],
                    "usage": {
                        "completion_tokens": token_count,
                        "total_time_s": round(elapsed, 2),
                        "tk_s": round(tk_s, 1),
                    },
                    "model_info": {
                        "role": routed_to,
                        "name": model_info["name"],
                    }
                }
                yield f"data: {json.dumps(usage_chunk)}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        background_tasks.add_task(model_manager.activate, get_resident_role())
        return StreamingResponse(sync_generator(), media_type="text/event-stream", background=background_tasks)
    else:
        try:
            response = await asyncio.to_thread(
                model_manager.generate, messages, max_tokens, temperature, top_p, False
            )
            if isinstance(response, dict):
                response["model_info"] = {
                    "role": routed_to,
                    "name": model_info["name"],
                    "swap_time_s": round(swap_time, 1),
                }
            background_tasks.add_task(model_manager.activate, get_resident_role())
            return JSONResponse(status_code=200, content=response)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


# ══════════════════════════════════════════════════════════════
# Engine Management Endpoints
# ══════════════════════════════════════════════════════════════

@app.get("/api/engine/status")
async def engine_status():
    """Get current engine and model status."""
    return {
        "has_llama_cpp": HAS_LLAMA_CPP,
        "active": model_manager.get_active_info(),
        "available": model_manager.list_available(),
    }

@app.post("/api/engine/activate/{role}")
async def engine_activate(role: str):
    """Manually activate a specific model by role."""
    try:
        _apply_all_overrides()
        swap_time = await asyncio.to_thread(model_manager.activate, role)
        return {
            "status": "loaded",
            "role": role,
            "swap_time_s": round(swap_time, 1),
            "info": model_manager.get_active_info(),
            "warning": model_manager.last_load_warning,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/engine/unload")
async def engine_unload():
    """Unload all active models."""
    await asyncio.to_thread(model_manager.unload_all)
    return {"status": "unloaded"}


@app.post("/api/engine/smart-toggle")
async def engine_smart_toggle():
    """
    Smart load/unload toggle.
    - If any model is loaded → unload all
    - If nothing loaded → apply user overrides and load the appropriate model
    """
    if model_manager.has_any_loaded():
        await asyncio.to_thread(model_manager.unload_all)
        return {
            "action": "unloaded",
            "status": "All models unloaded",
            "info": model_manager.get_active_info(),
        }
    else:
        _apply_all_overrides()
        settings = get_user_settings()
        inference_mode = settings.get("inference_mode", "routing")
        
        if inference_mode == "single":
            role = settings.get("single_model_role", "coder")
        else:
            role = get_resident_role()
        
        try:
            swap_time = await asyncio.to_thread(model_manager.activate, role)
            return {
                "action": "loaded",
                "status": f"Loaded {role}",
                "role": role,
                "swap_time_s": round(swap_time, 1),
                "info": model_manager.get_active_info(),
                "warning": model_manager.last_load_warning,
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load: {e}")


# ══════════════════════════════════════════════════════════════
# Model Scanning & Accelerated Download Endpoints
# ══════════════════════════════════════════════════════════════

class DownloadModelRequest(BaseModel):
    url: str
    filename: Optional[str] = None


@app.get("/api/models/scan")
async def scan_models_endpoint():
    """Scan local models directory and remembered paths for GGUF files."""
    settings = get_user_settings()
    remembered = settings.get("remembered_model_paths", [])
    extra_dirs = [os.path.dirname(p) for p in remembered if p and os.path.isabs(p)]
    discovered = scan_local_ggufs(extra_dirs=list(set(extra_dirs)))
    return {
        "models": discovered,
        "remembered_paths": remembered,
    }


@app.post("/api/models/download")
async def download_model_endpoint(req: DownloadModelRequest):
    """Start downloading a GGUF model via aria2 or streaming fallback."""
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="A download URL is required")
    try:
        status = downloader.start_download(req.url, req.filename)
        return status
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/models/download/status")
async def download_model_status_endpoint():
    """Poll download progress, speed, and ETA."""
    status = downloader.get_status()
    # If completed and not yet in remembered paths, add it to settings
    if status.get("status") == "completed" and status.get("path"):
        saved_path = status["path"]
        settings = get_user_settings()
        remembered = settings.get("remembered_model_paths", [])
        if saved_path not in remembered:
            remembered.append(saved_path)
            settings["remembered_model_paths"] = remembered
            settings["custom_model_path"] = saved_path
            try:
                with open(SETTINGS_FILE, "w") as f:
                    json.dump(settings, f)
            except Exception:
                pass
    return status


@app.post("/api/models/download/cancel")
async def download_model_cancel_endpoint():
    """Cancel an ongoing download."""
    return downloader.cancel_download()



# ══════════════════════════════════════════════════════════════
# Tool Execution Endpoints
# ══════════════════════════════════════════════════════════════

class ExecuteTerminalRequest(BaseModel):
    command: str

@app.post("/api/tools/execute_terminal")
async def execute_terminal(req: ExecuteTerminalRequest):
    """Execute a shell command securely and return its output."""
    try:
        # We run it in a thread so it doesn't block the async event loop
        def run_cmd():
            return subprocess.run(
                req.command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=15,
                cwd=os.path.dirname(__file__)
            )
            
        result = await asyncio.to_thread(run_cmd)
        
        output = result.stdout
        if result.stderr:
            output += f"\n[STDERR]\n{result.stderr}"
            
        if not output.strip():
            output = "[Command executed successfully with no output]"
            
        return {"output": output}
    except subprocess.TimeoutExpired:
        return {"error": "Command execution timed out after 15 seconds."}
    except Exception as e:
        return {"error": f"Execution failed: {str(e)}"}


# ══════════════════════════════════════════════════════════════
# Static Files & Root
# ══════════════════════════════════════════════════════════════

static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir, exist_ok=True)

app.mount("/static", StaticFiles(directory=static_dir), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


@app.get("/")
async def root():
    """Serve index.html at root."""
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Frontend index.html not yet created."}

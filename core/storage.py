"""
Storage, Settings, and Upload Management for nivm.
Handles local JSON persistence for chats, memory, settings, and media uploads.
"""

import os
import json
import time
import logging
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from pydantic import BaseModel

from .config import (
    SETTINGS_FILE,
    CHATS_FILE,
    MEMORY_FILE,
    UPLOADS_DIR,
    MAX_UPLOAD_BYTES,
)
from .engine import model_manager

logger = logging.getLogger("nivm.storage")

router = APIRouter(tags=["Settings & Storage"])


# ── Settings Pydantic Model ───────────────────────────────────────

class SettingsModel(BaseModel):
    model_config = {"extra": "allow"}

    engine_mode: str = "native"
    inference_mode: str = "single"          # "single", "routing", or "api"
    single_model_role: str = "coder"         # which role to use in single mode

    # API Mode settings
    api_base_url: str = "https://api.groq.com/openai/v1"
    api_chat_url: str = "https://api.groq.com/openai/v1/chat/completions"
    api_key: str = ""
    api_model: str = "llama-3.3-70b-versatile"
    api_multimodal: Optional[bool] = None

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
    vision_mmproj_use_gpu: bool = True

    # Custom model selection & path history
    custom_model_path: str = ""
    custom_mmproj_path: str = ""
    custom_mmproj_use_gpu: bool = True
    custom_chat_handler: str = "auto"
    remembered_model_paths: List[str] = []
    last_known_good_paths: Dict[str, str] = {}
    pdf_render_dpi: int = 150

    # Per-role: Custom
    custom_gpu_layers: int = -1
    custom_ctx: int = 8192
    custom_batch: int = 512
    custom_flash_attn: bool = True
    custom_offload_kqv: bool = True
    custom_use_mlock: bool = False
    custom_use_mmap: bool = True
    custom_kv_type: str = "f16"


def get_user_settings() -> dict:
    """Load settings from settings.json merged with default SettingsModel."""
    default_settings = SettingsModel().model_dump()
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r") as f:
                saved = json.load(f)
                default_settings.update(saved)
        except Exception as e:
            logger.warning(f"Failed to read settings file: {e}")
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
        "mmproj_use_gpu": "mmproj_use_gpu",
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
    custom_path = settings.get("custom_model_path", "").strip()
    if custom_path:
        model_manager.apply_user_overrides("custom", {"path": custom_path})

    # Custom mmproj override
    custom_mmproj = settings.get("custom_mmproj_path", "").strip()
    if custom_mmproj.lower() == "none":
        custom_mmproj = ""
    model_manager.apply_user_overrides("custom", {
        "mmproj_path": custom_mmproj,
        "mmproj_use_gpu": settings.get("custom_mmproj_use_gpu", True),
        "chat_handler_type": settings.get("custom_chat_handler", "auto")
    })

    # Restore last known good paths
    if settings.get("last_known_good_paths"):
        model_manager.last_known_good_paths.update(settings["last_known_good_paths"])


def _cleanup_orphaned_uploads(chats: list):
    """Scan all chats for referenced upload filenames and remove unreferenced files in UPLOADS_DIR."""
    try:
        referenced_files = set()
        for chat in chats:
            if not isinstance(chat, dict):
                continue
            for msg in chat.get("messages", []):
                content = msg.get("content")
                if isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict):
                            for key in ["image_url", "video_url", "audio_url", "document_url"]:
                                obj = part.get(key)
                                if isinstance(obj, dict) and "url" in obj:
                                    referenced_files.add(os.path.basename(obj["url"]))
                                elif isinstance(obj, str):
                                    referenced_files.add(os.path.basename(obj))

        if os.path.exists(UPLOADS_DIR):
            for fname in os.listdir(UPLOADS_DIR):
                fpath = os.path.join(UPLOADS_DIR, fname)
                # Keep newly uploaded files (< 2 mins) to prevent race conditions during message composition
                if os.path.isfile(fpath):
                    mtime = os.path.getmtime(fpath)
                    if time.time() - mtime < 120:
                        continue
                    if fname not in referenced_files:
                        try:
                            os.remove(fpath)
                            logger.info(f"Cleaned up orphaned upload: {fname}")
                        except Exception as e:
                            logger.warning(f"Failed to remove orphaned upload {fname}: {e}")
    except Exception as e:
        logger.warning(f"Error during orphaned uploads cleanup: {e}")


# ── Storage Endpoints ─────────────────────────────────────────────

@router.get("/api/settings")
async def get_settings_endpoint():
    return get_user_settings()


def save_user_settings(data: Dict[str, Any]):
    """Save settings dictionary to settings.json and apply overrides."""
    with open(SETTINGS_FILE, "w") as f:
        json.dump(data, f, indent=2)
    _apply_all_overrides()


@router.post("/api/settings")
async def save_settings_endpoint(settings: SettingsModel):
    save_user_settings(settings.model_dump())
    return {"status": "success"}


@router.post("/api/upload")
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


@router.post("/api/upload/delete")
async def delete_uploaded_files_endpoint(request: Request):
    """Deletes uploaded files given a list of file URLs or filenames."""
    try:
        data = await request.json()
        urls = data.get("urls", [])
        deleted = []
        for url in urls:
            if not isinstance(url, str):
                continue
            filename = os.path.basename(url)
            # Security guard: prevent path traversal
            if "/" in filename or "\\" in filename or ".." in filename:
                continue
            file_path = os.path.join(UPLOADS_DIR, filename)
            if os.path.isfile(file_path):
                try:
                    os.remove(file_path)
                    deleted.append(filename)
                except Exception as err:
                    logger.warning(f"Could not remove {file_path}: {err}")
        return {"status": "success", "deleted": deleted}
    except Exception as e:
        logger.error(f"Error in delete_uploaded_files: {e}")
        return {"status": "error", "detail": str(e)}


@router.get("/api/chats")
async def get_chats_endpoint():
    """Returns all saved chats from the server."""
    if os.path.exists(CHATS_FILE):
        try:
            with open(CHATS_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return []
    return []


@router.post("/api/chats")
async def save_chats_endpoint(request: Request):
    """Saves all chats to the server and cleans up orphaned uploads."""
    try:
        chats = await request.json()
        if not isinstance(chats, list):
            raise HTTPException(status_code=400, detail="Expected a JSON array of conversations")
        with open(CHATS_FILE, "w") as f:
            json.dump(chats, f, indent=2)
        _cleanup_orphaned_uploads(chats)
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving chats: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/memory")
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


@router.post("/api/memory")
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


@router.delete("/api/memory")
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

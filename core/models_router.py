"""
Model Management & Accelerated Downloader Router for nivm.
Handles model discovery, GGUF local scanning, remote model enumeration,
engine status, role activation, smart toggle, and aria2c model downloads.
"""

import os
import json
import asyncio
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx

from .config import SETTINGS_FILE
from .engine import model_manager, HAS_LLAMA_CPP, scan_local_ggufs
from .downloader import downloader
from .storage import get_user_settings, _apply_all_overrides
from .router import get_resident_role

logger = logging.getLogger("nivm.models")

router = APIRouter(tags=["Engine & Models"])


# ── Request Models ────────────────────────────────────────────────

class DownloadModelRequest(BaseModel):
    url: str
    filename: Optional[str] = None


class FetchRemoteModelsRequest(BaseModel):
    base_url: str
    api_key: Optional[str] = ""


# ── Model Enumeration Endpoints ───────────────────────────────────

@router.get("/api/models")
async def list_models():
    """List all models in the registry with their current status."""
    available = model_manager.list_available()
    return {
        "active": model_manager.get_active_info(),
        "models": [
            {
                "role": role,
                "name": info["name"],
                "description": info.get("description", ""),
                "available": info["available"],
                "size_gb": info["size_gb"],
            }
            for role, info in available.items()
        ]
    }


@router.post("/api/external/models")
async def fetch_remote_models(req: FetchRemoteModelsRequest):
    """Query an external OpenAI-compatible provider's /models endpoint to discover models."""
    base_url = req.base_url.strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="Missing base_url")

    if base_url.endswith("/chat/completions"):
        base_url = base_url[:-len("/chat/completions")]

    models_url = f"{base_url}/models"
    headers = {}
    if req.api_key and req.api_key.strip():
        headers["Authorization"] = f"Bearer {req.api_key.strip()}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(models_url, headers=headers)
            if resp.status_code != 200:
                err_text = resp.text[:300]
                return {"success": False, "error": f"HTTP {resp.status_code}: {err_text}", "models": []}

            data = resp.json()
            model_ids = []
            if isinstance(data, dict):
                if "data" in data and isinstance(data["data"], list):
                    for item in data["data"]:
                        if isinstance(item, dict) and "id" in item:
                            model_ids.append(item["id"])
                        elif isinstance(item, str):
                            model_ids.append(item)
                elif "models" in data and isinstance(data["models"], list):
                    for item in data["models"]:
                        if isinstance(item, dict):
                            model_ids.append(item.get("name") or item.get("id"))
                        elif isinstance(item, str):
                            model_ids.append(item)

            model_ids = sorted(list(set(filter(None, model_ids))))
            return {"success": True, "models": model_ids}
    except Exception as e:
        return {"success": False, "error": str(e), "models": []}


# ── Engine Management Endpoints ───────────────────────────────────

@router.get("/api/engine/status")
async def engine_status():
    """Get current engine and model status."""
    return {
        "has_llama_cpp": HAS_LLAMA_CPP,
        "active": model_manager.get_active_info(),
        "available": model_manager.list_available(),
    }


@router.post("/api/engine/activate/{role}")
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
        await asyncio.to_thread(model_manager.unload_all)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/engine/unload")
async def engine_unload():
    """Unload all active models."""
    await asyncio.to_thread(model_manager.unload_all)
    return {"status": "unloaded"}


@router.post("/api/engine/smart-toggle")
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
        inference_mode = settings.get("inference_mode", "single")

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
            await asyncio.to_thread(model_manager.unload_all)
            raise HTTPException(status_code=500, detail=f"Failed to load: {e}")


# ── Scanning & Downloader Endpoints ───────────────────────────────

@router.get("/api/models/scan")
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


@router.post("/api/models/download")
async def download_model_endpoint(req: DownloadModelRequest):
    """Start downloading a GGUF model via aria2 or streaming fallback."""
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="A download URL is required")
    try:
        status = downloader.start_download(req.url, req.filename)
        return status
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/models/download/status")
async def download_model_status_endpoint():
    """Poll download progress, speed, and ETA."""
    status = downloader.get_status()
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


@router.post("/api/models/download/cancel")
async def download_model_cancel_endpoint():
    """Cancel an ongoing download."""
    return downloader.cancel_download()

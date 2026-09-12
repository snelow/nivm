"""
FastAPI Router for nivm Image Studio (Qwen-Rapid).
Provides model status/downloader endpoints, generation, editing, and SSE live progress streaming with preview frames.
"""

import os
import time
import json
import uuid
import asyncio
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

from .config import IMAGES_DIR, UPLOADS_DIR
from .image_engine.config import IMAGES_OUTPUT_DIR
from .image_engine.model_checker import check_image_models_status
from .image_engine.downloader import start_models_download, get_download_status
from .image_engine.workflow_builder import build_qwen_workflow, compute_dimensions
from .image_engine.client import execute_image_workflow, upload_image_to_comfy
from .vram_coordinator import (
    prepare_vram_for_image_generation,
    restore_vram_after_image_generation,
    restore_vram_after_image_generation_async,
)

logger = logging.getLogger("nivm.image_router")

router = APIRouter(prefix="/api/image", tags=["Image Studio"])

# Active tasks state store for polling and SSE streaming
_active_tasks: Dict[str, Dict[str, Any]] = {}
_task_queues: Dict[str, asyncio.Queue] = {}


class GenerateRequest(BaseModel):
    prompt: str
    aspect_ratio: str = "portrait"          # "square", "portrait", "landscape"
    negative_prompt: Optional[str] = None
    seed: Optional[int] = None
    steps: int = 5
    cfg: float = 1.0
    width: Optional[int] = None
    height: Optional[int] = None


class EditRequest(BaseModel):
    image_filename: str                     # filename or path to primary image
    prompt: str
    aspect_ratio: str = "original"          # "original", "square", "portrait", "landscape"
    denoise_strength: float = 0.85          # 0.1 to 1.0
    reference_images: Optional[List[str]] = None  # up to 2 extra reference images
    negative_prompt: Optional[str] = None
    seed: Optional[int] = None
    steps: int = 5
    cfg: float = 1.0


def _resolve_image_path(filename_or_path: str) -> str:
    """Finds absolute path of an image in uploads, images, or direct path."""
    clean = filename_or_path.strip().replace("file://", "")
    if os.path.isabs(clean) and os.path.isfile(clean):
        return clean

    basename = os.path.basename(clean)

    # Check uploads directory
    uploads_path = os.path.join(UPLOADS_DIR, basename)
    if os.path.isfile(uploads_path):
        return uploads_path

    # Check images directory
    images_path = os.path.join(IMAGES_OUTPUT_DIR, basename)
    if os.path.isfile(images_path):
        return images_path

    raise FileNotFoundError(f"Image not found: '{filename_or_path}' (looked in uploads and generated images).")


# ── Model Status & Download Endpoints ─────────────────────────────

@router.get("/models/status")
async def get_models_status():
    """Returns whether the 3 Qwen-Rapid models are installed and ready."""
    return check_image_models_status()


@router.post("/models/download")
async def trigger_models_download():
    """Starts background aria2c download for any missing image models."""
    status = start_models_download()
    return status


@router.get("/models/download/status")
async def get_models_download_progress():
    """Polls real-time download status of image models."""
    return get_download_status()


# ── ComfyUI Engine Helper Endpoints ───────────────────────────────

@router.get("/comfy/status")
async def get_comfy_engine_status():
    """Returns ComfyUI backend detection and auto-setup status."""
    from .image_engine.setup_helper import get_setup_status
    return get_setup_status()


@router.post("/comfy/setup")
async def trigger_comfy_auto_setup():
    """Starts background installation of ComfyUI for fresh environments."""
    from .image_engine.setup_helper import start_auto_setup
    return start_auto_setup()


class SetPathRequest(BaseModel):
    path: str


@router.post("/comfy/set_path")
async def set_comfy_engine_path(req: SetPathRequest):
    """Saves user's custom ComfyUI directory."""
    from .image_engine.setup_helper import set_custom_comfy_path
    try:
        return set_custom_comfy_path(req.path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Generation & Editing Endpoints ────────────────────────────────

@router.post("/generate")
async def generate_image_endpoint(req: GenerateRequest):
    """
    Generate an image from pure text description.
    """
    model_status = check_image_models_status()
    if not model_status.get("installed"):
        raise HTTPException(
            status_code=400,
            detail="Image Studio models are not installed. Please download them in Model Settings first."
        )

    task_id = str(uuid.uuid4())
    _active_tasks[task_id] = {
        "status": "queued",
        "step": 0,
        "max_steps": req.steps,
        "percentage": 0,
        "time_elapsed": 0.0,
        "preview_url": None,
        "result": None,
        "error": None,
    }
    queue = asyncio.Queue()
    _task_queues[task_id] = queue

    def on_progress(event_data: Dict[str, Any]):
        if task_id in _active_tasks:
            _active_tasks[task_id].update(event_data)
        try:
            queue.put_nowait(event_data)
        except Exception:
            pass

    # Build workflow
    workflow = build_qwen_workflow(
        prompt=req.prompt,
        negative_prompt=req.negative_prompt,
        images=[],
        aspect_ratio=req.aspect_ratio,
        denoise=1.0,
        seed=req.seed,
        steps=req.steps,
        cfg=req.cfg,
        width=req.width,
        height=req.height,
    )

    # Dynamic VRAM Swapping & Background Execution
    async def _run_generate_task():
        saved_vram_state = prepare_vram_for_image_generation()
        try:
            result = await execute_image_workflow(workflow, progress_callback=on_progress)

            # Wait for LLM to be fully restored into memory before signaling completion
            if saved_vram_state:
                on_progress({
                    "stage_text": "Restoring language model into memory...",
                    "percentage": 98,
                })
                await restore_vram_after_image_generation_async(saved_vram_state)
                saved_vram_state = None

            _active_tasks[task_id]["result"] = result
            _active_tasks[task_id]["image"] = result
            _active_tasks[task_id]["status"] = "complete"
            _active_tasks[task_id]["percentage"] = 100
            try:
                queue.put_nowait({
                    "status": "complete",
                    "percentage": 100,
                    "image": result,
                })
            except Exception:
                pass
        except Exception as e:
            logger.error(f"Image generation failed: {e}")
            _active_tasks[task_id]["status"] = "error"
            _active_tasks[task_id]["error"] = str(e)
            try:
                queue.put_nowait({
                    "status": "error",
                    "error": str(e),
                })
            except Exception:
                pass
        finally:
            if saved_vram_state:
                try:
                    await restore_vram_after_image_generation_async(saved_vram_state)
                except Exception:
                    pass

    asyncio.create_task(_run_generate_task())

    return {
        "success": True,
        "task_id": task_id,
        "prompt": req.prompt,
        "aspect_ratio": req.aspect_ratio,
    }


@router.post("/edit")
async def edit_image_endpoint(req: EditRequest):
    """
    Edit an existing image (with optional reference images) guided by natural language.
    """
    model_status = check_image_models_status()
    if not model_status.get("installed"):
        raise HTTPException(
            status_code=400,
            detail="Image Studio models are not installed. Please download them in Model Settings first."
        )

    try:
        primary_abs_path = _resolve_image_path(req.image_filename)
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=404, detail=str(fnf))

    # Resolve reference images
    ref_paths = []
    if req.reference_images:
        for r_name in req.reference_images:
            if r_name and str(r_name).strip():
                try:
                    ref_paths.append(_resolve_image_path(r_name))
                except FileNotFoundError:
                    logger.warning(f"Reference image not found: {r_name}")

    task_id = str(uuid.uuid4())
    _active_tasks[task_id] = {
        "status": "queued",
        "step": 0,
        "max_steps": req.steps,
        "percentage": 0,
        "time_elapsed": 0.0,
        "preview_url": None,
        "result": None,
        "error": None,
    }
    queue = asyncio.Queue()
    _task_queues[task_id] = queue

    def on_progress(event_data: Dict[str, Any]):
        if task_id in _active_tasks:
            _active_tasks[task_id].update(event_data)
        try:
            queue.put_nowait(event_data)
        except Exception:
            pass

    # Construct original preview URL
    orig_filename = os.path.basename(primary_abs_path)
    if primary_abs_path.startswith(UPLOADS_DIR):
        orig_url = f"/uploads/{orig_filename}"
    else:
        orig_url = f"/images/{orig_filename}"

    # Upload images to Comfy input folder
    try:
        comfy_primary_name = await upload_image_to_comfy(primary_abs_path)
        all_comfy_names = [comfy_primary_name]
        for r_path in ref_paths:
            r_uploaded = await upload_image_to_comfy(r_path)
            all_comfy_names.append(r_uploaded)
    except Exception as up_err:
        raise HTTPException(status_code=500, detail=f"Failed to prepare input images: {up_err}")

    # Check if aspect ratio was explicitly requested in prompt
    explicit_aspect_keywords = ["16:9", "9:16", "1:1", "4:3", "3:4", "landscape", "widescreen", "portrait", "square", "vertical", "horizontal"]
    prompt_lower = (req.prompt or "").lower()
    has_explicit_ratio_in_prompt = any(kw in prompt_lower for kw in explicit_aspect_keywords)

    edit_aspect = req.aspect_ratio or "original"
    if not has_explicit_ratio_in_prompt:
        # Preserve original aspect ratio and dimensions unless explicitly commanded in prompt
        edit_aspect = "original"

    # Compute target dimensions from the primary source image
    computed_w, computed_h = compute_dimensions(
        aspect_ratio=edit_aspect,
        primary_image_path=primary_abs_path
    )

    # Build workflow
    workflow = build_qwen_workflow(
        prompt=req.prompt,
        negative_prompt=req.negative_prompt,
        images=all_comfy_names,
        aspect_ratio=edit_aspect,
        denoise=req.denoise_strength,
        seed=req.seed,
        steps=req.steps,
        cfg=req.cfg,
        width=computed_w,
        height=computed_h,
    )

    # Dynamic VRAM Swapping & Background Execution
    async def _run_edit_task():
        saved_vram_state = prepare_vram_for_image_generation()
        try:
            result = await execute_image_workflow(workflow, progress_callback=on_progress)

            # Wait for LLM to be fully restored into memory before signaling completion
            if saved_vram_state:
                on_progress({
                    "stage_text": "Restoring language model into memory...",
                    "percentage": 98,
                })
                await restore_vram_after_image_generation_async(saved_vram_state)
                saved_vram_state = None

            _active_tasks[task_id]["result"] = result
            _active_tasks[task_id]["image"] = result
            _active_tasks[task_id]["original_url"] = orig_url
            _active_tasks[task_id]["status"] = "complete"
            _active_tasks[task_id]["percentage"] = 100
            try:
                queue.put_nowait({
                    "status": "complete",
                    "percentage": 100,
                    "image": result,
                    "original_url": orig_url,
                })
            except Exception:
                pass
        except Exception as e:
            logger.error(f"Image edit failed: {e}")
            _active_tasks[task_id]["status"] = "error"
            _active_tasks[task_id]["error"] = str(e)
            try:
                queue.put_nowait({
                    "status": "error",
                    "error": str(e),
                })
            except Exception:
                pass
        finally:
            if saved_vram_state:
                try:
                    await restore_vram_after_image_generation_async(saved_vram_state)
                except Exception:
                    pass

    asyncio.create_task(_run_edit_task())

    return {
        "success": True,
        "task_id": task_id,
        "original_url": orig_url,
        "original_filename": orig_filename,
        "prompt": req.prompt,
        "denoise_strength": req.denoise_strength,
        "aspect_ratio": req.aspect_ratio,
    }


@router.get("/task/{task_id}")
async def get_task_status(task_id: str):
    """Direct status query for progress polling or fallback."""
    if task_id not in _active_tasks:
        raise HTTPException(status_code=404, detail="Task ID not found")
    return _active_tasks[task_id]



# ── Live Progress Stream (SSE) ────────────────────────────────────

@router.get("/progress/{task_id}")
async def stream_progress_events(task_id: str):
    """
    Server-Sent Events endpoint streaming real-time diffusion progress
    including live latent preview images, step count, and ETA.
    """
    if task_id not in _task_queues:
        # Check if already finished
        if task_id in _active_tasks:
            return JSONResponse(_active_tasks[task_id])
        raise HTTPException(status_code=404, detail="Task ID not found")

    queue = _task_queues[task_id]

    async def event_generator():
        try:
            # Yield initial state
            if task_id in _active_tasks:
                yield f"data: {json.dumps(_active_tasks[task_id])}\n\n"

            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=10.0)
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("status") in ("complete", "error"):
                        break
                except asyncio.TimeoutError:
                    # Keep-alive heartbeat
                    yield f": ping\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            _task_queues.pop(task_id, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/history")
async def get_image_history():
    """Returns list of all generated images sorted by timestamp descending."""
    items = []
    if not os.path.exists(IMAGES_OUTPUT_DIR):
        return items

    files = [f for f in os.listdir(IMAGES_OUTPUT_DIR) if f.lower().endswith((".png", ".jpg", ".webp"))]
    files.sort(key=lambda f: os.path.getmtime(os.path.join(IMAGES_OUTPUT_DIR, f)), reverse=True)

    for f in files[:100]:
        fpath = os.path.join(IMAGES_OUTPUT_DIR, f)
        items.append({
            "filename": f,
            "url": f"/images/{f}",
            "timestamp": int(os.path.getmtime(fpath) * 1000),
            "size_bytes": os.path.getsize(fpath),
        })

    return items

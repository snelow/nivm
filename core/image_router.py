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
from typing import Optional, List, Dict, Any, Tuple
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request, UploadFile, File, Form
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

from .config import IMAGES_DIR, UPLOADS_DIR
from .image_engine.config import IMAGES_OUTPUT_DIR
from .image_engine.model_checker import check_image_models_status
from .image_engine.downloader import start_models_download, get_download_status
from .image_engine.workflow_builder import build_qwen_workflow, compute_dimensions
from .image_engine.client import execute_image_workflow, upload_image_to_comfy, interrupt_comfy_generation
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
    clean = (filename_or_path or "").strip().replace("file://", "")

    # Fallback if filename is empty, generic pronoun, or "latest"
    if not clean or clean.lower() in ("latest", "recent", "last", "current", "image", "it", "this", "this_image", "default", "photo", "picture"):
        candidates = []
        for d in (IMAGES_OUTPUT_DIR, UPLOADS_DIR):
            if os.path.isdir(d):
                for f in os.listdir(d):
                    fp = os.path.join(d, f)
                    if os.path.isfile(fp) and f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                        candidates.append((os.path.getmtime(fp), fp))
        if candidates:
            candidates.sort(key=lambda x: x[0], reverse=True)
            return candidates[0][1]

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


# Model status and download endpoints

@router.get("/models/status")
async def get_models_status():
    """Returns whether the 3 Qwen-Rapid models are installed and ready."""
    return check_image_models_status()


class ModelDownloadRequest(BaseModel):
    category: str = "standard"


@router.post("/models/download")
async def trigger_models_download(category: Optional[str] = "standard", req: Optional[ModelDownloadRequest] = None):
    """Starts background aria2c download for missing image models (standard, anime, or all)."""
    cat = "standard"
    if req and req.category:
        cat = req.category.strip().lower()
    elif category:
        cat = category.strip().lower()
    status = start_models_download(category=cat)
    return status


@router.get("/models/download/status")
async def get_models_download_progress():
    """Polls real-time download status of image models."""
    return get_download_status()


# ComfyUI engine helper endpoints

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


def _match_prompt_option(options: dict, text: str, min_len: int = 4) -> str:
    """Matches a keyword or token from an options dictionary against a search string."""
    for k, v in options.items():
        if k == "none":
            continue
        disp = v.get("display_name", "").lower()
        tokens = [tok for tok in disp.split() if len(tok) >= min_len and not tok.startswith("&")]
        if k in text or k.replace("_", " ") in text or disp in text or (tokens and any(tok in text for tok in tokens)):
            return k
    return "none"


def _init_task(task_id: str, max_steps: int):
    """Initializes task state and event queue for live SSE streaming."""
    _active_tasks[task_id] = {
        "status": "queued",
        "step": 0,
        "max_steps": max_steps,
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

    return queue, on_progress


async def _execute_workflow_task(
    task_id: str,
    workflow: dict,
    queue: asyncio.Queue,
    on_progress,
    extra_result_fields: Optional[dict] = None,
    label: str = "Image generation"
):
    """Handles VRAM swapping, workflow execution, error trapping, and state cleanup."""
    saved_vram_state = prepare_vram_for_image_generation()
    try:
        result = await execute_image_workflow(workflow, progress_callback=on_progress)
        if saved_vram_state:
            on_progress({"stage_text": "Restoring language model into memory...", "percentage": 98})
            await restore_vram_after_image_generation_async(saved_vram_state)
            saved_vram_state = None

        res_data = {"status": "complete", "percentage": 100, "result": result, "image": result}
        if extra_result_fields:
            res_data.update(extra_result_fields)
        _active_tasks[task_id].update(res_data)
        try:
            queue.put_nowait(res_data)
        except Exception:
            pass
    except InterruptedError:
        logger.info(f"{label} {task_id} was interrupted by user.")
        msg = "Generation stopped by user"
        data = {"status": "interrupted", "stage_text": msg, "error": msg}
        _active_tasks[task_id].update(data)
        try:
            queue.put_nowait(data)
        except Exception:
            pass
    except Exception as e:
        logger.error(f"{label} failed: {e}")
        data = {"status": "error", "error": str(e)}
        _active_tasks[task_id].update(data)
        try:
            queue.put_nowait(data)
        except Exception:
            pass
    finally:
        if saved_vram_state:
            try:
                await restore_vram_after_image_generation_async(saved_vram_state)
            except Exception:
                pass


# Image generation and editing endpoints

@router.post("/generate")
async def generate_image_endpoint(req: GenerateRequest):
    """Generate an image from pure text description."""
    # Auto-detect if request targets a registered anime character
    try:
        from .image_engine.illustrious.characters import get_characters, POSE_OPTIONS, CONCEPT_OPTIONS
        from .image_engine.illustrious.config import find_illustrious_checkpoint

        _, ckpt_path = find_illustrious_checkpoint()
        if ckpt_path and os.path.isfile(ckpt_path):
            prompt_l = req.prompt.lower()
            chars = get_characters(nsfw_enabled=True)
            matched_char = _match_prompt_option(chars, prompt_l, min_len=3)
            if matched_char == "none":
                matched_char = None
            matched_pose = _match_prompt_option(POSE_OPTIONS, prompt_l)
            matched_concept = _match_prompt_option(CONCEPT_OPTIONS, prompt_l)

            if matched_char or (matched_pose != "none") or (matched_concept != "none") or any(
                w in prompt_l for w in ("anime", "illustrious", "waifu", "manga", "vtuber")
            ):
                anime_req = AnimeGenerateRequest(
                    character=matched_char or "none",
                    concept=matched_concept,
                    pose=matched_pose,
                    user_prompt=req.prompt,
                    resolution=req.aspect_ratio if req.aspect_ratio in ("portrait", "landscape", "square") else "portrait",
                    seed=req.seed,
                    use_lcm=any(w in prompt_l for w in ("turbo", "fast", "faster", "quick", "lcm", "speed")),
                )
                return await generate_anime_endpoint(anime_req)
    except Exception as e:
        logger.debug(f"Anime auto-detect check passed: {e}")

    model_status = check_image_models_status()
    if not model_status.get("installed"):
        raise HTTPException(
            status_code=400,
            detail="Image Studio models are not installed. Please download them in Model Settings first."
        )

    task_id = str(uuid.uuid4())
    queue, on_progress = _init_task(task_id, req.steps)

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

    asyncio.create_task(_execute_workflow_task(task_id, workflow, queue, on_progress, label="Image generation"))

    return {
        "success": True,
        "task_id": task_id,
        "prompt": req.prompt,
        "aspect_ratio": req.aspect_ratio,
        "steps": req.steps,
        "max_steps": req.steps,
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
    queue, on_progress = _init_task(task_id, req.steps)

    # Construct original preview URL
    orig_filename = os.path.basename(primary_abs_path)
    orig_url = f"/uploads/{orig_filename}" if primary_abs_path.startswith(UPLOADS_DIR) else f"/images/{orig_filename}"

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
    has_explicit_ratio = any(kw in prompt_lower for kw in explicit_aspect_keywords)
    edit_aspect = req.aspect_ratio if (has_explicit_ratio and req.aspect_ratio) else "original"

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

    asyncio.create_task(_execute_workflow_task(
        task_id, workflow, queue, on_progress,
        extra_result_fields={"original_url": orig_url},
        label="Image edit"
    ))

    return {
        "success": True,
        "task_id": task_id,
        "original_url": orig_url,
        "original_filename": orig_filename,
        "prompt": req.prompt,
        "denoise_strength": req.denoise_strength,
        "aspect_ratio": req.aspect_ratio,
        "steps": req.steps,
        "max_steps": req.steps,
    }


@router.get("/task/{task_id}")
async def get_task_status(task_id: str):
    """Direct status query for progress polling or fallback."""
    if task_id not in _active_tasks:
        raise HTTPException(status_code=404, detail="Task ID not found")
    return _active_tasks[task_id]



class InterruptRequest(BaseModel):
    task_id: Optional[str] = None


@router.post("/interrupt")
async def interrupt_image_generation(req: Optional[InterruptRequest] = None):
    """
    Interrupts ongoing ComfyUI image generation and transitions active task to interrupted.
    """
    target_task_id = req.task_id if req else None
    prompt_id = None

    if target_task_id and target_task_id in _active_tasks:
        prompt_id = _active_tasks[target_task_id].get("prompt_id")
        _active_tasks[target_task_id]["status"] = "interrupted"
        _active_tasks[target_task_id]["stage_text"] = "Generation stopped by user"
        _active_tasks[target_task_id]["error"] = "Generation stopped by user"
        if target_task_id in _task_queues:
            try:
                _task_queues[target_task_id].put_nowait({
                    "status": "interrupted",
                    "stage_text": "Generation stopped by user",
                    "error": "Generation stopped by user",
                })
            except Exception:
                pass
    elif not target_task_id:
        for tid, tinfo in _active_tasks.items():
            if tinfo.get("status") in ("queued", "generating", "starting"):
                tinfo["status"] = "interrupted"
                tinfo["stage_text"] = "Generation stopped by user"
                tinfo["error"] = "Generation stopped by user"
                if tid in _task_queues:
                    try:
                        _task_queues[tid].put_nowait({
                            "status": "interrupted",
                            "stage_text": "Generation stopped by user",
                            "error": "Generation stopped by user",
                        })
                    except Exception:
                        pass
                if not prompt_id:
                    prompt_id = tinfo.get("prompt_id")

    success = await interrupt_comfy_generation(prompt_id=prompt_id)
    return {"status": "interrupted" if success else "failed", "task_id": target_task_id}


@router.post("/interrupt/{task_id}")
async def interrupt_task_image_generation(task_id: str):
    """Interrupts specific task by task_id."""
    return await interrupt_image_generation(InterruptRequest(task_id=task_id))


# Live progress stream (SSE)

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
                    if event.get("status") in ("complete", "error", "interrupted"):
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
        meta_fpath = f"{fpath}.meta.json"
        dur = None
        if os.path.isfile(meta_fpath):
            try:
                with open(meta_fpath, "r", encoding="utf-8") as mf:
                    dur = json.load(mf).get("duration_seconds")
            except Exception:
                pass

        items.append({
            "filename": f,
            "url": f"/images/{f}",
            "timestamp": int(os.path.getmtime(fpath) * 1000),
            "size_bytes": os.path.getsize(fpath),
            "duration_seconds": dur,
        })

    return items


@router.get("/meta/{filename}")
async def get_image_metadata(filename: str):
    """Returns metadata for an image including generation duration."""
    base = os.path.basename(filename)
    img_path = os.path.join(IMAGES_OUTPUT_DIR, base)
    meta_path = f"{img_path}.meta.json"
    if os.path.isfile(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"filename": base, "duration_seconds": None}


# Anime pipeline endpoints

class AnimeGenerateRequest(BaseModel):
    character: str
    hairstyle: Optional[str] = None
    outfit: Optional[str] = None
    expression: Optional[str] = "smile"
    concept: Optional[str] = "none"
    pose: Optional[str] = "none"
    background: Optional[str] = "auto"
    user_prompt: Optional[str] = ""
    negative_prompt: Optional[str] = None
    resolution: Optional[str] = "portrait"
    seed: Optional[int] = None
    steps: Optional[int] = None
    cfg: Optional[float] = None
    batch_count: int = 1
    use_lcm: bool = False


class CharacterSaveRequest(BaseModel):
    key: str
    data: Dict[str, Any]


@router.get("/anime/registry")
async def get_anime_registry(nsfw_enabled: bool = False, include_all: bool = False):
    """Returns catalog for character, hairstyle, outfit, expression, concept, pose selectors."""
    from .image_engine.illustrious.characters import serialize_registry
    return serialize_registry(nsfw_enabled=nsfw_enabled, include_all=include_all)


@router.get("/anime/characters")
async def get_anime_characters(nsfw_enabled: bool = False):
    """Returns available characters and styling presets."""
    from .image_engine.illustrious.characters import get_characters
    return get_characters(nsfw_enabled=nsfw_enabled)


@router.post("/anime/characters")
async def save_anime_character(req: CharacterSaveRequest):
    """Adds or updates a character profile in the JSON registry."""
    from .image_engine.illustrious.characters import save_character
    clean_key = req.key.strip().lower().replace(" ", "_")
    if not clean_key:
        raise HTTPException(status_code=400, detail="Invalid character key")
    saved = save_character(clean_key, req.data)
    return {"success": True, "key": clean_key, "character": saved}


@router.delete("/anime/characters/{char_key}")
async def delete_anime_character(char_key: str):
    """Removes a character entry from the registry and deletes its LoRA file."""
    from .image_engine.illustrious.characters import delete_character
    ok = delete_character(char_key, delete_file=True)
    if not ok:
        raise HTTPException(status_code=404, detail="Character not found")
    return {"success": True, "key": char_key}



@router.post("/anime/generate")
async def generate_anime_endpoint(req: AnimeGenerateRequest):
    """Generate an anime illustration using Illustrious SDXL with dynamic LoRA chaining."""
    from .image_engine.illustrious.characters import get_characters
    from .image_engine.illustrious.workflow_builder import (
        build_illustrious_workflow,
        build_lcm_workflow,
    )
    from .image_engine.illustrious.config import (
        find_illustrious_checkpoint,
        DEFAULT_STEPS,
        DEFAULT_CFG,
        LCM_STEPS,
        LCM_CFG,
    )

    chars = get_characters(nsfw_enabled=True)
    if req.character and req.character not in ("none", "base", "prompt_only") and req.character not in chars:
        raise HTTPException(status_code=400, detail=f"Character '{req.character}' not found.")

    ckpt_name, ckpt_path = find_illustrious_checkpoint()
    if not ckpt_path or not os.path.isfile(ckpt_path):
        raise HTTPException(
            status_code=400,
            detail="Illustrious SDXL checkpoint not found. Please install waiIllustriousSDXL_v150.safetensors or download it via Settings."
        )

    task_id = str(uuid.uuid4())
    steps = req.steps or (LCM_STEPS if req.use_lcm else DEFAULT_STEPS)
    cfg = req.cfg or (LCM_CFG if req.use_lcm else DEFAULT_CFG)
    queue, on_progress = _init_task(task_id, steps)

    builder_fn = build_lcm_workflow if req.use_lcm else build_illustrious_workflow
    workflow, positive_prompt = builder_fn(
        char_key=req.character,
        hairstyle_key=req.hairstyle,
        outfit_key=req.outfit,
        expr_key=req.expression,
        concept_key=req.concept or "none",
        pose_key=req.pose or "none",
        bg_key=req.background or "auto",
        user_prompt=req.user_prompt or "",
        negative_prompt=req.negative_prompt,
        seed=req.seed if req.seed is not None else -1,
        steps=steps,
        cfg=cfg,
        resolution=req.resolution or "portrait",
        batch_count=req.batch_count or 1,
    )

    asyncio.create_task(_execute_workflow_task(task_id, workflow, queue, on_progress, label="Anime generation"))

    return {
        "success": True,
        "task_id": task_id,
        "character": req.character,
        "prompt": positive_prompt,
        "use_lcm": req.use_lcm,
        "steps": steps,
        "max_steps": steps,
    }


def _resolve_lora_target(category: str, name: str, key: Optional[str]) -> Tuple[str, str]:
    """Generates clean key and prefixed target filename for a LoRA model."""
    raw_key = (key or "").strip() or name.strip()
    clean_key = "".join(c if c.isalnum() or c in "-_" else "_" for c in raw_key.lower()).strip("_-") or "custom_lora"
    prefix = {"character": "char_", "concept": "concept_", "pose": "pose_"}.get(category, "lora_")
    clean_name = clean_key[len(prefix):] if clean_key.startswith(prefix) else clean_key
    clean_name = clean_name.strip("_-") or "custom_lora"
    return clean_key, f"{prefix}{clean_name}.safetensors"


def _save_lora_entry(
    category: str,
    clean_key: str,
    target_filename: str,
    name: str,
    strength: float,
    is_nsfw: bool,
    trigger_word: str = "",
    appearance: str = "",
    outfit_name: str = "Default",
    outfit_trigger: str = "",
    outfit_is_nsfw: bool = False
) -> Dict[str, Any]:
    """Saves metadata record into characters or options JSON registry."""
    from .image_engine.illustrious.characters import save_character, save_option_item
    if category == "character":
        res_outfit = outfit_name.strip() or "Default"
        outfit_key = "".join(c if c.isalnum() or c in "-_" else "_" for c in res_outfit.lower()).strip("_-") or "default"
        data = {
            "display_name": name.strip(),
            "lora_file": target_filename,
            "lora_strength_model": float(strength),
            "lora_strength_clip": float(strength),
            "trigger_word": trigger_word.strip(),
            "appearance": appearance.strip(),
            "nsfw": bool(is_nsfw),
            "outfits": {
                outfit_key: {
                    "display_name": res_outfit,
                    "trigger": outfit_trigger.strip(),
                    "nsfw": bool(outfit_is_nsfw),
                }
            },
        }
        save_character(clean_key, data)
        return {"success": True, "category": category, "key": clean_key, "filename": target_filename, "data": data}
    else:
        group_key = "poses" if category == "pose" else "concepts"
        data = {
            "display_name": name.strip(),
            "trigger": trigger_word.strip(),
            "lora_file": target_filename,
            "strength": float(strength),
            "nsfw": bool(is_nsfw),
        }
        save_option_item(group_key, clean_key, data)
        return {"success": True, "category": category, "key": clean_key, "filename": target_filename, "data": data}


@router.post("/anime/loras/import")
async def import_lora_file(
    file: UploadFile = File(...),
    category: str = Form("character"),
    name: str = Form(...),
    key: Optional[str] = Form(None),
    trigger_word: str = Form(""),
    appearance: str = Form(""),
    strength: float = Form(0.9),
    is_nsfw: bool = Form(False),
    outfit_name: str = Form("Default"),
    outfit_trigger: str = Form(""),
    outfit_is_nsfw: bool = Form(False),
):
    """Saves uploaded LoRA into models/image/loras and registers it in the JSON catalog."""
    from .image_engine.illustrious.config import LORAS_DIR

    if not file.filename.lower().endswith((".safetensors", ".pt")):
        raise HTTPException(status_code=400, detail="Only .safetensors files are supported.")

    os.makedirs(LORAS_DIR, exist_ok=True)
    clean_key, target_filename = _resolve_lora_target(category, name, key)
    target_path = os.path.join(LORAS_DIR, target_filename)

    with open(target_path, "wb") as f:
        f.write(await file.read())

    def _parse_bool(v: Any) -> bool:
        return v if isinstance(v, bool) else str(v).strip().lower() in ("true", "1", "yes", "on")

    return _save_lora_entry(
        category=category,
        clean_key=clean_key,
        target_filename=target_filename,
        name=name,
        strength=strength,
        is_nsfw=_parse_bool(is_nsfw),
        trigger_word=trigger_word,
        appearance=appearance,
        outfit_name=outfit_name,
        outfit_trigger=outfit_trigger,
        outfit_is_nsfw=_parse_bool(outfit_is_nsfw),
    )


@router.post("/anime/loras/sync")
async def sync_installed_loras():
    """Triggers bidirectional sync: removes registered items whose LoRA files were deleted on disk."""
    from .image_engine.illustrious.characters import sync_lora_files_with_disk
    return {"success": True, "sync": sync_lora_files_with_disk()}


@router.delete("/anime/options/{category}/{item_key}")
async def delete_anime_option(category: str, item_key: str):
    """Delete a concept or pose from options.json and deletes its LoRA file."""
    from .image_engine.illustrious.characters import delete_option_item
    if category not in ("concepts", "poses"):
        raise HTTPException(status_code=400, detail="Invalid category")
    ok = delete_option_item(category, item_key, delete_file=True)
    if not ok:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"success": True, "category": category, "key": item_key}


class AnimeOptionSaveRequest(BaseModel):
    key: str
    data: Dict[str, Any]


@router.post("/anime/options/{category}")
async def save_anime_option(category: str, req: AnimeOptionSaveRequest):
    """Save or update a concept or pose in options.json."""
    from .image_engine.illustrious.characters import save_option_item
    if category not in ("concepts", "poses"):
        raise HTTPException(status_code=400, detail="Invalid category")
    if req.key == "none":
        raise HTTPException(status_code=400, detail="Cannot edit default item")
    ok = save_option_item(category, req.key, req.data)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to save option item")
    return {"success": True, "category": category, "key": req.key, "data": req.data}


class HostLoraImportRequest(BaseModel):
    source_path: str
    category: str = "character"
    name: str
    key: Optional[str] = None
    trigger_word: str = ""
    appearance: str = ""
    strength: float = 0.9
    is_nsfw: bool = False
    outfit_name: str = "Default"
    outfit_trigger: str = ""
    outfit_is_nsfw: bool = False


@router.post("/anime/loras/import-host-file")
async def import_host_lora_file(req: HostLoraImportRequest):
    """Imports an existing LoRA file from the host filesystem into models/image/loras and registers it."""
    import shutil
    from .image_engine.illustrious.config import LORAS_DIR

    source = req.source_path.strip()
    if not os.path.isfile(source):
        raise HTTPException(status_code=404, detail="Source LoRA file not found on host disk.")
    if not source.lower().endswith((".safetensors", ".pt")):
        raise HTTPException(status_code=400, detail="Only .safetensors and .pt files are supported.")

    os.makedirs(LORAS_DIR, exist_ok=True)
    clean_key, target_filename = _resolve_lora_target(req.category, req.name, req.key)
    target_path = os.path.join(LORAS_DIR, target_filename)

    if os.path.abspath(source) != os.path.abspath(target_path):
        try:
            shutil.copy2(source, target_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to copy LoRA file: {e}")

    return _save_lora_entry(
        category=req.category,
        clean_key=clean_key,
        target_filename=target_filename,
        name=req.name,
        strength=req.strength,
        is_nsfw=req.is_nsfw,
        trigger_word=req.trigger_word,
        appearance=req.appearance,
        outfit_name=req.outfit_name,
        outfit_trigger=req.outfit_trigger,
        outfit_is_nsfw=req.outfit_is_nsfw,
    )


@router.get("/anime/loras")
async def list_installed_loras():
    """List all LoRA files currently in models/image/loras."""
    from .image_engine.illustrious.config import LORAS_DIR
    if not os.path.isdir(LORAS_DIR):
        return []
    files = []
    for f in sorted(os.listdir(LORAS_DIR)):
        if f.lower().endswith(".safetensors"):
            fpath = os.path.join(LORAS_DIR, f)
            files.append({
                "filename": f,
                "size_bytes": os.path.getsize(fpath),
                "modified": os.path.getmtime(fpath),
            })
    return files


class EnsureLoraFileRequest(BaseModel):
    source_path: str


@router.post("/anime/loras/ensure-file")
async def ensure_lora_file_endpoint(req: EnsureLoraFileRequest):
    """Ensure a LoRA file from any location on host disk is available in models/image/loras."""
    import shutil
    from .image_engine.illustrious.config import LORAS_DIR

    src = req.source_path.strip()
    if not os.path.isfile(src):
        raise HTTPException(status_code=404, detail="Source file not found")
    if not src.lower().endswith((".safetensors", ".pt")):
        raise HTTPException(status_code=400, detail="Only .safetensors and .pt files are supported")

    os.makedirs(LORAS_DIR, exist_ok=True)
    filename = os.path.basename(src)
    dst = os.path.join(LORAS_DIR, filename)

    if os.path.abspath(src) != os.path.abspath(dst):
        try:
            shutil.copy2(src, dst)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to copy file into loras directory: {e}")

    return {"success": True, "filename": filename, "path": dst}




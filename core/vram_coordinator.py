"""
Dynamic VRAM Swapping Coordinator for nivm.
Automatically manages GPU VRAM allocations between llama.cpp LLMs and diffusion models.
On systems with < 16GB VRAM (e.g. 4GB RTX 3050), unloads the LLM to prevent CUDA OOM,
then reloads the active LLM when image generation completes.
"""

import gc
import logging
from typing import Optional, Dict, Any

from .engine import model_manager

logger = logging.getLogger("nivm.vram_coordinator")

VRAM_THRESHOLD_BYTES = 16 * 1024 * 1024 * 1024  # 16 GB


def get_total_vram_bytes() -> int:
    """Returns total VRAM of the primary GPU in bytes, or 0 if CPU-only."""
    try:
        import torch
        if torch.cuda.is_available():
            return torch.cuda.get_device_properties(0).total_memory
    except Exception:
        pass
    return 0


def should_unload_llm() -> bool:
    """Checks if the LLM should be unloaded to prevent memory collision."""
    total_vram = get_total_vram_bytes()
    # If GPU is detected and total VRAM < 16 GB, unload LLM during diffusion
    if 0 < total_vram < VRAM_THRESHOLD_BYTES:
        return True
    return False


def prepare_vram_for_image_generation() -> Optional[Dict[str, Any]]:
    """
    Called right before starting diffusion.
    If VRAM is constrained, unloads the LLM and flushes CUDA cache.
    Returns saved state for subsequent restoration.
    """
    if not should_unload_llm():
        logger.info("Sufficient VRAM detected (>=16GB or CPU); keeping LLM resident.")
        return None

    if not model_manager.has_any_loaded():
        return None

    active_role = model_manager.active_role
    custom_path = model_manager.loaded_paths.get(active_role) if active_role else None

    logger.warning(
        f"Constrained VRAM detected (<16GB). Temporarily unloading active LLM ({active_role}) "
        "to dedicate 100% of GPU VRAM to image diffusion."
    )

    model_manager.unload_all()

    # Flush PyTorch CUDA cache if available
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception:
        pass

    gc.collect()

    return {
        "active_role": active_role,
        "custom_path": custom_path,
    }


async def restore_vram_after_image_generation_async(saved_state: Optional[Dict[str, Any]]):
    """
    Called after diffusion completes (or errors).
    Tells ComfyUI to free GPU memory, clears CUDA cache, and restores the previously active LLM.
    """
    if not saved_state or not saved_state.get("active_role"):
        return

    active_role = saved_state["active_role"]
    logger.info(f"Restoring active LLM ({active_role}) into memory...")

    # 1. Ask ComfyUI to release diffusion model weights from VRAM
    try:
        import httpx
        from .image_engine.config import COMFY_HOST, COMFY_PORT
        async with httpx.AsyncClient(timeout=6.0) as client:
            await client.post(
                f"http://{COMFY_HOST}:{COMFY_PORT}/free",
                json={"unload_models": True, "free_memory": True}
            )
            logger.info("Sent /free command to ComfyUI daemon.")
    except Exception as e:
        logger.debug(f"ComfyUI /free notification error: {e}")

    # 2. Flush residual PyTorch CUDA cache
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception:
        pass
    gc.collect()

    # Small pause to allow PyTorch / driver to finish releasing pages
    import asyncio
    await asyncio.sleep(0.5)

    # 3. Reload active LLM into llama.cpp
    try:
        await asyncio.to_thread(model_manager.activate, active_role)
        logger.info(f"Successfully reloaded LLM ({active_role}).")
    except Exception as e:
        logger.error(f"Failed to restore LLM after image generation: {e}")


def restore_vram_after_image_generation(saved_state: Optional[Dict[str, Any]]):
    """
    Synchronous fallback wrapper for LLM restoration.
    """
    if not saved_state or not saved_state.get("active_role"):
        return

    active_role = saved_state["active_role"]
    logger.info(f"Restoring active LLM ({active_role}) into llama.cpp memory (sync)...")

    try:
        import httpx
        from .image_engine.config import COMFY_HOST, COMFY_PORT
        with httpx.Client(timeout=4.0) as client:
            client.post(
                f"http://{COMFY_HOST}:{COMFY_PORT}/free",
                json={"unload_models": True, "free_memory": True}
            )
    except Exception:
        pass

    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
    gc.collect()

    try:
        model_manager.activate(active_role)
        logger.info(f"Successfully reloaded LLM ({active_role}).")
    except Exception as e:
        logger.error(f"Failed to restore LLM after image generation: {e}")


async def free_all_system_models() -> Dict[str, Any]:
    """
    Comprehensive GPU VRAM and system memory release:
    1. Unloads all llama.cpp LLMs
    2. Unloads Kokoro Neural TTS ONNX session and flushes CUDA/CPU memory
    3. Unloads Faster-Whisper STT model
    4. Tells ComfyUI to free diffusion models and VRAM
    5. Flushes PyTorch CUDA cache & triggers gc.collect()
    """
    unloaded = []

    # 1. LLM
    try:
        if model_manager.has_any_loaded():
            model_manager.unload_all()
            unloaded.append("llm")
    except Exception as e:
        logger.warning(f"Error unloading LLM: {e}")

    # 2. Kokoro TTS
    try:
        from .tts import unload_kokoro_engine
        if unload_kokoro_engine():
            unloaded.append("tts")
    except Exception as e:
        logger.warning(f"Error unloading TTS: {e}")

    # 3. Whisper STT
    try:
        from .multimodal import unload_whisper_model
        if unload_whisper_model():
            unloaded.append("stt")
    except Exception as e:
        logger.warning(f"Error unloading STT: {e}")

    # 4. ComfyUI Diffusion Models
    try:
        import httpx
        from .image_engine.config import COMFY_HOST, COMFY_PORT
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(
                f"http://{COMFY_HOST}:{COMFY_PORT}/free",
                json={"unload_models": True, "free_memory": True}
            )
            if resp.status_code == 200:
                unloaded.append("diffusion")
    except Exception:
        pass

    # 5. PyTorch CUDA cache
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
            unloaded.append("cuda_cache")
    except Exception:
        pass

    gc.collect()

    return {
        "status": "success",
        "unloaded": unloaded,
        "message": f"Successfully unloaded: {', '.join(unloaded) if unloaded else 'all models already idle'}"
    }

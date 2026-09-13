"""
Model discovery and verification for Image Studio (Qwen-Rapid).
"""

import os
import shutil
import logging
from typing import Dict, Any

from .config import (
    IMAGE_MODELS_DIR,
    UNET_DIR,
    CLIP_DIR,
    VAE_DIR,
    CHECKPOINTS_DIR,
    LORAS_DIR,
    UNET_FILENAME,
    CLIP_FILENAME,
    VAE_FILENAME,
    ILLUSTRIOUS_V170_FILENAME,
    ILLUSTRIOUS_V150_FILENAME,
    LCM_LORA_FILENAME,
    COMFY_DIR,
)

logger = logging.getLogger("nivm.image_engine.checker")


def auto_link_from_comfyui() -> bool:
    """
    If models exist in an external ComfyUI folder but not in nivm/models/image/,
    create reflink or symlinks automatically to avoid re-downloading.
    """
    from .setup_helper import get_candidate_comfy_paths
    linked = False
    for candidate_dir in get_candidate_comfy_paths():
        source_map = [
            (os.path.join(candidate_dir, "models", "unet", UNET_FILENAME), os.path.join(UNET_DIR, UNET_FILENAME)),
            (os.path.join(candidate_dir, "models", "text_encoders", CLIP_FILENAME), os.path.join(CLIP_DIR, CLIP_FILENAME)),
            (os.path.join(candidate_dir, "models", "vae", VAE_FILENAME), os.path.join(VAE_DIR, VAE_FILENAME)),
            (os.path.join(candidate_dir, "models", "checkpoints", ILLUSTRIOUS_V170_FILENAME), os.path.join(CHECKPOINTS_DIR, ILLUSTRIOUS_V170_FILENAME)),
            (os.path.join(candidate_dir, "models", "checkpoints", ILLUSTRIOUS_V150_FILENAME), os.path.join(CHECKPOINTS_DIR, ILLUSTRIOUS_V150_FILENAME)),
            (os.path.join(candidate_dir, "models", "loras", LCM_LORA_FILENAME), os.path.join(LORAS_DIR, LCM_LORA_FILENAME)),
            (os.path.join(candidate_dir, "models", "loras", "pytorch_lora_weights.safetensors"), os.path.join(LORAS_DIR, LCM_LORA_FILENAME)),
        ]

        for src, dst in source_map:
            if os.path.isfile(src) and not os.path.exists(dst):
                try:
                    os.symlink(src, dst)
                    linked = True
                    logger.info(f"Auto-symlinked {src} -> {dst}")
                except Exception as e:
                    logger.warning(f"Failed to symlink {src}: {e}")

        # Also auto-link any illustrious checkpoints if present in ComfyUI
        comfy_ckpts = os.path.join(candidate_dir, "models", "checkpoints")
        if os.path.isdir(comfy_ckpts):
            for fname in os.listdir(comfy_ckpts):
                if "illustrious" in fname.lower() and fname.lower().endswith(".safetensors"):
                    src = os.path.join(comfy_ckpts, fname)
                    dst = os.path.join(CHECKPOINTS_DIR, fname)
                    if os.path.isfile(src) and not os.path.exists(dst):
                        try:
                            os.symlink(src, dst)
                            linked = True
                            logger.info(f"Auto-symlinked {src} -> {dst}")
                        except Exception as e:
                            logger.warning(f"Failed to symlink {src}: {e}")
    return linked


def check_image_models_status() -> Dict[str, Any]:
    """
    Check whether the 3 required Qwen-Rapid models are present.
    Returns status dictionary for frontend and tools checks.
    """
    # Try auto-linking if any are missing
    auto_link_from_comfyui()

    unet_path = os.path.join(UNET_DIR, UNET_FILENAME)
    clip_path = os.path.join(CLIP_DIR, CLIP_FILENAME)
    vae_path = os.path.join(VAE_DIR, VAE_FILENAME)

    unet_exists = os.path.isfile(unet_path) and os.path.getsize(unet_path) > 1024 * 1024
    clip_exists = os.path.isfile(clip_path) and os.path.getsize(clip_path) > 1024 * 1024
    vae_exists = os.path.isfile(vae_path) and os.path.getsize(vae_path) > 1024 * 1024

    total_size = 0
    for p in (unet_path, clip_path, vae_path):
        if os.path.isfile(p):
            try:
                total_size += os.path.getsize(p)
            except OSError:
                pass

    all_installed = unet_exists and clip_exists and vae_exists

    missing_models = []
    if not unet_exists:
        missing_models.append("unet")
    if not clip_exists:
        missing_models.append("text_encoder")
    if not vae_exists:
        missing_models.append("vae")

    anime_status = check_anime_models_status()

    return {
        "installed": all_installed,
        "all_installed": all_installed,
        "missing_count": len(missing_models),
        "missing_models": missing_models,
        "unet": {
            "name": UNET_FILENAME,
            "installed": unet_exists,
            "size_bytes": os.path.getsize(unet_path) if unet_exists else 0,
            "path": unet_path if unet_exists else None,
        },
        "text_encoder": {
            "name": CLIP_FILENAME,
            "installed": clip_exists,
            "size_bytes": os.path.getsize(clip_path) if clip_exists else 0,
            "path": clip_path if clip_exists else None,
        },
        "vae": {
            "name": VAE_FILENAME,
            "installed": vae_exists,
            "size_bytes": os.path.getsize(vae_path) if vae_exists else 0,
            "path": vae_path if vae_exists else None,
        },
        "anime": anime_status,
        "total_size_mb": round(total_size / (1024 * 1024), 1),
        "total_size_gb": round(total_size / (1024 * 1024 * 1024), 2),
    }


def check_anime_models_status() -> Dict[str, Any]:
    """
    Check whether Illustrious SDXL checkpoint and optional LCM turbo LoRA are present.
    """
    try:
        from .illustrious.config import (
            find_illustrious_checkpoint,
            LCM_LORA_FILE,
            LORAS_DIR,
            CHECKPOINTS_DIR,
            ILLUSTRIOUS_V170_FILENAME,
        )
        ckpt_name, ckpt_path = find_illustrious_checkpoint()
        ckpt_exists = bool(ckpt_path and os.path.isfile(ckpt_path))
        ckpt_size = os.path.getsize(ckpt_path) if ckpt_exists else 0

        v170_path = os.path.join(CHECKPOINTS_DIR, ILLUSTRIOUS_V170_FILENAME)
        v170_installed = os.path.isfile(v170_path) and os.path.getsize(v170_path) > 100 * 1024 * 1024

        lcm_path = os.path.join(LORAS_DIR, LCM_LORA_FILE)
        lcm_exists = os.path.isfile(lcm_path) and os.path.getsize(lcm_path) > 1024 * 1024
        lcm_size = os.path.getsize(lcm_path) if lcm_exists else 0

        return {
            "installed": ckpt_exists,
            "all_installed": ckpt_exists and lcm_exists,
            "v170_installed": v170_installed,
            "checkpoint": {
                "name": ckpt_name or ILLUSTRIOUS_V170_FILENAME,
                "installed": ckpt_exists,
                "is_v170": v170_installed,
                "size_bytes": ckpt_size,
                "size_str": f"{round(ckpt_size / (1024 * 1024 * 1024), 2)} GB" if ckpt_exists else "6.5 GB",
                "path": ckpt_path,
            },
            "lcm_lora": {
                "name": LCM_LORA_FILE,
                "installed": lcm_exists,
                "size_bytes": lcm_size,
                "size_str": f"{round(lcm_size / (1024 * 1024), 1)} MB" if lcm_exists else "376 MB",
                "path": lcm_path if lcm_exists else None,
            }
        }
    except Exception as e:
        logger.warning(f"Error checking anime models status: {e}")
        return {
            "installed": False,
            "all_installed": False,
            "checkpoint": {"name": "waiIllustriousSDXL_v170.safetensors", "installed": False, "size_bytes": 0, "size_str": "6.5 GB", "path": None},
            "lcm_lora": {"name": "turbo_lcm_sdxl.safetensors", "installed": False, "size_bytes": 0, "size_str": "376 MB", "path": None}
        }

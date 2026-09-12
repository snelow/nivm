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
    UNET_FILENAME,
    CLIP_FILENAME,
    VAE_FILENAME,
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
        ]

        for src, dst in source_map:
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
        "total_size_mb": round(total_size / (1024 * 1024), 1),
        "total_size_gb": round(total_size / (1024 * 1024 * 1024), 2),
    }

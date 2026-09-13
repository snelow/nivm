"""
Illustrious SDXL anime pipeline — config, model paths, sampling defaults.
"""

import os
from typing import Dict, Optional, Tuple

from ..config import (
    BASE_DIR,
    CHECKPOINTS_DIR,
    LORAS_DIR,
    UNET_DIR,
    CLIP_DIR,
    VAE_DIR,
    ILLUSTRIOUS_V170_FILENAME,
    ILLUSTRIOUS_V150_FILENAME,
    LCM_LORA_FILENAME,
)

_ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
WORKFLOW_TEMPLATE_PATH = os.path.join(_ENGINE_DIR, "workflow_template.json")

# LoRAs and Checkpoints live here inside this project
EXTRA_MODEL_PATHS_YAML = os.path.join(BASE_DIR, "models", "image", "nivm_model_paths.yaml")
os.makedirs(LORAS_DIR, exist_ok=True)
os.makedirs(CHECKPOINTS_DIR, exist_ok=True)


def find_illustrious_checkpoint() -> Tuple[Optional[str], Optional[str]]:
    """
    Finds the active Illustrious checkpoint inside this project's checkpoints directory
    (models/image/checkpoints/), following the same pattern as Qwen.
    Prefers v170 if available, then v150, then any illustrious checkpoint.
    Returns (checkpoint_filename, absolute_path) or (None, None).
    """
    # Auto-link from ComfyUI to project directory if present externally
    try:
        from ..model_checker import auto_link_from_comfyui
        auto_link_from_comfyui()
    except Exception:
        pass

    preferred_names = [
        ILLUSTRIOUS_V170_FILENAME,
        ILLUSTRIOUS_V150_FILENAME,
    ]

    for name in preferred_names:
        p = os.path.join(CHECKPOINTS_DIR, name)
        if os.path.isfile(p) and os.path.getsize(p) > 100 * 1024 * 1024:
            return name, p

    if os.path.isdir(CHECKPOINTS_DIR):
        for fname in sorted(os.listdir(CHECKPOINTS_DIR)):
            if "illustrious" in fname.lower() and fname.lower().endswith(".safetensors"):
                p = os.path.join(CHECKPOINTS_DIR, fname)
                if os.path.isfile(p) and os.path.getsize(p) > 100 * 1024 * 1024:
                    return fname, p

    return None, None

def get_active_checkpoint_name() -> str:
    name, _ = find_illustrious_checkpoint()
    return name or "waiIllustriousSDXL_v170.safetensors"

# Full FP16 checkpoint — resolves dynamically, falling back to default
ILLUSTRIOUS_CHECKPOINT = get_active_checkpoint_name()

# LCM turbo (fast 8-step generation with tuned CFG to prevent black clipping)
LCM_LORA_FILE = "turbo_lcm_sdxl.safetensors"
LCM_SAMPLER = "lcm"
LCM_SCHEDULER = "sgm_uniform"
LCM_STEPS = 8
LCM_CFG = 1.1
LCM_LORA_STRENGTH_MODEL = 0.8
LCM_LORA_STRENGTH_CLIP = 0.8

DEFAULT_NEGATIVE = (
    "worst quality, low quality, bad anatomy, missing fingers, "
    "deformed, text, watermark, bad quality, sketch, censor, "
    "transparent background, patreon logo, duplicate, twin, clone, "
    "multiple views, split view, multiple moles"
)

DEFAULT_STEPS = 26
DEFAULT_CFG = 5.2
DEFAULT_SAMPLER = "dpmpp_2m_sde_gpu"
DEFAULT_SCHEDULER = "karras"

RESOLUTIONS: Dict[str, Tuple[int, int]] = {
    "portrait":      (832, 1216),
    "landscape":     (1216, 832),
    "square":        (1024, 1024),
    "portrait_hd":   (1024, 1536),
    "landscape_hd":  (1536, 1024),
    "square_hd":     (1280, 1280),
}

RESOLUTION_LABELS: Dict[str, str] = {
    "portrait":      "📐 Portrait  (832 × 1216)",
    "landscape":     "📐 Landscape (1216 × 832)",
    "square":        "📐 Square    (1024 × 1024)",
    "portrait_hd":   "🖼️ Portrait HD  (1024 × 1536)",
    "landscape_hd":  "🖼️ Landscape HD (1536 × 1024)",
    "square_hd":     "🖼️ Square HD    (1280 × 1280)",
}


def ensure_extra_model_paths():
    """
    Writes a nivm_model_paths.yaml so ComfyUI picks up checkpoints, LoRAs,
    unet, clip, and vae from nivm/models/image/.
    """
    yaml_content = f"""nivm:
    checkpoints: {CHECKPOINTS_DIR}/
    loras: {LORAS_DIR}/
    unet: {UNET_DIR}/
    clip: {CLIP_DIR}/
    vae: {VAE_DIR}/
"""
    os.makedirs(os.path.dirname(EXTRA_MODEL_PATHS_YAML), exist_ok=True)
    with open(EXTRA_MODEL_PATHS_YAML, "w") as f:
        f.write(yaml_content)
    return EXTRA_MODEL_PATHS_YAML


try:
    ensure_extra_model_paths()
except Exception:
    pass


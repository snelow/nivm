"""
Illustrious SDXL anime pipeline — config, model paths, sampling defaults.
"""

import os
from typing import Dict, Tuple

_ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
IMAGE_ENGINE_DIR = os.path.dirname(_ENGINE_DIR)
CORE_DIR = os.path.dirname(IMAGE_ENGINE_DIR)
BASE_DIR = os.path.dirname(CORE_DIR)

WORKFLOW_TEMPLATE_PATH = os.path.join(_ENGINE_DIR, "workflow_template.json")

# LoRAs live here — ComfyUI is told to look in this dir via extra_model_paths
LORAS_DIR = os.path.join(BASE_DIR, "models", "image", "loras")
os.makedirs(LORAS_DIR, exist_ok=True)

# Extra model paths YAML that tells ComfyUI where nivm keeps its LoRAs/checkpoints
EXTRA_MODEL_PATHS_YAML = os.path.join(BASE_DIR, "models", "image", "nivm_model_paths.yaml")

# Full FP16 checkpoint — faster than GGUF Q8 on this hardware
ILLUSTRIOUS_CHECKPOINT = "waiIllustriousSDXL_v150.safetensors"

# LCM turbo (fast 6-step generation)
LCM_LORA_FILE = "turbo_lcm_sdxl.safetensors"
LCM_SAMPLER = "lcm"
LCM_SCHEDULER = "sgm_uniform"
LCM_STEPS = 6
LCM_CFG = 1.5

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
    Writes a nivm_model_paths.yaml so ComfyUI picks up LoRAs
    from nivm/models/image/loras/ without needing symlinks.
    """
    yaml_content = f"""nivm:
    loras: {LORAS_DIR}/
"""
    os.makedirs(os.path.dirname(EXTRA_MODEL_PATHS_YAML), exist_ok=True)
    with open(EXTRA_MODEL_PATHS_YAML, "w") as f:
        f.write(yaml_content)
    return EXTRA_MODEL_PATHS_YAML


try:
    ensure_extra_model_paths()
except Exception:
    pass


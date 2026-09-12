"""
Configuration and constants for nivm Image Engine (Qwen-Rapid).
"""

import os
import shutil
import sys
from typing import Tuple, Dict

# Paths
CORE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_DIR = os.path.dirname(CORE_DIR)
MODELS_DIR = os.path.join(BASE_DIR, "models")
IMAGE_MODELS_DIR = os.path.join(MODELS_DIR, "image")

UNET_DIR = os.path.join(IMAGE_MODELS_DIR, "unet")
CLIP_DIR = os.path.join(IMAGE_MODELS_DIR, "text_encoders")
VAE_DIR = os.path.join(IMAGE_MODELS_DIR, "vae")

USER_FILES_DIR = os.path.join(BASE_DIR, "User files")
IMAGES_OUTPUT_DIR = os.path.join(USER_FILES_DIR, "images")
UPLOADS_DIR = os.path.join(USER_FILES_DIR, "uploads")

os.makedirs(IMAGE_MODELS_DIR, exist_ok=True)
os.makedirs(UNET_DIR, exist_ok=True)
os.makedirs(CLIP_DIR, exist_ok=True)
os.makedirs(VAE_DIR, exist_ok=True)
os.makedirs(IMAGES_OUTPUT_DIR, exist_ok=True)

# Target Model Filenames
UNET_FILENAME = "Qwen-Rapid-NSFW-v23_Q4_K.gguf"
CLIP_FILENAME = "Qwen2.5-VL-7B-Instruct-abliterated.Q4_K_M.gguf"
VAE_FILENAME = "qwen_image_vae.safetensors"

# Model Download URLs (Direct HuggingFace resolve links for aria2)
MODEL_DOWNLOAD_URLS = {
    "unet": {
        "filename": UNET_FILENAME,
        "target_dir": UNET_DIR,
        "size_label": "13.3 GB",
        "url": "https://huggingface.co/city96/Qwen-Rapid-NSFW-v23-gguf/resolve/main/Qwen-Rapid-NSFW-v23_Q4_K.gguf"
    },
    "text_encoder": {
        "filename": CLIP_FILENAME,
        "target_dir": CLIP_DIR,
        "size_label": "4.7 GB",
        "url": "https://huggingface.co/city96/Qwen2.5-VL-7B-Instruct-GGUF/resolve/main/Qwen2.5-VL-7B-Instruct-abliterated.Q4_K_M.gguf"
    },
    "vae": {
        "filename": VAE_FILENAME,
        "target_dir": VAE_DIR,
        "size_label": "253 MB",
        "url": "https://huggingface.co/Comfy-Org/Qwen-Image-Edit-GGUF/resolve/main/qwen_image_vae.safetensors"
    }
}

# Daemon / Backend Configuration
def get_comfy_dir() -> str:
    try:
        from .setup_helper import detect_comfyui
        detected = detect_comfyui()
        if detected.get("detected") and detected.get("path"):
            return detected["path"]
    except Exception:
        pass
    return os.getenv("COMFY_DIR", "/home/blubvlub/ComfyUI")

COMFY_DIR = get_comfy_dir()
COMFY_PORT = int(os.getenv("COMFY_PORT", "8188"))
COMFY_HOST = "127.0.0.1"

# Find suitable python binary with ComfyUI packages installed
def get_comfy_python() -> str:
    cdir = get_comfy_dir()
    candidates = [
        os.path.join(cdir, "venv312", "bin", "python"),
        os.path.join(cdir, "venv", "bin", "python"),
        os.path.join(cdir, ".venv", "bin", "python"),
        sys.executable,
    ]
    for p in candidates:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return sys.executable

# Default Prompts & Generation Parameters
DEFAULT_NEGATIVE_PROMPT = (
    "deformed face, bad anatomy, blurry face, extra fingers, "
    "deformed pussy, fused labia, missing genitals, smooth crotch, plastic looking pussy, blurry genitals, extra genitals"
)

DEFAULT_STEPS = 5
DEFAULT_CFG = 1.0
DEFAULT_SAMPLER = "euler_ancestral"
DEFAULT_SCHEDULER = "beta"
DEFAULT_EDIT_DENOISE = 0.85

# Aspect Ratio Presets (width, height) - multiples of 16
ASPECT_RATIOS: Dict[str, Tuple[int, int]] = {
    "square": (1024, 1024),
    "1:1": (1024, 1024),
    "portrait": (720, 1280),
    "9:16": (720, 1280),
    "landscape": (1280, 720),
    "16:9": (1280, 720),
    "4:3": (1152, 864),
    "3:4": (864, 1152),
}

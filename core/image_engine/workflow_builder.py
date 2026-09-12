"""
Dynamic Prompt Workflow Generator for Qwen-Rapid.
Supports:
- 0 images: Pure Text-to-Image Generation (EmptyLatentImage, denoise=1.0)
- 1 image: Single Image Editing (TextEncode with image1, denoise=edit_strength)
- 2 images: Image Edit with Reference (TextEncode with image1 + image2)
- 3 images: Triple Composite Conditioning (TextEncode with image1 + image2 + image3)
- Aspect ratio handling: "original", "square", "portrait", "landscape"
"""

import os
import math
import random
from typing import Optional, List, Tuple, Dict, Any
from PIL import Image

from .config import (
    UNET_FILENAME,
    CLIP_FILENAME,
    VAE_FILENAME,
    DEFAULT_NEGATIVE_PROMPT,
    DEFAULT_STEPS,
    DEFAULT_CFG,
    DEFAULT_SAMPLER,
    DEFAULT_SCHEDULER,
    DEFAULT_EDIT_DENOISE,
    ASPECT_RATIOS,
)


def compute_dimensions(
    aspect_ratio: str = "original",
    primary_image_path: Optional[str] = None,
    max_dimension: int = 1280
) -> Tuple[int, int]:
    """
    Computes width and height for generation/edit.
    Ensures dimensions are multiples of 16 for VAE latent downsampling.
    """
    aspect = (aspect_ratio or "original").lower().strip()

    # Try to resolve primary_image_path if not directly found
    resolved_path = None
    if primary_image_path:
        if os.path.isabs(primary_image_path) and os.path.exists(primary_image_path):
            resolved_path = primary_image_path
        else:
            from .config import get_comfy_dir, UPLOADS_DIR, IMAGES_OUTPUT_DIR
            try:
                comfy_dir = get_comfy_dir()
                candidate_paths = [
                    os.path.join(comfy_dir, "input", primary_image_path),
                    os.path.join(UPLOADS_DIR, primary_image_path),
                    os.path.join(IMAGES_OUTPUT_DIR, primary_image_path),
                    primary_image_path,
                ]
                for cp in candidate_paths:
                    if cp and os.path.exists(cp):
                        resolved_path = cp
                        break
            except Exception:
                if os.path.exists(primary_image_path):
                    resolved_path = primary_image_path

    if aspect == "original" and resolved_path:
        try:
            with Image.open(resolved_path) as img:
                w, h = img.size

                # Scale down if exceeds max_dimension
                if max(w, h) > max_dimension:
                    if w > h:
                        h = round((h / w) * max_dimension)
                        w = max_dimension
                    else:
                        w = round((w / h) * max_dimension)
                        h = max_dimension

                # Round to nearest multiple of 16
                w = max(256, round(w / 16) * 16)
                h = max(256, round(h / 16) * 16)
                return (w, h)
        except Exception:
            pass  # Fall back to default portrait/square if image open fails

    # Fuzzy normalization
    if "1:1" in aspect or "square" in aspect:
        return ASPECT_RATIOS["square"]
    elif "16:9" in aspect or "landscape" in aspect:
        return ASPECT_RATIOS["landscape"]
    elif "9:16" in aspect or "portrait" in aspect:
        return ASPECT_RATIOS["portrait"]
    elif "4:3" in aspect:
        return ASPECT_RATIOS["4:3"]
    elif "3:4" in aspect:
        return ASPECT_RATIOS["3:4"]

    if aspect in ASPECT_RATIOS:
        return ASPECT_RATIOS[aspect]

    # Default fallback
    return (1024, 1024) if not primary_image_path else (720, 1280)


def build_qwen_workflow(
    prompt: str,
    negative_prompt: Optional[str] = None,
    images: Optional[List[str]] = None,
    aspect_ratio: str = "original",
    denoise: Optional[float] = None,
    seed: Optional[int] = None,
    steps: int = DEFAULT_STEPS,
    cfg: float = DEFAULT_CFG,
    width: Optional[int] = None,
    height: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Builds the executable ComfyUI prompt graph for Qwen-Rapid.

    :param prompt: Positive text instruction or scene description.
    :param negative_prompt: Optional negative prompt (uses default if None).
    :param images: List of image filenames (already uploaded/placed in Comfy input dir).
                   0 images -> pure text-to-image.
                   1 image  -> standard edit.
                   2 images -> edit + reference.
                   3 images -> triple conditioning.
    :param aspect_ratio: "original", "square", "portrait", or "landscape".
    :param denoise: Float 0.0 - 1.0 (default 1.0 for text->image, 0.85 for edit).
    :param seed: Random integer if None.
    :param steps: Inference steps (default 5 for Qwen-Rapid).
    :param cfg: Guidance scale (default 1.0 for rapid distilled).
    """
    image_list = [img for img in (images or []) if img and str(img).strip()]
    num_images = len(image_list)

    if seed is None or seed < 0:
        seed = random.randint(100000000000000, 999999999999999)

    # Determine denoise
    if denoise is None:
        denoise = 1.0 if num_images == 0 else DEFAULT_EDIT_DENOISE
    denoise = max(0.05, min(1.0, float(denoise)))

    # Compute target resolution if not explicitly given
    if width is None or height is None:
        computed_w, computed_h = compute_dimensions(
            aspect_ratio=aspect_ratio,
            primary_image_path=image_list[0] if num_images > 0 else None
        )
        width = width or computed_w
        height = height or computed_h

    # Ensure multiples of 16
    width = round(width / 16) * 16
    height = round(height / 16) * 16

    neg_prompt_text = negative_prompt if negative_prompt is not None else DEFAULT_NEGATIVE_PROMPT

    # Base prompt graph
    workflow = {
        # 3: KSampler
        "3": {
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": DEFAULT_SAMPLER,
                "scheduler": DEFAULT_SCHEDULER,
                "denoise": denoise,
                "model": ["17", 0],
                "positive": ["10", 0],
                "negative": ["11", 0],
                "latent_image": ["22", 0],
            },
            "class_type": "KSampler",
            "_meta": {"title": "KSampler"}
        },
        # 8: VAEDecode
        "8": {
            "inputs": {
                "samples": ["3", 0],
                "vae": ["19", 0],
            },
            "class_type": "VAEDecode",
            "_meta": {"title": "VAE Decode"}
        },
        # 9: SaveImage
        "9": {
            "inputs": {
                "filename_prefix": "nivm",
                "images": ["8", 0],
            },
            "class_type": "SaveImage",
            "_meta": {"title": "Save Image"}
        },
        # 10: Positive Text Conditioning
        "10": {
            "inputs": {
                "prompt": prompt or "high quality photograph",
                "clip": ["21", 0],
                "vae": ["19", 0],
            },
            "class_type": "TextEncodeQwenImageEditPlus",
            "_meta": {"title": "TextEncode (Positive)"}
        },
        # 11: Negative Text Conditioning
        "11": {
            "inputs": {
                "prompt": neg_prompt_text,
                "clip": ["21", 0],
                "vae": ["19", 0],
            },
            "class_type": "TextEncodeQwenImageEditPlus",
            "_meta": {"title": "TextEncode (Negative)"}
        },
        # 17: GGUF UNet Loader
        "17": {
            "inputs": {
                "unet_name": UNET_FILENAME,
            },
            "class_type": "UnetLoaderGGUF",
            "_meta": {"title": "Unet Loader (GGUF)"}
        },
        # 19: VAE Loader
        "19": {
            "inputs": {
                "vae_name": VAE_FILENAME,
            },
            "class_type": "VAELoader",
            "_meta": {"title": "Load VAE"}
        },
        # 21: GGUF CLIP Loader (Qwen2.5-VL text encoder)
        "21": {
            "inputs": {
                "clip_name": CLIP_FILENAME,
                "type": "qwen_image",
            },
            "class_type": "CLIPLoaderGGUF",
            "_meta": {"title": "CLIPLoader (GGUF)"}
        },
        # 22: Empty Latent Image
        "22": {
            "inputs": {
                "width": width,
                "height": height,
                "batch_size": 1,
            },
            "class_type": "EmptyLatentImage",
            "_meta": {"title": "Empty Latent Image"}
        }
    }

    # Dynamically wire images (image1, image2, image3)
    node_id_map = {0: "13", 1: "25", 2: "26"}
    for idx, img_name in enumerate(image_list[:3]):
        node_id = node_id_map[idx]
        image_key = f"image{idx + 1}"

        # Create LoadImage node
        workflow[node_id] = {
            "inputs": {
                "image": img_name,
            },
            "class_type": "LoadImage",
            "_meta": {"title": f"Image {idx + 1}"}
        }

        # Wire into Positive and Negative TextEncode nodes
        workflow["10"]["inputs"][image_key] = [node_id, 0]
        workflow["11"]["inputs"][image_key] = [node_id, 0]

    return workflow

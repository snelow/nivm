"""
ComfyUI workflow constructor for Illustrious SDXL.

Builds the prompt graph with dynamic LoRA chaining:
  Checkpoint → Character → Expression → Concept → Pose → (LCM)

Only loads LoRAs that are actually needed — unused nodes get removed.
"""

import copy
import json
import logging
import os
import random

from .config import (
    DEFAULT_CFG,
    DEFAULT_STEPS,
    ILLUSTRIOUS_CHECKPOINT,
    LCM_CFG,
    LCM_LORA_FILE,
    LCM_SAMPLER,
    LCM_SCHEDULER,
    LCM_STEPS,
    LORAS_DIR,
    RESOLUTIONS,
    WORKFLOW_TEMPLATE_PATH,
)
from .characters import (
    CHARACTERS,
    EXPRESSIONS,
    CONCEPT_OPTIONS,
    POSE_OPTIONS,
    resolve_concept_option,
    resolve_pose_option,
)
from .prompt_builder import build_prompt, build_negative_prompt

logger = logging.getLogger("nivm.illustrious")

_WORKFLOW_TEMPLATE = None


def _get_template():
    global _WORKFLOW_TEMPLATE
    if _WORKFLOW_TEMPLATE is None:
        with open(WORKFLOW_TEMPLATE_PATH, "r") as f:
            _WORKFLOW_TEMPLATE = json.load(f)
    return _WORKFLOW_TEMPLATE


def build_illustrious_workflow(
    char_key, hairstyle_key=None, outfit_key=None, expr_key=None,
    concept_key="none", pose_key="none", bg_key="auto",
    user_prompt="", negative_prompt=None, seed=-1,
    steps=DEFAULT_STEPS, cfg=DEFAULT_CFG, resolution="portrait",
    width=None, height=None, batch_count=1,
):
    """Build the standard Illustrious workflow. Returns (workflow, positive_prompt)."""
    wf = copy.deepcopy(_get_template())
    char = CHARACTERS.get(char_key, {}) if char_key else {}

    if width is None or height is None:
        res = RESOLUTIONS.get(resolution, RESOLUTIONS["portrait"])
        width = width or res[0]
        height = height or res[1]

    # Track the chain — each LoRA feeds into the next
    last_model = ["1", 0]
    last_clip = ["1", 1]

    # Character LoRA (optional: loaded only if specified on character and file exists on disk)
    char_lora = char.get("lora_file") if char else None
    char_lora_path = os.path.join(LORAS_DIR, char_lora) if char_lora else None
    if char_lora and char_lora_path and os.path.isfile(char_lora_path):
        wf["9"]["inputs"]["lora_name"] = char_lora
        wf["9"]["inputs"]["strength_model"] = char.get("lora_strength_model", 0.9)
        wf["9"]["inputs"]["strength_clip"] = char.get("lora_strength_clip", 0.9)
        wf["9"]["inputs"]["model"] = last_model
        wf["9"]["inputs"]["clip"] = last_clip
        last_model = ["9", 0]
        last_clip = ["9", 1]
    elif "9" in wf:
        del wf["9"]

    # Expression is purely prompt tags (no LoRA)
    if "10" in wf:
        del wf["10"]

    # Concept LoRA (turnaround sheets, salt bae, custom concepts, etc.)
    concept = resolve_concept_option(concept_key) or (CONCEPT_OPTIONS.get(concept_key) if concept_key else None)
    concept_lora = concept.get("lora_file") if concept else None
    concept_lora_path = os.path.join(LORAS_DIR, concept_lora) if concept_lora else None
    if concept_lora and concept_lora_path and os.path.isfile(concept_lora_path):
        wf["11"] = {
            "inputs": {
                "lora_name": concept_lora,
                "strength_model": concept.get("strength", 0.85),
                "strength_clip": concept.get("strength", 0.85),
                "model": last_model,
                "clip": last_clip,
            },
            "class_type": "LoraLoader",
            "_meta": {"title": "Load LoRA (Concept)"},
        }
        last_model = ["11", 0]
        last_clip = ["11", 1]
    elif "11" in wf:
        del wf["11"]

    # Pose LoRA (slav squat, etc.)
    pose = resolve_pose_option(pose_key) or (POSE_OPTIONS.get(pose_key) if pose_key else None)
    pose_lora = pose.get("lora_file") if pose else None
    pose_lora_path = os.path.join(LORAS_DIR, pose_lora) if pose_lora else None
    if pose_lora and pose_lora_path and os.path.isfile(pose_lora_path):
        wf["12"] = {
            "inputs": {
                "lora_name": pose_lora,
                "strength_model": pose.get("strength", 1.0),
                "strength_clip": pose.get("strength", 1.0),
                "model": last_model,
                "clip": last_clip,
            },
            "class_type": "LoraLoader",
            "_meta": {"title": "Load LoRA (Pose)"},
        }
        last_model = ["12", 0]
        last_clip = ["12", 1]
    elif "12" in wf:
        del wf["12"]

    # Wire text encoders + sampler to whatever the last LoRA in the chain was
    wf["2"]["inputs"]["clip"] = last_clip
    wf["3"]["inputs"]["clip"] = last_clip
    wf["6"]["inputs"]["model"] = last_model

    # Prompts
    pos_prompt = build_prompt(
        char_key, hairstyle_key, outfit_key,
        expr_key, concept_key, pose_key, bg_key, user_prompt,
    )
    wf["2"]["inputs"]["text"] = pos_prompt
    wf["3"]["inputs"]["text"] = build_negative_prompt(negative_prompt, bg_key, char_key, user_prompt)

    # Resolution + batch
    wf["4"]["inputs"]["width"] = width
    wf["4"]["inputs"]["height"] = height
    wf["4"]["inputs"]["batch_size"] = batch_count

    # Sampler
    wf["6"]["inputs"]["seed"] = seed if seed >= 0 else random.randint(0, 2**53)
    wf["6"]["inputs"]["steps"] = steps
    wf["6"]["inputs"]["cfg"] = cfg

    return wf, pos_prompt


def build_lcm_workflow(
    char_key, hairstyle_key=None, outfit_key=None, expr_key=None,
    concept_key="none", pose_key="none", bg_key="auto",
    user_prompt="", negative_prompt=None, seed=-1,
    steps=LCM_STEPS, cfg=LCM_CFG, resolution="portrait",
    width=None, height=None, batch_count=1,
    edited_prompt=None, lcm_steps=None, lcm_cfg=None,
):
    """
    LCM turbo variant — appends lcm-lora-sdxl at the end of the chain
    and swaps the sampler for fast generation.
    Returns (workflow, positive_prompt).
    """
    actual_steps = lcm_steps if lcm_steps is not None else steps
    actual_cfg = lcm_cfg if lcm_cfg is not None else cfg

    wf, pos_prompt = build_illustrious_workflow(
        char_key=char_key,
        hairstyle_key=hairstyle_key,
        outfit_key=outfit_key,
        expr_key=expr_key,
        concept_key=concept_key,
        pose_key=pose_key,
        bg_key=bg_key,
        user_prompt=user_prompt,
        negative_prompt=negative_prompt,
        seed=seed,
        steps=actual_steps,
        cfg=actual_cfg,
        resolution=resolution,
        width=width,
        height=height,
        batch_count=batch_count,
    )

    if edited_prompt and edited_prompt.strip():
        wf["2"]["inputs"]["text"] = edited_prompt.strip()
        pos_prompt = edited_prompt.strip()

    last_model = wf["6"]["inputs"]["model"]
    last_clip = wf["2"]["inputs"]["clip"]

    # Tack LCM LoRA onto the end of whatever chain we built
    wf["20"] = {
        "inputs": {
            "lora_name": LCM_LORA_FILE,
            "strength_model": 1.0,
            "strength_clip": 1.0,
            "model": last_model,
            "clip": last_clip,
        },
        "class_type": "LoraLoader",
        "_meta": {"title": "Load LoRA (LCM Turbo)"},
    }

    wf["6"]["inputs"]["model"] = ["20", 0]
    wf["2"]["inputs"]["clip"] = ["20", 1]
    wf["3"]["inputs"]["clip"] = ["20", 1]

    wf["6"]["inputs"]["sampler_name"] = LCM_SAMPLER
    wf["6"]["inputs"]["scheduler"] = LCM_SCHEDULER
    wf["6"]["inputs"]["steps"] = actual_steps
    wf["6"]["inputs"]["cfg"] = actual_cfg

    return wf, pos_prompt


def estimate_duration(width, height, steps, batch_count=1):
    """Rough time estimate tuned for RTX 3050 4GB with SDXL model offloading."""
    megapixels = (width * height) / 1_000_000
    total = megapixels * steps * 1.0 * batch_count
    if total < 60:
        return f"~{int(total)}s"
    mins = int(total // 60)
    secs = int(total % 60)
    return f"~{mins}m {secs}s"

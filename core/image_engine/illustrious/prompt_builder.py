"""
Prompt assembly for Illustrious SDXL.

Tag order for Illustrious:
  masterpiece, best quality → concept → pose → background →
  character trigger → appearance → hairstyle → outfit → expression → user additions
"""

from typing import Tuple, Dict, Any, Optional

from .characters import (
    CHARACTERS,
    EXPRESSIONS,
    CONCEPT_OPTIONS,
    BACKGROUND_OPTIONS,
    POSE_OPTIONS,
    resolve_concept_option,
    resolve_pose_option,
)


def resolve_subject_tags(char: Dict[str, Any], user_prompt: str = "") -> Tuple[str, str]:
    """
    Dynamically resolves positive and anti-twin negative subject tags based on character gender
    or prompt contents when generating without a character.
    Returns:
        (positive_subject_tag, negative_subject_tag)
        e.g. ('solo, 1boy', 'multiple boys, 2boys, 3boys') for male characters
             ('solo, 1girl', 'multiple girls, 2girls, 3girls') for female characters
             ('solo', 'multiple subjects, 2people') for neutral/custom characters
    """
    prompt_l = (user_prompt or "").lower()

    if not char:
        # Check if user specifically requested scenery / landscape with no humans
        if any(k in prompt_l for k in ("scenery", "landscape", "background", "no humans", "environment", "interior", "cityscape", "nature")):
            if not any(k in prompt_l for k in ("1girl", "1boy", "girl", "boy", "female", "male", "woman", "man", "waifu", "person")):
                return "", ""
        if any(k in prompt_l for k in ("1boy", "1man", "boy", "man", "male")) and not any(k in prompt_l for k in ("1girl", "girl", "female", "woman")):
            return "solo, 1boy", "multiple boys, 2boys, 3boys"
        if any(k in prompt_l for k in ("1girl", "1woman", "girl", "woman", "female", "waifu")):
            return "solo, 1girl", "multiple girls, 2girls, 3girls"
        if any(k in prompt_l for k in ("2girls", "2boys", "multiple girls", "multiple boys", "group", "couple")):
            return "", ""
        return "solo", "multiple subjects, 2people"

    gender = str(char.get("gender", "")).lower().strip()
    if gender in ("male", "boy", "man", "1boy"):
        return "solo, 1boy", "multiple boys, 2boys, 3boys"
    if gender in ("female", "girl", "woman", "1girl"):
        return "solo, 1girl", "multiple girls, 2girls, 3girls"

    # Auto-detect from character appearance, trigger word, and outfit triggers
    outfits = char.get("outfits", {})
    combined_text = (
        str(char.get("appearance", "")) + " " +
        str(char.get("trigger_word", "")) + " " +
        " ".join(str(o.get("trigger", "")) for o in outfits.values())
    ).lower()

    if any(k in combined_text for k in ("1boy", "1man", " male", "boy ", "handsome")):
        return "solo, 1boy", "multiple boys, 2boys, 3boys"
    if any(k in combined_text for k in ("1girl", "1woman", "skirt", "bikini", "bra", "breasts", "dress", "girl", "panties", "female")):
        return "solo, 1girl", "multiple girls, 2girls, 3girls"

    return "solo", "multiple subjects, 2people"


def build_prompt(
    char_key, hairstyle_key=None, outfit_key=None, expr_key=None,
    concept_key="none", pose_key="none", bg_key="auto", user_prompt="",
):
    """Assemble the full positive prompt from selectors and LLM user prompt."""
    char = CHARACTERS.get(char_key, {}) if char_key and char_key not in ("none", "null", "prompt_only", "base") else {}
    pos_subject, _ = resolve_subject_tags(char, user_prompt)
    if pos_subject:
        parts = [f"masterpiece, best quality, very aesthetic, {pos_subject}"]
    else:
        parts = ["masterpiece, best quality, very aesthetic"]

    # Concept: strictly skipped if none or not requested
    if concept_key and str(concept_key).lower() not in ("none", "null", ""):
        concept = resolve_concept_option(concept_key) or CONCEPT_OPTIONS.get(concept_key)
        if concept and concept.get("trigger"):
            parts.append(concept["trigger"])

    # Pose: strictly skipped if none or not requested
    if pose_key and str(pose_key).lower() not in ("none", "null", ""):
        pose = resolve_pose_option(pose_key) or POSE_OPTIONS.get(pose_key)
        if pose and pose.get("trigger"):
            parts.append(pose["trigger"])

    # Background: strictly skipped if auto or none
    if bg_key and bg_key not in ("auto", "none"):
        bg = BACKGROUND_OPTIONS.get(bg_key)
        if bg and bg.get("positive"):
            parts.append(bg["positive"])

    # Character trigger and core appearance
    if char.get("trigger_word"):
        parts.append(char["trigger_word"])
    if char.get("appearance"):
        parts.append(char["appearance"])

    # Hairstyle: only if explicitly specified
    if hairstyle_key and hairstyle_key != "none" and "hairstyles" in char:
        if hairstyle_key in char["hairstyles"]:
            hair_trigger = char["hairstyles"][hairstyle_key].get("trigger")
            if hair_trigger:
                parts.append(hair_trigger)
        else:
            clean_hk = hairstyle_key.lower().strip()
            for hk, hv in char["hairstyles"].items():
                if clean_hk in hk.lower() or clean_hk in hv.get("display_name", "").lower():
                    hair_trigger = hv.get("trigger")
                    if hair_trigger:
                        parts.append(hair_trigger)
                    break

    # Outfit: ALWAYS enforce an outfit to avoid missing clothes / multi-subject ambiguity
    outfit_found = False
    if "outfits" in char and char["outfits"]:
        if outfit_key and outfit_key not in ("none", "skip"):
            if outfit_key in char["outfits"]:
                outfit_trigger = char["outfits"][outfit_key].get("trigger")
                if outfit_trigger:
                    parts.append(outfit_trigger)
                    outfit_found = True
            else:
                clean_ok = outfit_key.lower().strip()
                for ok, ov in char["outfits"].items():
                    if clean_ok in ok.lower() or clean_ok in ov.get("display_name", "").lower():
                        outfit_trigger = ov.get("trigger")
                        if outfit_trigger:
                            parts.append(outfit_trigger)
                            outfit_found = True
                        break
        # If no outfit was specified or matched, default to the character's primary registered outfit
        if not outfit_found and outfit_key != "skip":
            first_outfit_key = list(char["outfits"].keys())[0]
            first_trigger = char["outfits"][first_outfit_key].get("trigger")
            if first_trigger:
                parts.append(first_trigger)

    # Expression
    if expr_key and str(expr_key).lower() not in ("none", "null", ""):
        if expr_key in EXPRESSIONS:
            expr_trigger = EXPRESSIONS[expr_key].get("trigger")
            if expr_trigger:
                parts.append(expr_trigger)
        else:
            clean_ek = expr_key.lower().strip()
            for ek, ev in EXPRESSIONS.items():
                if clean_ek in ek.lower() or clean_ek in ev.get("display_name", "").lower():
                    expr_trigger = ev.get("trigger")
                    if expr_trigger:
                        parts.append(expr_trigger)
                    break
    elif char_key and str(char_key).lower() not in ("none", "null", "prompt_only", "base"):
        parts.append(":)")

    if user_prompt and user_prompt.strip():
        parts.append(user_prompt.strip())

    return ",\n".join(parts)


def build_negative_prompt(negative_prompt=None, bg_key="auto", char_key=None, user_prompt=""):
    """Merge user negative with background-specific negatives and anti-twin subject negatives."""
    from .config import DEFAULT_NEGATIVE

    neg = negative_prompt if negative_prompt is not None else DEFAULT_NEGATIVE
    char = CHARACTERS.get(char_key, {}) if char_key and char_key not in ("none", "null", "prompt_only", "base") else {}
    _, neg_subject = resolve_subject_tags(char, user_prompt)
    if neg_subject and neg_subject not in neg:
        neg = neg + ", " + neg_subject

    bg = BACKGROUND_OPTIONS.get(bg_key, BACKGROUND_OPTIONS.get("auto"))
    if bg and bg.get("negative"):
        neg = neg + ", " + bg["negative"]
    return neg


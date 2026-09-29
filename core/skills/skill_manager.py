import os
import re
import logging
from typing import Dict, List, Optional, Any

logger = logging.getLogger("nivm.skills")

_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))

SKILLS_REGISTRY: Dict[str, Dict[str, Any]] = {
    "anime_generation": {
        "id": "anime_generation",
        "name": "Anime Generation",
        "description": "High-detail anime character and scene synthesis using Illustrious SDXL",
        "tools": ["generate_anime_image"],
        "file": "anime_generation.md",
        "triggers": [
            r"\banime\b",
            r"\bwaifu\b",
            r"\bmanga\b",
            r"\billustrat\w*\b",
            r"\bdraw\b(?:\s+(?:an?\s+)?anime|\s+\w+\s+anime)",
            r"\borihime\b",
            r"\bmakima\b",
            r"\b2d\s+(?:girl|boy|art|character)\b",
            r"\bdanbooru\b",
        ],
    },
    "image_studio": {
        "id": "image_studio",
        "name": "Image Studio",
        "description": "Photorealistic image synthesis & universal image editing (realistic & anime) using Qwen-Rapid",
        "tools": ["generate_image", "edit_image"],
        "file": "image_studio.md",
        "triggers": [
            r"\b(?:generate|create|render|paint|draw|make)\s+(?:an?\s+)?image\b",
            r"\bedit\s+(?:this\s+|the\s+)?image\b",
            r"\b(?:modify|alter|transform|change|inpaint)\s+(?:this\s+|the\s+)?image\b",
            r"\bphotoreal\w*\b",
            r"\bphoto\s+of\b",
            r"\bpicture\s+of\b",
            r"\bchange\s+(?:her|his|their|the)\s+(?:outfit|clothes|hair|expression|background)\b",
        ],
    },
    "terminal": {
        "id": "terminal",
        "name": "Terminal",
        "description": "Execute non-interactive shell commands on the local Linux host machine",
        "tools": ["execute_terminal"],
        "file": "terminal.md",
        "triggers": [
            r"\bterminal\b",
            r"\bexecute\s+command\b",
            r"\brun\s+(?:command|script|shell|bash)\b",
            r"\b(?:what\s+is\s+the\s+)?(?:time|date)\b",
            r"\b(?:system|server)\s+(?:specs|stats|info|status|uptime)\b",
            r"\b(?:disk\s+space|free\s+memory|ram\s+usage)\b",
            r"\bls\s+-",
            r"\bcat\s+/",
        ],
    },
}


def get_available_skills() -> Dict[str, Dict[str, Any]]:
    """Returns metadata for all available skills."""
    result = {}
    for skill_id, skill in SKILLS_REGISTRY.items():
        result[skill_id] = {
            "id": skill["id"],
            "name": skill["name"],
            "description": skill["description"],
            "tools": skill["tools"],
        }
    return result


def get_skill_content(skill_id: str) -> Optional[str]:
    """Reads and returns the markdown documentation for a given skill ID."""
    skill = SKILLS_REGISTRY.get(skill_id)
    if not skill:
        return None
    file_path = os.path.join(_CURRENT_DIR, skill["file"])
    if os.path.isfile(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read().strip()
        except Exception as e:
            logger.error(f"Failed to read skill file {file_path}: {e}")
            return None
    return None


def detect_skills_for_prompt(user_text: str) -> List[str]:
    """Scans the user query and returns matched skill IDs based on intent triggers.
    
    Anime generation takes precedence over image studio creation for anime characters
    and anime styling, while preserving image editing capabilities for all image types.
    """
    if not user_text or not isinstance(user_text, str):
        return []
    
    text = user_text.lower()
    matched = []

    # Dynamically check registered anime characters if available
    matches_registered_char = False
    try:
        from core.image_engine.illustrious.characters import get_characters
        chars = get_characters(nsfw_enabled=True)
        for char_key, char_data in chars.items():
            words = char_key.split("_")
            disp = char_data.get("display_name", "").lower().split()
            for w in set(words + disp):
                if len(w) > 2 and re.search(rf"\b{re.escape(w)}\b", text):
                    matches_registered_char = True
                    break
            if matches_registered_char:
                break
    except Exception:
        pass

    # Check anime generation triggers
    anime_skill = SKILLS_REGISTRY.get("anime_generation", {})
    is_anime = matches_registered_char or any(
        re.search(t, text, re.IGNORECASE) for t in anime_skill.get("triggers", [])
    )
    if is_anime:
        matched.append("anime_generation")

    # Check image studio triggers
    is_edit = bool(
        re.search(r"\b(?:edit|modify|alter|transform|change|inpaint)\s+(?:this\s+|the\s+)?image\b", text, re.IGNORECASE)
        or re.search(r"\bchange\s+(?:her|his|their|the)\s+(?:outfit|clothes|hair|expression|background)\b", text, re.IGNORECASE)
    )
    is_photo_or_general = bool(
        re.search(r"\bphotoreal\w*\b", text, re.IGNORECASE)
        or re.search(r"\b(?:photo|picture)\s+of\b", text, re.IGNORECASE)
        or re.search(r"\brealistic\b", text, re.IGNORECASE)
    )
    is_new_image = bool(
        re.search(r"\b(?:generate|create|render|paint|draw|make)\s+(?:an?\s+)?image\b", text, re.IGNORECASE)
    )

    # Only include image_studio if it is an edit request OR if it's a non-anime image creation request
    if is_edit or (not is_anime and (is_new_image or is_photo_or_general)):
        matched.append("image_studio")

    # Check terminal triggers
    terminal_skill = SKILLS_REGISTRY.get("terminal", {})
    if any(re.search(t, text, re.IGNORECASE) for t in terminal_skill.get("triggers", [])):
        matched.append("terminal")
                
    return matched


def build_skills_instruction(active_skill_ids: Optional[List[str]] = None) -> str:
    """Builds a token-efficient system instruction for skills.
    
    If active_skill_ids are provided, mounts their full detailed markdown.
    Otherwise, injects only a lightweight 3-line index of available skills.
    """
    if active_skill_ids:
        blocks = []
        for sid in active_skill_ids:
            content = get_skill_content(sid)
            skill_meta = SKILLS_REGISTRY.get(sid, {})
            name = skill_meta.get("name", sid)
            if content:
                blocks.append(f"[SKILL MOUNTED: {name} (id: {sid})]\n{content}")
        if blocks:
            return "\n\n" + "\n\n".join(blocks)

    # Lightweight index when no specific skill is mounted
    index_lines = ["\n\n[AVAILABLE SKILLS SYSTEM]"]
    index_lines.append("To view full capabilities and usage rules for any skill, call: TOOL_CALL: read_skill(skill_name)")
    index_lines.append("Skills Catalog:")
    for skill_id, s in SKILLS_REGISTRY.items():
        index_lines.append(f"- {s['id']} ({s['name']}): {s['description']} [tools: {', '.join(s['tools'])}]")
    return "\n".join(index_lines)

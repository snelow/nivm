import os
import json
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger("nivm.illustrious.characters")

_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
_IMAGE_ENGINE_DIR = os.path.dirname(_CURRENT_DIR)
_CORE_DIR = os.path.dirname(_IMAGE_ENGINE_DIR)
_BASE_DIR = os.path.dirname(_CORE_DIR)

# Single unified user registry in User files/
USER_ANIME_REGISTRY_JSON = os.path.join(_BASE_DIR, "User files", "anime_registry.json")
OPTIONS_JSON = USER_ANIME_REGISTRY_JSON

# Built-in tag definitions (prompt modifiers) fallback
DEFAULT_REGISTRY = {
    "characters": {},
    "concepts": {},
    "poses": {},
    "expressions": {
        "smile": {"display_name": "😊 Smile", "trigger": ":)"},
        "big_grin": {"display_name": "😄 Big Grin", "trigger": ":D"},
        "cat_mouth": {"display_name": "😺 Cat Mouth", "trigger": ":3"},
        "surprised": {"display_name": "😮 Surprised", "trigger": ":o"},
        "wink": {"display_name": "😉 Wink", "trigger": ";)"},
        "smug": {"display_name": "😏 Smug", "trigger": ">:)"},
        "tongue_out": {"display_name": "😛 Tongue Out", "trigger": ":p"},
        "blush": {"display_name": "😳 Blush", "trigger": "blush"},
        "embarrassed": {"display_name": "😳 Embarrassed", "trigger": "embarrassed, blush, looking away"},
        "pout": {"display_name": "😤 Pout", "trigger": "pout"},
        "serious": {"display_name": "😐 Serious", "trigger": "serious"},
        "sad": {"display_name": "😢 Sad", "trigger": "sad, crying"},
        "angry": {"display_name": "😠 Angry", "trigger": "angry"},
        "yandere": {"display_name": "🔪 Yandere Face", "trigger": "yandere, crazy smile, dark persona, shadow over eyes"}
    },
    "backgrounds": {
        "auto": {"display_name": "✨ Auto / Scenic", "trigger": "scenic, atmospheric background"},
        "simple": {"display_name": "⚪ Simple / Clean", "trigger": "simple background, clean background"},
        "white": {"display_name": "⬜ Pure White", "trigger": "white background, solid background"},
        "gradient": {"display_name": "🌈 Gradient", "trigger": "gradient background, soft lighting"},
        "nature": {"display_name": "🌿 Nature & Outdoors", "trigger": "outdoors, nature, lush greenery, trees, sunlight"},
        "city": {"display_name": "🏙️ Cyberpunk / Urban City", "trigger": "city street, urban background, buildings, neon glow"},
        "room": {"display_name": "🛋️ Cozy Bedroom / Interior", "trigger": "indoor, cozy bedroom, soft ambient light, window, curtains"},
        "cherry_blossom": {"display_name": "🌸 Cherry Blossom Park", "trigger": "cherry blossoms, falling petals, spring, outdoor park"},
        "night_sky": {"display_name": "🌌 Starlit Night Sky", "trigger": "night sky, starry sky, milky way, moon, celestial glow"},
        "beach": {"display_name": "🏖️ Tropical Beach & Ocean", "trigger": "beach, ocean, clear blue sea, bright sunshine, white sand"}
    },
    "nsfw_options": {},
}

# In-memory unified registry cache
_registry_cache: Optional[Dict[str, Any]] = None


def _load_registry(force_reload: bool = False) -> Dict[str, Any]:
    """Loads the unified anime registry from User files/anime_registry.json."""
    global _registry_cache
    if _registry_cache is not None and not force_reload:
        return _registry_cache

    if os.path.isfile(USER_ANIME_REGISTRY_JSON):
        try:
            with open(USER_ANIME_REGISTRY_JSON, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    for k in ("characters", "concepts", "poses", "expressions", "backgrounds", "nsfw_options"):
                        data.setdefault(k, {})
                    _registry_cache = data
                    return _registry_cache
        except Exception as e:
            logger.error(f"Failed loading anime registry from {USER_ANIME_REGISTRY_JSON}: {e}")

    import copy
    _registry_cache = copy.deepcopy(DEFAULT_REGISTRY)
    _save_registry(_registry_cache)
    return _registry_cache


def _save_registry(registry_data: Dict[str, Any]) -> bool:
    """Saves the unified anime registry strictly to User files/anime_registry.json."""
    global _registry_cache
    _registry_cache = registry_data

    try:
        os.makedirs(os.path.dirname(USER_ANIME_REGISTRY_JSON), exist_ok=True)
        with open(USER_ANIME_REGISTRY_JSON, "w", encoding="utf-8") as f:
            json.dump(registry_data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"Failed writing anime registry to {USER_ANIME_REGISTRY_JSON}: {e}")
        return False


def _load_options() -> Dict[str, Any]:
    return _load_registry()


def load_characters(force_reload: bool = False) -> Dict[str, Any]:
    """Load character definitions from User files/anime_registry.json."""
    reg = _load_registry(force_reload=force_reload)
    return reg.setdefault("characters", {})


def save_characters(characters_data: Dict[str, Any]) -> bool:
    """Save character dictionary strictly into User files/anime_registry.json."""
    reg = _load_registry()
    reg["characters"] = characters_data
    return _save_registry(reg)


def get_character(char_key: str) -> Optional[Dict[str, Any]]:
    chars = load_characters()
    return chars.get(char_key)


def save_character(char_key: str, data: Dict[str, Any]) -> Dict[str, Any]:
    reg = _load_registry(force_reload=True)
    chars = reg.setdefault("characters", {})
    chars[char_key] = data
    _save_registry(reg)
    return chars[char_key]


def delete_character(char_key: str, delete_file: bool = True) -> bool:
    reg = _load_registry(force_reload=True)
    chars = reg.setdefault("characters", {})
    if char_key in chars:
        char = chars[char_key]
        lora_file = char.get("lora_file")
        if delete_file and lora_file:
            from .config import LORAS_DIR
            lora_path = os.path.join(LORAS_DIR, lora_file)
            if os.path.isfile(lora_path):
                try:
                    os.remove(lora_path)
                except Exception as e:
                    logger.warning(f"Could not remove LoRA file {lora_path}: {e}")
        del chars[char_key]
        _save_registry(reg)
        return True
    return False


def get_characters(nsfw_enabled: bool = False) -> Dict[str, Any]:
    chars = load_characters()
    if nsfw_enabled:
        return chars

    filtered = {}
    for k, v in chars.items():
        if v.get("nsfw"):
            continue
        entry = dict(v)
        if "outfits" in entry:
            entry["outfits"] = {
                ok: ov for ok, ov in entry["outfits"].items()
                if not ov.get("nsfw")
            }
        filtered[k] = entry
    return filtered


def get_character_names() -> Dict[str, str]:
    chars = load_characters()
    return {k: v.get("display_name", k) for k, v in chars.items()}


def get_expressions(nsfw_enabled: bool = False) -> Dict[str, Any]:
    opts = _load_options().get("expressions", {})
    if nsfw_enabled:
        return opts
    return {k: v for k, v in opts.items() if not v.get("nsfw")}


def get_concept_options(nsfw_enabled: bool = False) -> Dict[str, Any]:
    opts = _load_options().get("concepts", {})
    if nsfw_enabled:
        return opts
    return {k: v for k, v in opts.items() if not v.get("nsfw")}


def get_background_options() -> Dict[str, Any]:
    return _load_options().get("backgrounds", {})


def get_pose_options(nsfw_enabled: bool = False) -> Dict[str, Any]:
    opts = _load_options().get("poses", {})
    if nsfw_enabled:
        return opts
    return {k: v for k, v in opts.items() if not v.get("nsfw")}


def delete_option_item(category: str, key: str, delete_file: bool = True) -> bool:
    """Deletes an item from anime_registry.json (e.g. category='concepts' or 'poses') and removes its file from disk."""
    reg = _load_registry()
    if category in reg and key in reg[category]:
        item = reg[category][key]
        lora_file = item.get("lora_file")
        if delete_file and lora_file:
            from .config import LORAS_DIR
            lora_path = os.path.join(LORAS_DIR, lora_file)
            if os.path.isfile(lora_path):
                try:
                    os.remove(lora_path)
                except Exception as e:
                    logger.warning(f"Could not remove LoRA file {lora_path}: {e}")
        del reg[category][key]
        return _save_registry(reg)
    return False


def save_option_item(category: str, key: str, data: Dict[str, Any]) -> bool:
    """Save or update an option item (concept or pose) in User files/anime_registry.json."""
    if category not in ("concepts", "poses"):
        return False
    reg = _load_registry()
    if category not in reg:
        reg[category] = {}
    reg[category][key] = data
    return _save_registry(reg)



def resolve_pose_option(pose_key: Optional[str]) -> Optional[Dict[str, Any]]:
    """Resolves a pose entry by exact key, clean name, display name, or LoRA filename."""
    if not pose_key or str(pose_key).lower() in ("none", "null", "false", ""):
        return None
    poses = _load_options().get("poses", {})
    if pose_key in poses:
        return poses[pose_key]

    clean = str(pose_key).lower().strip().replace(" ", "_")
    if clean in poses:
        return poses[clean]

    for pk, pv in poses.items():
        if not isinstance(pv, dict):
            continue
        if clean in pk.lower() or pk.lower() in clean:
            return pv
        disp = pv.get("display_name", "").lower()
        if clean in disp or any(tok in clean for tok in disp.split() if len(tok) >= 4 and not tok.startswith("&")):
            return pv
        lora_f = str(pv.get("lora_file", "")).lower()
        if lora_f and (clean in lora_f or lora_f in clean):
            return pv
    return None


def resolve_concept_option(concept_key: Optional[str]) -> Optional[Dict[str, Any]]:
    """Resolves a concept entry by exact key, clean name, display name, or LoRA filename."""
    if not concept_key or str(concept_key).lower() in ("none", "null", "false", ""):
        return None
    concepts = _load_options().get("concepts", {})
    if concept_key in concepts:
        return concepts[concept_key]

    clean = str(concept_key).lower().strip().replace(" ", "_")
    if clean in concepts:
        return concepts[clean]

    for ck, cv in concepts.items():
        if not isinstance(cv, dict):
            continue
        if clean in ck.lower() or ck.lower() in clean:
            return cv
        disp = cv.get("display_name", "").lower()
        if clean in disp or any(tok in clean for tok in disp.split() if len(tok) >= 4 and not tok.startswith("&")):
            return cv
        lora_f = str(cv.get("lora_file", "")).lower()
        if lora_f and (clean in lora_f or lora_f in clean):
            return cv
    return None


def sync_lora_files_with_disk() -> Dict[str, Any]:
    """
    Checks registered characters, concepts, and poses that have a lora_file.
    If the .safetensors file was deleted from models/image/loras/ on disk,
    automatically removes the entry from characters.json and options.json
    so that deleting a file from disk deletes it from the window (bidirectional sync).
    """
    from .config import LORAS_DIR
    if not os.path.isdir(LORAS_DIR):
        return {"deleted_chars": [], "deleted_concepts": [], "deleted_poses": []}

    deleted_chars = []
    reg = _load_registry(force_reload=True)
    chars = reg.setdefault("characters", {})
    changed = False

    for k, v in list(chars.items()):
        lora_f = v.get("lora_file")
        if lora_f:
            full_path = os.path.join(LORAS_DIR, lora_f)
            if not os.path.isfile(full_path):
                logger.info(f"LoRA file '{lora_f}' deleted from disk. Sync-removing character '{k}' from registry.")
                del chars[k]
                deleted_chars.append(k)
                changed = True

    deleted_concepts = []
    deleted_poses = []

    for cat, del_list in [("concepts", deleted_concepts), ("poses", deleted_poses)]:
        if cat in reg and isinstance(reg[cat], dict):
            for k, v in list(reg[cat].items()):
                if not isinstance(v, dict):
                    continue
                lora_f = v.get("lora_file")
                if lora_f:
                    full_path = os.path.join(LORAS_DIR, lora_f)
                    if not os.path.isfile(full_path):
                        logger.info(f"LoRA file '{lora_f}' deleted from disk. Sync-removing {cat} '{k}' from registry.")
                        del reg[cat][k]
                        del_list.append(k)
                        changed = True

    if changed:
        _save_registry(reg)

    return {
        "deleted_chars": deleted_chars,
        "deleted_concepts": deleted_concepts,
        "deleted_poses": deleted_poses,
    }


def serialize_registry(nsfw_enabled: bool = False, include_all: bool = False) -> Dict[str, Any]:
    from .config import LORAS_DIR
    # Sync disk deletions with registry
    sync_lora_files_with_disk()
    if include_all:
        chars = load_characters()
    else:
        chars = get_characters(nsfw_enabled=nsfw_enabled)
    serialized_chars = {}
    for key, char in chars.items():
        hairstyles = None
        if "hairstyles" in char:
            hairstyles = {
                hk: {
                    "display_name": hv.get("display_name", hk),
                    "trigger": hv.get("trigger", ""),
                }
                for hk, hv in char["hairstyles"].items()
            }

        outfits = {
            ok: {
                "display_name": ov.get("display_name", ok),
                "trigger": ov.get("trigger", ""),
                "nsfw": bool(ov.get("nsfw", False)),
            }
            for ok, ov in char.get("outfits", {}).items()
            if include_all or nsfw_enabled or not ov.get("nsfw")
        }

        lora_f = char.get("lora_file", "")
        has_file = bool(lora_f)
        file_exists = bool(lora_f and os.path.isfile(os.path.join(LORAS_DIR, lora_f))) if has_file else True

        serialized_chars[key] = {
            "display_name": char.get("display_name", key),
            "trigger_word": char.get("trigger_word", ""),
            "appearance": char.get("appearance", ""),
            "lora_file": lora_f,
            "has_lora": has_file,
            "file_exists": file_exists,
            "lora_strength_model": char.get("lora_strength_model", 0.9),
            "lora_strength_clip": char.get("lora_strength_clip", 0.9),
            "hairstyles": hairstyles,
            "outfits": outfits,
            "nsfw": bool(char.get("nsfw", False)),
        }

    concepts_serialized = {}
    concepts_src = _load_options().get("concepts", {}) if include_all else get_concept_options(nsfw_enabled)
    for k, v in concepts_src.items():
        lora_f = v.get("lora_file")
        has_f = bool(lora_f)
        file_exists = bool(lora_f and os.path.isfile(os.path.join(LORAS_DIR, lora_f))) if has_f else True
        concepts_serialized[k] = {
            "display_name": v.get("display_name", k),
            "trigger": v.get("trigger", ""),
            "lora_file": lora_f,
            "has_lora": has_f,
            "file_exists": file_exists,
            "strength": v.get("strength", 1.0),
            "nsfw": bool(v.get("nsfw", False)),
        }

    poses_serialized = {}
    poses_src = _load_options().get("poses", {}) if include_all else get_pose_options(nsfw_enabled)
    for k, v in poses_src.items():
        lora_f = v.get("lora_file")
        has_f = bool(lora_f)
        file_exists = bool(lora_f and os.path.isfile(os.path.join(LORAS_DIR, lora_f))) if has_f else True
        poses_serialized[k] = {
            "display_name": v.get("display_name", k),
            "trigger": v.get("trigger", ""),
            "lora_file": lora_f,
            "has_lora": has_f,
            "file_exists": file_exists,
            "strength": v.get("strength", 1.0),
            "nsfw": bool(v.get("nsfw", False)),
        }

    lora_files = []
    if os.path.isdir(LORAS_DIR):
        try:
            lora_files = sorted([f for f in os.listdir(LORAS_DIR) if f.lower().endswith((".safetensors", ".pt"))])
        except Exception as e:
            logger.warning(f"Error listing lora files: {e}")

    return {
        "characters": serialized_chars,
        "expressions": {
            k: {"display_name": v.get("display_name", k), "trigger": v.get("trigger", "")}
            for k, v in get_expressions(nsfw_enabled).items()
        },
        "concepts": concepts_serialized,
        "backgrounds": {
            k: {"display_name": v.get("display_name", k)}
            for k, v in get_background_options().items()
        },
        "poses": poses_serialized,
        "available_lora_files": lora_files,
    }




class _DynamicDict(dict):
    """Dynamic dict wrapper so module imports stay in sync with JSON updates."""
    def __init__(self, getter):
        super().__init__()
        self._getter = getter

    def __getitem__(self, key):
        return self._getter()[key]

    def get(self, key, default=None):
        return self._getter().get(key, default)

    def items(self):
        return self._getter().items()

    def values(self):
        return self._getter().values()

    def keys(self):
        return self._getter().keys()

    def __contains__(self, key):
        return key in self._getter()

    def __len__(self):
        return len(self._getter())

    def __iter__(self):
        return iter(self._getter())


# Dynamic proxies for existing imports
CHARACTERS = _DynamicDict(lambda: load_characters())
EXPRESSIONS = _DynamicDict(lambda: _load_options().get("expressions", {}))
NSFW_OPTIONS = _DynamicDict(lambda: _load_options().get("nsfw_options", {}))
CONCEPT_OPTIONS = _DynamicDict(lambda: _load_options().get("concepts", {}))
BACKGROUND_OPTIONS = _DynamicDict(lambda: _load_options().get("backgrounds", {}))
POSE_OPTIONS = _DynamicDict(lambda: _load_options().get("poses", {}))

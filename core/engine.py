"""
Multi-Model Engine Manager for Project NIVM.

Manages multiple GGUF models with hot-swap capability:
- Router model (Qwen3-1.7B): always-ready intent classifier
- Specialist models (Qwen3-8B, Gemma-4-E2B): swapped onto GPU on demand

Strategy:
  1. Router loads on GPU at startup (tiny, ~1.7GB)
  2. On request: router classifies intent → specialist loads on GPU (router unloaded)
  3. Specialist generates response → unloads → router reloads on GPU
"""

import logging
import gc
import os
import time
import contextlib
import struct
import json
from typing import Dict, Any, Optional, List, Union, Tuple


try:
    import ctypes
    _libc = ctypes.CDLL(None)
except Exception:
    _libc = None


@contextlib.contextmanager
def suppress_c():
    """Temporarily redirect low-level C file descriptors 1 (stdout) and 2 (stderr) to /dev/null."""
    try:
        if _libc and hasattr(_libc, 'fflush'):
            try:
                _libc.fflush(None)
            except Exception:
                pass
        devnull = os.open(os.devnull, os.O_RDWR)
        old_stdout = os.dup(1)
        old_stderr = os.dup(2)
        os.dup2(devnull, 1)
        os.dup2(devnull, 2)
    except Exception:
        yield
        return

    try:
        yield
    finally:
        if _libc and hasattr(_libc, 'fflush'):
            try:
                _libc.fflush(None)
            except Exception:
                pass
        try:
            os.dup2(old_stdout, 1)
            os.dup2(old_stderr, 2)
            os.close(old_stdout)
            os.close(old_stderr)
            os.close(devnull)
        except Exception:
            pass

try:
    from llama_cpp import Llama
    import llama_cpp
    import numpy as np
    import ctypes

    # Suppress verbose C-level llama.cpp and ggml logging from spilling into the terminal
    try:
        @llama_cpp.llama_log_callback
        def _silent_llama_log_callback(level, text, user_data):
            if text and logger.isEnabledFor(logging.DEBUG):
                try:
                    msg = text.decode('utf-8', errors='replace').rstrip()
                    if msg:
                        logger.debug(f"[llama.cpp] {msg}")
                except Exception:
                    pass

        # Keep a persistent module-level reference to the ctypes callback to prevent GC
        _llama_log_c_callback = _silent_llama_log_callback
        llama_cpp.llama_log_set(_llama_log_c_callback, ctypes.c_void_p())
    except Exception as _log_err:
        pass

    class _SafeScores:
        """
        Wraps llama_cpp scores array to prevent IndexError during token sampling
        and stopping criteria evaluation (e.g. 'index 2111 is out of bounds for axis 0 with size 8').
        """
        def __init__(self, arr, vocab_size):
            self.arr = arr
            self.vocab_size = vocab_size

        def __getitem__(self, item):
            try:
                return self.arr[item]
            except (IndexError, TypeError):
                if len(self.arr) > 0:
                    return self.arr[-1]
                return np.zeros((self.vocab_size,), dtype=np.single)

        def __len__(self):
            return len(self.arr)

        @property
        def shape(self):
            return self.arr.shape

        def __array__(self, dtype=None):
            return np.asarray(self.arr, dtype=dtype)

        def copy(self):
            return self.arr.copy()

        def tolist(self):
            return self.arr.tolist()

    # Monkey-patch llama_cpp.Llama._scores property safely
    try:
        def _get_safe_scores(self):
            return _SafeScores(self.scores[: self.n_tokens, :], self._n_vocab)

        llama_cpp.Llama._scores = property(_get_safe_scores)
    except Exception as _patch_err:
        pass

    HAS_LLAMA_CPP = True
except ImportError:
    HAS_LLAMA_CPP = False

logger = logging.getLogger(__name__)

# Model registry
# Each entry defines a model role and its loading configuration.

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(PROJECT_ROOT, "models")

MODEL_REGISTRY: Dict[str, Dict[str, Any]] = {
    "router": {
        "name": "Qwen2.5 (1.5B) Router",
        "paths": [
            os.path.join(MODELS_DIR, "qwen2.5-1.5b-instruct-q4_k_m.gguf"),
            os.path.join(MODELS_DIR, "Qwen3-1.7B-Q8_0.gguf"),
        ],
        "n_ctx": 8192,
        "n_gpu_layers": -1,      # Fully on GPU when active
        "n_batch": 512,
        "flash_attn": True,
        "kv_type": "f16",
        "use_mmap": True,
        "use_mlock": False,
        "offload_kqv": True,
        "chat_handler_type": None,
        "mmproj_path": "",
    },
    "coder": {
        "name": "Prototype Worker",
        "paths": [
            os.path.join(MODELS_DIR, "qwen2.5-coder-3b-instruct-q4_k_m.gguf"),
            os.path.join(MODELS_DIR, "microsoft_Phi-4-mini-instruct-Q4_K_M.gguf"),
            os.path.join(MODELS_DIR, "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf"),
        ],
        "n_ctx": 8192,
        "n_gpu_layers": -1,      # Fully on GPU for blazing fast coding
        "n_batch": 1024,
        "flash_attn": True,
        "kv_type": "q8_0",
        "use_mmap": True,
        "use_mlock": False,
        "offload_kqv": True,
        "chat_handler_type": None,
        "mmproj_path": "",
    },
    "vision": {
        "name": "Vision Specialist",
        "paths": [
            os.path.join(MODELS_DIR, "gemma-4-E2B-it-Q4_K_M.gguf"),
        ],
        "n_ctx": 32768,
        "n_gpu_layers": -1,      # Fully on GPU when active
        "n_batch": 1024,
        "flash_attn": True,
        "kv_type": "q4_0",
        "use_mmap": True,
        "use_mlock": False,
        "offload_kqv": True,
        "chat_handler_type": "gemma4",
        "mmproj_path": os.path.join(MODELS_DIR, "mmproj-gemma-4-E2B-it-BF16.gguf"),
        "mmproj_use_gpu": True,
    },
    "custom": {
        "name": "Custom GGUF",
        "paths": [],
        "path": "",
        "n_ctx": 8192,
        "n_gpu_layers": -1,
        "n_batch": 512,
        "flash_attn": True,
        "kv_type": "f16",
        "use_mmap": True,
        "use_mlock": False,
        "offload_kqv": True,
        "chat_handler_type": None,
        "mmproj_path": "",
        "mmproj_use_gpu": True,
    },
}


def extract_metadata_from_dict(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract standard architecture, layers, context, and MoE metadata from a GGUF dictionary."""
    arch = str(metadata.get("general.architecture", "unknown"))
    layers = None
    context_length = None
    expert_count = None
    expert_used_count = None

    for k, v in metadata.items():
        if k.endswith(".block_count"):
            try:
                layers = int(v[0] if hasattr(v, "__getitem__") and not isinstance(v, (str, bytes)) else v)
            except Exception:
                pass
        elif k.endswith(".context_length"):
            try:
                context_length = int(v[0] if hasattr(v, "__getitem__") and not isinstance(v, (str, bytes)) else v)
            except Exception:
                pass
        elif "expert_count" in k:
            try:
                expert_count = int(v[0] if hasattr(v, "__getitem__") and not isinstance(v, (str, bytes)) else v)
            except Exception:
                pass
        elif "expert_used_count" in k:
            try:
                expert_used_count = int(v[0] if hasattr(v, "__getitem__") and not isinstance(v, (str, bytes)) else v)
            except Exception:
                pass

    is_moe = bool(
        (expert_count is not None and expert_count > 0)
        or "moe" in arch.lower()
        or "mixtral" in arch.lower()
        or "deepseek" in arch.lower() and (expert_count is not None and expert_count > 0)
    )
    return {
        "arch": arch,
        "layers": layers,
        "context_length": context_length,
        "is_moe": is_moe,
        "expert_count": expert_count,
        "expert_used_count": expert_used_count,
    }


def _read_gguf_header_fast(file_path: str) -> Dict[str, Any]:
    """Fast binary parser for GGUF key-value metadata.
    
    Reads only the initial KV header and skips massive tokenizer arrays
    (such as token strings and scores) without memory allocation,
    reducing parse time by up to 98% compared to standard GGUFReader.
    """
    TYPE_SIZES = {
        0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8
    }

    def _read_str(f):
        ln_bytes = f.read(8)
        if len(ln_bytes) < 8:
            return ""
        ln = struct.unpack("<Q", ln_bytes)[0]
        if ln > 10 * 1024 * 1024:
            return ""
        raw = f.read(ln)
        return raw.decode("utf-8", errors="ignore")

    def _read_val(f, vtype):
        if vtype == 8:  # string
            return _read_str(f)
        elif vtype in TYPE_SIZES:
            sz = TYPE_SIZES[vtype]
            raw = f.read(sz)
            if len(raw) < sz:
                return None
            if vtype in (0, 2, 4, 10):
                return int.from_bytes(raw, "little", signed=False)
            elif vtype in (1, 3, 5, 11):
                return int.from_bytes(raw, "little", signed=True)
            elif vtype == 6:
                return struct.unpack("<f", raw)[0]
            elif vtype == 12:
                return struct.unpack("<d", raw)[0]
            elif vtype == 7:
                return bool(raw[0])
        elif vtype == 9:  # array
            hdr = f.read(12)
            if len(hdr) < 12:
                return None
            elem_type, count = struct.unpack("<IQ", hdr)
            if elem_type in TYPE_SIZES:
                elem_sz = TYPE_SIZES[elem_type]
                if count <= 64:
                    vals = []
                    for _ in range(count):
                        v = _read_val(f, elem_type)
                        if v is not None:
                            vals.append(v)
                    return vals
                else:
                    f.seek(count * elem_sz, 1)
                    return None
            elif elem_type == 8:  # array of strings
                if count > 64:
                    for _ in range(count):
                        slen_bytes = f.read(8)
                        if len(slen_bytes) < 8:
                            break
                        slen = struct.unpack("<Q", slen_bytes)[0]
                        f.seek(slen, 1)
                    return None
                else:
                    return [_read_str(f) for _ in range(count)]
            else:
                return None
        return None

    with open(file_path, "rb") as f:
        magic = f.read(4)
        if magic != b"GGUF":
            return {}
        ver_bytes = f.read(4)
        if len(ver_bytes) < 4:
            return {}
        ver = struct.unpack("<I", ver_bytes)[0]
        if ver not in (1, 2, 3):
            return {}
        hdr = f.read(16)
        if len(hdr) < 16:
            return {}
        n_tensors, n_kv = struct.unpack("<QQ", hdr)
        kv: Dict[str, Any] = {}
        for _ in range(n_kv):
            key = _read_str(f)
            type_bytes = f.read(4)
            if len(type_bytes) < 4:
                break
            vtype = struct.unpack("<I", type_bytes)[0]
            val = _read_val(f, vtype)
            if val is not None:
                kv[key] = val
        return kv


_GGUF_METADATA_CACHE: Dict[Tuple[str, float, int], Dict[str, Any]] = {}
_DISK_CACHE_LOADED = False
_DISK_CACHE_DATA: Dict[str, Dict[str, Any]] = {}


def _get_disk_cache_path() -> str:
    try:
        from .config import USER_FILES_DIR
        return os.path.join(USER_FILES_DIR, "gguf_meta_cache.json")
    except Exception:
        return os.path.join(PROJECT_ROOT, "User files", "gguf_meta_cache.json")


def _load_disk_cache() -> None:
    global _DISK_CACHE_LOADED, _DISK_CACHE_DATA
    if _DISK_CACHE_LOADED:
        return
    _DISK_CACHE_LOADED = True
    cache_path = _get_disk_cache_path()
    if os.path.isfile(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    _DISK_CACHE_DATA = data
        except Exception as e:
            logger.debug(f"Failed to load GGUF disk cache: {e}")


def _save_disk_cache() -> None:
    cache_path = _get_disk_cache_path()
    try:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        tmp_path = cache_path + f".tmp.{os.getpid()}"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(_DISK_CACHE_DATA, f, indent=2)
        os.replace(tmp_path, cache_path)
    except Exception as e:
        logger.debug(f"Failed to save GGUF disk cache: {e}")


def get_gguf_metadata(file_path: str) -> Dict[str, Any]:
    """Extract metadata (layers, architecture, context length, MoE info) directly from a GGUF header.
    
    Uses both an in-memory cache and a disk-persisted cache keyed by (file_path, mtime, size).
    """
    if not file_path or not os.path.isfile(file_path):
        return {}
    try:
        stat = os.stat(file_path)
        mtime = stat.st_mtime
        size = stat.st_size
        cache_key = (file_path, mtime, size)

        # 1. In-memory check
        if cache_key in _GGUF_METADATA_CACHE:
            return _GGUF_METADATA_CACHE[cache_key]

        # 2. Disk cache check
        _load_disk_cache()
        cached_entry = _DISK_CACHE_DATA.get(file_path)
        if (
            isinstance(cached_entry, dict)
            and cached_entry.get("mtime") == mtime
            and cached_entry.get("size") == size
            and isinstance(cached_entry.get("meta"), dict)
        ):
            meta = cached_entry["meta"]
            _GGUF_METADATA_CACHE[cache_key] = meta
            return meta

        # 3. Fast binary header parse
        meta = {}
        try:
            fields = _read_gguf_header_fast(file_path)
            if fields:
                meta = extract_metadata_from_dict(fields)
        except Exception as fast_err:
            logger.debug(f"Fast GGUF header parse failed for {file_path}: {fast_err}")

        # 4. Fallback to gguf.GGUFReader if fast parse failed or returned empty
        if not meta or not meta.get("arch") or meta.get("arch") == "unknown":
            try:
                import gguf
                reader = gguf.GGUFReader(file_path)
                fields: Dict[str, Any] = {}
                for f in reader.fields.values():
                    try:
                        val_part = f.parts[f.data[0]]
                        val_type = f.types[0]
                        if val_type == gguf.GGUFValueType.STRING:
                            fields[f.name] = bytes(val_part).decode("utf-8", errors="ignore")
                        elif val_type in (
                            gguf.GGUFValueType.UINT32, gguf.GGUFValueType.INT32,
                            gguf.GGUFValueType.UINT64, gguf.GGUFValueType.INT64,
                            gguf.GGUFValueType.UINT16, gguf.GGUFValueType.INT16,
                            gguf.GGUFValueType.UINT8, gguf.GGUFValueType.INT8
                        ):
                            fields[f.name] = int(val_part[0])
                        elif val_type in (gguf.GGUFValueType.FLOAT32, gguf.GGUFValueType.FLOAT64):
                            fields[f.name] = float(val_part[0])
                        elif val_type == gguf.GGUFValueType.BOOL:
                            fields[f.name] = bool(val_part[0])
                    except Exception:
                        pass
                meta = extract_metadata_from_dict(fields)
            except Exception as reader_err:
                logger.debug(f"GGUFReader fallback failed for {file_path}: {reader_err}")

        # 5. Store in caches
        _GGUF_METADATA_CACHE[cache_key] = meta
        _DISK_CACHE_DATA[file_path] = {
            "mtime": mtime,
            "size": size,
            "meta": meta
        }
        _save_disk_cache()
        return meta

    except Exception as e:
        logger.debug(f"Failed reading GGUF metadata for {file_path}: {e}")
        return {}


def scan_local_ggufs(extra_dirs: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Scan models directory and optional extra directories for all .gguf files with metadata."""
    seen_paths = set()
    results = []
    
    dirs_to_scan = [MODELS_DIR]
    if extra_dirs:
        for d in extra_dirs:
            if d and os.path.isdir(d):
                dirs_to_scan.append(os.path.abspath(d))

    for folder in dirs_to_scan:
        if not os.path.exists(folder):
            continue
        try:
            for root, _, files in os.walk(folder):
                for f in sorted(files):
                    if f.lower().endswith(".gguf") and not f.startswith("."):
                        full_path = os.path.abspath(os.path.join(root, f))
                        if full_path not in seen_paths and os.path.isfile(full_path):
                            seen_paths.add(full_path)
                            size = os.path.getsize(full_path)
                            meta = get_gguf_metadata(full_path)
                            results.append({
                                "filename": f,
                                "path": full_path,
                                "size_bytes": size,
                                "size_gb": round(size / (1024**3), 2),
                                "modified": os.path.getmtime(full_path),
                                "layers": meta.get("layers"),
                                "arch": meta.get("arch"),
                                "context_length": meta.get("context_length"),
                                "is_moe": meta.get("is_moe", False),
                                "expert_count": meta.get("expert_count"),
                                "expert_used_count": meta.get("expert_used_count"),
                            })
        except Exception as e:
            logger.warning(f"Error scanning folder {folder}: {e}")

    return sorted(results, key=lambda x: x["filename"].lower())



class ModelManager:
    """
    Manages multiple models in memory simultaneously.
    
    Models are loaded into RAM (and VRAM) and kept alive to 
    ensure zero-latency context switching between the router and specialists.
    """
    
    def __init__(self):
        self.loaded_models: Dict[str, Llama] = {}
        self.loaded_paths: Dict[str, str] = {}
        self.loaded_configs: Dict[str, Dict[str, Any]] = {}
        self.last_known_good_paths: Dict[str, str] = {}
        self.last_load_warning: Optional[str] = None
        self.active_role: Optional[str] = None
        self.active_name: str = ""
        self._loading = False
    
    def is_loaded(self, role: Optional[str] = None) -> bool:
        """Check if a model (or specific role) is loaded."""
        if role:
            return role in self.loaded_models
        return len(self.loaded_models) > 0
    
    def get_active_info(self) -> Dict[str, Any]:
        """Return info about the currently active model."""
        active_cfg = MODEL_REGISTRY.get(self.active_role, {}) if self.active_role else {}
        mmproj = active_cfg.get("mmproj_path", "")
        mmproj_valid = bool(mmproj and mmproj.strip().lower() != "none" and os.path.isfile(mmproj.strip()))
        has_vision = bool(mmproj_valid or active_cfg.get("chat_handler_type") is not None or self.active_role == "vision")
        mmproj_use_gpu = active_cfg.get("mmproj_use_gpu", True)
        has_prefill_think = False
        layers = None
        arch = None
        context_length = None
        is_moe = False
        expert_count = None
        expert_used_count = None

        if self.active_role and self.active_role in self.loaded_models:
            m = self.loaded_models[self.active_role]
            if getattr(m, "chat_handler", None) is not None:
                has_vision = True
            elif not mmproj_valid:
                has_vision = False
            if hasattr(m, "metadata") and isinstance(m.metadata, dict):
                m_meta = extract_metadata_from_dict(m.metadata)
                layers = m_meta.get("layers")
                arch = m_meta.get("arch")
                context_length = m_meta.get("context_length")
                is_moe = m_meta.get("is_moe", False)
                expert_count = m_meta.get("expert_count")
                expert_used_count = m_meta.get("expert_used_count")

            # Fallback to file header if not found in memory metadata
            if not layers:
                loaded_file = self.loaded_paths.get(self.active_role, "")
                if loaded_file and os.path.isfile(loaded_file):
                    f_meta = get_gguf_metadata(loaded_file)
                    layers = layers or f_meta.get("layers")
                    arch = arch or f_meta.get("arch")
                    context_length = context_length or f_meta.get("context_length")
                    is_moe = is_moe or f_meta.get("is_moe", False)
                    expert_count = expert_count or f_meta.get("expert_count")
                    expert_used_count = expert_used_count or f_meta.get("expert_used_count")

            try:
                tmpl = str(m.metadata.get("tokenizer.chat_template", ""))
                gen_section = tmpl.split("add_generation_prompt")[-1]
                # All known model thinking-tag prefills.
                # If the model's chat template contains any of these in its
                # generation_prompt section, the frontend will enter THINKING
                # phase immediately on the first chunk (no tag detection needed).
                #
                # HOW TO ADD A NEW MODEL:
                #   1. Add the open-tag string here.
                #   2. Also update static/js/think_tags.js and core/chat_manager.py.
                #   See the HOW-TO in static/js/think_tags.js for a full example.
                PREFILL_MARKERS = [
                    "<think>",                    # QwQ, Qwen3, DeepSeek-R1, Phi-4
                    "<thought>",                  # Generic
                    "<reasoning>",                # Generic
                    "<|channel>thought",           # Gemma 4
                    "channel>thought",             # Gemma 4 (partial match)
                    "[THINK]",                     # Mistral
                    "<|thinking|>",                # Llama-style
                    "<|start_thinking|>",          # Llama-style
                ]
                if any(marker in gen_section for marker in PREFILL_MARKERS):
                    has_prefill_think = True
            except Exception:
                pass

        return {
            "role": self.active_role,
            "name": self.active_name,
            "path": self.loaded_paths.get(self.active_role, ""),
            "loaded": self.active_role in self.loaded_models,
            "warning": self.last_load_warning,
            "has_vision": has_vision,
            "mmproj_path": mmproj if mmproj_valid else None,
            "mmproj_use_gpu": mmproj_use_gpu,
            "mmproj_device": "gpu" if mmproj_use_gpu else "cpu",
            "prefill_think": has_prefill_think,
            "layers": layers,
            "arch": arch,
            "context_length": context_length,
            "is_moe": is_moe,
            "expert_count": expert_count,
            "expert_used_count": expert_used_count,
            "n_gpu_layers": active_cfg.get("n_gpu_layers", -1),
        }


    def get_model_path(self, role: str, custom_path: Optional[str] = None) -> Optional[str]:
        """
        Return the resolved model path for a role with cascading fallback:
        1. Explicit custom_path if provided and exists
        2. Configured config['path'] if exists
        3. Last known working good path for this role
        4. Default registered paths for this role
        5. Any available .gguf file found in MODELS_DIR
        """
        config = MODEL_REGISTRY.get(role, {})
        
        # 1. Custom model: strictly use the specified file path; never fallback to another model
        if role == "custom":
            target_path = custom_path or config.get("path")
            if target_path:
                target_path = os.path.abspath(target_path)
                if os.path.isfile(target_path):
                    return target_path
                else:
                    logger.warning(f"Custom model path not found: {target_path}")
            return None

        # 2. Standard role path override
        target_path = custom_path or config.get("path")
        if target_path:
            target_path = os.path.abspath(target_path)
            if os.path.isfile(target_path):
                return target_path

        # 3. Last known good path for this role
        if role in self.last_known_good_paths:
            good_path = self.last_known_good_paths[role]
            if os.path.isfile(good_path):
                return good_path

        # 4. Default registered candidate paths for this role
        candidate_paths: List[str] = config.get("paths", [])
        for candidate in candidate_paths:
            if candidate and os.path.isfile(candidate):
                return candidate

        return None
    
    @staticmethod
    def apply_user_overrides(role: str, overrides: Dict[str, Any]):
        """Merge user-provided settings into MODEL_REGISTRY for a given role."""
        if role in MODEL_REGISTRY and overrides:
            allowed = {
                "path", "n_ctx", "n_batch", "n_gpu_layers", "flash_attn", "kv_type",
                "use_mlock", "use_mmap", "offload_kqv", "chat_handler_type", "mmproj_path", "mmproj_use_gpu"
            }
            MODEL_REGISTRY[role].update({k: v for k, v in overrides.items() if k in allowed})
    
    def has_any_loaded(self) -> bool:
        """Check if any models are currently loaded in memory."""
        return len(self.loaded_models) > 0

    def unload_all(self):
        """Unload all models and free memory."""
        logger.warning(f"Unloading all {len(self.loaded_models)} models...")
        for role in list(self.loaded_models.keys()):
            model = self.loaded_models.pop(role, None)
            if model is not None:
                try:
                    if hasattr(model, "close"):
                        model.close()
                except Exception as ce:
                    logger.warning(f"Error closing model {role}: {ce}")
                del model
        self.loaded_models.clear()
        self.loaded_paths.clear()
        self.loaded_configs.clear()
        self.active_role = None
        self.active_name = ""
        gc.collect()
    
    def _create_chat_handler(self, config: Dict[str, Any], model_path: Optional[str] = None):
        """Create a multimodal chat handler if needed."""
        handler_type = config.get("chat_handler_type")
        mmproj_path = config.get("mmproj_path", "").strip()
        
        if not mmproj_path or mmproj_path.lower() == "none" or not os.path.isfile(mmproj_path):
            return None
        
        # Safeguard: Do not load base model as projector
        resolved_model_path = model_path or config.get("path", "").strip()
        if resolved_model_path and os.path.abspath(mmproj_path) == os.path.abspath(resolved_model_path):
            logger.warning(f"mmproj_path is identical to model_path ({mmproj_path}); skipping chat handler.")
            return None

        # Safeguard: Validate model and projector variant compatibility (e.g. e2b vs e4b)
        if resolved_model_path:
            model_fname = os.path.basename(resolved_model_path).lower()
            mmproj_fname = os.path.basename(mmproj_path).lower()
            size_tokens = ["e2b", "2b", "e4b", "4b", "7b", "8b", "9b", "14b", "27b", "32b", "70b", "72b"]
            m_size = next((s for s in size_tokens if s in model_fname), None)
            p_size = next((s for s in size_tokens if s in mmproj_fname), None)
            if m_size and p_size and m_size != p_size:
                logger.warning(f"Multimodal projector size mismatch: model '{model_fname}' ({m_size}) vs mmproj '{mmproj_fname}' ({p_size}).")
                # Look for matching mmproj in MODELS_DIR
                matched_path = None
                if os.path.isdir(MODELS_DIR):
                    for fname in os.listdir(MODELS_DIR):
                        lf = fname.lower()
                        if "mmproj" in lf and m_size in lf and lf.endswith(".gguf"):
                            matched_path = os.path.join(MODELS_DIR, fname)
                            break
                if matched_path and os.path.isfile(matched_path):
                    logger.info(f"Auto-corrected to matching projector: {matched_path}")
                    mmproj_path = matched_path
                else:
                    logger.warning("No matching multimodal projector found for this model variant. Disabling chat handler to prevent crash.")
                    return None

        # Auto-detect handler type if not specified
        if not handler_type or handler_type == "auto":
            fname = os.path.basename(mmproj_path).lower()
            model_name = config.get("name", "").lower()
            if "gemma" in fname or "gemma" in model_name:
                handler_type = "gemma4"
            elif "qwen" in fname or "qwen" in model_name:
                handler_type = "qwen2.5-vl"
            elif "minicpm" in fname or "minicpm" in model_name:
                handler_type = "minicpmv26"
            elif "llava" in fname or "llava" in model_name:
                handler_type = "llava-1.5"
            else:
                handler_type = "mtmd"

        try:
            from llama_cpp.llama_chat_format import (
                Gemma4ChatHandler,
                Llava15ChatHandler,
                Qwen25VLChatHandler,
                MiniCPMv26ChatHandler,
                MTMDChatHandler,
            )
            import inspect
            
            def instantiate_handler(HandlerClass, clip_path):
                sig = inspect.signature(HandlerClass.__init__)
                if "use_gpu" in sig.parameters:
                    return HandlerClass(clip_model_path=clip_path, use_gpu=config.get("mmproj_use_gpu", True))
                return HandlerClass(clip_model_path=clip_path)
            
            handler_map = {
                "gemma4": Gemma4ChatHandler,
                "qwen2.5-vl": Qwen25VLChatHandler,
                "minicpmv26": MiniCPMv26ChatHandler,
                "llava-1.5": Llava15ChatHandler,
                "mtmd": MTMDChatHandler,
            }
            HandlerClass = handler_map.get(handler_type, Llava15ChatHandler)
            handler = instantiate_handler(HandlerClass, mmproj_path)
            
            # Monkey-patch for audio support (WAV detection)
            if handler and hasattr(handler, '_create_bitmap_from_bytes'):
                original_fn = handler._create_bitmap_from_bytes
                
                def custom_create_bitmap(image_bytes: bytes):
                    if image_bytes.startswith(b'RIFF') and b'WAVE' in image_bytes[8:12]:
                        import soundfile as sf
                        import io
                        import numpy as np
                        import ctypes
                        try:
                            # Verify if handler mtmd_ctx supports audio
                            if hasattr(handler, 'mtmd_ctx') and handler.mtmd_ctx is not None:
                                if hasattr(handler._mtmd_cpp, 'mtmd_support_audio') and not handler._mtmd_cpp.mtmd_support_audio(handler.mtmd_ctx):
                                    logger.warning("Active multimodal projector does not support audio embeddings; skipping audio bitmap")
                                    blank_png = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa74e\x96\x00\x00\x00\x00IEND\xaeB`\x82'
                                    return original_fn(blank_png)

                            data, samplerate = sf.read(io.BytesIO(image_bytes), dtype='float32')
                            if len(data.shape) > 1:
                                data = data.mean(axis=1)  # downmix to mono
                            
                            # Ensure 16000 Hz sample rate
                            target_sr = 16000
                            if samplerate != target_sr:
                                import scipy.signal
                                num_samples = int(len(data) * target_sr / samplerate)
                                data = scipy.signal.resample(data, num_samples).astype(np.float32)
                            
                            # Cap duration to max 30 seconds (480,000 samples) to prevent context overflow
                            max_samples = 30 * target_sr
                            if len(data) > max_samples:
                                data = data[:max_samples]

                            data = np.ascontiguousarray(data, dtype=np.float32)
                            n_samples = len(data)
                            data_ptr = data.ctypes.data_as(ctypes.POINTER(ctypes.c_float))
                            bitmap = handler._mtmd_cpp.mtmd_bitmap_init_from_audio(n_samples, data_ptr)
                            if bitmap is None:
                                raise ValueError("Failed to create audio bitmap")
                            return bitmap
                        except Exception as e:
                            logger.error(f"Audio bitmap creation failed: {e}")
                            blank_png = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa74e\x96\x00\x00\x00\x00IEND\xaeB`\x82'
                            return original_fn(blank_png)
                    return original_fn(image_bytes)
                
                handler._create_bitmap_from_bytes = custom_create_bitmap
            
            use_gpu_flag = config.get("mmproj_use_gpu", True)
            device_str = "GPU" if use_gpu_flag else "CPU"
            logger.warning(
                f"Multimodal Vision Projector loaded: {os.path.basename(mmproj_path)} "
                f"({HandlerClass.__name__} on {device_str})"
            )
            return handler
        except Exception as e:
            logger.error(f"Failed to create chat handler: {e}")
            return None
    
    def activate(self, role: str) -> float:
        """
        Set the active model role, loading it into memory if it's not already loaded.
        
        Returns the time (seconds) it took to load, or 0 if already loaded.
        """
        if not HAS_LLAMA_CPP:
            raise RuntimeError("llama-cpp-python is not installed.")
        
        # Ensure latest settings overrides from settings.json are applied
        try:
            from core.storage import _apply_all_overrides
            _apply_all_overrides()
        except ImportError:
            try:
                from storage import _apply_all_overrides
                _apply_all_overrides()
            except Exception:
                pass
        except Exception:
            pass

        if role not in MODEL_REGISTRY:
            raise ValueError(f"Unknown model role: {role}. Available: {list(MODEL_REGISTRY.keys())}")
        
        config = MODEL_REGISTRY[role]

        model_path = self.get_model_path(role)
        if not model_path:
            raise FileNotFoundError(
                "No valid GGUF model files found on disk. Please download or select a GGUF model in Settings."
            )

        # Build current configuration signature to detect changes (including mmproj & CPU/GPU flags)
        raw_mmproj = (config.get("mmproj_path") or "").strip()
        current_config_sig = {
            "model_path": os.path.abspath(model_path) if model_path else "",
            "mmproj_path": os.path.abspath(raw_mmproj) if raw_mmproj and raw_mmproj.lower() != "none" and os.path.isfile(raw_mmproj) else "",
            "mmproj_use_gpu": config.get("mmproj_use_gpu", True),
            "chat_handler_type": config.get("chat_handler_type", "auto"),
            "n_gpu_layers": config.get("n_gpu_layers", -1),
            "n_ctx": config.get("n_ctx", 8192),
            "n_batch": config.get("n_batch", 512),
            "flash_attn": config.get("flash_attn", True),
            "offload_kqv": config.get("offload_kqv", True),
            "kv_type": config.get("kv_type", "q4_0"),
            "use_mlock": config.get("use_mlock", False),
            "use_mmap": config.get("use_mmap", True),
        }
        
        # Already loaded with identical configuration
        if role in self.loaded_models and self.loaded_configs.get(role) == current_config_sig:
            self.active_role = role
            self.active_name = os.path.basename(model_path) if role == "custom" else config["name"]
            return 0.0
        
        # Unload any currently loaded models to free VRAM for the new/updated one
        if self.loaded_models:
            for loaded_role in list(self.loaded_models.keys()):
                logger.warning(f"Unloading model: {loaded_role}")
                old_model = self.loaded_models.pop(loaded_role, None)
                if old_model is not None:
                    try:
                        if hasattr(old_model, "close"):
                            old_model.close()
                    except Exception as ce:
                        logger.warning(f"Error closing model {loaded_role}: {ce}")
                    del old_model
            self.loaded_paths.clear()
            self.loaded_configs.clear()
            gc.collect()
        
        self._loading = True
        start = time.time()
        
        logger.warning(f"Loading model: {config['name']} ({role}) from {model_path}")
        
        # KV cache type mapping
        kv_type_map = {
            "f16": llama_cpp.GGML_TYPE_F16,
            "q8_0": llama_cpp.GGML_TYPE_Q8_0,
            "q4_0": llama_cpp.GGML_TYPE_Q4_0,
            "q4_1": llama_cpp.GGML_TYPE_Q4_1,
        }
        kv = config.get("kv_type", "q4_0")
        type_k = kv_type_map.get(kv, llama_cpp.GGML_TYPE_Q4_0)
        type_v = type_k if config.get("flash_attn", True) else llama_cpp.GGML_TYPE_F16
        
        # Create chat handler for multimodal models
        chat_handler = self._create_chat_handler(config, model_path=model_path)
        
        def _try_load(path_to_load: str):
            with suppress_c():
                return Llama(
                    model_path=path_to_load,
                    n_gpu_layers=config.get("n_gpu_layers", -1),
                    n_ctx=config.get("n_ctx", 8192),
                    n_batch=config.get("n_batch", 512),
                    flash_attn=config.get("flash_attn", True),
                    offload_kqv=config.get("offload_kqv", True),
                    use_mlock=config.get("use_mlock", False),
                    use_mmap=config.get("use_mmap", True),
                    type_k=type_k,
                    type_v=type_v,
                    chat_handler=chat_handler,
                    verbose=False,
                )

        try:
            model = _try_load(model_path)
            self.loaded_models[role] = model
            self.loaded_paths[role] = model_path
            self.loaded_configs[role] = current_config_sig
            self.last_known_good_paths[role] = model_path
            self.active_role = role
            self.active_name = os.path.basename(model_path) if role == "custom" else config["name"]
            elapsed = time.time() - start
            logger.warning(f"Model loaded: {self.active_name} in {elapsed:.1f}s")
            return elapsed
        except Exception as e:
            gc.collect()
            err_msg = str(e).lower()
            if "failed to create llama_context" in err_msg or "out of memory" in err_msg:
                ctx_val = config.get("n_ctx", 8192)
                kv_val = config.get("kv_type", "q4_0")
                friendly_msg = (
                    f"GPU VRAM limit exceeded: Could not allocate {ctx_val} context tokens with {kv_val.upper()} KV cache. "
                    f"Please lower the Context slider (e.g. to 8k or 16k), select Q4_0 KV cache, or uncheck 'KV → GPU' to run the context in system RAM."
                )
                logger.error(f"Failed to load model from {model_path}: {friendly_msg}")
                self.active_role = None
                self.active_name = None
                self.loaded_models.clear()
                self.loaded_paths.clear()
                self.loaded_configs.clear()
                self.last_load_warning = friendly_msg
                raise RuntimeError(friendly_msg)

            logger.error(f"Failed to load model from {model_path}: {e}")
            self.active_role = None
            self.active_name = None
            self.loaded_models.clear()
            self.loaded_paths.clear()
            self.loaded_configs.clear()
            self.last_load_warning = None
            raise RuntimeError(f"Failed to load model ({os.path.basename(model_path)}): {e}")
        finally:
            self._loading = False
    
    def generate(self, messages, max_tokens=2048, temperature=0.6, top_p=0.9, stream=True, repeat_penalty=1.1, enable_thinking=None):
        """Generate a chat completion using the currently active model."""
        if not self.active_role or self.active_role not in self.loaded_models:
            raise RuntimeError("No model is loaded. Call activate() first.")
        
        model = self.loaded_models[self.active_role]
        with suppress_c():
            handler = model.chat_handler or model._chat_handlers.get(model.chat_format)
            if handler and enable_thinking is not None:
                try:
                    return handler(
                        llama=model,
                        messages=messages,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        top_p=top_p,
                        repeat_penalty=repeat_penalty,
                        stream=stream,
                        enable_thinking=enable_thinking,
                    )
                except ValueError as ve:
                    if "Failed to load mtmd context" in str(ve):
                        logger.warning(f"Direct chat_handler mtmd failed ({ve}). Detaching chat handler and retrying text-only...")
                        model.chat_handler = None
                    else:
                        logger.warning(f"Direct chat_handler invocation failed: {ve}")
                except Exception as e:
                    logger.warning(f"Direct chat_handler invocation failed: {e}")

            try:
                return model.create_chat_completion(
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    top_p=top_p,
                    repeat_penalty=repeat_penalty,
                    stream=stream,
                )
            except ValueError as ve:
                if "Failed to load mtmd context" in str(ve) and getattr(model, "chat_handler", None):
                    logger.warning(f"Multimodal projector context load failed ({ve}). Detaching incompatible projector and retrying text generation...")
                    model.chat_handler = None
                    return model.create_chat_completion(
                        messages=messages,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        top_p=top_p,
                        repeat_penalty=repeat_penalty,
                        stream=stream,
                    )
                raise

    def get_active_model(self):
        """Return the active Llama model instance if loaded."""
        if not self.active_role or self.active_role not in self.loaded_models:
            return None
        return self.loaded_models[self.active_role]

    def tokenize(self, text: Union[str, bytes], role: Optional[str] = None, special: bool = True) -> List[int]:
        """Tokenize text using the active (or specified) model."""
        target_role = role or self.active_role
        if not target_role:
            for r in ["coder", "custom", "router", "vision"]:
                if r in MODEL_REGISTRY and self.get_model_path(r):
                    target_role = r
                    break
        if not target_role:
            return []
        if target_role not in self.loaded_models:
            self.activate(target_role)
        model = self.loaded_models.get(target_role)
        if not model:
            return []
        if isinstance(text, str):
            text = text.encode("utf-8")
        try:
            return model.tokenize(text, special=special)
        except Exception as e:
            logger.warning(f"Tokenize failed: {e}")
            return []

    def detokenize(self, tokens: List[int], role: Optional[str] = None) -> str:
        """Decode token IDs back into text."""
        target_role = role or self.active_role
        if not target_role:
            return ""
        if target_role not in self.loaded_models:
            self.activate(target_role)
        model = self.loaded_models.get(target_role)
        if not model:
            return ""
        try:
            return model.detokenize(tokens).decode("utf-8", errors="replace")
        except Exception as e:
            logger.warning(f"Detokenize failed: {e}")
            return ""

    def get_token_pieces(self, tokens: List[int], role: Optional[str] = None) -> List[str]:
        """Get the individual string pieces corresponding to token IDs."""
        target_role = role or self.active_role
        if not target_role:
            return []
        if target_role not in self.loaded_models:
            self.activate(target_role)
        model = self.loaded_models.get(target_role)
        if not model:
            return []
        pieces = []
        for t in tokens:
            try:
                pieces.append(model.detokenize([t]).decode("utf-8", errors="replace"))
            except Exception:
                pieces.append("")
        return pieces
    
    def list_available(self) -> Dict[str, Dict[str, Any]]:
        """List all registered models and their availability."""
        result = {}
        for role, config in MODEL_REGISTRY.items():
            resolved_path = self.get_model_path(role)
            has_file = bool(resolved_path and os.path.isfile(resolved_path))
            mmproj = config.get("mmproj_path", "")
            mmproj_valid = bool(mmproj and mmproj.strip().lower() != "none" and os.path.isfile(mmproj.strip()))
            has_vision = bool(mmproj_valid or config.get("chat_handler_type") is not None or role == "vision")
            result[role] = {
                "name": config["name"],
                "path": resolved_path if has_file else None,
                "available": has_file,
                "size_gb": round(os.path.getsize(resolved_path) / (1024**3), 1) if has_file else None,
                "has_vision": has_vision,
                "mmproj_path": mmproj if mmproj_valid else None,
            }
        return result


# Global model manager instance
model_manager = ModelManager()

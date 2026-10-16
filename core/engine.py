"""
Native llama-server Engine Manager for Project NIVM.

Manages local GGUF models using the bundled native C++ llama-server daemon.
Provides seamless single-model inference, OpenAI-compatible streaming SSE,
and instant 100% VRAM release during image diffusion handoffs.
"""

import logging
import os
import time
import json
import signal
import struct
import subprocess
import threading
from typing import Dict, Any, Optional, List, Union, Generator
import httpx

logger = logging.getLogger("nivm.engine")

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(PROJECT_ROOT, "models")
BIN_DIR = os.path.join(PROJECT_ROOT, "bin")
LLAMA_SERVER_BIN = os.path.join(BIN_DIR, "llama-server")

HAS_LLAMA_SERVER = os.path.isfile(LLAMA_SERVER_BIN) and os.access(LLAMA_SERVER_BIN, os.X_OK)
HAS_LLAMA_CPP = HAS_LLAMA_SERVER  # Backwards compatibility alias

LLAMA_SERVER_HOST = os.getenv("LLAMA_SERVER_HOST", "127.0.0.1")
LLAMA_SERVER_PORT = int(os.getenv("LLAMA_SERVER_PORT", "8081"))
LLAMA_BASE_URL = f"http://{LLAMA_SERVER_HOST}:{LLAMA_SERVER_PORT}"
LLAMA_PID_FILE = os.path.join(PROJECT_ROOT, ".llama_server.pid")

# Model registry
# Single Local Model Configuration
MODEL_REGISTRY: Dict[str, Dict[str, Any]] = {
    "custom": {
        "name": "Local Model",
        "paths": [],
        "path": "",
        "n_ctx": 8192,
        "n_gpu_layers": -1,
        "n_batch": 512,
        "flash_attn": True,
        "kv_type": "q4_0",
        "use_mmap": True,
        "use_mlock": False,
        "offload_kqv": True,
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
    chat_template = str(metadata.get("tokenizer.chat_template") or "")
    return {
        "arch": arch,
        "layers": layers,
        "context_length": context_length,
        "is_moe": is_moe,
        "expert_count": expert_count,
        "expert_used_count": expert_used_count,
        "chat_template": chat_template,
    }


def _read_gguf_header_fast(file_path: str) -> Dict[str, Any]:
    """Fast binary parser for GGUF key-value metadata."""
    if not os.path.isfile(file_path):
        return {}

    metadata = {}
    try:
        with open(file_path, "rb") as f:
            magic = f.read(4)
            if magic != b"GGUF":
                return {}

            version = struct.unpack("<I", f.read(4))[0]
            if version not in (2, 3):
                return {}

            tensor_count = struct.unpack("<Q", f.read(8))[0]
            metadata_kv_count = struct.unpack("<Q", f.read(8))[0]

            def _read_str(f):
                str_len = struct.unpack("<Q", f.read(8))[0]
                if str_len > 10 * 1024 * 1024:
                    raise ValueError(f"String length too large: {str_len}")
                raw = f.read(str_len)
                return raw.decode("utf-8", errors="replace")

            def _read_val(f, vtype):
                if vtype == 0:
                    return struct.unpack("<B", f.read(1))[0]
                elif vtype == 1:
                    return struct.unpack("<b", f.read(1))[0]
                elif vtype == 2:
                    return struct.unpack("<H", f.read(2))[0]
                elif vtype == 3:
                    return struct.unpack("<h", f.read(2))[0]
                elif vtype == 4:
                    return struct.unpack("<I", f.read(4))[0]
                elif vtype == 5:
                    return struct.unpack("<i", f.read(4))[0]
                elif vtype == 6:
                    return struct.unpack("<f", f.read(4))[0]
                elif vtype == 7:
                    return struct.unpack("<?", f.read(1))[0]
                elif vtype == 8:
                    return _read_str(f)
                elif vtype == 9:
                    arr_type = struct.unpack("<I", f.read(4))[0]
                    arr_len = struct.unpack("<Q", f.read(8))[0]
                    if arr_len > 1000000:
                        f.seek(0, os.SEEK_END)
                        return None
                    if arr_type in (0, 1, 7):
                        f.seek(arr_len * 1, os.SEEK_CUR)
                    elif arr_type in (2, 3):
                        f.seek(arr_len * 2, os.SEEK_CUR)
                    elif arr_type in (4, 5, 6):
                        f.seek(arr_len * 4, os.SEEK_CUR)
                    elif arr_type in (10, 11, 12):
                        f.seek(arr_len * 8, os.SEEK_CUR)
                    elif arr_type == 8:
                        for _ in range(arr_len):
                            s_len = struct.unpack("<Q", f.read(8))[0]
                            f.seek(s_len, os.SEEK_CUR)
                    elif arr_type == 9:
                        f.seek(0, os.SEEK_END)
                    return None
                elif vtype == 10:
                    return struct.unpack("<Q", f.read(8))[0]
                elif vtype == 11:
                    return struct.unpack("<q", f.read(8))[0]
                elif vtype == 12:
                    return struct.unpack("<d", f.read(8))[0]
                else:
                    return None

            INTERESTING_KEYS = {
                "general.architecture",
                "tokenizer.chat_template",
                "tokenizer.ggml.bos_token_id",
                "tokenizer.ggml.eos_token_id",
            }
            INTERESTING_SUFFIXES = (
                ".block_count",
                ".context_length",
                ".expert_count",
                ".expert_used_count",
            )

            for _ in range(metadata_kv_count):
                key = _read_str(f)
                vtype = struct.unpack("<I", f.read(4))[0]

                is_interesting = (
                    key in INTERESTING_KEYS
                    or any(key.endswith(sfx) for sfx in INTERESTING_SUFFIXES)
                )

                if is_interesting:
                    val = _read_val(f, vtype)
                    if val is not None:
                        metadata[key] = val
                else:
                    _read_val(f, vtype)

    except Exception as e:
        logger.debug(f"Fast GGUF parser ended for {file_path}: {e}")

    return metadata


_GGUF_METADATA_CACHE: Dict[str, Dict[str, Any]] = {}
_DISK_CACHE_DATA: Optional[Dict[str, Any]] = None


def _get_disk_cache_path() -> str:
    from core import config
    user_dir = getattr(config, "USER_FILES_DIR", None)
    if not user_dir:
        user_dir = os.path.join(PROJECT_ROOT, "User files")
    os.makedirs(user_dir, exist_ok=True)
    return os.path.join(user_dir, "gguf_cache.json")


def _load_disk_cache() -> None:
    global _DISK_CACHE_DATA
    if _DISK_CACHE_DATA is not None:
        return
    cache_path = _get_disk_cache_path()
    if os.path.isfile(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                _DISK_CACHE_DATA = json.load(f)
                return
        except Exception:
            pass
    _DISK_CACHE_DATA = {}


def _save_disk_cache() -> None:
    global _DISK_CACHE_DATA
    if _DISK_CACHE_DATA is None:
        return
    cache_path = _get_disk_cache_path()
    try:
        tmp_path = cache_path + f".tmp_{os.getpid()}"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(_DISK_CACHE_DATA, f)
        os.replace(tmp_path, cache_path)
    except Exception:
        pass


def get_gguf_metadata(file_path: str) -> Dict[str, Any]:
    """Extract metadata (layers, architecture, context size, MoE) from a GGUF file with caching."""
    if not file_path or not os.path.isfile(file_path):
        return {}

    try:
        mtime = os.path.getmtime(file_path)
        size = os.path.getsize(file_path)
        cache_key = f"{file_path}_{mtime}_{size}"
        if cache_key in _GGUF_METADATA_CACHE:
            return _GGUF_METADATA_CACHE[cache_key]

        _load_disk_cache()
        if file_path in _DISK_CACHE_DATA:
            cached_entry = _DISK_CACHE_DATA[file_path]
            if cached_entry.get("mtime") == mtime and cached_entry.get("size") == size:
                meta = cached_entry.get("meta", {})
                _GGUF_METADATA_CACHE[cache_key] = meta
                return meta

        fast_dict = _read_gguf_header_fast(file_path)
        meta = extract_metadata_from_dict(fast_dict)

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
    Manages the local bundled llama-server daemon.
    Spawns, monitors, and stops the C++ llama-server process with the configured model.
    """

    def __init__(self):
        self.process: Optional[subprocess.Popen] = None
        self.active_role: Optional[str] = None
        self.active_name: str = ""
        self.active_path: str = ""
        self.active_config: Dict[str, Any] = {}
        self.last_known_good_paths: Dict[str, str] = {}
        self.last_load_warning: Optional[str] = None
        self._lock = threading.RLock()
        self._active_generations = 0

    def is_loaded(self, role: Optional[str] = None) -> bool:
        """Check if llama-server process is active and responding to health check."""
        # 1. Active child process
        if self.process is not None:
            if self.process.poll() is not None:
                return False
            try:
                with httpx.Client(timeout=1.0) as client:
                    resp = client.get(f"{LLAMA_BASE_URL}/health")
                    return resp.status_code == 200
            except Exception:
                return False

        # 2. Check if daemon is warm across backend restarts
        try:
            with httpx.Client(timeout=1.0) as client:
                resp = client.get(f"{LLAMA_BASE_URL}/health")
                if resp.status_code == 200:
                    try:
                        props_resp = client.get(f"{LLAMA_BASE_URL}/props")
                        if props_resp.status_code == 200:
                            props = props_resp.json()
                            alias = props.get("model_alias") or props.get("model") or ""
                            if alias:
                                self.active_name = alias
                                self.active_role = role or "custom"
                                resolved = self.get_model_path(self.active_role)
                                if resolved:
                                    self.active_path = resolved
                    except Exception:
                        pass
                    return True
        except Exception:
            pass
        return False

    def get_active_info(self) -> Dict[str, Any]:
        """Return information about the currently running model and configuration."""
        loaded = self.is_loaded()
        cfg = MODEL_REGISTRY.get(self.active_role or "custom", {})
        mmproj = cfg.get("mmproj_path", "")
        mmproj_valid = bool(mmproj and mmproj.strip().lower() != "none" and os.path.isfile(mmproj.strip()))
        has_vision = bool(mmproj_valid)
        mmproj_use_gpu = cfg.get("mmproj_use_gpu", True)

        layers = None
        arch = None
        context_length = None
        is_moe = False
        expert_count = None
        expert_used_count = None
        has_prefill_think = False

        target_file = self.active_path or self.get_model_path(self.active_role or "custom")
        if target_file and os.path.isfile(target_file):
            f_meta = get_gguf_metadata(target_file)
            layers = f_meta.get("layers")
            arch = f_meta.get("arch")
            context_length = f_meta.get("context_length")
            is_moe = f_meta.get("is_moe", False)
            expert_count = f_meta.get("expert_count")
            expert_used_count = f_meta.get("expert_used_count")
            tmpl = f_meta.get("chat_template") or ""
            if "<think>" in tmpl:
                has_prefill_think = True

        return {
            "role": self.active_role if loaded else None,
            "name": self.active_name if loaded else "",
            "path": self.active_path if loaded else "",
            "loaded": loaded,
            "warning": self.last_load_warning,
            "has_vision": has_vision,
            "mmproj_path": mmproj if mmproj_valid else None,
            "mmproj_use_gpu": mmproj_use_gpu,
            "mmproj_device": "gpu" if mmproj_use_gpu else "cpu",
            "prefill_think": has_prefill_think,
            "layers": layers,
            "arch": arch,
            "context_length": context_length or cfg.get("n_ctx", 8192),
            "is_moe": is_moe,
            "expert_count": expert_count,
            "expert_used_count": expert_used_count,
            "n_gpu_layers": cfg.get("n_gpu_layers", -1),
        }

    def get_model_path(self, role: str = "custom", custom_path: Optional[str] = None) -> Optional[str]:
        """Resolve model path from custom path, user settings, or local scan."""
        cfg = MODEL_REGISTRY.get(role, MODEL_REGISTRY.get("custom", {}))

        # 1. Custom / explicit path
        target = custom_path or cfg.get("path")
        if target:
            target = os.path.abspath(target)
            if os.path.isfile(target):
                return target

        # 2. Last known good path
        if role in self.last_known_good_paths:
            p = self.last_known_good_paths[role]
            if os.path.isfile(p):
                return p

        # 3. Default registered candidate paths
        for p in cfg.get("paths", []):
            if p and os.path.isfile(p):
                return p

        # 4. Fallback: scan MODELS_DIR for any valid .gguf
        if os.path.isdir(MODELS_DIR):
            for fname in sorted(os.listdir(MODELS_DIR)):
                if fname.lower().endswith(".gguf") and not fname.startswith("mmproj") and not fname.startswith("."):
                    cand = os.path.join(MODELS_DIR, fname)
                    if os.path.isfile(cand):
                        return cand

        return None

    @staticmethod
    def apply_user_overrides(role: str, overrides: Dict[str, Any]):
        """Merge user-provided configuration settings into MODEL_REGISTRY."""
        if role in MODEL_REGISTRY and overrides:
            allowed = {
                "path", "n_ctx", "n_batch", "n_gpu_layers", "flash_attn", "kv_type",
                "use_mlock", "use_mmap", "offload_kqv", "chat_handler_type", "mmproj_path", "mmproj_use_gpu"
            }
            MODEL_REGISTRY[role].update({k: v for k, v in overrides.items() if k in allowed})
            # Also keep 'custom' in sync if 'single' or other role is modified
            if role != "custom":
                MODEL_REGISTRY["custom"].update({k: v for k, v in overrides.items() if k in allowed})

    def has_any_loaded(self) -> bool:
        """Check if llama-server is currently running and active."""
        return self.is_loaded()

    def unload_all(self):
        """Cleanly terminate the llama-server daemon and release 100% GPU VRAM."""
        with self._lock:
            if self.process is not None:
                pid = self.process.pid
                logger.info(f"Stopping llama-server process (PID: {pid})...")
                try:
                    self.process.terminate()
                    try:
                        self.process.wait(timeout=3.0)
                    except subprocess.TimeoutExpired:
                        logger.warning(f"llama-server PID {pid} didn't exit in 3s; killing...")
                        self.process.kill()
                        self.process.wait(timeout=2.0)
                except Exception as e:
                    logger.warning(f"Error terminating llama-server PID {pid}: {e}")
                self.process = None

            # Clean up PID file if daemon was spawned previously
            if os.path.isfile(LLAMA_PID_FILE):
                try:
                    with open(LLAMA_PID_FILE, "r") as pf:
                        saved_pid = int(pf.read().strip())
                    if saved_pid > 0:
                        os.kill(saved_pid, signal.SIGTERM)
                        time.sleep(0.3)
                        try:
                            os.kill(saved_pid, signal.SIGKILL)
                        except OSError:
                            pass
                except Exception:
                    pass
                try:
                    os.remove(LLAMA_PID_FILE)
                except Exception:
                    pass

            # Ensure port 8081 is clean
            try:
                subprocess.run(["fuser", "-k", f"{LLAMA_SERVER_PORT}/tcp"], capture_output=True, timeout=2)
            except Exception:
                pass

            self.active_role = None
            self.active_name = ""
            self.active_path = ""
            self.active_config = {}

    def activate(self, role: str = "custom") -> float:
        """Start or verify the bundled llama-server daemon with the target model."""
        if not HAS_LLAMA_SERVER:
            raise RuntimeError(
                "Bundled llama-server binary not found at bin/llama-server. "
                "Please run ./run.sh --setup to provision it automatically."
            )

        # Apply settings overrides
        try:
            from core.storage import _apply_all_overrides
            _apply_all_overrides()
        except Exception:
            pass

        config = MODEL_REGISTRY.get(role, MODEL_REGISTRY.get("custom", {}))
        model_path = self.get_model_path(role)
        if not model_path:
            raise FileNotFoundError(
                "No valid GGUF model files found on disk. Please select or download a GGUF model in Settings."
            )

        raw_mmproj = (config.get("mmproj_path") or "").strip()
        mmproj_valid = bool(raw_mmproj and raw_mmproj.lower() != "none" and os.path.isfile(raw_mmproj))

        current_config_sig = {
            "model_path": os.path.abspath(model_path),
            "mmproj_path": os.path.abspath(raw_mmproj) if mmproj_valid else "",
            "mmproj_use_gpu": config.get("mmproj_use_gpu", True),
            "n_gpu_layers": config.get("n_gpu_layers", -1),
            "n_ctx": config.get("n_ctx", 8192),
            "n_batch": config.get("n_batch", 512),
            "flash_attn": config.get("flash_attn", True),
            "kv_type": config.get("kv_type", "q4_0"),
            "use_mlock": config.get("use_mlock", False),
            "use_mmap": config.get("use_mmap", True),
        }

        # If already running with matching configuration and healthy (seamless re-attachment)
        if self.is_loaded(role):
            target_alias = os.path.basename(model_path)
            if (self.active_config == current_config_sig and self.active_path == model_path) or (self.active_name == target_alias):
                self.active_role = role
                self.active_name = target_alias
                self.active_path = os.path.abspath(model_path)
                self.active_config = current_config_sig
                logger.info(f"Re-attached to warm llama-server ({self.active_name}) without reloading weights.")
                return 0.0

        with self._lock:
            start_time = time.time()
            self.unload_all()

            n_gpu = config.get("n_gpu_layers", -1)
            if n_gpu < 0:
                n_gpu = 99
            n_ctx = config.get("n_ctx", 8192)
            n_batch = config.get("n_batch", 512)
            n_ubatch = max(256, n_batch // 2)
            kv_type = config.get("kv_type", "q4_0")
            flash_attn = config.get("flash_attn", True)

            cmd = [
                LLAMA_SERVER_BIN,
                "-m", os.path.abspath(model_path),
                "--host", LLAMA_SERVER_HOST,
                "--port", str(LLAMA_SERVER_PORT),
                "-c", str(n_ctx),
                "-b", str(n_batch),
                "-ub", str(n_ubatch),
                "-ngl", str(n_gpu),
                "-fa", "on" if flash_attn else "off",
                "-ctk", str(kv_type),
                "-ctv", str(kv_type),
                "--jinja",
                "--alias", os.path.basename(model_path),
            ]

            if mmproj_valid:
                cmd.extend(["--mmproj", os.path.abspath(raw_mmproj)])
                if not config.get("mmproj_use_gpu", True):
                    cmd.append("--no-mmproj-offload")

            if config.get("use_mlock", False):
                cmd.append("--mlock")
            if not config.get("use_mmap", True):
                cmd.append("--no-mmap")

            logger.info(f"Launching llama-server: {' '.join(cmd)}")

            env = os.environ.copy()
            env["LD_LIBRARY_PATH"] = f"{BIN_DIR}:{env.get('LD_LIBRARY_PATH', '')}"

            try:
                self.process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=env,
                    text=True,
                )
                try:
                    with open(LLAMA_PID_FILE, "w") as pf:
                        pf.write(str(self.process.pid))
                except Exception:
                    pass
            except Exception as e:
                logger.error(f"Failed to spawn llama-server: {e}")
                raise RuntimeError(f"Failed to start llama-server process: {e}")

            max_wait = 45.0
            poll_interval = 0.5
            elapsed = 0.0
            loaded_ok = False

            while elapsed < max_wait:
                if self.process.poll() is not None:
                    stderr_out = ""
                    try:
                        _, stderr_out = self.process.communicate(timeout=1.0)
                    except Exception:
                        pass
                    err_msg = stderr_out.strip() or "Process exited unexpectedly"
                    logger.error(f"llama-server startup error: {err_msg}")
                    self.unload_all()
                    if "out of memory" in err_msg.lower() or "cuda" in err_msg.lower() and "memory" in err_msg.lower():
                        friendly = "GPU VRAM limit exceeded. Please lower Context size or use Q4_0 KV cache."
                        self.last_load_warning = friendly
                        raise RuntimeError(friendly)
                    raise RuntimeError(f"Failed to load model: {err_msg[:300]}")

                try:
                    with httpx.Client(timeout=1.0) as client:
                        resp = client.get(f"{LLAMA_BASE_URL}/health")
                        if resp.status_code == 200:
                            loaded_ok = True
                            break
                except Exception:
                    pass

                time.sleep(poll_interval)
                elapsed += poll_interval

            if not loaded_ok:
                self.unload_all()
                raise TimeoutError(f"llama-server failed to respond within {max_wait}s.")

            self.active_role = role
            self.active_name = os.path.basename(model_path)
            self.active_path = os.path.abspath(model_path)
            self.active_config = current_config_sig
            self.last_known_good_paths[role] = self.active_path
            self.last_load_warning = None

            total_elapsed = time.time() - start_time
            logger.info(f"llama-server ready ({self.active_name}) in {total_elapsed:.1f}s")
            return total_elapsed

    def generate(
        self,
        messages: List[Dict[str, Any]],
        max_tokens: int = 2048,
        temperature: float = 0.6,
        top_p: float = 0.9,
        stream: bool = True,
        repeat_penalty: float = 1.1,
        enable_thinking: Optional[bool] = None,
        stop: Optional[Union[str, List[str]]] = None
    ):
        """Generate a chat completion using the active llama-server."""
        if not self.is_loaded():
            self.activate(self.active_role or "custom")

        payload = {
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "stream": stream,
            "repeat_penalty": repeat_penalty,
        }
        if stream:
            payload["stream_options"] = {"include_usage": True}
        if stop:
            payload["stop"] = stop if isinstance(stop, list) else [stop]

        if stream:
            def _stream_gen():
                with self._lock:
                    self._active_generations += 1
                try:
                    with httpx.Client(timeout=180.0) as client:
                        with client.stream("POST", f"{LLAMA_BASE_URL}/v1/chat/completions", json=payload) as resp:
                            if resp.status_code != 200:
                                raise RuntimeError(f"llama-server error {resp.status_code}: {resp.read().decode('utf-8', errors='replace')}")
                            for line in resp.iter_lines():
                                if not line:
                                    continue
                                if line.startswith("data: "):
                                    data_str = line[6:].strip()
                                    if data_str == "[DONE]":
                                        break
                                    try:
                                        chunk = json.loads(data_str)
                                        yield chunk
                                    except Exception:
                                        pass
                finally:
                    with self._lock:
                        self._active_generations = max(0, self._active_generations - 1)

            return _stream_gen()
        else:
            with self._lock:
                self._active_generations += 1
            try:
                with httpx.Client(timeout=180.0) as client:
                    resp = client.post(f"{LLAMA_BASE_URL}/v1/chat/completions", json=payload)
                    if resp.status_code != 200:
                        raise RuntimeError(f"llama-server error {resp.status_code}: {resp.text}")
                    return resp.json()
            finally:
                with self._lock:
                    self._active_generations = max(0, self._active_generations - 1)

    def get_active_model(self):
        """Returns the active instance indicator if loaded."""
        return self if self.is_loaded() else None

    def tokenize(self, text: Union[str, bytes], role: Optional[str] = None, special: bool = True) -> List[int]:
        """Tokenize text using llama-server native /tokenize endpoint."""
        if not self.is_loaded():
            try:
                self.activate(role or self.active_role or "custom")
            except Exception:
                return []
        if isinstance(text, bytes):
            text = text.decode("utf-8", errors="replace")
        try:
            with httpx.Client(timeout=5.0) as client:
                resp = client.post(f"{LLAMA_BASE_URL}/tokenize", json={"content": text, "special": special})
                if resp.status_code == 200:
                    return resp.json().get("tokens", [])
        except Exception as e:
            logger.debug(f"Tokenize error: {e}")
        return []

    def detokenize(self, tokens: List[int], role: Optional[str] = None) -> str:
        """Detokenize tokens back to text using llama-server native /detokenize endpoint."""
        if not self.is_loaded():
            try:
                self.activate(role or self.active_role or "custom")
            except Exception:
                return ""
        try:
            with httpx.Client(timeout=5.0) as client:
                resp = client.post(f"{LLAMA_BASE_URL}/detokenize", json={"tokens": tokens})
                if resp.status_code == 200:
                    return resp.json().get("content", "")
        except Exception as e:
            logger.debug(f"Detokenize error: {e}")
        return ""

    def get_token_pieces(self, tokens: List[int], role: Optional[str] = None) -> List[str]:
        """Convert token IDs into individual token string pieces."""
        if not tokens:
            return []
        pieces = []
        for t in tokens:
            pieces.append(self.detokenize([t], role=role))
        return pieces

    def list_available(self) -> Dict[str, Dict[str, Any]]:
        """List registered model roles and disk availability."""
        result = {}
        for role, config in MODEL_REGISTRY.items():
            resolved_path = self.get_model_path(role)
            has_file = bool(resolved_path and os.path.isfile(resolved_path))
            mmproj = config.get("mmproj_path", "")
            mmproj_valid = bool(mmproj and mmproj.strip().lower() != "none" and os.path.isfile(mmproj.strip()))
            has_vision = bool(mmproj_valid)
            result[role] = {
                "name": config.get("name", role),
                "path": resolved_path if has_file else None,
                "available": has_file,
                "size_gb": round(os.path.getsize(resolved_path) / (1024**3), 1) if has_file else None,
                "has_vision": has_vision,
                "mmproj_path": mmproj if mmproj_valid else None,
            }
        return result


# Global singleton instance
model_manager = ModelManager()

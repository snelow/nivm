"""
Multi-Model Engine Manager for Sovereign AI Workbench.

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
from typing import Dict, Any, Optional, List, Union


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

# ── Model Registry ──────────────────────────────────────────────
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


def scan_local_ggufs(extra_dirs: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Scan models directory and optional extra directories for all .gguf files."""
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
                            results.append({
                                "filename": f,
                                "path": full_path,
                                "size_bytes": size,
                                "size_gb": round(size / (1024**3), 2),
                                "modified": os.path.getmtime(full_path)
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
        return {
            "role": self.active_role,
            "name": self.active_name,
            "path": self.loaded_paths.get(self.active_role, ""),
            "loaded": self.active_role in self.loaded_models,
            "warning": self.last_load_warning,
            "has_vision": has_vision,
            "mmproj_path": mmproj if mmproj_valid else None,
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
        """
        Merge user-provided settings into MODEL_REGISTRY for a given role.
        
        Only known engine keys are applied; unknown keys are ignored.
        This must be called BEFORE activate() to take effect.
        """
        if role not in MODEL_REGISTRY:
            return
        
        config = MODEL_REGISTRY[role]
        key_map = {
            "path": "path",
            "n_ctx": "n_ctx",
            "n_batch": "n_batch",
            "n_gpu_layers": "n_gpu_layers",
            "flash_attn": "flash_attn",
            "kv_type": "kv_type",
            "use_mlock": "use_mlock",
            "use_mmap": "use_mmap",
            "offload_kqv": "offload_kqv",
            "chat_handler_type": "chat_handler_type",
            "mmproj_path": "mmproj_path",
            "mmproj_use_gpu": "mmproj_use_gpu",
        }
        for key, registry_key in key_map.items():
            if key in overrides:
                config[registry_key] = overrides[key]
    
    def has_any_loaded(self) -> bool:
        """Check if any models are currently loaded in memory."""
        return len(self.loaded_models) > 0

    def unload_all(self):
        """Unload all models and free memory."""
        logger.warning(f"Unloading all {len(self.loaded_models)} models...")
        for role, model in list(self.loaded_models.items()):
            del model
        self.loaded_models.clear()
        self.loaded_paths.clear()
        self.active_role = None
        self.active_name = ""
        gc.collect()
    
    def _create_chat_handler(self, config: Dict[str, Any]):
        """Create a multimodal chat handler if needed."""
        handler_type = config.get("chat_handler_type")
        mmproj_path = config.get("mmproj_path", "").strip()
        
        if not mmproj_path or mmproj_path.lower() == "none" or not os.path.isfile(mmproj_path):
            return None
        
        # Safeguard: Do not load base model as projector
        model_path = config.get("path", "").strip()
        if model_path and os.path.abspath(mmproj_path) == os.path.abspath(model_path):
            logger.warning(f"mmproj_path is identical to model_path ({mmproj_path}); skipping chat handler.")
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
        
        if role not in MODEL_REGISTRY:
            raise ValueError(f"Unknown model role: {role}. Available: {list(MODEL_REGISTRY.keys())}")
        
        config = MODEL_REGISTRY[role]
        
        # Already loaded
        if role in self.loaded_models:
            self.active_role = role
            self.active_name = config["name"]
            return 0.0
        
        # Unload any currently loaded models to free VRAM for the new one
        if self.loaded_models:
            for loaded_role in list(self.loaded_models.keys()):
                logger.warning(f"Unloading model: {loaded_role}")
                del self.loaded_models[loaded_role]
            self.loaded_paths.clear()
        
        model_path = self.get_model_path(role)
        if not model_path:
            raise FileNotFoundError(
                "No valid GGUF model files found on disk. Please download or select a GGUF model in Settings."
            )
        
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
        chat_handler = self._create_chat_handler(config)
        
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
            self.last_known_good_paths[role] = model_path
            self.active_role = role
            self.active_name = os.path.basename(model_path) if role == "custom" else config["name"]
            elapsed = time.time() - start
            logger.warning(f"Model loaded: {self.active_name} in {elapsed:.1f}s")
            return elapsed
        except Exception as e:
            logger.error(f"Failed to load model from {model_path}: {e}")
            self.active_role = None
            self.active_name = None
            self.loaded_models.clear()
            self.loaded_paths.clear()
            self.last_load_warning = None
            raise RuntimeError(f"Failed to load model ({os.path.basename(model_path)}): {e}")
        finally:
            self._loading = False
    
    def generate(self, messages, max_tokens=2048, temperature=0.6, top_p=0.9, stream=True, repeat_penalty=1.1):
        """Generate a chat completion using the currently active model."""
        if not self.active_role or self.active_role not in self.loaded_models:
            raise RuntimeError("No model is loaded. Call activate() first.")
        
        model = self.loaded_models[self.active_role]
        with suppress_c():
            return model.create_chat_completion(
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                top_p=top_p,
                repeat_penalty=repeat_penalty,
                stream=stream,
            )

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

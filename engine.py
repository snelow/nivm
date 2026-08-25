import logging
import gc
from typing import Dict, Any, Optional

try:
    from llama_cpp import Llama
    HAS_LLAMA_CPP = True
except ImportError:
    HAS_LLAMA_CPP = False

logger = logging.getLogger(__name__)

class NativeEngine:
    def __init__(self):
        self.model: Optional[Llama] = None
        self.model_path: str = ""
        self.config: Dict[str, Any] = {}
        
    def is_loaded(self) -> bool:
        return self.model is not None
        
    def load_model(self, model_path: str, n_gpu_layers: int = -1, n_ctx: int = 4096, n_batch: int = 512,
                   flash_attn: bool = False, offload_kqv: bool = True, use_mlock: bool = False,
                   use_mmap: bool = True, kv_type: str = "f16", mmproj_path: str = "", chat_handler_type: str = "gemma4", mmproj_cpu: bool = False) -> bool:
        if not HAS_LLAMA_CPP:
            logger.error("llama-cpp-python is not installed.")
            raise RuntimeError("llama-cpp-python is not installed.")
            
        if self.model is not None:
            self.unload_model()
            
        import llama_cpp
        kv_type_map = {
            "f16": llama_cpp.GGML_TYPE_F16,
            "q8_0": llama_cpp.GGML_TYPE_Q8_0,
            "q4_0": llama_cpp.GGML_TYPE_Q4_0,
            "q4_1": llama_cpp.GGML_TYPE_Q4_1
        }
        type_k = kv_type_map.get(kv_type, llama_cpp.GGML_TYPE_F16)
        
        # Standard attention in llama.cpp strictly requires the Value cache (type_v) to be F16.
        # Flash Attention is the only path that can handle quantized V-cache.
        type_v = type_k if flash_attn else llama_cpp.GGML_TYPE_F16
            
        logger.warning(f"Loading native model: {model_path} with ctx={n_ctx}, gpu_layers={n_gpu_layers}, batch={n_batch}, flash_attn={flash_attn}, type_k={kv_type}, type_v={'f16' if type_v == llama_cpp.GGML_TYPE_F16 else kv_type}")
        
        chat_handler = None
        if mmproj_path.strip():
            logger.warning(f"Initializing multimodal chat handler '{chat_handler_type}' with mmproj: {mmproj_path} on CPU: {mmproj_cpu}")
            try:
                from llama_cpp.llama_chat_format import Llava15ChatHandler, Gemma4ChatHandler, MiniCPMv26ChatHandler
                import inspect
                
                # Helper function to instantiate safely with use_gpu if supported
                def instantiate_handler(HandlerClass, clip_path):
                    sig = inspect.signature(HandlerClass.__init__)
                    if "use_gpu" in sig.parameters:
                        return HandlerClass(clip_model_path=clip_path, use_gpu=not mmproj_cpu)
                    else:
                        logger.warning(f"{HandlerClass.__name__} does not support use_gpu flag, falling back to default.")
                        return HandlerClass(clip_model_path=clip_path)

                if chat_handler_type == "gemma4":
                    chat_handler = instantiate_handler(Gemma4ChatHandler, mmproj_path)
                elif chat_handler_type == "llava-1.5":
                    chat_handler = instantiate_handler(Llava15ChatHandler, mmproj_path)
                elif chat_handler_type == "minicpm-v2.6":
                    chat_handler = instantiate_handler(MiniCPMv26ChatHandler, mmproj_path)
                else:
                    logger.warning(f"Unknown chat_handler_type: {chat_handler_type}, defaulting to Llava15ChatHandler")
                    chat_handler = instantiate_handler(Llava15ChatHandler, mmproj_path)
            except Exception as e:
                logger.error(f"Failed to load chat handler: {e}")

            # Monkey-patch chat_handler to support audio parsing natively!
            if chat_handler:
                original_create_bitmap = chat_handler._create_bitmap_from_bytes

                def custom_create_bitmap(image_bytes: bytes):
                    # Check for WAV file header
                    if image_bytes.startswith(b'RIFF') and b'WAVE' in image_bytes[8:12]:
                        import soundfile as sf
                        import io
                        import ctypes
                        import numpy as np
                        
                        try:
                            # Decode audio
                            data, samplerate = sf.read(io.BytesIO(image_bytes), dtype='float32')
                            if len(data.shape) > 1:
                                data = data.mean(axis=1) # mix to mono
                                
                            n_samples = len(data)
                            data_ptr = data.ctypes.data_as(ctypes.POINTER(ctypes.c_float))
                            
                            bitmap = chat_handler._mtmd_cpp.mtmd_bitmap_init_from_audio(n_samples, data_ptr)
                            if bitmap is None:
                                raise ValueError("Failed to create audio bitmap")
                            return bitmap
                        except Exception as e:
                            logger.error(f"Audio bitmap creation failed: {e}")
                            return original_create_bitmap(image_bytes)
                    else:
                        return original_create_bitmap(image_bytes)

                chat_handler._create_bitmap_from_bytes = custom_create_bitmap

        try:
            self.model = Llama(
                model_path=model_path,
                n_gpu_layers=n_gpu_layers,
                n_ctx=n_ctx,
                n_batch=n_batch,
                flash_attn=flash_attn,
                offload_kqv=offload_kqv,
                use_mlock=use_mlock,
                use_mmap=use_mmap,
                type_k=type_k,
                type_v=type_v,
                chat_handler=chat_handler,
                verbose=True
            )
            self.model_path = model_path
            self.config = {
                "n_gpu_layers": n_gpu_layers,
                "n_ctx": n_ctx,
                "n_batch": n_batch,
                "flash_attn": flash_attn,
                "offload_kqv": offload_kqv,
                "use_mlock": use_mlock,
                "use_mmap": use_mmap,
                "kv_type": kv_type
            }
            return True
        except Exception as e:
            logger.error(f"Failed to load native model: {e}")
            raise e
            
    def unload_model(self):
        if self.model is not None:
            logger.warning(f"Unloading native model: {self.model_path}")
            del self.model
            self.model = None
            self.model_path = ""
            self.config = {}
            # Force garbage collection to free VRAM
            gc.collect()

    def generate(self, messages, max_tokens=1024, temperature=0.7, top_p=0.9, stream=True):
        if not self.model:
            raise RuntimeError("Model is not loaded.")
            
        # llama_cpp_python supports create_chat_completion which matches the OpenAI spec exactly
        return self.model.create_chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            stream=stream
        )

# Global engine instance
native_engine = NativeEngine()

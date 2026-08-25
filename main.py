import json
import logging
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx
import os
import asyncio

import config
try:
    from engine import native_engine, HAS_LLAMA_CPP
except ImportError:
    native_engine = None
    HAS_LLAMA_CPP = False

USER_FILES_DIR = os.path.join(os.path.dirname(__file__), "User files")
os.makedirs(USER_FILES_DIR, exist_ok=True)
SETTINGS_FILE = os.path.join(USER_FILES_DIR, "settings.json")
CHATS_FILE = os.path.join(USER_FILES_DIR, "chats.json")
MEMORY_FILE = os.path.join(USER_FILES_DIR, "memory.json")
UPLOADS_DIR = os.path.join(USER_FILES_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

def get_user_settings():
    default_settings = SettingsModel().model_dump()
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r") as f:
                saved = json.load(f)
                default_settings.update(saved)
        except Exception:
            pass
    return default_settings

def get_active_base_url():
    settings = get_user_settings()
    url = settings.get("base_url") or config.LM_STUDIO_BASE_URL
    url = url.strip().rstrip("/")
    if url and not url.startswith("http"):
        url = "http://" + url
    return url

def get_httpx_headers():
    settings = get_user_settings()
    api_key = settings.get("api_key", "").strip()
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers

class SettingsModel(BaseModel):
    base_url: str = ""
    api_key: str = ""
    engine_mode: str = "native"
    safety_bypass: bool = False
    
    # Native Engine settings
    native_model_path: str = "./model/gemma-4-E2B-it-Q4_K_M.gguf"
    native_gpu_layers: int = -1
    native_ctx: int = 4096
    native_batch: int = 512
    native_flash_attn: bool = False
    native_offload_kqv: bool = True
    native_use_mlock: bool = False
    native_use_mmap: bool = True
    native_kv_type: str = "f16"
    native_mmproj_path: str = ""
    native_mmproj_cpu: bool = False
    native_chat_handler: str = "gemma4"

# Setup logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("lm_studio_backend")

app = FastAPI(
    title="LM Studio Frontend Backend API",
    description="FastAPI backend connecting a modern web UI to local LM Studio instances.",
    version="1.0.0"
)

# CORS middleware for developer flexibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/settings")
async def get_settings_endpoint():
    return get_user_settings()

@app.post("/api/settings")
async def save_settings_endpoint(settings: SettingsModel):
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings.model_dump(), f)
    return {"status": "success"}

import time
@app.post("/api/upload")
async def upload_file_endpoint(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    
    ext = os.path.splitext(file.filename)[1]
    new_filename = f"media_{int(time.time() * 1000)}{ext}"
    file_path = os.path.join(UPLOADS_DIR, new_filename)
    
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
        
    return {"url": f"/uploads/{new_filename}"}

@app.get("/api/chats")
async def get_chats_endpoint():
    """Returns all saved chats from the server."""
    if os.path.exists(CHATS_FILE):
        try:
            with open(CHATS_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return []
    return []

@app.post("/api/chats")
async def save_chats_endpoint(request: Request):
    """Saves all chats to the server."""
    try:
        chats = await request.json()
        with open(CHATS_FILE, "w") as f:
            json.dump(chats, f)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/memory")
async def get_memory_endpoint():
    """Returns the user's memory database."""
    if not os.path.exists(MEMORY_FILE):
        return {}
    try:
        with open(MEMORY_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error reading memory file: {e}")
        return {}

@app.post("/api/memory")
async def save_memory_endpoint(request: Request):
    """Updates the user's memory database. Expects a JSON object with a 'key' and 'value'."""
    try:
        body = await request.json()
        key = body.get("key")
        value = body.get("value")
        
        if not key:
            raise HTTPException(status_code=400, detail="Key is required")
            
        memory_data = {}
        if os.path.exists(MEMORY_FILE):
            try:
                with open(MEMORY_FILE, "r") as f:
                    memory_data = json.load(f)
            except Exception:
                pass
                
        # If value is none or empty string, maybe we delete it? For now just set it.
        memory_data[key] = value
        
        with open(MEMORY_FILE, "w") as f:
            json.dump(memory_data, f, indent=2)
            
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error saving memory file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save memory")

@app.delete("/api/memory")
async def delete_memory_endpoint(request: Request):
    """Deletes a key from the user's memory database. Expects a JSON object with a 'key'."""
    try:
        body = await request.json()
        key = body.get("key")
        
        if not key:
            raise HTTPException(status_code=400, detail="Key is required")
            
        memory_data = {}
        if os.path.exists(MEMORY_FILE):
            try:
                with open(MEMORY_FILE, "r") as f:
                    memory_data = json.load(f)
            except Exception:
                pass
                
        if key in memory_data:
            del memory_data[key]
            with open(MEMORY_FILE, "w") as f:
                json.dump(memory_data, f, indent=2)
            
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error deleting memory file: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete memory")

@app.get("/api/health")
async def health_check():
    """Health check endpoint that verifies connectivity to API backend."""
    lm_studio_connected = False
    lm_studio_error = None
    available_models = []
    
    active_base_url = get_active_base_url()
    headers = get_httpx_headers()

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{active_base_url}/models", headers=headers)
            if response.status_code == 200:
                lm_studio_connected = True
                data = response.json()
                available_models = [m.get("id") for m in data.get("data", [])]
            else:
                lm_studio_error = f"API responded with HTTP {response.status_code}"
    except Exception as e:
        lm_studio_error = f"Could not connect to API at {active_base_url}: {str(e)}"

    return {
        "status": "online",
        "lm_studio_url": active_base_url,
        "lm_studio_connected": lm_studio_connected,
        "lm_studio_error": lm_studio_error,
        "default_model": config.DEFAULT_MODEL,
        "available_models": available_models
    }


@app.get("/api/config")
async def get_config():
    """Returns application configuration settings."""
    return {
        "lm_studio_base_url": config.LM_STUDIO_BASE_URL,
        "default_model": config.DEFAULT_MODEL,
        "default_system_prompt": config.DEFAULT_SYSTEM_PROMPT,
        "default_temperature": config.DEFAULT_TEMPERATURE,
        "default_top_p": config.DEFAULT_TOP_P,
        "default_max_tokens": config.DEFAULT_MAX_TOKENS,
    }


@app.get("/api/models")
async def get_models():
    """Proxy request to list available models."""
    active_base_url = get_active_base_url()
    headers = get_httpx_headers()
    
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{active_base_url}/models", headers=headers)
            if response.status_code == 200:
                return response.json()
            else:
                logger.warning(f"Failed to fetch models from API: HTTP {response.status_code}")
    except Exception as e:
        logger.warning(f"Error connecting to API models endpoint: {e}")

    # Fallback response if API is unreachable or returning empty
    return {
        "object": "list",
        "data": [
            {"id": config.DEFAULT_MODEL, "object": "model", "owned_by": "local"}
        ]
    }


import base64
import mimetypes

@app.post("/api/chat")
async def chat_completion(request: Request):
    """
    Proxy endpoint for chat completions. Supports streaming SSE responses.
    Expects OpenAI standard completion payload.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    model = body.get("model", config.DEFAULT_MODEL)
    messages = body.get("messages", [])
    temperature = body.get("temperature", config.DEFAULT_TEMPERATURE)
    top_p = body.get("top_p", config.DEFAULT_TOP_P)
    max_tokens = body.get("max_tokens", config.DEFAULT_MAX_TOKENS)
    stream = body.get("stream", True)
    
    # Process local uploads to Base64
    for msg in messages:
        if isinstance(msg.get("content"), list):
            new_content = []
            for item in msg["content"]:
                if item.get("type") in ["image_url", "video_url", "audio_url"]:
                    url_key = item.get("type")
                    url = item.get(url_key, {}).get("url", "")
                    if url.startswith("/uploads/"):
                        filename = url.split("/")[-1]
                        filepath = os.path.join(UPLOADS_DIR, filename)
                        if os.path.exists(filepath):
                            if url_key == "video_url":
                                import cv2
                                
                                # Inform the model that this is a video
                                new_content.append({
                                    "type": "text",
                                    "text": "[System Note: The user attached a video file. The following media consists of the video's audio track and a sequence of extracted visual frames.]"
                                })
                                
                                # Extract and resample audio using pydub
                                try:
                                    from pydub import AudioSegment
                                    import io
                                    audio = AudioSegment.from_file(filepath)
                                    audio = audio.set_frame_rate(16000).set_channels(1)
                                    wav_io = io.BytesIO()
                                    audio.export(wav_io, format="wav")
                                    wav_b64 = base64.b64encode(wav_io.getvalue()).decode("utf-8")
                                    new_content.append({
                                        "type": "image_url",
                                        "image_url": {"url": f"data:audio/wav;base64,{wav_b64}"}
                                    })
                                except Exception as e:
                                    print(f"Failed to extract audio from video: {e}")

                                cap = cv2.VideoCapture(filepath)
                                if cap.isOpened():
                                    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                                    fps = cap.get(cv2.CAP_PROP_FPS)
                                    if fps > 0 and frame_count > 0:
                                        duration_seconds = frame_count / fps
                                        num_frames = min(60, max(1, int(duration_seconds)))
                                        
                                        step = max(1, frame_count // num_frames)
                                        extracted = 0
                                        for i in range(0, frame_count, step):
                                            cap.set(cv2.CAP_PROP_POS_FRAMES, i)
                                            ret, frame = cap.read()
                                            if ret:
                                                _, buffer = cv2.imencode('.jpg', frame)
                                                b64 = base64.b64encode(buffer).decode("utf-8")
                                                new_content.append({
                                                    "type": "image_url",
                                                    "image_url": {"url": f"data:image/jpeg;base64,{b64}"}
                                                })
                                                extracted += 1
                                            if extracted >= num_frames:
                                                break
                                cap.release()
                            elif url_key == "audio_url":
                                new_content.append({
                                    "type": "text",
                                    "text": "[System Note: The user attached an audio file.]"
                                })
                                try:
                                    from pydub import AudioSegment
                                    import io
                                    audio = AudioSegment.from_file(filepath)
                                    audio = audio.set_frame_rate(16000).set_channels(1)
                                    wav_io = io.BytesIO()
                                    audio.export(wav_io, format="wav")
                                    wav_b64 = base64.b64encode(wav_io.getvalue()).decode("utf-8")
                                    new_content.append({
                                        "type": "image_url",
                                        "image_url": {"url": f"data:audio/wav;base64,{wav_b64}"}
                                    })
                                except Exception as e:
                                    print(f"Failed to extract audio from file: {e}")
                            else:
                                mime, _ = mimetypes.guess_type(filepath)
                                mime = mime or "image/jpeg"
                                
                                is_animated = False
                                try:
                                    from PIL import Image
                                    import io
                                    with Image.open(filepath) as img:
                                        if getattr(img, "is_animated", False) and getattr(img, "n_frames", 1) > 1:
                                            is_animated = True
                                            new_content.append({
                                                "type": "text",
                                                "text": "[System Note: The user attached an animated image. The following sequence of frames was extracted.]"
                                            })
                                            
                                            n_frames = img.n_frames
                                            # We cap at 30 frames for short animations like GIFs to avoid context bloat
                                            num_frames_to_extract = min(30, max(1, n_frames))
                                            step = max(1, n_frames // num_frames_to_extract)
                                            
                                            extracted = 0
                                            for i in range(0, n_frames, step):
                                                img.seek(i)
                                                buf = io.BytesIO()
                                                # Convert to RGB to safely save as JPEG
                                                rgb_frame = img.convert('RGB')
                                                rgb_frame.save(buf, format='JPEG', quality=85)
                                                b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
                                                new_content.append({
                                                    "type": "image_url",
                                                    "image_url": {"url": f"data:image/jpeg;base64,{b64}"}
                                                })
                                                extracted += 1
                                                if extracted >= num_frames_to_extract:
                                                    break
                                except Exception as e:
                                    print(f"Animation extraction failed: {e}")

                                if not is_animated:
                                    try:
                                        from PIL import Image
                                        import io
                                        with Image.open(filepath) as img:
                                            buf = io.BytesIO()
                                            img.convert('RGB').save(buf, format='JPEG', quality=85)
                                            b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
                                        item["image_url"]["url"] = f"data:image/jpeg;base64,{b64}"
                                        new_content.append(item)
                                    except Exception as e:
                                        print(f"Static image conversion failed: {e}")
                                        with open(filepath, "rb") as media_file:
                                            b64 = base64.b64encode(media_file.read()).decode("utf-8")
                                        item["image_url"]["url"] = f"data:{mime};base64,{b64}"
                                        new_content.append(item)
                    else:
                        new_content.append(item)
                else:
                    new_content.append(item)
            msg["content"] = new_content

    engine_mode = body.get("engine_mode", "api")

    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "top_p": top_p,
        "stream": stream,
    }

    if max_tokens > 0:
        payload["max_tokens"] = max_tokens

    if engine_mode == "native":
        if not native_engine or not native_engine.is_loaded():
            raise HTTPException(status_code=400, detail="Native engine is not loaded.")
        
        if stream:
            def sync_generator():
                import time
                try:
                    start_time = time.time()
                    token_count = 0
                    for chunk in native_engine.generate(messages, max_tokens, temperature, top_p, stream=True):
                        yield f"data: {json.dumps(chunk)}\n\n"
                        try:
                            if "choices" in chunk and len(chunk["choices"]) > 0:
                                delta = chunk["choices"][0].get("delta", {})
                                if "content" in delta and delta["content"]:
                                    token_count += 1
                        except Exception:
                            pass
                    
                    elapsed = time.time() - start_time
                    tk_s = token_count / elapsed if elapsed > 0 else 0
                    
                    usage_chunk = {
                        "object": "chat.completion.chunk",
                        "choices": [{"delta": {"content": ""}, "index": 0, "finish_reason": "stop"}],
                        "usage": {
                            "completion_tokens": token_count,
                            "total_time_s": elapsed,
                            "tk_s": tk_s
                        }
                    }
                    yield f"data: {json.dumps(usage_chunk)}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'error': str(e)})}\n\n"
            return StreamingResponse(sync_generator(), media_type="text/event-stream")
        else:
            try:
                response = native_engine.generate(messages, max_tokens, temperature, top_p, stream=False)
                return JSONResponse(status_code=200, content=response)
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

    if max_tokens > 0:
        payload["max_tokens"] = max_tokens

    active_base_url = get_active_base_url()
    headers = get_httpx_headers()
    target_url = f"{active_base_url}/chat/completions"

    if stream:
        async def stream_generator():
            try:
                async with httpx.AsyncClient(timeout=120.0) as client:
                    async with client.stream("POST", target_url, json=payload, headers=headers) as response:
                        if response.status_code != 200:
                            err_content = await response.aread()
                            yield f"data: {json.dumps({'error': f'API returned error code {response.status_code}: {err_content.decode()}'})}\n\n"
                            return

                        async for line in response.aiter_lines():
                            if line:
                                yield f"{line}\n\n"
            except httpx.ConnectError:
                err_msg = json.dumps({"error": f"Failed to connect to API at {target_url}."})
                yield f"data: {err_msg}\n\n"
            except Exception as e:
                err_msg = json.dumps({"error": f"Streaming error: {str(e)}"})
                yield f"data: {err_msg}\n\n"

        return StreamingResponse(stream_generator(), media_type="text/event-stream")

    else:
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(target_url, json=payload, headers=headers)
                return JSONResponse(status_code=response.status_code, content=response.json())
        except httpx.ConnectError:
            raise HTTPException(
                status_code=503,
                detail=f"Failed to connect to API at {target_url}."
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

class EngineLoadRequest(BaseModel):
    model_path: str
    n_gpu_layers: int = -1
    n_ctx: int = 4096
    n_batch: int = 512
    flash_attn: bool = False
    offload_kqv: bool = True
    use_mlock: bool = False
    use_mmap: bool = True
    kv_type: str = "f16"
    mmproj_path: str = ""
    chat_handler: str = "gemma4"
    mmproj_cpu: bool = False

@app.post("/api/engine/load")
async def engine_load(req: EngineLoadRequest):
    if not native_engine:
        raise HTTPException(status_code=500, detail="Native engine module not available.")
    try:
        # Run loading in thread so it doesn't block event loop entirely
        await asyncio.to_thread(
            native_engine.load_model, 
            req.model_path, 
            req.n_gpu_layers, 
            req.n_ctx, 
            req.n_batch,
            req.flash_attn,
            req.offload_kqv,
            req.use_mlock,
            req.use_mmap,
            req.kv_type,
            req.mmproj_path,
            req.chat_handler,
            req.mmproj_cpu
        )
        return {"status": "loaded", "config": native_engine.config}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/engine/unload")
async def engine_unload():
    if not native_engine:
        raise HTTPException(status_code=500, detail="Native engine module not available.")
    native_engine.unload_model()
    return {"status": "unloaded"}

@app.get("/api/engine/status")
async def engine_status():
    if not native_engine:
        return {"status": "unavailable", "has_llama_cpp": HAS_LLAMA_CPP}
    return {
        "status": "loaded" if native_engine.is_loaded() else "unloaded",
        "has_llama_cpp": HAS_LLAMA_CPP,
        "model_path": native_engine.model_path,
        "config": native_engine.config
    }


# Serve static web assets
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir, exist_ok=True)

app.mount("/static", StaticFiles(directory=static_dir), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


@app.get("/")
async def root():
    """Serve index.html at root."""
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Frontend index.html not yet created."}

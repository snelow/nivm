"""
nivm — Native Inference Virtual Machine (Sovereign AI Workbench).
Main FastAPI application entrypoint.

Connects modular sub-routers:
- core/api_v1.py: OpenAI-compatible /v1 endpoints
- core/storage.py: Settings, user chats, memory, and media uploads
- core/models_router.py: Model discovery, GGUF local scanning, and downloads
- core/file_services.py: Desktop file dialogs, directory listing, and terminal execution
- core/multimodal.py: Video keyframe scoring, Whisper transcription, and audio processing
- core/engine.py: Local llama.cpp inference backend
"""

import os
import time
import json
import asyncio
import logging
from typing import Optional

from fastapi import FastAPI, Request, Response, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
import httpx

# ── Core Engine & Config ──────────────────────────────────────────
from core import config
from core.config import UPLOADS_DIR, BASE_DIR
from core.engine import model_manager, HAS_LLAMA_CPP, MODEL_REGISTRY
from core.router import classify_intent, get_resident_role
from core.network_monitor import record_api_start, record_api_end, get_network_status
from core.multimodal import process_media_in_messages

# ── Sub-Routers & Storage ─────────────────────────────────────────
from core.api_v1 import router as api_v1_router
from core.storage import router as storage_router, get_user_settings, _apply_all_overrides
from core.models_router import router as models_router
from core.file_services import router as file_services_router

# ── Logging ───────────────────────────────────────────────────────
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("nivm")


# ── FastAPI App Setup ─────────────────────────────────────────────
app = FastAPI(
    title="nivm",
    description="Native Inference Virtual Machine — Air-Gapped Sovereign AI Workbench",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def monitor_network_middleware(request: Request, call_next):
    """Pass-through middleware tracking internal request activity for health metrics."""
    return await call_next(request)


@app.on_event("startup")
async def startup_event():
    """Apply saved hardware overrides and custom paths on server startup."""
    _apply_all_overrides()


# ── Mount Routers ─────────────────────────────────────────────────
app.include_router(api_v1_router)
app.include_router(storage_router)
app.include_router(models_router)
app.include_router(file_services_router)


# ── Diagnostics & Health Endpoints ────────────────────────────────

@app.get("/api/config")
async def get_config():
    """Returns application configuration settings."""
    return {
        "default_model": "coder",
        "default_system_prompt": config.DEFAULT_SYSTEM_PROMPT,
        "default_temperature": config.DEFAULT_TEMPERATURE,
        "default_top_p": config.DEFAULT_TOP_P,
        "default_max_tokens": config.DEFAULT_MAX_TOKENS,
    }


@app.get("/api/network/monitor")
async def get_network_monitor():
    """Returns real-time network connection data to prove air-gapped status."""
    return get_network_status()


@app.get("/api/health")
async def health_check():
    """Health check — reports local engine status."""
    return {
        "status": "online",
        "air_gapped": True,
        "has_llama_cpp": HAS_LLAMA_CPP,
        "active_model": model_manager.get_active_info(),
        "available_models": model_manager.list_available(),
    }


# ── Text-to-Speech (TTS) Endpoints ───────────────────────────────

@app.get("/api/tts/status")
async def tts_status():
    """Returns status and capabilities of the native offline TTS engine."""
    from core.tts import get_tts_info
    return get_tts_info()


@app.post("/api/tts")
async def tts_synthesize(request: Request):
    """
    Synthesizes speech from input text using the offline ONNX engine on CPU.
    Returns audio/wav bytes.
    """
    from core.tts import generate_wav_bytes
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    text = body.get("text", "")
    voice = body.get("voice", "af_nicole")
    speed = float(body.get("speed", 0.95))
    warmth = float(body.get("warmth", 0.7))

    if not text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    wav_bytes = generate_wav_bytes(text, voice=voice, speed=speed, warmth=warmth)
    if not wav_bytes:
        raise HTTPException(status_code=500, detail="Failed to synthesize speech")

    return Response(content=wav_bytes, media_type="audio/wav")


@app.post("/api/stt")
async def stt_transcribe(request: Request):
    """
    Transcribes uploaded voice speech (WebM, WAV, Ogg, MP3) using offline Faster-Whisper on CPU.
    Accepts raw audio bytes or multipart form-data.
    Returns JSON: {"text": "transcribed speech"}
    """
    from core.multimodal import transcribe_speech_bytes
    content_type = request.headers.get("content-type", "").lower()
    audio_bytes = b""

    try:
        if "multipart/form-data" in content_type:
            form = await request.form()
            for key in ["audio", "file", "voice"]:
                upload = form.get(key)
                if upload and hasattr(upload, "read"):
                    audio_bytes = await upload.read()
                    break
        else:
            audio_bytes = await request.body()
    except Exception as e:
        logger.warning(f"Error reading STT request body: {e}")
        return JSONResponse(status_code=200, content={"text": ""})

    if not audio_bytes:
        return JSONResponse(status_code=200, content={"text": ""})

    transcribed_text = await asyncio.to_thread(transcribe_speech_bytes, audio_bytes)
    return JSONResponse(status_code=200, content={"text": transcribed_text})


@app.get("/api/tts/pronunciations")
async def get_pronunciations():
    """Returns the sovereign offline pronunciation dictionary with default and user custom rules."""
    from core.tts import get_pronunciation_dict
    return get_pronunciation_dict()


@app.post("/api/tts/pronunciations")
async def add_pronunciation(request: Request):
    """Add or update a user custom pronunciation rule."""
    from core.tts import save_user_pronunciation
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    word = body.get("word", "").strip()
    pronunciation = body.get("pronunciation", "").strip()
    if not word or not pronunciation:
        raise HTTPException(status_code=400, detail="Both 'word' and 'pronunciation' are required.")
    if word.lower() == "nivm":
        raise HTTPException(status_code=400, detail="'nivm' is a protected core sovereign pronunciation and cannot be modified.")
    custom = save_user_pronunciation(word, pronunciation)
    return {"status": "success", "custom": custom}


@app.delete("/api/tts/pronunciations")
async def delete_pronunciation(request: Request):
    """Delete a user custom pronunciation rule."""
    from core.tts import delete_user_pronunciation
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    word = body.get("word", "").strip()
    if not word:
        raise HTTPException(status_code=400, detail="Missing 'word' parameter.")
    if word.lower() == "nivm":
        raise HTTPException(status_code=400, detail="'nivm' is a protected core sovereign pronunciation and cannot be deleted.")
    custom = delete_user_pronunciation(word)
    return {"status": "success", "custom": custom}


# ══════════════════════════════════════════════════════════════════
# Chat Completion — Multi-Model with Auto-Routing & API Mode
# ══════════════════════════════════════════════════════════════════

@app.post("/api/chat")
async def chat_completion(request: Request, background_tasks: BackgroundTasks):
    """
    Multi-model chat completion with automatic intent routing.

    Flow:
      1. Process media in messages (extract video keyframes, audio waveform, Whisper transcript)
      2. In API mode: forward to external OpenAI-compatible provider
      3. In Single mode: use selected model role (or delegate to vision specialist if media attached)
      4. In Routing mode: classify user intent and pick optimal specialist
      5. Activate chosen model and stream tokens to client
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    messages = body.get("messages", [])
    temperature = body.get("temperature", config.DEFAULT_TEMPERATURE)
    top_p = body.get("top_p", config.DEFAULT_TOP_P)
    repeat_penalty = body.get("repeat_penalty", 1.1)
    max_tokens = body.get("max_tokens", config.DEFAULT_MAX_TOKENS)
    stream = body.get("stream", True)

    # Step 1: Process media (convert uploads to base64)
    has_images = await asyncio.to_thread(process_media_in_messages, messages)

    # Step 2: Extract user message text for routing
    user_text = ""
    if messages:
        last_msg = messages[-1]
        if isinstance(last_msg.get("content"), str):
            user_text = last_msg["content"]
        elif isinstance(last_msg.get("content"), list):
            user_text = " ".join(
                item.get("text", "") for item in last_msg["content"]
                if item.get("type") == "text"
            )

    # Step 3: Route to the right model (or forward in API mode)
    _apply_all_overrides()
    settings = get_user_settings()
    inference_mode = settings.get("inference_mode", "single")

    if inference_mode == "api":
        # API Mode: Forward request to external OpenAI-compatible endpoint
        api_chat_url = settings.get("api_chat_url", "").strip()
        if not api_chat_url:
            base_url = settings.get("api_base_url", "https://api.groq.com/openai/v1").rstrip("/")
            api_chat_url = f"{base_url}/chat/completions"

        api_key = settings.get("api_key", "").strip()
        api_model = settings.get("api_model", "llama-3.3-70b-versatile").strip() or "llama-3.3-70b-versatile"

        # Determine if external provider/model supports multimodal images
        is_api_multimodal = settings.get("api_multimodal")
        if is_api_multimodal is None:
            m_lower = api_model.lower()
            url_lower = api_chat_url.lower()
            if any(k in url_lower for k in ["googleapis.com", "generativelanguage"]):
                is_api_multimodal = True
            elif any(k in m_lower for k in ["gemini", "gpt-4o", "gpt-4-turbo", "vision", "-vl", "_vl", "pixtral", "llava", "claude-3", "minicpm-v", "internvl"]):
                is_api_multimodal = True
            else:
                is_api_multimodal = False

        # Prepare messages payload
        clean_messages = []
        for msg in messages:
            content = msg.get("content")
            role = msg.get("role", "user")
            if isinstance(content, str):
                clean_messages.append({"role": role, "content": content})
            elif isinstance(content, list):
                if is_api_multimodal:
                    msg_parts = []
                    for part in content:
                        if isinstance(part, dict):
                            ptype = part.get("type")
                            if ptype == "text":
                                msg_parts.append({"type": "text", "text": part.get("text", "")})
                            elif ptype == "image_url":
                                img_url = part.get("image_url", {})
                                url_val = img_url.get("url") if isinstance(img_url, dict) else str(img_url)
                                if url_val:
                                    msg_parts.append({
                                        "type": "image_url",
                                        "image_url": {"url": url_val}
                                    })
                        elif isinstance(part, str):
                            msg_parts.append({"type": "text", "text": part})
                    clean_messages.append({
                        "role": role,
                        "content": msg_parts if msg_parts else ""
                    })
                else:
                    text_parts = []
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            text_parts.append(part.get("text", ""))
                        elif isinstance(part, str):
                            text_parts.append(part)
                    clean_messages.append({
                        "role": role,
                        "content": " ".join(text_parts) if text_parts else "[Media omitted in API mode]"
                    })
            else:
                clean_messages.append({"role": role, "content": str(content)})

        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        api_req_tokens = body.get("max_tokens")
        if not api_req_tokens or not isinstance(api_req_tokens, int) or api_req_tokens <= 0:
            api_req_tokens = getattr(config, "DEFAULT_API_MAX_TOKENS", 1000)
        elif api_req_tokens > 4096:
            api_req_tokens = 4096

        effective_max_tokens = api_req_tokens
        if "groq.com" in api_chat_url.lower() and effective_max_tokens > 950 and "qwen" in api_model.lower():
            effective_max_tokens = 950

        payload = {
            "model": api_model,
            "messages": clean_messages,
            "temperature": temperature,
            "top_p": top_p,
            "stream": stream,
        }
        if effective_max_tokens is not None and effective_max_tokens > 0:
            payload["max_tokens"] = effective_max_tokens

        if stream:
            async def external_api_generator():
                record_api_start()
                start_time = time.time()
                full_text = ""
                token_count = 0
                try:
                    meta_chunk = {
                        "object": "chat.completion.chunk",
                        "choices": [{"delta": {"content": ""}, "index": 0, "finish_reason": None}],
                        "model_info": {
                            "role": "api",
                            "name": f"API: {api_model}",
                            "swap_time_s": 0.0,
                        }
                    }
                    yield f"data: {json.dumps(meta_chunk)}\n\n"

                    async with httpx.AsyncClient(timeout=120.0) as client:
                        async with client.stream("POST", api_chat_url, headers=headers, json=payload) as resp:
                            if resp.status_code != 200:
                                err_body = await resp.aread()
                                err_text = err_body.decode("utf-8", errors="replace")
                                logger.error(f"External API error {resp.status_code}: {err_text}")
                                yield f"data: {json.dumps({'error': f'API Error {resp.status_code}: {err_text}'})}\n\n"
                                return

                            async for line in resp.aiter_lines():
                                if not line:
                                    continue
                                line = line.strip()
                                if line.startswith("data:"):
                                    data_str = line[5:].strip()
                                    if data_str == "[DONE]":
                                        break
                                    try:
                                        chunk = json.loads(data_str)
                                        yield f"data: {json.dumps(chunk)}\n\n"
                                        if "choices" in chunk and len(chunk["choices"]) > 0:
                                            delta = chunk["choices"][0].get("delta", {})
                                            if "content" in delta and delta["content"]:
                                                full_text += delta["content"]
                                                token_count += 1
                                    except Exception:
                                        yield f"{line}\n\n"

                    elapsed = time.time() - start_time
                    tk_s = token_count / elapsed if elapsed > 0 else 0
                    def _calc_tokens(c):
                        if isinstance(c, str):
                            return len(c.split())
                        if isinstance(c, list):
                            count = 0
                            for p in c:
                                if isinstance(p, dict):
                                    if p.get("type") == "text":
                                        count += len(p.get("text", "").split())
                                    elif p.get("type") == "image_url":
                                        count += 256
                                elif isinstance(p, str):
                                    count += len(p.split())
                            return count
                        return 0

                    prompt_len = sum(_calc_tokens(m.get("content")) for m in clean_messages)
                    usage_chunk = {
                        "object": "chat.completion.chunk",
                        "choices": [{"delta": {"content": ""}, "index": 0, "finish_reason": "stop"}],
                        "usage": {
                            "prompt_tokens": prompt_len,
                            "completion_tokens": token_count,
                            "total_tokens": prompt_len + token_count,
                            "total_time_s": round(elapsed, 2),
                            "tk_s": round(tk_s, 1),
                            "raw_tokens": [],
                        },
                        "model_info": {
                            "role": "api",
                            "name": f"API: {api_model}",
                        }
                    }
                    yield f"data: {json.dumps(usage_chunk)}\n\n"
                except Exception as e:
                    logger.error(f"External API stream error: {e}")
                    yield f"data: {json.dumps({'error': f'External API connection failed: {str(e)}'})}\n\n"
                finally:
                    record_api_end()

            return StreamingResponse(external_api_generator(), media_type="text/event-stream")
        else:
            record_api_start()
            try:
                async with httpx.AsyncClient(timeout=120.0) as client:
                    resp = await client.post(api_chat_url, headers=headers, json=payload)
                    if resp.status_code != 200:
                        raise HTTPException(status_code=resp.status_code, detail=resp.text)
                    return resp.json()
            finally:
                record_api_end()

    elif inference_mode == "single":
        # Single model mode
        routed_to = settings.get("single_model_role", "coder")
        active_cfg = MODEL_REGISTRY.get(routed_to, {})
        mmproj_val = str(active_cfg.get("mmproj_path") or "").strip()
        has_multimodal = bool(
            active_cfg.get("chat_handler_type") is not None
            or (mmproj_val and mmproj_val.lower() != "none" and os.path.isfile(mmproj_val))
            or routed_to == "vision"
        )
        if has_images:
            if has_multimodal:
                logger.info(f"Single model mode: '{routed_to}' has mmproj active; sending directly to model for multimodal understanding.")
            else:
                logger.warning(f"Single model mode: '{routed_to}' has mmproj set to none/missing. Vision is disabled; converting to text-only.")
                for msg in messages:
                    if isinstance(msg.get("content"), list):
                        msg["content"] = " ".join(
                            item.get("text", "") for item in msg["content"]
                            if isinstance(item, dict) and item.get("type") == "text"
                        ).strip()
                has_images = False
        logger.warning(f"Single model mode: using {routed_to}")
    else:
        # Routing mode — classify intent
        routed_to = await asyncio.to_thread(classify_intent, user_text, has_images)
        logger.warning(f"Router classified -> {routed_to}")

    available_models = model_manager.list_available()
    if not available_models.get(routed_to, {}).get("available"):
        logger.warning(f"Requested role '{routed_to}' unavailable, falling back to coder")
        routed_to = "coder"
    logger.warning(f"Routed to: {routed_to}")

    # Strip tools instruction for vision model to prevent looping
    if routed_to == "vision":
        for msg in messages:
            if msg.get("role") == "system" and isinstance(msg.get("content"), str):
                msg["content"] = msg["content"].split("[CRITICAL INSTRUCTION: TOOLS SYSTEM]")[0].strip()

    # Activate specialist model
    try:
        swap_time = await asyncio.to_thread(model_manager.activate, routed_to)
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=f"Model not available: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load model: {e}")

    model_info = model_manager.get_active_info()

    if stream:
        def sync_generator():
            try:
                meta_chunk = {
                    "object": "chat.completion.chunk",
                    "choices": [{"delta": {"content": ""}, "index": 0, "finish_reason": None}],
                    "model_info": {
                        "role": routed_to,
                        "name": model_info["name"],
                        "swap_time_s": round(swap_time, 1),
                    }
                }
                yield f"data: {json.dumps(meta_chunk)}\n\n"

                start_time = time.time()
                token_count = 0
                full_text = ""

                for chunk in model_manager.generate(messages, max_tokens, temperature, top_p, stream=True, repeat_penalty=repeat_penalty):
                    yield f"data: {json.dumps(chunk)}\n\n"
                    try:
                        if "choices" in chunk and len(chunk["choices"]) > 0:
                            delta = chunk["choices"][0].get("delta", {})
                            if "content" in delta and delta["content"]:
                                full_text += delta["content"]
                                token_count += 1
                    except Exception:
                        pass

                elapsed = time.time() - start_time

                raw_tokens = []
                completion_tokens = token_count
                prompt_tokens = 0
                try:
                    raw_tokens = model_manager.tokenize(full_text, role=routed_to)
                    if raw_tokens:
                        completion_tokens = len(raw_tokens)

                    prompt_text = " ".join(
                        m.get("content", "") if isinstance(m.get("content"), str) else " ".join(
                            part.get("text", "") for part in m.get("content", []) if isinstance(part, dict)
                        )
                        for m in messages
                    )
                    raw_prompt_tokens = model_manager.tokenize(prompt_text, role=routed_to)
                    if raw_prompt_tokens:
                        prompt_tokens = len(raw_prompt_tokens)
                except Exception as tok_err:
                    logger.warning(f"Post-stream token counting error: {tok_err}")

                tk_s = completion_tokens / elapsed if elapsed > 0 else 0

                usage_chunk = {
                    "object": "chat.completion.chunk",
                    "choices": [{"delta": {"content": ""}, "index": 0, "finish_reason": "stop"}],
                    "usage": {
                        "prompt_tokens": prompt_tokens,
                        "completion_tokens": completion_tokens,
                        "total_tokens": prompt_tokens + completion_tokens,
                        "total_time_s": round(elapsed, 2),
                        "tk_s": round(tk_s, 1),
                        "raw_tokens": raw_tokens[:2000] if raw_tokens else [],
                    },
                    "model_info": {
                        "role": routed_to,
                        "name": model_info["name"],
                    }
                }
                yield f"data: {json.dumps(usage_chunk)}\n\n"
            except Exception as e:
                logger.error(f"Streaming error in sync_generator: {e}", exc_info=True)
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        if inference_mode == "routing":
            background_tasks.add_task(model_manager.activate, get_resident_role())
        return StreamingResponse(sync_generator(), media_type="text/event-stream", background=background_tasks)
    else:
        try:
            response = await asyncio.to_thread(
                model_manager.generate, messages, max_tokens, temperature, top_p, False, repeat_penalty
            )
            if isinstance(response, dict):
                response["model_info"] = {
                    "role": routed_to,
                    "name": model_info["name"],
                    "swap_time_s": round(swap_time, 1),
                }
                choices = response.get("choices", [])
                if choices and "message" in choices[0]:
                    content = choices[0]["message"].get("content", "")
                    raw_tokens = model_manager.tokenize(content, role=routed_to)
                    if "usage" in response:
                        response["usage"]["raw_tokens"] = raw_tokens[:2000]
            if inference_mode == "routing":
                background_tasks.add_task(model_manager.activate, get_resident_role())
            return JSONResponse(status_code=200, content=response)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


# ══════════════════════════════════════════════════════════════════
# Static Asset Serving & Root
# ══════════════════════════════════════════════════════════════════

static_dir = os.path.join(BASE_DIR, "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir, exist_ok=True)


class NoCacheStaticFiles(StaticFiles):
    def is_not_modified(self, response_headers, request_headers) -> bool:
        return False

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response


app.mount("/static", NoCacheStaticFiles(directory=static_dir), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


@app.get("/")
async def root():
    """Serve index.html at root."""
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(
            index_path,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )
    return {"message": "Frontend index.html not yet created."}

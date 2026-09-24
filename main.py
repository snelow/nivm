"""
nivm — Native Inference Virtual Machine (Local & Hybrid AI Workbench).
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
from typing import Optional, Any

from fastapi import FastAPI, Request, Response, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
import httpx

# Core engine and configuration
from core import config
from core.config import UPLOADS_DIR, IMAGES_DIR, BASE_DIR
from core.engine import model_manager, HAS_LLAMA_CPP, MODEL_REGISTRY
from core.router import classify_intent, get_resident_role
from core.network_monitor import record_api_start, record_api_end, get_network_status
from core.multimodal import process_media_in_messages
from core.chat_manager import chat_manager

# Sub-routers and storage
from core.api_v1 import router as api_v1_router
from core.storage import router as storage_router, get_user_settings, _apply_all_overrides
from core.models_router import router as models_router
from core.file_services import router as file_services_router
from core.image_router import router as image_router
from core.image_engine.daemon import stop_daemon
import hmac
from core.auth import (
    router as auth_router,
    is_auth_configured,
    extract_token_from_request,
    validate_session,
    get_auth_data,
)

# Logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("nivm")


# FastAPI application
app = FastAPI(
    title="nivm",
    description="Native Inference Virtual Machine — Local & Hybrid AI Workbench",
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
async def security_and_network_middleware(request: Request, call_next):
    """
    Enforce single-user owner authentication across all data, uploads, images,
    and inference endpoints with strict zero-leakage Level 1 network gatekeeping.
    """
    if request.method == "OPTIONS":
        return await call_next(request)

    path = request.url.path

    # Public Whitelist: Landing, frontend static assets, PWA manifest, service worker, icons
    if (
        path == "/"
        or path.startswith("/static")
        or path in ("/manifest.json", "/favicon.ico", "/sw.js")
    ):
        return await call_next(request)

    # Public Auth & Health endpoints
    if path in (
        "/api/auth/login",
        "/api/auth/logout",
        "/api/auth/session",
        "/api/auth/status",
        "/api/auth/reset-password",
        "/api/health",
    ):
        return await call_next(request)

    # Local CLI Authorization (from host run.sh console via loopback)
    cli_key = request.headers.get("X-NIVM-Internal-Key")
    client_host = request.client.host if request.client else ""
    if cli_key and client_host in ("127.0.0.1", "localhost", "::1"):
        auth_data = get_auth_data()
        expected_secret = auth_data.get("signing_secret")
        if expected_secret and hmac.compare_digest(cli_key, expected_secret):
            return await call_next(request)

    # If owner account is not yet configured, block protected data APIs
    if not is_auth_configured():
        if (
            path.startswith("/api/")
            or path.startswith("/v1/")
            or path.startswith("/uploads/")
            or path.startswith("/images/")
        ):
            return JSONResponse(
                status_code=403,
                content={
                    "error": "Unconfigured",
                    "detail": "Owner account not configured. Please initialize your password in terminal or via setup.",
                },
            )
        return await call_next(request)

    # Verify session token from Bearer header or HTTP-only session cookie
    token = extract_token_from_request(request)
    username = validate_session(token) if token else None

    # Protect all APIs, inference routes, uploaded files, and generated images
    if (
        path.startswith("/api/")
        or path.startswith("/v1/")
        or path.startswith("/uploads/")
        or path.startswith("/images/")
    ):
        if not username:
            return JSONResponse(
                status_code=401,
                content={
                    "error": "Unauthorized",
                    "detail": "Session authentication required. Please unlock session.",
                },
            )

    return await call_next(request)


@app.on_event("startup")
async def startup_event():
    """Apply saved hardware overrides and custom paths on server startup."""
    _apply_all_overrides()


# Mount sub-routers
app.include_router(auth_router)
app.include_router(api_v1_router)
app.include_router(storage_router)
app.include_router(models_router)
app.include_router(file_services_router)
app.include_router(image_router)


@app.on_event("shutdown")
async def shutdown_event():
    """Ensure background daemons are cleanly stopped on shutdown."""
    stop_daemon()


# Diagnostics and health endpoints

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


# Text-to-speech endpoints

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
    Returns JSON: {"text": "transcribed speech", "duration_ms": 120, "model": "base.en"}
    """
    from core.multimodal import transcribe_speech_bytes, get_active_whisper_model_name
    content_type = request.headers.get("content-type", "").lower()
    audio_bytes = b""
    model_param = request.query_params.get("model")

    try:
        if "multipart/form-data" in content_type:
            form = await request.form()
            if not model_param and form.get("model"):
                model_param = str(form.get("model"))
            for key in ["audio", "file", "voice"]:
                upload = form.get(key)
                if upload and hasattr(upload, "read"):
                    audio_bytes = await upload.read()
                    break
        else:
            audio_bytes = await request.body()
    except Exception as e:
        logger.warning(f"Error reading STT request body: {e}")
        return JSONResponse(status_code=200, content={"text": "", "duration_ms": 0, "model": get_active_whisper_model_name()})

    if not audio_bytes:
        return JSONResponse(status_code=200, content={"text": "", "duration_ms": 0, "model": get_active_whisper_model_name()})

    t0 = time.time()
    transcribed_text = await asyncio.to_thread(transcribe_speech_bytes, audio_bytes, 60, model_param)
    dur_ms = int((time.time() - t0) * 1000)
    return JSONResponse(status_code=200, content={
        "text": transcribed_text,
        "duration_ms": dur_ms,
        "model": get_active_whisper_model_name()
    })


@app.get("/api/stt/config")
async def get_stt_config():
    """Returns available Whisper models and currently active selection."""
    from core.multimodal import get_active_whisper_model_name, AVAILABLE_WHISPER_MODELS
    return {
        "active_model": get_active_whisper_model_name(),
        "available_models": AVAILABLE_WHISPER_MODELS,
        "engines": ["web", "whisper"]
    }


@app.post("/api/stt/config")
async def set_stt_config(request: Request):
    """Sets the active Whisper model preference."""
    from core.multimodal import set_active_whisper_model, get_active_whisper_model_name, AVAILABLE_WHISPER_MODELS
    try:
        body = await request.json()
        model_name = body.get("model")
        if model_name:
            success = set_active_whisper_model(model_name)
            return {"success": success, "active_model": get_active_whisper_model_name()}
    except Exception as e:
        logger.warning(f"Error updating STT config: {e}")
    return {"success": False, "active_model": get_active_whisper_model_name(), "available_models": AVAILABLE_WHISPER_MODELS}


@app.get("/api/tts/pronunciations")
async def get_pronunciations():
    """Returns the offline pronunciation dictionary with default and user custom rules."""
    from core.tts import get_pronunciation_dict
    return get_pronunciation_dict()


def _validate_pronunciation_body(body: dict, require_val: bool = True):
    word = body.get("word", "").strip()
    pron = body.get("pronunciation", "").strip()
    if not word or (require_val and not pron):
        raise HTTPException(status_code=400, detail="Required parameters missing.")
    if word.lower() == "nivm":
        raise HTTPException(status_code=400, detail="'nivm' is a protected core pronunciation.")
    return word, pron


@app.post("/api/tts/pronunciations")
async def add_pronunciation(request: Request):
    """Add or update a user custom pronunciation rule."""
    from core.tts import save_user_pronunciation
    try:
        word, pron = _validate_pronunciation_body(await request.json(), require_val=True)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    return {"status": "success", "custom": save_user_pronunciation(word, pron)}


@app.delete("/api/tts/pronunciations")
async def delete_pronunciation(request: Request):
    """Delete a user custom pronunciation rule."""
    from core.tts import delete_user_pronunciation
    try:
        word, _ = _validate_pronunciation_body(await request.json(), require_val=False)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    return {"status": "success", "custom": delete_user_pronunciation(word)}


# Chat completion endpoint

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
    chat_id = body.get("chat_id") or f"chat_{int(time.time() * 1000)}"
    temperature = body.get("temperature", config.DEFAULT_TEMPERATURE)
    top_p = body.get("top_p", config.DEFAULT_TOP_P)
    repeat_penalty = body.get("repeat_penalty", 1.1)
    max_tokens = body.get("max_tokens", config.DEFAULT_MAX_TOKENS)
    stream = body.get("stream", True)
    enable_thinking = body.get("enable_thinking")

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
            job = chat_manager.start_api_job(
                chat_id=chat_id,
                api_chat_url=api_chat_url,
                headers=headers,
                payload=payload,
                api_model=api_model,
                clean_messages=clean_messages
            )
            return StreamingResponse(chat_manager.stream_job(job), media_type="text/event-stream")
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
        job = chat_manager.start_local_job(
            chat_id=chat_id,
            routed_to=routed_to,
            model_info=model_info,
            swap_time=swap_time,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            repeat_penalty=repeat_penalty,
            inference_mode=inference_mode,
            enable_thinking=enable_thinking
        )
        return StreamingResponse(chat_manager.stream_job(job), media_type="text/event-stream")
    else:
        try:
            response = await asyncio.to_thread(
                model_manager.generate, messages, max_tokens, temperature, top_p, False, repeat_penalty, enable_thinking
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


@app.get("/api/chat/status")
async def get_chat_status(chat_id: str):
    """Check background generation status for a given chat."""
    if not chat_id:
        return {"status": "idle"}
    return chat_manager.get_status(chat_id)


@app.get("/api/chat/stream")
async def reconnect_chat_stream(chat_id: str):
    """Reconnect to an active or buffered background stream."""
    job = chat_manager.get_job(chat_id)
    if not job:
        raise HTTPException(status_code=404, detail="No active generation for this chat")
    return StreamingResponse(chat_manager.stream_job(job), media_type="text/event-stream")


@app.post("/api/chat/stop")
async def stop_chat_generation(request: Request):
    """Explicitly stops an in-progress background generation job."""
    try:
        body = await request.json()
        chat_id = body.get("chat_id", "")
    except Exception:
        chat_id = ""
    if not chat_id:
        raise HTTPException(status_code=400, detail="chat_id is required")
    return chat_manager.stop_chat(chat_id)


# Static asset serving and frontend routes

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
app.mount("/images", StaticFiles(directory=IMAGES_DIR), name="images")


def _serve_static_file(rel_path: str, media_type: Optional[str] = None, extra_headers: Optional[dict] = None, fallback: Any = None):
    full_path = os.path.join(static_dir, rel_path)
    if os.path.exists(full_path):
        headers = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
        if extra_headers:
            headers.update(extra_headers)
        return FileResponse(full_path, media_type=media_type, headers=headers)
    if fallback is not None:
        return fallback
    raise HTTPException(status_code=404, detail=f"{rel_path} not found")


@app.get("/sw.js")
async def service_worker():
    return _serve_static_file("sw.js", "application/javascript", {"Service-Worker-Allowed": "/"})


@app.get("/offline.html")
async def offline_page():
    return _serve_static_file("offline.html", "text/html")


@app.get("/manifest.json")
async def web_manifest():
    return _serve_static_file("manifest.json", "application/manifest+json")


@app.get("/favicon.ico")
async def favicon_ico():
    return _serve_static_file("favicon.ico", "image/x-icon")


@app.get("/")
async def root():
    return _serve_static_file("index.html", fallback={"message": "Frontend index.html not yet created."})

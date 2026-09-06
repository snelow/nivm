"""
nivm OpenAI-Compatible Text API & Raw Token Endpoints (/v1)
Air-gapped, sovereign text-only API implementation.
"""

import os
import time
import json
import uuid
import asyncio
from typing import List, Dict, Any, Optional, Union
from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

try:
    from . import config
    from .engine import model_manager, MODEL_REGISTRY
    from .network_monitor import record_api_start, record_api_end
except ImportError:
    import config
    from engine import model_manager, MODEL_REGISTRY
    from network_monitor import record_api_start, record_api_end

router = APIRouter(tags=["OpenAI Compatible API"])


# ── Pydantic Request Models ───────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    content: Union[str, List[Dict[str, Any]]]
    name: Optional[str] = None


class ChatCompletionRequest(BaseModel):
    model: Optional[str] = None
    messages: List[ChatMessage]
    temperature: Optional[float] = Field(default=config.DEFAULT_TEMPERATURE)
    top_p: Optional[float] = Field(default=config.DEFAULT_TOP_P)
    max_tokens: Optional[int] = Field(default=config.DEFAULT_MAX_TOKENS)
    stream: Optional[bool] = False
    stop: Optional[Union[str, List[str]]] = None
    presence_penalty: Optional[float] = 0.0
    frequency_penalty: Optional[float] = 0.0


class CompletionRequest(BaseModel):
    model: Optional[str] = None
    prompt: Union[str, List[str]]
    temperature: Optional[float] = Field(default=config.DEFAULT_TEMPERATURE)
    top_p: Optional[float] = Field(default=config.DEFAULT_TOP_P)
    max_tokens: Optional[int] = Field(default=config.DEFAULT_MAX_TOKENS)
    stream: Optional[bool] = False
    stop: Optional[Union[str, List[str]]] = None


class TokenizeRequest(BaseModel):
    text: str
    model: Optional[str] = None
    role: Optional[str] = None


class DetokenizeRequest(BaseModel):
    tokens: List[int]
    model: Optional[str] = None
    role: Optional[str] = None


# ── Helper Functions ──────────────────────────────────────────────

def _resolve_text_role(requested_model: Optional[str]) -> str:
    """
    Resolve which role to use for text requests.
    Enforces text-only constraints.
    """
    from main import get_user_settings, _apply_all_overrides
    _apply_all_overrides()
    settings = get_user_settings()

    if requested_model:
        req = requested_model.strip().lower()
        if req == "vision":
            raise HTTPException(
                status_code=400,
                detail={
                    "error": {
                        "message": "Vision model is disabled on the text API endpoint.",
                        "type": "invalid_request_error",
                        "code": "vision_disabled"
                    }
                }
            )
        for role, reg in MODEL_REGISTRY.items():
            if role == "vision":
                continue
            if req == role or req == reg.get("name", "").lower():
                return role
            path = reg.get("path") or ""
            if req == os.path.basename(path).lower():
                return role

    # No specific model requested: obey inference_mode
    inference_mode = settings.get("inference_mode", "single")
    if inference_mode == "single":
        single_role = settings.get("single_model_role", "coder")
        if single_role == "vision":
            return "coder" if model_manager.get_model_path("coder") else "custom"
        return single_role

    # Routing mode: default to coder for technical/general text tasks
    return "coder" if model_manager.get_model_path("coder") else "router"


def _check_text_only(messages: List[ChatMessage]):
    """
    Ensure no multimodal image content is passed.
    Raises HTTPException(400) if vision content is detected.
    """
    for msg in messages:
        if isinstance(msg.content, list):
            for part in msg.content:
                part_type = part.get("type", "")
                if part_type in ("image_url", "image", "media", "input_audio", "video"):
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "error": {
                                "message": "Vision and multimodal inputs are not supported on the text API endpoint. Please use the nivm web interface for vision tasks.",
                                "type": "invalid_request_error",
                                "code": "vision_not_supported"
                            }
                        }
                    )


# ── Endpoints ─────────────────────────────────────────────────────

@router.get("/v1/models")
@router.get("/api/v1/models")
async def list_models():
    """List available text models in OpenAI format."""
    from main import _apply_all_overrides
    _apply_all_overrides()

    available = model_manager.list_available()
    data = []
    for role, info in available.items():
        if role == "vision":
            continue  # API is strictly text-only
        if info.get("available"):
            data.append({
                "id": role,
                "object": "model",
                "created": int(time.time()),
                "owned_by": "nivm",
                "permission": [],
                "root": role,
                "parent": None,
                "meta": {
                    "name": info.get("name"),
                    "filename": os.path.basename(info.get("path") or ""),
                    "size_gb": info.get("size_gb"),
                }
            })
    return {"object": "list", "data": data}


@router.get("/v1/models/{model_id}")
@router.get("/api/v1/models/{model_id}")
async def get_model(model_id: str):
    """Get metadata for a single model."""
    if model_id == "vision":
        raise HTTPException(
            status_code=400,
            detail={"error": {"message": "Vision model is disabled on the text API.", "type": "invalid_request_error"}}
        )
    available = model_manager.list_available()
    if model_id in available and available[model_id].get("available"):
        info = available[model_id]
        return {
            "id": model_id,
            "object": "model",
            "created": int(time.time()),
            "owned_by": "nivm",
            "permission": [],
            "meta": info
        }
    raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found.")


@router.post("/v1/chat/completions")
@router.post("/api/v1/chat/completions")
async def chat_completions(req: ChatCompletionRequest, background_tasks: BackgroundTasks):
    """
    OpenAI-compatible chat completions endpoint.
    Strictly text-only (vision rejected). Supports streaming & exact token counts.
    """
    # 1. Enforce text-only
    _check_text_only(req.messages)

    # 2. Resolve text role
    role = _resolve_text_role(req.model)

    # 3. Activate target model
    try:
        await asyncio.to_thread(model_manager.activate, role)
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": {"message": f"Failed to load model: {e}"}})

    # Format messages for engine
    raw_messages = []
    prompt_text = ""
    for m in req.messages:
        content_str = m.content if isinstance(m.content, str) else " ".join(
            part.get("text", "") for part in m.content if isinstance(part, dict)
        )
        raw_messages.append({"role": m.role, "content": content_str})
        prompt_text += f" {content_str}"

    # Calculate exact prompt tokens with local tokenizer
    prompt_tokens = len(model_manager.tokenize(prompt_text, role=role))
    completion_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    created_ts = int(time.time())
    active_info = model_manager.get_active_info()
    model_name = active_info.get("name", role)

    if req.stream:
        def sse_generator():
            record_api_start()
            start_time = time.time()
            completion_tokens = 0
            full_content = ""

            try:
                # First chunk with role
                first_chunk = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created_ts,
                    "model": model_name,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"role": "assistant", "content": ""},
                            "finish_reason": None
                        }
                    ]
                }
                yield f"data: {json.dumps(first_chunk)}\n\n"

                # Stream token chunks
                for chunk in model_manager.generate(
                    raw_messages,
                    max_tokens=req.max_tokens,
                    temperature=req.temperature,
                    top_p=req.top_p,
                    stream=True
                ):
                    choices = chunk.get("choices", [])
                    if choices:
                        delta = choices[0].get("delta", {})
                        content_piece = delta.get("content", "")
                        if content_piece:
                            full_content += content_piece
                            chunk_payload = {
                                "id": completion_id,
                                "object": "chat.completion.chunk",
                                "created": created_ts,
                                "model": model_name,
                                "choices": [
                                    {
                                        "index": 0,
                                        "delta": {"content": content_piece},
                                        "finish_reason": None
                                    }
                                ]
                            }
                            yield f"data: {json.dumps(chunk_payload)}\n\n"

                # Calculate exact completion tokens
                raw_toks = model_manager.tokenize(full_content, role=role)
                completion_tokens = len(raw_toks) if raw_toks else max(1, len(full_content) // 4)
                elapsed = time.time() - start_time
                tk_s = round(completion_tokens / elapsed, 1) if elapsed > 0 else 0

                # Final stop chunk with usage & raw tokens
                stop_chunk = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created_ts,
                    "model": model_name,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {},
                            "finish_reason": "stop"
                        }
                    ],
                    "usage": {
                        "prompt_tokens": prompt_tokens,
                        "completion_tokens": completion_tokens,
                        "total_tokens": prompt_tokens + completion_tokens,
                        "tk_s": tk_s,
                        "total_time_s": round(elapsed, 2),
                        "raw_tokens": raw_toks[:2000]
                    }
                }
                yield f"data: {json.dumps(stop_chunk)}\n\n"
                yield "data: [DONE]\n\n"
            except Exception as e:
                err_chunk = {"error": {"message": str(e), "type": "internal_error"}}
                yield f"data: {json.dumps(err_chunk)}\n\n"
            finally:
                record_api_end()

        return StreamingResponse(sse_generator(), media_type="text/event-stream")

    else:
        # Non-streaming
        record_api_start()
        start_time = time.time()
        try:
            res = await asyncio.to_thread(
                model_manager.generate,
                raw_messages,
                req.max_tokens,
                req.temperature,
                req.top_p,
                False
            )
            elapsed = time.time() - start_time
            content = ""
            if isinstance(res, dict) and "choices" in res and res["choices"]:
                content = res["choices"][0].get("message", {}).get("content", "")

            raw_toks = model_manager.tokenize(content, role=role)
            completion_tokens = len(raw_toks) if raw_toks else max(1, len(content) // 4)
            tk_s = round(completion_tokens / elapsed, 1) if elapsed > 0 else 0

            return JSONResponse({
                "id": completion_id,
                "object": "chat.completion",
                "created": created_ts,
                "model": model_name,
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": content
                        },
                        "finish_reason": "stop"
                    }
                ],
                "usage": {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": prompt_tokens + completion_tokens,
                    "tk_s": tk_s,
                    "total_time_s": round(elapsed, 2),
                    "raw_tokens": raw_toks[:2000]
                }
            })
        except Exception as e:
            raise HTTPException(status_code=500, detail={"error": {"message": str(e)}})
        finally:
            record_api_end()


@router.post("/v1/completions")
@router.post("/api/v1/completions")
async def completions(req: CompletionRequest):
    """OpenAI-compatible legacy completions endpoint (text only)."""
    record_api_start()
    role = _resolve_text_role(req.model)
    try:
        await asyncio.to_thread(model_manager.activate, role)
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": {"message": f"Failed to load model: {e}"}})

    prompt_str = req.prompt if isinstance(req.prompt, str) else "\n".join(req.prompt)
    prompt_tokens = len(model_manager.tokenize(prompt_str, role=role))
    created_ts = int(time.time())
    completion_id = f"cmpl-{uuid.uuid4().hex[:12]}"
    active_info = model_manager.get_active_info()
    model_name = active_info.get("name", role)

    # Convert prompt into standard single user message for chat completion engine
    messages = [{"role": "user", "content": prompt_str}]
    start_time = time.time()
    try:
        res = await asyncio.to_thread(
            model_manager.generate,
            messages,
            req.max_tokens,
            req.temperature,
            req.top_p,
            False
        )
        elapsed = time.time() - start_time
        content = ""
        if isinstance(res, dict) and "choices" in res and res["choices"]:
            content = res["choices"][0].get("message", {}).get("content", "")

        raw_toks = model_manager.tokenize(content, role=role)
        completion_tokens = len(raw_toks) if raw_toks else max(1, len(content) // 4)
        tk_s = round(completion_tokens / elapsed, 1) if elapsed > 0 else 0

        return JSONResponse({
            "id": completion_id,
            "object": "text_completion",
            "created": created_ts,
            "model": model_name,
            "choices": [
                {
                    "text": content,
                    "index": 0,
                    "logprobs": None,
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
                "tk_s": tk_s,
                "total_time_s": round(elapsed, 2),
                "raw_tokens": raw_toks[:2000]
            }
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": {"message": str(e)}})
    finally:
        record_api_end()


@router.post("/v1/tokenize")
@router.post("/api/tokenize")
async def tokenize_endpoint(req: TokenizeRequest):
    """
    Raw token inspection endpoint.
    Returns exact token IDs, token pieces, and count using the local model's tokenizer.
    """
    role = req.role or req.model
    if not role or role == "vision":
        from main import get_user_settings, _apply_all_overrides
        _apply_all_overrides()
        settings = get_user_settings()
        role = settings.get("single_model_role", "coder")
        if role == "vision":
            role = "coder" if model_manager.get_model_path("coder") else "custom"

    tokens = model_manager.tokenize(req.text, role=role)
    pieces = model_manager.get_token_pieces(tokens, role=role)
    active_info = model_manager.get_active_info()

    return {
        "tokens": tokens,
        "pieces": pieces,
        "count": len(tokens),
        "model": active_info.get("name", role),
        "role": role
    }


@router.post("/v1/detokenize")
@router.post("/api/detokenize")
async def detokenize_endpoint(req: DetokenizeRequest):
    """
    Raw token decode endpoint.
    Decodes token IDs back into string text using the local model.
    """
    role = req.role or req.model
    if not role or role == "vision":
        from main import get_user_settings, _apply_all_overrides
        _apply_all_overrides()
        settings = get_user_settings()
        role = settings.get("single_model_role", "coder")
        if role == "vision":
            role = "coder" if model_manager.get_model_path("coder") else "custom"

    text = model_manager.detokenize(req.tokens, role=role)
    active_info = model_manager.get_active_info()

    return {
        "text": text,
        "count": len(req.tokens),
        "model": active_info.get("name", role),
        "role": role
    }

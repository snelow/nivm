"""
Background Chat Generation & Persistence Manager for nivm.

Enables robust generation tasks that continue running in the background if the user
closes the tab, refreshes, or locks their mobile screen. Automatically persists
completed responses to User files/chats.json on disk.
"""

import asyncio
import json
import logging
import os
import time
from typing import Dict, List, Optional, Any
import httpx

from core.config import CHATS_FILE
from core.engine import model_manager
from core.network_monitor import record_api_start, record_api_end
from core.router import get_resident_role

logger = logging.getLogger("nivm.chat_manager")


def _calc_tokens(c) -> int:
    """Helper to estimate token count from string or multimodal message content."""
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


def save_assistant_message_to_chat(chat_id: str, assistant_msg: dict) -> bool:
    """
    Directly and atomically updates or appends the assistant message
    to the conversation in chats.json on disk.
    """
    if not chat_id or not os.path.exists(CHATS_FILE):
        return False

    try:
        with open(CHATS_FILE, "r", encoding="utf-8") as f:
            chats = json.load(f)

        if not isinstance(chats, list):
            return False

        updated = False
        for chat in chats:
            if chat.get("id") == chat_id:
                msgs = chat.setdefault("messages", [])
                if msgs and msgs[-1].get("role") == "assistant":
                    msgs[-1] = assistant_msg
                else:
                    msgs.append(assistant_msg)
                updated = True
                break

        if updated:
            tmp_path = f"{CHATS_FILE}.tmp_{int(time.time() * 1000)}"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(chats, f, indent=2, ensure_ascii=False)
            os.replace(tmp_path, CHATS_FILE)
            logger.info(f"Auto-saved background response for chat '{chat_id}'")
            return True
        else:
            logger.warning(f"Chat '{chat_id}' not found in chats.json to auto-save.")
            return False
    except Exception as e:
        logger.error(f"Error auto-saving assistant message for chat '{chat_id}': {e}", exc_info=True)
        return False


class GenerationJob:
    """Represents an active or recently finished generation job."""

    def __init__(self, chat_id: str):
        self.chat_id = chat_id
        self.chunks: List[str] = []
        self.full_text: str = ""
        self.reasoning_text: str = ""
        self.status: str = "generating"  # "generating", "completed", "stopped", "error"
        self.error: Optional[str] = None
        self.meta: Optional[dict] = None
        self.model_info: Optional[dict] = None
        self.start_time: float = time.time()
        self.think_start_time: Optional[float] = None
        self.think_end_time: Optional[float] = None
        self.completed_at: Optional[float] = None
        self.stop_requested: bool = False
        self.task: Optional[asyncio.Task] = None
        self.listeners: List[asyncio.Queue] = []

    def add_listener(self) -> asyncio.Queue:
        """Add a client queue and prime it with all past chunks."""
        q = asyncio.Queue()
        for chunk in self.chunks:
            q.put_nowait(chunk)
        if self.status in ("completed", "stopped", "error"):
            q.put_nowait(None)
        self.listeners.append(q)
        return q

    def remove_listener(self, q: asyncio.Queue):
        """Remove a client queue."""
        if q in self.listeners:
            self.listeners.remove(q)

    def broadcast_chunk(self, chunk_line: str):
        """Buffer chunk and broadcast to all listening client queues."""
        self.chunks.append(chunk_line)
        for q in list(self.listeners):
            try:
                q.put_nowait(chunk_line)
            except Exception:
                pass

    def request_stop(self):
        """Flag stop requested and cancel task if active."""
        self.stop_requested = True
        if self.task and not self.task.done():
            self.task.cancel()

    def finish(self, status: str = "completed", error: Optional[str] = None, meta: Optional[dict] = None):
        """Seal generation job and notify all listeners."""
        self.status = status
        self.error = error
        self.meta = meta
        self.completed_at = time.time()
        for q in list(self.listeners):
            try:
                q.put_nowait(None)
            except Exception:
                pass
        self.listeners.clear()


class ChatGenerationManager:
    """Singleton manager coordinating background chat jobs."""

    def __init__(self):
        self.jobs: Dict[str, GenerationJob] = {}

    def _cleanup_old_jobs(self):
        """Clean up finished jobs older than 10 minutes."""
        now = time.time()
        to_delete = [
            cid for cid, j in self.jobs.items()
            if j.completed_at and (now - j.completed_at > 600)
        ]
        for cid in to_delete:
            del self.jobs[cid]

    def get_job(self, chat_id: str) -> Optional[GenerationJob]:
        self._cleanup_old_jobs()
        return self.jobs.get(chat_id)

    def get_status(self, chat_id: str) -> dict:
        job = self.get_job(chat_id)
        if not job:
            return {"status": "idle", "chat_id": chat_id}
        return {
            "status": job.status,
            "chat_id": chat_id,
            "text": job.full_text,
            "error": job.error,
            "meta": job.meta,
            "duration": round(time.time() - job.start_time, 1)
        }

    def stop_chat(self, chat_id: str) -> dict:
        job = self.get_job(chat_id)
        if job and job.status == "generating":
            job.request_stop()
            # Save whatever partial response exists
            if job.full_text.strip():
                final_content = job.full_text
                if job.reasoning_text and not final_content.startswith("<think>"):
                    final_content = f"<think>{job.reasoning_text}</think>\n\n{final_content}"
                partial_msg = {
                    "role": "assistant",
                    "content": final_content,
                    "meta": {
                        "durationSec": str(round(time.time() - job.start_time, 1)),
                        "estTokens": len(job.full_text.split()),
                        "stopped": True,
                        "modelInfo": job.model_info
                    }
                }
                save_assistant_message_to_chat(chat_id, partial_msg)
            job.finish(status="stopped")
            return {"status": "stopped", "chat_id": chat_id}
        return {"status": "idle", "chat_id": chat_id}

    async def stream_job(self, job: GenerationJob):
        """Async generator yielding chunks to an HTTP SSE response."""
        q = job.add_listener()
        try:
            while True:
                chunk = await q.get()
                if chunk is None:
                    break
                yield chunk
        finally:
            job.remove_listener(q)

    def start_api_job(
        self,
        chat_id: str,
        api_chat_url: str,
        headers: dict,
        payload: dict,
        api_model: str,
        clean_messages: list
    ) -> GenerationJob:
        """Start an external API generation task in the background."""
        self._cleanup_old_jobs()
        # If an existing job is still running for this chat, request stop
        existing = self.jobs.get(chat_id)
        if existing and existing.status == "generating":
            existing.request_stop()

        job = GenerationJob(chat_id)
        job.model_info = {"role": "api", "name": f"API: {api_model}"}
        self.jobs[chat_id] = job

        job.task = asyncio.create_task(
            self._run_api_worker(job, api_chat_url, headers, payload, api_model, clean_messages)
        )
        return job

    async def _run_api_worker(
        self,
        job: GenerationJob,
        api_chat_url: str,
        headers: dict,
        payload: dict,
        api_model: str,
        clean_messages: list
    ):
        start_time = time.time()
        record_api_start()
        try:
            meta_chunk = {
                "object": "chat.completion.chunk",
                "choices": [{"delta": {"content": ""}, "index": 0, "finish_reason": None}],
                "model_info": job.model_info
            }
            job.broadcast_chunk(f"data: {json.dumps(meta_chunk)}\n\n")

            token_count = 0
            async with httpx.AsyncClient(timeout=180.0) as client:
                async with client.stream("POST", api_chat_url, headers=headers, json=payload) as resp:
                    if resp.status_code != 200:
                        err_body = await resp.aread()
                        err_text = err_body.decode("utf-8", errors="replace")
                        logger.error(f"External API error {resp.status_code}: {err_text}")
                        job.broadcast_chunk(f"data: {json.dumps({'error': f'API Error {resp.status_code}: {err_text}'})}\n\n")
                        job.finish(status="error", error=err_text)
                        return

                    async for line in resp.aiter_lines():
                        if job.stop_requested:
                            logger.info(f"Chat {job.chat_id}: API stream stopped by user request.")
                            break
                        if not line:
                            continue
                        line = line.strip()
                        if line.startswith("data:"):
                            data_str = line[5:].strip()
                            if data_str == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data_str)
                                job.broadcast_chunk(f"data: {json.dumps(chunk)}\n\n")
                                if "choices" in chunk and len(chunk["choices"]) > 0:
                                    delta = chunk["choices"][0].get("delta", {})
                                    if "content" in delta and delta["content"]:
                                        job.full_text += delta["content"]
                                        token_count += 1
                                    if "reasoning_content" in delta and delta["reasoning_content"]:
                                        job.reasoning_text += delta["reasoning_content"]
                            except Exception:
                                job.broadcast_chunk(f"{line}\n\n")

            elapsed = time.time() - start_time
            tk_s = token_count / elapsed if elapsed > 0 else 0
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
                "model_info": job.model_info
            }
            job.broadcast_chunk(f"data: {json.dumps(usage_chunk)}\n\n")
            job.broadcast_chunk("data: [DONE]\n\n")

            final_content = job.full_text
            if job.reasoning_text and not final_content.startswith("<think>"):
                final_content = f"<think>{job.reasoning_text}</think>\n\n{final_content}"

            think_time = None
            if "<think>" in final_content and "</think>" in final_content:
                think_time = 0.1

            assistant_msg = {
                "role": "assistant",
                "content": final_content,
                "thinkTime": think_time,
                "meta": {
                    "durationSec": str(round(elapsed, 1)),
                    "estTokens": token_count,
                    "promptTokens": prompt_len,
                    "totalTokens": prompt_len + token_count,
                    "isExact": True,
                    "rawTokens": [],
                    "tkPerSec": str(round(tk_s, 1)),
                    "estCost": f"{(prompt_len + token_count) * 0.000002:.5f}",
                    "modelInfo": job.model_info,
                    "thinkTime": think_time
                }
            }
            save_assistant_message_to_chat(job.chat_id, assistant_msg)
            job.finish(status="completed", meta=assistant_msg["meta"])

        except asyncio.CancelledError:
            logger.info(f"API generation task cancelled for chat {job.chat_id}")
            job.finish(status="stopped")
        except Exception as e:
            logger.error(f"Error in API background task for {job.chat_id}: {e}", exc_info=True)
            job.broadcast_chunk(f"data: {json.dumps({'error': str(e)})}\n\n")
            job.finish(status="error", error=str(e))
        finally:
            record_api_end()

    def start_local_job(
        self,
        chat_id: str,
        routed_to: str,
        model_info: dict,
        swap_time: float,
        messages: list,
        max_tokens: int,
        temperature: float,
        top_p: float,
        repeat_penalty: float,
        inference_mode: str
    ) -> GenerationJob:
        """Start a local engine generation task in the background."""
        self._cleanup_old_jobs()
        existing = self.jobs.get(chat_id)
        if existing and existing.status == "generating":
            existing.request_stop()

        job = GenerationJob(chat_id)
        job.model_info = {
            "role": routed_to,
            "name": model_info["name"],
            "swap_time_s": round(swap_time, 1)
        }
        self.jobs[chat_id] = job

        job.task = asyncio.create_task(
            self._run_local_worker(
                job, routed_to, model_info, swap_time, messages,
                max_tokens, temperature, top_p, repeat_penalty, inference_mode
            )
        )
        return job

    async def _run_local_worker(
        self,
        job: GenerationJob,
        routed_to: str,
        model_info: dict,
        swap_time: float,
        messages: list,
        max_tokens: int,
        temperature: float,
        top_p: float,
        repeat_penalty: float,
        inference_mode: str
    ):
        start_time = time.time()
        try:
            meta_chunk = {
                "object": "chat.completion.chunk",
                "choices": [{"delta": {"content": ""}, "index": 0, "finish_reason": None}],
                "model_info": job.model_info
            }
            job.broadcast_chunk(f"data: {json.dumps(meta_chunk)}\n\n")

            token_count = 0
            loop = asyncio.get_running_loop()

            def sync_generate():
                for chunk in model_manager.generate(
                    messages, max_tokens, temperature, top_p,
                    stream=True, repeat_penalty=repeat_penalty
                ):
                    if job.stop_requested:
                        break
                    loop.call_soon_threadsafe(
                        job.broadcast_chunk, f"data: {json.dumps(chunk)}\n\n"
                    )
                    try:
                        if "choices" in chunk and len(chunk["choices"]) > 0:
                            delta = chunk["choices"][0].get("delta", {})
                            if "content" in delta and delta["content"]:
                                job.full_text += delta["content"]
                            if "reasoning_content" in delta and delta["reasoning_content"]:
                                job.reasoning_text += delta["reasoning_content"]
                    except Exception:
                        pass

            await loop.run_in_executor(None, sync_generate)

            elapsed = time.time() - start_time
            raw_tokens = []
            completion_tokens = len(job.full_text.split())
            prompt_tokens = 0
            try:
                raw_tokens = model_manager.tokenize(job.full_text, role=routed_to)
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
                "model_info": job.model_info
            }
            job.broadcast_chunk(f"data: {json.dumps(usage_chunk)}\n\n")
            job.broadcast_chunk("data: [DONE]\n\n")

            final_content = job.full_text
            if job.reasoning_text and not final_content.startswith("<think>"):
                final_content = f"<think>{job.reasoning_text}</think>\n\n{final_content}"

            think_time = None
            if "<think>" in final_content and "</think>" in final_content:
                think_time = 0.5

            assistant_msg = {
                "role": "assistant",
                "content": final_content,
                "thinkTime": think_time,
                "meta": {
                    "durationSec": str(round(elapsed, 1)),
                    "estTokens": completion_tokens,
                    "promptTokens": prompt_tokens,
                    "totalTokens": prompt_tokens + completion_tokens,
                    "isExact": True,
                    "rawTokens": raw_tokens[:2000] if raw_tokens else [],
                    "tkPerSec": str(round(tk_s, 1)),
                    "estCost": f"{(prompt_tokens + completion_tokens) * 0.000002:.5f}",
                    "modelInfo": job.model_info,
                    "thinkTime": think_time
                }
            }
            save_assistant_message_to_chat(job.chat_id, assistant_msg)
            job.finish(status="completed", meta=assistant_msg["meta"])

        except asyncio.CancelledError:
            logger.info(f"Local generation cancelled for chat {job.chat_id}")
            job.finish(status="stopped")
        except Exception as e:
            logger.error(f"Error in local background task for {job.chat_id}: {e}", exc_info=True)
            job.broadcast_chunk(f"data: {json.dumps({'error': str(e)})}\n\n")
            job.finish(status="error", error=str(e))
        finally:
            if inference_mode == "routing":
                try:
                    await asyncio.to_thread(model_manager.activate, get_resident_role())
                except Exception:
                    pass


# Singleton instance
chat_manager = ChatGenerationManager()

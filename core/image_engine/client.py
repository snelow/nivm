"""
ComfyUI Client for nivm Image Engine.
Submits workflow prompts, tracks WebSocket progress events in real-time,
and saves generated images directly into nivm/User files/images/.
"""

import os
import time
import json
import uuid
import shutil
import logging
import asyncio
from typing import Optional, Dict, Any, Callable, List
import httpx
import websockets
import base64

from .config import (
    COMFY_HOST,
    COMFY_PORT,
    IMAGES_OUTPUT_DIR,
    UPLOADS_DIR,
)
from .daemon import get_api_base_url, is_running, start_daemon

logger = logging.getLogger("nivm.image_engine.client")

NODE_STAGE_NAMES = {
    "19": "Loading VAE...",
    "21": "Loading Qwen2.5-VL text encoder...",
    "22": "Preparing latent canvas...",
    "10": "Encoding positive prompt with Qwen2.5-VL (CPU RAM)...",
    "11": "Encoding negative prompt with Qwen2.5-VL...",
    "17": "Streaming Qwen-Rapid weights to RTX 3050 GPU...",
    "3": "Diffusion denoising on CUDA RTX 3050...",
    "8": "Decoding image with VAE...",
    "9": "Saving generated image...",
}


async def upload_image_to_comfy(file_path: str) -> str:
    """Uploads an image file to ComfyUI's input directory and returns its server filename."""
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"Source image not found: {file_path}")

    base_url = get_api_base_url()
    filename = os.path.basename(file_path)

    async with httpx.AsyncClient(timeout=30.0) as client:
        with open(file_path, "rb") as f:
            files = {"image": (filename, f, "image/png")}
            data = {"overwrite": "true"}
            resp = await client.post(f"{base_url}/upload/image", files=files, data=data)
            if resp.status_code != 200:
                raise RuntimeError(f"ComfyUI upload failed ({resp.status_code}): {resp.text}")
            result = resp.json()
            return result.get("name", filename)


async def execute_image_workflow(
    workflow: Dict[str, Any],
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    timeout_seconds: int = 300,
) -> Dict[str, Any]:
    """
    Submits workflow to ComfyUI, streams progress via WebSocket,
    downloads output image to nivm's images directory, and returns metadata.
    """
    # Ensure daemon is running
    if not is_running():
        started = start_daemon()
        if not started:
            raise RuntimeError("Could not start headless ComfyUI diffusion daemon.")

    client_id = str(uuid.uuid4())
    base_url = get_api_base_url()
    ws_url = f"ws://{COMFY_HOST}:{COMFY_PORT}/ws?clientId={client_id}"

    # Submit prompt
    prompt_id = None
    async with httpx.AsyncClient(timeout=30.0) as client:
        payload = {"prompt": workflow, "client_id": client_id}
        resp = await client.post(f"{base_url}/prompt", json=payload)
        if resp.status_code != 200:
            raise RuntimeError(f"ComfyUI rejected prompt ({resp.status_code}): {resp.text}")
        result = resp.json()
        prompt_id = result.get("prompt_id")
        if not prompt_id:
            raise RuntimeError(f"No prompt_id returned from ComfyUI: {result}")

    logger.info(f"Queued image generation job {prompt_id} (client_id: {client_id})")

    # Connect to WebSocket and monitor progress
    output_images: List[Dict[str, Any]] = []
    current_step = 0
    total_steps = 5

    start_time = time.time()

    try:
        async with websockets.connect(ws_url, ping_interval=10, ping_timeout=20) as ws:
            while time.time() - start_time < timeout_seconds:
                try:
                    msg_text = await asyncio.wait_for(ws.recv(), timeout=5.0)
                except asyncio.TimeoutError:
                    continue

                if isinstance(msg_text, bytes):
                    # Binary preview frame from ComfyUI
                    if len(msg_text) > 8:
                        try:
                            jpeg_idx = msg_text.find(b'\xff\xd8')
                            png_idx = msg_text.find(b'\x89PNG')
                            preview_bytes = None
                            mime = "image/jpeg"
                            if jpeg_idx != -1:
                                preview_bytes = msg_text[jpeg_idx:]
                                mime = "image/jpeg"
                            elif png_idx != -1:
                                preview_bytes = msg_text[png_idx:]
                                mime = "image/png"
                            else:
                                preview_bytes = msg_text[8:]

                            if preview_bytes:
                                preview_b64 = base64.b64encode(preview_bytes).decode("utf-8")
                                preview_data_url = f"data:{mime};base64,{preview_b64}"
                                if progress_callback:
                                    progress_callback({
                                        "status": "generating",
                                        "step": current_step,
                                        "max_steps": total_steps,
                                        "percentage": round((current_step / max(1, total_steps)) * 100),
                                        "time_elapsed": round(time.time() - start_time, 1),
                                        "preview_url": preview_data_url,
                                    })
                        except Exception as prev_err:
                            logger.debug(f"Preview frame decode failed: {prev_err}")
                    continue

                try:
                    event = json.loads(msg_text)
                except Exception:
                    continue

                event_type = event.get("type")
                data = event.get("data", {})

                if event_type == "progress":
                    current_step = data.get("value", current_step)
                    total_steps = data.get("max", total_steps)
                    percent = round((current_step / max(1, total_steps)) * 100)

                    if progress_callback:
                        progress_callback({
                            "status": "generating",
                            "step": current_step,
                            "max_steps": total_steps,
                            "percentage": percent,
                            "time_elapsed": round(time.time() - start_time, 1),
                        })

                elif event_type == "executing":
                    node = data.get("node")
                    # If node is None and prompt_id matches, execution finished
                    if node is None and data.get("prompt_id") == prompt_id:
                        break

                    if node and progress_callback and (data.get("prompt_id") == prompt_id or not data.get("prompt_id")):
                        stage_desc = NODE_STAGE_NAMES.get(str(node), f"Processing stage {node}...")
                        pct = 5 if str(node) in ["1", "2", "3"] else (15 if str(node) in ["4", "5", "6"] else round((current_step / max(1, total_steps)) * 100))
                        progress_callback({
                            "status": "generating",
                            "step": current_step,
                            "max_steps": total_steps,
                            "stage_text": stage_desc,
                            "percentage": pct,
                            "time_elapsed": round(time.time() - start_time, 1),
                        })

                elif event_type == "executed":
                    if data.get("prompt_id") == prompt_id:
                        output = data.get("output", {})
                        if "images" in output:
                            output_images.extend(output["images"])

                elif event_type == "execution_error":
                    if data.get("prompt_id") == prompt_id:
                        err_msg = data.get("exception_message", "Unknown diffusion error")
                        raise RuntimeError(f"ComfyUI diffusion error: {err_msg}")

    except Exception as ws_err:
        logger.warning(f"WebSocket tracking event: {ws_err}")

    # Fallback to check history if WebSocket closed or images not captured
    if not output_images:
        async with httpx.AsyncClient(timeout=15.0) as client:
            hist_resp = await client.get(f"{base_url}/history/{prompt_id}")
            if hist_resp.status_code == 200:
                hist_data = hist_resp.json().get(prompt_id, {})
                outputs = hist_data.get("outputs", {})
                for node_id, node_out in outputs.items():
                    if "images" in node_out:
                        output_images.extend(node_out["images"])

    if not output_images:
        raise RuntimeError("Generation completed but no output images were produced.")

    # Download output image and save to nivm User files/images/
    first_img = output_images[0]
    img_filename = first_img["filename"]
    subfolder = first_img.get("subfolder", "")
    img_type = first_img.get("type", "output")

    timestamp_str = time.strftime("%Y%m%d_%H%M%S")
    saved_filename = f"gen_{timestamp_str}_{uuid.uuid4().hex[:6]}.png"
    target_path = os.path.join(IMAGES_OUTPUT_DIR, saved_filename)

    params = {"filename": img_filename, "type": img_type}
    if subfolder:
        params["subfolder"] = subfolder

    async with httpx.AsyncClient(timeout=30.0) as client:
        view_resp = await client.get(f"{base_url}/view", params=params)
        if view_resp.status_code != 200:
            raise RuntimeError(f"Failed to retrieve output image: {view_resp.status_code}")
        with open(target_path, "wb") as out_f:
            out_f.write(view_resp.content)

    total_duration = round(time.time() - start_time, 1)
    logger.info(f"Image saved successfully to {target_path} in {total_duration}s")

    result_data = {
        "filename": saved_filename,
        "path": target_path,
        "url": f"/images/{saved_filename}",
        "duration_seconds": total_duration,
    }

    if progress_callback:
        progress_callback({
            "status": "complete",
            "step": total_steps,
            "max_steps": total_steps,
            "percentage": 100,
            "time_elapsed": total_duration,
            "filename": saved_filename,
            "url": f"/images/{saved_filename}",
            "image": result_data,
        })

    return result_data

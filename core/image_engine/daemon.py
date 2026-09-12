"""
Headless ComfyUI daemon supervisor for nivm.
Spawns, monitors, and terminates the headless diffusion process silently in the background.
"""

import os
import time
import signal
import logging
import subprocess
from typing import Optional
import httpx

from .config import (
    COMFY_DIR,
    COMFY_HOST,
    COMFY_PORT,
    get_comfy_dir,
    get_comfy_python,
)

logger = logging.getLogger("nivm.image_engine.daemon")

_daemon_process: Optional[subprocess.Popen] = None


def get_api_base_url() -> str:
    return f"http://{COMFY_HOST}:{COMFY_PORT}"


def is_running(timeout: float = 1.0) -> bool:
    """Check if ComfyUI is responding on the configured host/port."""
    try:
        url = f"{get_api_base_url()}/system_stats"
        resp = httpx.get(url, timeout=timeout)
        return resp.status_code == 200
    except Exception:
        return False


def start_daemon(timeout_seconds: int = 60) -> bool:
    """
    Starts ComfyUI in the background in headless mode with optimized low-VRAM flags.
    Blocks until the server responds or timeout occurs.
    """
    global _daemon_process

    if is_running():
        logger.info("ComfyUI daemon is already running.")
        return True

    comfy_dir = get_comfy_dir()
    python_bin = get_comfy_python()
    main_script = os.path.join(comfy_dir, "main.py")

    if not os.path.isfile(main_script):
        logger.error(f"ComfyUI main.py not found at {main_script}")
        return False

    cmd = [
        python_bin,
        main_script,
        "--listen", COMFY_HOST,
        "--port", str(COMFY_PORT),
        "--lowvram",
        "--use-pytorch-cross-attention",
        "--disable-auto-launch",
        "--dont-print-server",
        "--preview-method", "auto",
    ]

    logger.info(f"Launching ComfyUI daemon: {' '.join(cmd)}")
    log_path = os.path.join(comfy_dir, "user", "nivm_daemon.log")
    try:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        log_file = open(log_path, "a")
        _daemon_process = subprocess.Popen(
            cmd,
            cwd=comfy_dir,
            stdout=log_file,
            stderr=log_file,
            preexec_fn=os.setsid,  # create separate process group for clean termination
        )
    except Exception as e:
        logger.error(f"Failed to start ComfyUI daemon: {e}")
        return False

    # Poll until ready
    start_time = time.time()
    while time.time() - start_time < timeout_seconds:
        if is_running(timeout=0.5):
            logger.info("ComfyUI daemon successfully started and healthy.")
            return True
        # Check if process died prematurely
        if _daemon_process.poll() is not None:
            logger.error(f"ComfyUI daemon exited early with code {_daemon_process.returncode}")
            _daemon_process = None
            return False
        time.sleep(0.3)

    logger.error(f"ComfyUI daemon failed to respond within {timeout_seconds}s")
    return False


def stop_daemon():
    """Stops the headless daemon if it was spawned by nivm."""
    global _daemon_process
    if _daemon_process is not None and _daemon_process.poll() is None:
        logger.info("Stopping ComfyUI daemon...")
        try:
            os.killpg(os.getpgid(_daemon_process.pid), signal.SIGTERM)
            _daemon_process.wait(timeout=5)
        except Exception as e:
            logger.warning(f"Error stopping ComfyUI daemon: {e}")
            try:
                os.killpg(os.getpgid(_daemon_process.pid), signal.SIGKILL)
            except Exception:
                pass
        _daemon_process = None

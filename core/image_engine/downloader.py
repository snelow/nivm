"""
Background aria2c installer for Qwen-Rapid Image Studio models.
Downloads missing models sequentially with real-time progress tracking.
"""

import os
import re
import time
import shutil
import logging
import threading
import subprocess
from typing import Dict, Any, List, Optional

from .config import MODEL_DOWNLOAD_URLS
from .model_checker import check_image_models_status

logger = logging.getLogger("nivm.image_engine.downloader")

_download_thread: Optional[threading.Thread] = None
_current_proc: Optional[subprocess.Popen] = None
_download_state: Dict[str, Any] = {
    "status": "idle",       # "idle", "downloading", "completed", "error"
    "current_model": "",
    "target_dir": "",
    "target_path": "",
    "current_index": 0,
    "total_models": 0,
    "percent": 0.0,
    "speed_str": "0 MB/s",
    "downloaded_str": "0 MB",
    "total_str": "0 MB",
    "eta_str": "--",
    "error": "",
}


def find_aria2c() -> Optional[str]:
    found = shutil.which("aria2c")
    if found:
        return found
    candidates = [
        "/usr/bin/aria2c",
        "/usr/local/bin/aria2c",
        os.path.expanduser("~/.local/bin/aria2c"),
    ]
    for c in candidates:
        if os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return None


def get_download_status() -> Dict[str, Any]:
    global _download_state
    status_copy = dict(_download_state)
    status_copy["aria2_available"] = bool(find_aria2c())
    return status_copy


def _run_downloads():
    global _download_state, _current_proc

    aria2c_bin = find_aria2c()
    if not aria2c_bin:
        _download_state["status"] = "error"
        _download_state["error"] = "aria2c executable not found on host machine."
        return

    # Check which models are missing
    model_status = check_image_models_status()
    queue = []
    if not model_status["unet"]["installed"]:
        queue.append(MODEL_DOWNLOAD_URLS["unet"])
    if not model_status["text_encoder"]["installed"]:
        queue.append(MODEL_DOWNLOAD_URLS["text_encoder"])
    if not model_status["vae"]["installed"]:
        queue.append(MODEL_DOWNLOAD_URLS["vae"])

    if not queue:
        _download_state["status"] = "completed"
        _download_state["percent"] = 100.0
        _download_state["current_model"] = "All models already installed"
        return

    _download_state["status"] = "downloading"
    _download_state["total_models"] = len(queue)
    _download_state["error"] = ""

    for idx, item in enumerate(queue):
        _download_state["current_index"] = idx + 1
        _download_state["current_model"] = item["filename"]
        _download_state["percent"] = round((idx / len(queue)) * 100, 1)

        target_dir = item["target_dir"]
        target_filename = item["filename"]
        target_path = os.path.join(target_dir, target_filename)
        url = item["url"]

        _download_state["target_dir"] = target_dir
        _download_state["target_path"] = target_path

        os.makedirs(target_dir, exist_ok=True)

        if os.path.isfile(target_path) and os.path.getsize(target_path) > 1024 * 1024:
            logger.info(f"Skipping {target_filename} (already verified at {target_path})")
            continue

        cmd = [
            aria2c_bin,
            "-x", "16",
            "-s", "16",
            "-j", "4",
            "-k", "1M",
            "--file-allocation=none",
            "--summary-interval=1",
            "--console-log-level=warn",
            "--dir", target_dir,
            "-o", target_filename,
            url,
        ]

        logger.info(f"Starting aria2 download: {target_filename} from {url}")

        try:
            _current_proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )

            # Regex for aria2 output: e.g. [#938492 120MiB/4.7GiB(2%) CN:16 DL:45MiB ETA:1m40s]
            progress_re = re.compile(
                r'\[#\w+\s+([0-9.]+[A-Za-z]+)/([0-9.]+[A-Za-z]+)\(([0-9.]+)%\)\s+.*?DL:([0-9.]+[A-Za-z]+)(?:\s+ETA:([0-9a-zA-Z]+))?\]'
            )

            for line in _current_proc.stdout:
                match = progress_re.search(line)
                if match:
                    downloaded, total, pct, speed, eta = match.groups()
                    sub_pct = float(pct)
                    overall_pct = round(((idx + (sub_pct / 100.0)) / len(queue)) * 100, 1)
                    _download_state["percent"] = overall_pct
                    _download_state["downloaded_str"] = downloaded
                    _download_state["total_str"] = total
                    _download_state["speed_str"] = f"{speed}/s"
                    _download_state["eta_str"] = eta or "--"

            _current_proc.wait()
            if _current_proc.returncode != 0:
                _download_state["status"] = "error"
                _download_state["error"] = f"Download of {target_filename} failed (code {_current_proc.returncode})"
                _current_proc = None
                return

        except Exception as e:
            _download_state["status"] = "error"
            _download_state["error"] = f"Download error: {str(e)}"
            _current_proc = None
            return

    _current_proc = None
    _download_state["status"] = "completed"
    _download_state["percent"] = 100.0
    _download_state["current_model"] = "All image models installed successfully"
    _download_state["speed_str"] = "0 MB/s"
    _download_state["eta_str"] = "0s"


def start_models_download() -> Dict[str, Any]:
    global _download_thread
    if _download_state.get("status") == "downloading":
        return get_download_status()

    _download_thread = threading.Thread(target=_run_downloads, daemon=True)
    _download_thread.start()
    return get_download_status()

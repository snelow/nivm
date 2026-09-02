"""
Model Downloader Manager (Out-of-Process).

Coordinates model downloads in a dedicated, decoupled OS process
to ensure zero memory leak, zero buffer contention, and absolute isolation
from the FastAPI server and LLM inference engine.
"""

import os
import sys
import json
import time
import signal
import shutil
import logging
import subprocess
import urllib.parse
from typing import Optional, Dict, Any

logger = logging.getLogger("model_downloader")

MODELS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "models"))
WORKER_SCRIPT = os.path.abspath(os.path.join(os.path.dirname(__file__), "download_worker.py"))
STATUS_FILE = os.path.abspath(os.path.join(MODELS_DIR, ".download_status.json"))


def find_aria2c() -> Optional[str]:
    """Find aria2c binary from system PATH or python virtualenv."""
    found = shutil.which("aria2c")
    if found:
        return found
    candidates = [
        os.path.join(sys.prefix, "bin", "aria2c"),
        os.path.join(sys.prefix, "Scripts", "aria2c.exe"),
        os.path.expanduser("~/.local/bin/aria2c"),
        "/usr/bin/aria2c",
        "/usr/local/bin/aria2c",
    ]
    for path in candidates:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


def normalize_hf_url(url: str) -> str:
    """Normalize Hugging Face web view URLs into direct file resolve URLs."""
    url = url.strip()
    if "huggingface.co" in url and "/blob/" in url:
        url = url.replace("/blob/", "/resolve/")
    return url


def extract_filename_from_url(url: str) -> str:
    """Extract a safe filename from a download URL."""
    parsed = urllib.parse.urlparse(url)
    path = parsed.path
    name = os.path.basename(path)
    name = name.split("?")[0].strip()
    if not name or not name.lower().endswith(".gguf"):
        name = name + ".gguf" if name else f"model_{int(time.time())}.gguf"
    return name


def format_bytes(num_bytes: float) -> str:
    """Format bytes into human-readable string (KB, MB, GB)."""
    if num_bytes < 1024:
        return f"{num_bytes:.0f} B"
    elif num_bytes < 1024 ** 2:
        return f"{num_bytes / 1024:.1f} KB"
    elif num_bytes < 1024 ** 3:
        return f"{num_bytes / (1024 ** 2):.1f} MB"
    else:
        return f"{num_bytes / (1024 ** 3):.2f} GB"


class ModelDownloader:
    """Manages active GGUF downloads via an isolated child OS process."""

    def __init__(self, download_dir: str = MODELS_DIR):
        self.download_dir = download_dir
        self.status_file = os.path.abspath(os.path.join(self.download_dir, ".download_status.json"))
        os.makedirs(self.download_dir, exist_ok=True)
        self._proc: Optional[subprocess.Popen] = None
        self._last_known_status: Dict[str, Any] = self._default_status()

    def _default_status(self) -> Dict[str, Any]:
        return {
            "status": "idle",
            "engine": "aria2 (isolated)" if find_aria2c() else "streaming (isolated)",
            "url": "",
            "filename": "",
            "path": "",
            "percent": 0.0,
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "downloaded_str": "0 MB",
            "total_str": "Unknown",
            "speed_str": "0 MB/s",
            "eta_str": "--",
            "error": "",
            "aria2_available": bool(find_aria2c()),
        }

    def _read_status_file(self) -> Optional[Dict[str, Any]]:
        """Safely read status JSON from disk."""
        if not os.path.exists(self.status_file):
            return None
        try:
            with open(self.status_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
        return None

    def get_status(self) -> Dict[str, Any]:
        """Poll download progress, speed, ETA, and worker process health."""
        file_status = self._read_status_file()
        if file_status:
            self._last_known_status.update(file_status)

        # Check process liveness
        if self._proc is not None:
            ret = self._proc.poll()
            if ret is not None:
                # Process has terminated
                self._proc = None
                curr_status = self._last_known_status.get("status")
                if curr_status == "downloading":
                    if ret == 0 and os.path.exists(self._last_known_status.get("path", "")):
                        self._last_known_status["status"] = "completed"
                        self._last_known_status["percent"] = 100.0
                    else:
                        self._last_known_status["status"] = "error"
                        self._last_known_status["error"] = f"Downloader process terminated unexpectedly (code {ret})."

        self._last_known_status["aria2_available"] = bool(find_aria2c())
        return self._last_known_status

    def start_download(self, url: str, custom_filename: Optional[str] = None) -> Dict[str, Any]:
        """Start downloading in an isolated, detached OS process."""
        current = self.get_status()
        if current.get("status") == "downloading" and self._proc and self._proc.poll() is None:
            raise RuntimeError("A download is already in progress.")

        clean_url = normalize_hf_url(url)
        filename = custom_filename.strip() if custom_filename else extract_filename_from_url(clean_url)
        if not filename.lower().endswith(".gguf"):
            filename += ".gguf"

        dest_path = os.path.join(self.download_dir, filename)

        # Clean up any leftover status file
        try:
            if os.path.exists(self.status_file):
                os.remove(self.status_file)
        except Exception:
            pass

        self._last_known_status = {
            "status": "downloading",
            "engine": "aria2 (isolated)" if find_aria2c() else "streaming (isolated)",
            "url": clean_url,
            "filename": filename,
            "path": dest_path,
            "percent": 0.0,
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "downloaded_str": "0 MB",
            "total_str": "Unknown",
            "speed_str": "0 MB/s",
            "eta_str": "--",
            "error": "",
            "aria2_available": bool(find_aria2c()),
        }

        # Spawn isolated background OS process in its own session group
        cmd = [
            sys.executable,
            WORKER_SCRIPT,
            "--url", clean_url,
            "--dest-dir", self.download_dir,
            "--filename", filename,
            "--status-file", self.status_file,
        ]

        logger.info(f"Spawning out-of-process downloader: {' '.join(cmd)}")
        self._proc = subprocess.Popen(
            cmd,
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        return self._last_known_status

    def cancel_download(self) -> Dict[str, Any]:
        """Cancel ongoing download by sending SIGTERM to worker process group."""
        if self._proc is not None and self._proc.poll() is None:
            pid = self._proc.pid
            try:
                # Send SIGTERM to entire process group
                pgid = os.getpgid(pid)
                os.killpg(pgid, signal.SIGTERM)
                time.sleep(0.3)
                if self._proc.poll() is None:
                    os.killpg(pgid, signal.SIGKILL)
            except Exception as e:
                logger.warning(f"Error terminating worker process {pid}: {e}")
            finally:
                self._proc = None

        self._last_known_status["status"] = "cancelled"
        self._last_known_status["speed_str"] = "0 MB/s"
        self._last_known_status["eta_str"] = "--"

        # Update disk status file
        try:
            with open(self.status_file, "w", encoding="utf-8") as f:
                json.dump(self._last_known_status, f)
        except Exception:
            pass

        return self._last_known_status


# Global singleton downloader manager
downloader = ModelDownloader()

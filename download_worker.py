"""
Dedicated Out-of-Process Downloader Worker for nivm.

Runs as an independent OS process to completely isolate model downloading
from the main FastAPI server and LLM inference engine. This prevents high network
buffering, dirty page bloat, and memory exhaustion from crashing the server.
"""

import os
import re
import sys
import json
import time
import shutil
import signal
import logging
import argparse
import subprocess
import urllib.parse
import urllib.request
from typing import Optional, Dict, Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [download_worker] %(message)s"
)
logger = logging.getLogger("download_worker")


def set_process_priority():
    """Lower process priority so background download doesn't starve the engine."""
    try:
        if hasattr(os, "nice"):
            os.nice(10)
    except Exception as e:
        logger.debug(f"Could not set nice level: {e}")


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


def atomic_write_status(status_file: str, data: Dict[str, Any]):
    """Atomically write JSON status dictionary to disk via temp file swap."""
    tmp_file = f"{status_file}.tmp.{os.getpid()}"
    try:
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_file, status_file)
    except Exception as e:
        logger.warning(f"Failed to write status file: {e}")
        if os.path.exists(tmp_file):
            try:
                os.remove(tmp_file)
            except Exception:
                pass


class WorkerDownloader:
    def __init__(self, url: str, dest_dir: str, filename: str, status_file: str):
        self.url = url
        self.dest_dir = dest_dir
        self.filename = filename
        self.status_file = status_file
        self.dest_path = os.path.join(dest_dir, filename)
        self.aria2_bin = find_aria2c()
        self.engine = "aria2 (isolated)" if self.aria2_bin else "streaming (isolated)"

        self.cancelled = False
        self.subproc: Optional[subprocess.Popen] = None

        self.status_data = {
            "pid": os.getpid(),
            "status": "downloading",
            "engine": self.engine,
            "url": self.url,
            "filename": self.filename,
            "path": self.dest_path,
            "percent": 0.0,
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "downloaded_str": "0 MB",
            "total_str": "Unknown",
            "speed_str": "0 MB/s",
            "eta_str": "--",
            "error": "",
            "aria2_available": bool(self.aria2_bin),
        }

        # Register termination signal handlers
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

    def _handle_signal(self, signum, frame):
        logger.info(f"Worker received signal {signum}, cancelling download...")
        self.cancelled = True
        if self.subproc:
            try:
                self.subproc.terminate()
                self.subproc.kill()
            except Exception:
                pass
        self._cleanup()
        self.status_data["status"] = "cancelled"
        self.status_data["speed_str"] = "0 MB/s"
        self.status_data["eta_str"] = "--"
        atomic_write_status(self.status_file, self.status_data)
        sys.exit(0)

    def _cleanup(self):
        """Clean up partial aria2 metadata or partial file on cancel."""
        aria2_ctrl = self.dest_path + ".aria2"
        if os.path.exists(aria2_ctrl):
            try:
                os.remove(aria2_ctrl)
            except Exception:
                pass
        if self.cancelled and os.path.exists(self.dest_path):
            try:
                os.remove(self.dest_path)
            except Exception:
                pass

    def run(self):
        set_process_priority()
        os.makedirs(self.dest_dir, exist_ok=True)
        atomic_write_status(self.status_file, self.status_data)

        try:
            if self.aria2_bin:
                success = self._run_aria2()
                if not success and not self.cancelled:
                    logger.warning("aria2 failed, attempting graceful fallback to HTTP streaming...")
                    self.engine = "streaming (isolated fallback)"
                    self.status_data["engine"] = self.engine
                    self._run_streaming()
            else:
                self._run_streaming()
        except Exception as e:
            logger.exception(f"Unhandled worker error: {e}")
            self.status_data["status"] = "error"
            self.status_data["error"] = str(e)
            atomic_write_status(self.status_file, self.status_data)
        finally:
            self._cleanup()

    def _run_aria2(self) -> bool:
        """
        Run aria2 with memory safeguards:
        - 4 parallel connections instead of 16 to avoid socket buffer bloat
        - --file-allocation=falloc to instantly allocate blocks without dirty-page RAM bloat
        - --disk-cache=16M to strictly bound memory usage
        """
        logger.info(f"Launching aria2c worker: {self.url} -> {self.dest_path}")
        
        cmd = [
            self.aria2_bin,
            "-x", "4",
            "-s", "4",
            "-k", "1M",
            "--file-allocation=falloc",
            "--disk-cache=16M",
            "--summary-interval=1",
            "--console-log-level=notice",
            "--allow-overwrite=true",
            "--auto-file-renaming=false",
            "-d", self.dest_dir,
            "-o", self.filename,
            self.url
        ]

        try:
            self.subproc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True
            )

            progress_regex = re.compile(
                r'\[#\w+\s+([\d\.]+\w+)/([\d\.]+\w+)\((\d+)%\)\s+CN:\d+\s+DL:([\d\.]+\w+)(?:\s+ETA:([\w\d]+))?'
            )

            last_write = 0
            for line in iter(self.subproc.stdout.readline, ''):
                if self.cancelled:
                    break
                line = line.strip()
                if not line:
                    continue

                match = progress_regex.search(line)
                if match:
                    dl_str, tot_str, pct_str, spd_str, eta_str = match.groups()
                    self.status_data["downloaded_str"] = dl_str
                    self.status_data["total_str"] = tot_str
                    self.status_data["percent"] = float(pct_str)
                    self.status_data["speed_str"] = spd_str + "/s"
                    self.status_data["eta_str"] = eta_str if eta_str else "--"

                    now = time.time()
                    if now - last_write >= 0.5:
                        atomic_write_status(self.status_file, self.status_data)
                        last_write = now

            self.subproc.wait()
            ret = self.subproc.returncode

            if self.cancelled:
                self.status_data["status"] = "cancelled"
                atomic_write_status(self.status_file, self.status_data)
                return False

            if ret == 0 and os.path.exists(self.dest_path):
                size = os.path.getsize(self.dest_path)
                self.status_data["status"] = "completed"
                self.status_data["percent"] = 100.0
                self.status_data["speed_str"] = "0 MB/s"
                self.status_data["eta_str"] = "Complete"
                self.status_data["downloaded_str"] = format_bytes(size)
                self.status_data["total_str"] = format_bytes(size)
                self.status_data["downloaded_bytes"] = size
                self.status_data["total_bytes"] = size
                atomic_write_status(self.status_file, self.status_data)
                logger.info(f"aria2c download completed successfully: {self.dest_path} ({size} bytes)")
                return True
            else:
                logger.warning(f"aria2c exited with code {ret}")
                return False

        except Exception as e:
            logger.error(f"Error running aria2c: {e}")
            return False

    def _run_streaming(self):
        """
        Streaming chunked HTTP download with kernel page cache eviction (posix_fadvise)
        to guarantee minimal resident set size (RSS < 25MB) even for 20GB+ models.
        """
        logger.info(f"Starting memory-guarded streaming download for {self.url}")
        req = urllib.request.Request(
            self.url,
            headers={"User-Agent": "Mozilla/5.0 nivm-isolated-downloader"}
        )

        with urllib.request.urlopen(req) as resp, open(self.dest_path, "wb") as f:
            content_len = resp.headers.get("Content-Length")
            total = int(content_len) if content_len and content_len.isdigit() else 0
            self.status_data["total_bytes"] = total
            self.status_data["total_str"] = format_bytes(total) if total > 0 else "Unknown"
            atomic_write_status(self.status_file, self.status_data)

            downloaded = 0
            start_time = time.time()
            last_update = start_time
            bytes_since_fadvise = 0
            fd = f.fileno()

            chunk_size = 256 * 1024  # 256KB chunks
            while True:
                if self.cancelled:
                    break

                chunk = resp.read(chunk_size)
                if not chunk:
                    break

                f.write(chunk)
                downloaded += len(chunk)
                bytes_since_fadvise += len(chunk)

                # Every 16MB written, inform Linux kernel to drop pages from RAM cache
                if bytes_since_fadvise >= 16 * 1024 * 1024:
                    f.flush()
                    if hasattr(os, "posix_fadvise") and hasattr(os, "POSIX_FADV_DONTNEED"):
                        try:
                            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
                        except Exception:
                            pass
                    bytes_since_fadvise = 0

                now = time.time()
                if now - last_update >= 0.5:
                    elapsed = now - start_time
                    speed = downloaded / elapsed if elapsed > 0 else 0
                    pct = (downloaded / total * 100.0) if total > 0 else 0.0
                    eta = (total - downloaded) / speed if (total > 0 and speed > 0) else 0

                    self.status_data["downloaded_bytes"] = downloaded
                    self.status_data["downloaded_str"] = format_bytes(downloaded)
                    self.status_data["percent"] = round(pct, 1)
                    self.status_data["speed_str"] = f"{format_bytes(speed)}/s"
                    self.status_data["eta_str"] = f"{int(eta)}s" if eta > 0 else "--"
                    atomic_write_status(self.status_file, self.status_data)
                    last_update = now

        if self.cancelled:
            self.status_data["status"] = "cancelled"
            atomic_write_status(self.status_file, self.status_data)
            return

        size = os.path.getsize(self.dest_path) if os.path.exists(self.dest_path) else 0
        self.status_data["status"] = "completed"
        self.status_data["percent"] = 100.0
        self.status_data["speed_str"] = "0 MB/s"
        self.status_data["eta_str"] = "Complete"
        self.status_data["downloaded_str"] = format_bytes(size)
        self.status_data["total_str"] = format_bytes(size)
        self.status_data["downloaded_bytes"] = size
        self.status_data["total_bytes"] = size
        atomic_write_status(self.status_file, self.status_data)
        logger.info(f"Streaming download completed: {self.dest_path} ({size} bytes)")


def main():
    parser = argparse.ArgumentParser(description="nivm isolated download worker")
    parser.add_argument("--url", required=True, help="Download URL")
    parser.add_argument("--dest-dir", required=True, help="Destination directory")
    parser.add_argument("--filename", required=True, help="Target filename")
    parser.add_argument("--status-file", required=True, help="Path to status JSON file")

    args = parser.parse_args()
    worker = WorkerDownloader(
        url=args.url,
        dest_dir=args.dest_dir,
        filename=args.filename,
        status_file=args.status_file
    )
    worker.run()


if __name__ == "__main__":
    main()

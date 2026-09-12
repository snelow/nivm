"""
ComfyUI Environment Detection & Auto-Setup Helper.
Finds existing ComfyUI installations, allows setting custom paths,
and provides automated setup for fresh systems.
"""

import os
import sys
import shutil
import logging
import subprocess
import threading
from typing import Dict, Any, Optional, List

from .config import BASE_DIR, get_comfy_python
from ..storage import get_user_settings, save_user_settings

logger = logging.getLogger("nivm.image_engine.setup_helper")

_setup_state = {
    "status": "idle",       # "idle", "installing", "completed", "error"
    "progress_message": "",
    "error": "",
}


def get_candidate_comfy_paths() -> List[str]:
    """Returns candidate directories to search for an existing ComfyUI install."""
    settings = get_user_settings()
    custom_dir = settings.get("comfy_dir", "").strip()

    candidates = []
    if custom_dir:
        candidates.append(os.path.abspath(custom_dir))

    env_dir = os.getenv("COMFY_DIR", "").strip()
    if env_dir:
        candidates.append(os.path.abspath(env_dir))

    # Standard default paths
    candidates.extend([
        os.path.expanduser("~/ComfyUI"),
        "/home/blubvlub/ComfyUI",
        os.path.join(BASE_DIR, "engine", "ComfyUI"),
        os.path.expanduser("~/.local/share/nivm/ComfyUI"),
        "/opt/ComfyUI",
    ])

    # De-duplicate while preserving order
    seen = set()
    unique = []
    for c in candidates:
        norm = os.path.normpath(c)
        if norm not in seen:
            seen.add(norm)
            unique.append(norm)
    return unique


def detect_comfyui() -> Dict[str, Any]:
    """
    Checks if a valid ComfyUI installation exists and returns details.
    """
    for path in get_candidate_comfy_paths():
        main_py = os.path.join(path, "main.py")
        if os.path.isfile(main_py):
            # Verify if custom nodes ComfyUI-GGUF or venv exists
            has_gguf = os.path.isdir(os.path.join(path, "custom_nodes", "ComfyUI-GGUF"))
            python_candidates = [
                os.path.join(path, "venv312", "bin", "python"),
                os.path.join(path, "venv", "bin", "python"),
                os.path.join(path, ".venv", "bin", "python"),
                sys.executable,
            ]
            valid_python = None
            for py in python_candidates:
                if os.path.isfile(py) and os.access(py, os.X_OK):
                    valid_python = py
                    break

            return {
                "detected": True,
                "path": path,
                "main_py": main_py,
                "python_bin": valid_python or sys.executable,
                "has_gguf_nodes": has_gguf,
            }

    return {
        "detected": False,
        "path": None,
        "main_py": None,
        "python_bin": None,
        "has_gguf_nodes": False,
    }


def set_custom_comfy_path(path: str) -> Dict[str, Any]:
    """Saves user's custom ComfyUI directory to settings.json."""
    clean = os.path.abspath(os.path.expanduser(path.strip()))
    main_py = os.path.join(clean, "main.py")
    if not os.path.isfile(main_py):
        raise ValueError(f"No ComfyUI main.py found inside '{clean}'")

    settings = get_user_settings()
    settings["comfy_dir"] = clean
    save_user_settings(settings)
    return detect_comfyui()


_setup_state = {
    "status": "idle",       # "idle", "installing", "completed", "error"
    "step": 0,
    "total_steps": 3,
    "step_name": "",
    "target_dir": os.path.join(BASE_DIR, "engine", "ComfyUI"),
    "current_command": "",
    "progress_message": "",
    "percent": 0,
    "log_lines": [],
    "error": "",
}


def get_setup_status() -> Dict[str, Any]:
    global _setup_state
    info = detect_comfyui()
    res = dict(_setup_state)
    res["comfyui"] = info
    return res


def _run_streaming_cmd(cmd: List[str], step_num: int, step_title: str, base_pct: int, end_pct: int, log_fn):
    global _setup_state
    _setup_state["step"] = step_num
    _setup_state["step_name"] = step_title
    _setup_state["percent"] = base_pct
    cmd_str = " ".join(cmd)
    _setup_state["current_command"] = cmd_str
    log_fn(f"[{step_num}/3] {step_title} (Running: {cmd_str})")

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    line_count = 0
    for line in proc.stdout:
        line_clean = line.strip()
        if line_clean:
            line_count += 1
            log_fn(line_clean)
            # Smoothly interpolate percent
            step_progress = min(1.0, line_count / 40.0)
            _setup_state["percent"] = int(base_pct + step_progress * (end_pct - base_pct))

    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"Command '{cmd[0]}' failed with exit code {proc.returncode}")


def _run_auto_setup():
    global _setup_state
    target_dir = os.path.join(BASE_DIR, "engine", "ComfyUI")
    _setup_state["status"] = "installing"
    _setup_state["step"] = 1
    _setup_state["total_steps"] = 3
    _setup_state["target_dir"] = target_dir
    _setup_state["percent"] = 5
    _setup_state["error"] = ""
    _setup_state["log_lines"] = []
    _setup_state["progress_message"] = f"Initializing setup in {target_dir}..."

    os.makedirs(os.path.dirname(target_dir), exist_ok=True)

    def log(msg: str):
        logger.info(msg)
        _setup_state["progress_message"] = msg
        _setup_state["log_lines"].append(msg)
        if len(_setup_state["log_lines"]) > 100:
            _setup_state["log_lines"].pop(0)

    try:
        log(f"Target installation directory: {target_dir}")

        # Step 1: Clone ComfyUI
        if not os.path.exists(target_dir):
            _run_streaming_cmd(
                ["git", "clone", "--depth=1", "--progress", "https://github.com/comfyanonymous/ComfyUI.git", target_dir],
                step_num=1,
                step_title=f"Cloning ComfyUI repository to {target_dir}",
                base_pct=10,
                end_pct=40,
                log_fn=log
            )
            log(f"✓ ComfyUI cloned successfully to {target_dir}")
        else:
            _setup_state["step"] = 1
            _setup_state["percent"] = 40
            log(f"✓ [Step 1/3] ComfyUI already exists at {target_dir}")

        # Step 2: Clone ComfyUI-GGUF custom node
        gguf_node_dir = os.path.join(target_dir, "custom_nodes", "ComfyUI-GGUF")
        if not os.path.exists(gguf_node_dir):
            _run_streaming_cmd(
                ["git", "clone", "--depth=1", "--progress", "https://github.com/city96/ComfyUI-GGUF.git", gguf_node_dir],
                step_num=2,
                step_title=f"Installing ComfyUI-GGUF custom nodes to {gguf_node_dir}",
                base_pct=45,
                end_pct=65,
                log_fn=log
            )
            log(f"✓ ComfyUI-GGUF custom nodes installed at {gguf_node_dir}")
        else:
            _setup_state["step"] = 2
            _setup_state["percent"] = 65
            log(f"✓ [Step 2/3] ComfyUI-GGUF nodes already present at {gguf_node_dir}")

        # Step 3: Install Python dependencies
        req_file = os.path.join(target_dir, "requirements.txt")
        _run_streaming_cmd(
            [sys.executable, "-m", "pip", "install", "-r", req_file, "gguf"],
            step_num=3,
            step_title="Installing Python diffusion requirements (torch, torchvision, gguf)",
            base_pct=70,
            end_pct=95,
            log_fn=log
        )
        log("✓ Python diffusion dependencies verified & installed successfully.")

        set_custom_comfy_path(target_dir)
        _setup_state["status"] = "completed"
        _setup_state["step"] = 3
        _setup_state["percent"] = 100
        _setup_state["progress_message"] = f"ComfyUI engine setup complete at {target_dir}!"
        log(f"✓ ComfyUI engine setup complete at {target_dir}! Image generation is ready.")

    except Exception as e:
        err_msg = str(e)
        logger.error(f"Auto-setup failed: {err_msg}")
        _setup_state["status"] = "error"
        _setup_state["error"] = err_msg
        log(f"❌ Setup error: {err_msg}")


def start_auto_setup():
    global _setup_state
    if _setup_state["status"] == "installing":
        return get_setup_status()

    t = threading.Thread(target=_run_auto_setup, daemon=True)
    t.start()
    return get_setup_status()

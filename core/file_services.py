"""
Desktop Integration, Native File Pickers & System Tools for nivm.
Provides native OS file dialogs (Zenity, KDialog, Tkinter), directory listing,
file verification, file locator, and secure terminal tool execution.
"""

import os
import shutil
import subprocess
import asyncio
import logging
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel

from .config import BASE_DIR, MODELS_DIR

logger = logging.getLogger("nivm.files")

router = APIRouter(tags=["File Services & Tools"])


# ── Request Models ────────────────────────────────────────────────

class BrowseDialogRequest(BaseModel):
    initial_dir: Optional[str] = None
    title: Optional[str] = "Select GGUF Model File"


class VerifyFileRequest(BaseModel):
    path: str


class ExecuteTerminalRequest(BaseModel):
    command: str


# ── File Dialog & Discovery Endpoints ─────────────────────────────

@router.post("/api/files/browse-dialog")
async def browse_file_dialog_endpoint(req: Optional[BrowseDialogRequest] = None):
    """Open native file dialog on the host system to select a GGUF file."""
    initial_dir = req.initial_dir if req else None
    dialog_title = req.title if req and req.title else "Select GGUF Model File"

    def _run_native_picker():
        # 1. Try zenity (standard on GNOME/GTK Linux)
        if shutil.which("zenity"):
            cmd = [
                "zenity",
                "--file-selection",
                f"--title={dialog_title}",
                "--file-filter=GGUF Model Files (*.gguf) | *.gguf *.GGUF",
                "--file-filter=All Files | *"
            ]
            if initial_dir and os.path.exists(initial_dir):
                target = os.path.abspath(initial_dir)
                if os.path.isdir(target):
                    cmd.append(f"--filename={target}/")
                else:
                    cmd.append(f"--filename={target}")
            else:
                if os.path.exists(MODELS_DIR):
                    cmd.append(f"--filename={MODELS_DIR}/")
                else:
                    cmd.append(f"--filename={os.path.expanduser('~')}/")

            try:
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
                if res.returncode == 0 and res.stdout.strip():
                    selected_path = res.stdout.strip().split("\n")[0]
                    if os.path.exists(selected_path):
                        size_bytes = os.path.getsize(selected_path)
                        return {
                            "success": True,
                            "path": os.path.abspath(selected_path),
                            "filename": os.path.basename(selected_path),
                            "size_gb": round(size_bytes / (1024**3), 2),
                            "size_bytes": size_bytes
                        }
                elif res.returncode == 1:
                    return {"cancelled": True, "success": False}
            except Exception as e:
                logger.warning(f"Zenity picker failed: {e}")

        # 2. Try kdialog (KDE Linux)
        if shutil.which("kdialog"):
            cmd = [
                "kdialog",
                "--getopenfilename",
                initial_dir if (initial_dir and os.path.exists(initial_dir)) else os.path.expanduser("~"),
                "*.gguf *.GGUF|GGUF Models\n*|All Files",
                "--title",
                dialog_title
            ]
            try:
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
                if res.returncode == 0 and res.stdout.strip():
                    selected_path = res.stdout.strip().split("\n")[0]
                    if os.path.exists(selected_path):
                        size_bytes = os.path.getsize(selected_path)
                        return {
                            "success": True,
                            "path": os.path.abspath(selected_path),
                            "filename": os.path.basename(selected_path),
                            "size_gb": round(size_bytes / (1024**3), 2),
                            "size_bytes": size_bytes
                        }
                return {"cancelled": True, "success": False}
            except Exception as e:
                logger.warning(f"Kdialog picker failed: {e}")

        # 3. Try tkinter
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True)
            selected_path = filedialog.askopenfilename(
                title=dialog_title,
                filetypes=[("GGUF Model Files", "*.gguf *.GGUF"), ("All Files", "*.*")],
                initialdir=initial_dir if (initial_dir and os.path.exists(initial_dir)) else os.path.expanduser("~")
            )
            root.destroy()
            if selected_path and os.path.exists(selected_path):
                size_bytes = os.path.getsize(selected_path)
                return {
                    "success": True,
                    "path": os.path.abspath(selected_path),
                    "filename": os.path.basename(selected_path),
                    "size_gb": round(size_bytes / (1024**3), 2),
                    "size_bytes": size_bytes
                }
            return {"cancelled": True, "success": False}
        except Exception as e:
            logger.warning(f"Tkinter picker failed: {e}")

        return {"error": "No GUI file dialog available on host", "success": False, "fallback": True}

    return await asyncio.to_thread(_run_native_picker)


@router.get("/api/files/list-dir")
async def list_directory_endpoint(path: Optional[str] = None):
    """List subfolders and GGUF files for in-browser directory browsing."""
    def _list_directory():
        target = path.strip() if path and path.strip() else os.path.expanduser("~")
        target = os.path.abspath(target)
        if not os.path.exists(target) or not os.path.isdir(target):
            target = os.path.expanduser("~")

        parent = os.path.dirname(target) if target != "/" else None

        folders = []
        files = []

        try:
            with os.scandir(target) as it:
                for entry in it:
                    if entry.name.startswith("."):
                        continue
                    try:
                        if entry.is_dir(follow_symlinks=True):
                            folders.append({
                                "name": entry.name,
                                "path": os.path.abspath(entry.path)
                            })
                        elif entry.is_file(follow_symlinks=True):
                            is_gguf = entry.name.lower().endswith(".gguf")
                            stat = entry.stat()
                            size_bytes = stat.st_size
                            files.append({
                                "name": entry.name,
                                "path": os.path.abspath(entry.path),
                                "is_gguf": is_gguf,
                                "size_gb": round(size_bytes / (1024**3), 2),
                                "size_mb": round(size_bytes / (1024**2), 1),
                                "modified": stat.st_mtime
                            })
                    except (PermissionError, OSError):
                        continue
        except Exception as e:
            return {
                "error": str(e),
                "current_path": target,
                "parent_path": parent,
                "folders": [],
                "files": [],
                "shortcuts": []
            }

        folders.sort(key=lambda x: x["name"].lower())
        files.sort(key=lambda x: (not x["is_gguf"], x["name"].lower()))

        home_dir = os.path.expanduser("~")
        downloads_dir = os.path.join(home_dir, "Downloads")
        desktop_dir = os.path.join(home_dir, "Desktop")

        shortcuts = [
            {"name": "Models Dir", "path": MODELS_DIR, "icon": "fa-cube"},
            {"name": "Home", "path": home_dir, "icon": "fa-house"},
        ]
        if os.path.exists(downloads_dir):
            shortcuts.append({"name": "Downloads", "path": downloads_dir, "icon": "fa-download"})
        if os.path.exists(desktop_dir):
            shortcuts.append({"name": "Desktop", "path": desktop_dir, "icon": "fa-desktop"})
        shortcuts.append({"name": "Root (/)", "path": "/", "icon": "fa-hard-drive"})

        return {
            "current_path": target,
            "parent_path": parent,
            "folders": folders,
            "files": files,
            "shortcuts": shortcuts
        }

    return await asyncio.to_thread(_list_directory)


@router.post("/api/files/verify")
async def verify_file_endpoint(req: VerifyFileRequest):
    """Verify if a specific file exists on the host system and get its size."""
    raw_path = req.path.strip()
    if not raw_path:
        return {"exists": False, "error": "Empty path"}

    p = os.path.abspath(os.path.expanduser(raw_path))
    if os.path.isfile(p):
        size_bytes = os.path.getsize(p)
        return {
            "exists": True,
            "path": p,
            "filename": os.path.basename(p),
            "is_gguf": p.lower().endswith(".gguf"),
            "size_bytes": size_bytes,
            "size_gb": round(size_bytes / (1024**3), 2)
        }
    elif os.path.isdir(p):
        return {"exists": False, "is_directory": True, "error": "Path is a directory, not a file"}
    else:
        return {"exists": False, "error": "File does not exist"}


@router.get("/api/files/locate")
async def locate_file_endpoint(filename: str, size: Optional[int] = None):
    """Attempt to locate a file on the local host by name (e.g. from browser file picker)."""
    if not filename or not filename.strip():
        return {"found": False}

    fname = os.path.basename(filename.strip())
    home = os.path.expanduser("~")
    search_dirs = [
        MODELS_DIR,
        os.path.join(home, "Downloads"),
        os.path.join(home, "Desktop"),
        os.path.join(home, "models"),
        os.path.join(home, ".cache", "lm-studio", "models"),
        os.path.join(home, ".cache", "huggingface", "hub"),
        os.path.join(home, ".ollama", "models"),
        home,
    ]

    for d in search_dirs:
        if not os.path.exists(d) or not os.path.isdir(d):
            continue
        direct = os.path.join(d, fname)
        if os.path.isfile(direct):
            sb = os.path.getsize(direct)
            return {
                "found": True,
                "path": os.path.abspath(direct),
                "filename": fname,
                "size_gb": round(sb / (1024**3), 2)
            }
        try:
            for root, _, files in os.walk(d):
                if fname in files:
                    full = os.path.join(root, fname)
                    if os.path.isfile(full):
                        sb = os.path.getsize(full)
                        return {
                            "found": True,
                            "path": os.path.abspath(full),
                            "filename": fname,
                            "size_gb": round(sb / (1024**3), 2)
                        }
                if d == home and root != home:
                    break
        except Exception:
            continue

    return {"found": False}


# ── Tool Execution Endpoint ───────────────────────────────────────

@router.post("/api/tools/execute_terminal")
async def execute_terminal(req: ExecuteTerminalRequest):
    """Execute a shell command securely and return its output."""
    cmd = req.command.strip()
    logger.info(f"[Terminal Tool] Executing: {cmd}")
    try:
        def run_cmd():
            return subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=15,
                cwd=BASE_DIR
            )

        result = await asyncio.to_thread(run_cmd)

        output = result.stdout
        if result.stderr:
            output += f"\n[STDERR]\n{result.stderr}"

        if not output.strip():
            output = "[Command executed successfully with no output]"

        return {"output": output}
    except subprocess.TimeoutExpired:
        return {"error": "Command execution timed out after 15 seconds."}
    except Exception as e:
        return {"error": f"Execution failed: {str(e)}"}

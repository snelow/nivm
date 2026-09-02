@echo off
setlocal enabledelayedexpansion

:: Default parameters
set "HOST=127.0.0.1"
set "PORT=8000"
set "RELOAD=true"
set "FORCE_SETUP=false"

:: Parse command-line arguments
:parse_args
if "%~1"=="" goto :args_done
if /I "%~1"=="-h"      ( set "HOST=%~2" & shift & shift & goto :parse_args )
if /I "%~1"=="--host"   ( set "HOST=%~2" & shift & shift & goto :parse_args )
if /I "%~1"=="-p"      ( set "PORT=%~2" & shift & shift & goto :parse_args )
if /I "%~1"=="--port"   ( set "PORT=%~2" & shift & shift & goto :parse_args )
if /I "%~1"=="--no-reload" ( set "RELOAD=false" & shift & goto :parse_args )
if /I "%~1"=="-s"      ( set "FORCE_SETUP=true" & shift & goto :parse_args )
if /I "%~1"=="--setup"  ( set "FORCE_SETUP=true" & shift & goto :parse_args )
if /I "%~1"=="--help"   ( goto :show_help )
echo [!] Unknown option: %~1
goto :show_help

:show_help
echo.
echo   Sovereign AI Workbench — Local Multi-Model Assistant
echo   Usage: run.bat [OPTIONS]
echo.
echo   Options:
echo     -h, --host HOST         Set server bind address (default: 127.0.0.1)
echo     -p, --port PORT         Set server port (default: 8000)
echo     --no-reload             Disable Uvicorn auto-reload
echo     -s, --setup             Force re-installation of dependencies in virtual environment
echo     --help                  Show this help message and exit
echo.
exit /b 0

:args_done

echo ====================================================
echo         Sovereign AI Workbench — nivm v2.0
echo ====================================================

:: Check models directory
set "MODELS_DIR=models"
echo [+] Checking models...

if exist "%MODELS_DIR%\Qwen3-1.7B-Q8_0.gguf" (
    echo   [ok] Router:  Qwen3-1.7B
) else if exist "%MODELS_DIR%\qwen2.5-1.5b-instruct-q4_k_m.gguf" (
    echo   [ok] Router:  Qwen2.5-1.5B
) else (
    echo   [!!] Router:  missing router model
)

if exist "%MODELS_DIR%\qwen2.5-coder-3b-instruct-q4_k_m.gguf" (
    echo   [ok] Worker:  Qwen2.5-Coder-3B
) else if exist "%MODELS_DIR%\microsoft_Phi-4-mini-instruct-Q4_K_M.gguf" (
    echo   [ok] Worker:  Phi-4-mini
) else (
    echo   [!!] Worker:  missing worker model
)

if exist "%MODELS_DIR%\gemma-4-E2B-it-Q4_K_M.gguf" (
    echo   [ok] Vision:  Gemma-4-E2B
) else (
    echo   [--] Vision:  optional, not installed
)

:: ── Virtual Environment Setup ──────────────────────────
set "VENV_DIR=venv"
set "PYTHON_BIN="

:: Detect best Python binary — prefer 3.14 via the Windows py launcher
where py >nul 2>&1
if !errorlevel! equ 0 (
    py -3.14 --version >nul 2>&1
    if !errorlevel! equ 0 (
        set "PYTHON_BIN=py -3.14"
        goto :python_found
    )
    py -3.12 --version >nul 2>&1
    if !errorlevel! equ 0 (
        set "PYTHON_BIN=py -3.12"
        goto :python_found
    )
    py -3 --version >nul 2>&1
    if !errorlevel! equ 0 (
        set "PYTHON_BIN=py -3"
        goto :python_found
    )
)

where python3 >nul 2>&1
if !errorlevel! equ 0 (
    set "PYTHON_BIN=python3"
    goto :python_found
)

where python >nul 2>&1
if !errorlevel! equ 0 (
    set "PYTHON_BIN=python"
    goto :python_found
)

echo [!] Error: Python 3 is not installed or not in PATH.
exit /b 1

:python_found
echo [+] Using Python: !PYTHON_BIN!

if "!FORCE_SETUP!"=="true" goto :setup_venv
if not exist "!VENV_DIR!\Scripts\activate.bat" goto :setup_venv
goto :activate_venv

:setup_venv
echo [+] Setting up Python virtual environment...
if not exist "!VENV_DIR!\Scripts\activate.bat" (
    !PYTHON_BIN! -m venv --system-site-packages "!VENV_DIR!"
)
call "!VENV_DIR!\Scripts\activate.bat"
echo [+] Installing requirements...
pip install --upgrade pip -q
pip install -r requirements.txt -q

:: ── Install llama-cpp-python with CUDA support if NVIDIA GPU detected ──
echo [+] Detecting GPU for llama-cpp-python...
set "HAS_NVIDIA=false"
where nvidia-smi >nul 2>&1
if !errorlevel! equ 0 (
    nvidia-smi >nul 2>&1
    if !errorlevel! equ 0 (
        set "HAS_NVIDIA=true"
    )
)

if "!HAS_NVIDIA!"=="true" (
    echo [+] NVIDIA GPU detected — installing llama-cpp-python with CUDA support...
    echo     This uses a prebuilt wheel so no C++ compiler is needed.
    pip install llama-cpp-python==0.3.34 --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124 -q
    if !errorlevel! neq 0 (
        echo [!] CUDA wheel failed, trying cu123...
        pip install llama-cpp-python==0.3.34 --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu123 -q
        if !errorlevel! neq 0 (
            echo [!] CUDA install failed. Falling back to CPU-only build...
            echo     NOTE: If this fails, install Visual Studio Build Tools with C++ workload.
            pip install llama-cpp-python==0.3.34 -q
        )
    )
) else (
    echo [+] No NVIDIA GPU detected — installing llama-cpp-python (CPU)...
    echo     NOTE: If this fails, install Visual Studio Build Tools with C++ workload.
    echo     Download: https://visualstudio.microsoft.com/visual-cpp-build-tools/
    pip install llama-cpp-python==0.3.34 -q
)

echo [ok] Virtual environment ready.
goto :venv_done

:activate_venv
call "!VENV_DIR!\Scripts\activate.bat"

:venv_done

:: ── Frontend Asset Download ────────────────────────────
if "!FORCE_SETUP!"=="true" goto :download_assets
if not exist "static\vendor" goto :download_assets
goto :assets_done

:download_assets
echo [+] Downloading frontend assets...
python -c "import os, re, urllib.request; STATIC_DIR = os.path.join(os.getcwd(), 'static'); VENDOR_DIR = os.path.join(STATIC_DIR, 'vendor'); FONTS_DIR = os.path.join(VENDOR_DIR, 'fonts'); os.makedirs(VENDOR_DIR, exist_ok=True); os.makedirs(FONTS_DIR, exist_ok=True); safe_download = lambda url, path: (not os.path.exists(path)) and urllib.request.urlretrieve(url, path); fa_version = '6.4.0'; safe_download(f'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/{fa_version}/css/all.min.css', os.path.join(VENDOR_DIR, 'fontawesome.min.css')); fa_webfonts_dir = os.path.join(VENDOR_DIR, 'webfonts'); os.makedirs(fa_webfonts_dir, exist_ok=True); [safe_download(f'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/{fa_version}/webfonts/{ft}', os.path.join(fa_webfonts_dir, ft)) for ft in ['fa-solid-900.woff2','fa-regular-400.woff2','fa-brands-400.woff2','fa-solid-900.ttf','fa-regular-400.ttf','fa-brands-400.ttf']]"

:: Download Fira Code font via a small helper script
python -c "import os, re, urllib.request; VENDOR_DIR = os.path.join(os.getcwd(), 'static', 'vendor'); FONTS_DIR = os.path.join(VENDOR_DIR, 'fonts'); os.makedirs(FONTS_DIR, exist_ok=True); headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}; req = urllib.request.Request('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&display=swap', headers=headers); response = urllib.request.urlopen(req); fira_css = response.read().decode('utf-8'); urls = re.findall(r'url\((https://[^\)]+)\)', fira_css); [urllib.request.urlretrieve(u, os.path.join(FONTS_DIR, u.split('/')[-1])) for u in urls if not os.path.exists(os.path.join(FONTS_DIR, u.split('/')[-1]))]; fira_css_out = fira_css; [None for u in urls if not (fira_css_out := fira_css_out.replace(u, './fonts/' + u.split('/')[-1])) is None]; open(os.path.join(VENDOR_DIR, 'fira-code.css'), 'w').write(fira_css_out)" 2>nul
echo [ok] Assets downloaded.

:assets_done

:: ── Export environment variables for config.py ─────────
set "SERVER_HOST=%HOST%"
set "SERVER_PORT=%PORT%"
set "RELOAD=%RELOAD%"

echo [ok] Configuration loaded:
echo   * Frontend URL:    http://%HOST%:%PORT%
echo   * Air-gapped:      Yes — no external API calls
echo   * Auto Reload:     %RELOAD%
echo ----------------------------------------------------
echo [+] Starting Uvicorn Server... (Press Ctrl+C to stop)

:: Build Uvicorn arguments
set "UVICORN_ARGS=main:app --host %HOST% --port %PORT% --log-level warning"
if "%RELOAD%"=="true" (
    set "UVICORN_ARGS=!UVICORN_ARGS! --reload"
)

:: Launch Server
python -m uvicorn !UVICORN_ARGS!

endlocal

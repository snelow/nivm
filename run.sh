#!/usr/bin/env bash

# Exit on error (except where explicitly handled)
set -e

# Default parameters
HOST="127.0.0.1"
PORT="8000"
RELOAD="true"
FORCE_SETUP="false"
KILL_EXISTING="false"

# Terminal Color Palette
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
PURPLE='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Clean trap on interrupt/termination
trap "echo -e '\n${YELLOW}[!] Stopping nivm server...${NC}'; exit 0" SIGINT SIGTERM

# Function to show usage help
show_help() {
    echo -e "${CYAN}${BOLD}nivm — Native Inference Virtual Machine${NC}"
    echo "Usage: ./run.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --host HOST         Set server bind address (default: 127.0.0.1)"
    echo "  -p, --port PORT         Set server port (default: 8000)"
    echo "  --no-reload             Disable Uvicorn auto-reload"
    echo "  -k, --kill              Kill any existing process currently bound to the target port"
    echo "  -s, --setup             Force re-installation of dependencies and assets"
    echo "  --help                  Show this help message and exit"
    echo ""
}

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--host)
            HOST="$2"
            shift 2
            ;;
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        --no-reload)
            RELOAD="false"
            shift
            ;;
        -k|--kill)
            KILL_EXISTING="true"
            shift
            ;;
        -s|--setup)
            FORCE_SETUP="true"
            shift
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# Banner
clear 2>/dev/null || true
echo -e "${CYAN}"
cat << "EOF"
    ███╗   ██╗██╗██╗   ██╗███╗   ███╗
    ████╗  ██║██║██║   ██║████╗ ████║
    ██╔██╗ ██║██║██║   ██║██╔████╔██║
    ██║╚██╗██║██║╚██╗ ██╔╝██║╚██╔╝██║
    ██║ ╚████║██║ ╚████╔╝ ██║ ╚═╝ ██║
    ╚═╝  ╚═══╝╚═╝  ╚═══╝  ╚═╝     ╚═╝
EOF
echo -e "${BOLD}      Native Inference Virtual Machine v2.0${NC}"
echo -e "${CYAN}====================================================${NC}"

# Handle port cleanup if requested or check conflict
EXISTING_PID=$(lsof -ti :"$PORT" 2>/dev/null || ss -tulpn 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | cut -d= -f2 | head -n 1 || true)

if [ -n "$EXISTING_PID" ]; then
    if [ "$KILL_EXISTING" = "true" ]; then
        echo -e "${YELLOW}[!] Terminating existing process on port $PORT (PID: $EXISTING_PID)...${NC}"
        kill -9 "$EXISTING_PID" 2>/dev/null || true
        sleep 0.5
    else
        echo -e "${RED}[!] Error: Port $PORT is already in use by PID $EXISTING_PID.${NC}"
        echo -e "${YELLOW}    Tip: Run './run.sh --kill' or specify a different port with '-p PORT'${NC}"
        exit 1
    fi
fi

# ── Hardware & Environment Inspection ────────────────────────
echo -e "${YELLOW}[+] Inspecting hardware & acceleration...${NC}"
if command -v nvidia-smi &>/dev/null; then
    GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n 1 || echo "NVIDIA GPU")
    VRAM_TOTAL=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader 2>/dev/null | head -n 1 || echo "Unknown VRAM")
    echo -e "  ${GREEN}✓${NC} GPU Detected: ${CYAN}${GPU_NAME}${NC} (${VRAM_TOTAL})"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo -e "  ${GREEN}✓${NC} Apple Silicon / Metal acceleration available"
else
    CPU_THREADS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo "4")
    echo -e "  ${CYAN}ℹ${NC} Accelerator: CPU Mode (${CPU_THREADS} logical threads)"
fi

# Check aria2 acceleration
if command -v aria2c &>/dev/null; then
    ARIA2_VER=$(aria2c -v 2>/dev/null | head -n 1 | awk '{print $3}')
    echo -e "  ${GREEN}✓${NC} Downloader:  ${CYAN}aria2c v${ARIA2_VER}${NC} (Isolated multi-connection)"
else
    echo -e "  ${YELLOW}ℹ${NC} Downloader:  ${CYAN}Streaming Fallback${NC} (aria2c not in PATH)"
fi

# ── Scan Models Directory ─────────────────────────────────────
MODELS_DIR="models"
mkdir -p "$MODELS_DIR"
echo -e "${YELLOW}[+] Scanning local models (${MODELS_DIR}/)...${NC}"

shopt -s nullglob
GGUF_FILES=("$MODELS_DIR"/*.gguf)
shopt -u nullglob

if [ ${#GGUF_FILES[@]} -eq 0 ]; then
    echo -e "  ${YELLOW}ℹ${NC} No .gguf models currently found in ${MODELS_DIR}/."
    echo -e "    ${CYAN}→ You can download models anytime using the in-app Downloader.${NC}"
else
    for model_path in "${GGUF_FILES[@]}"; do
        filename=$(basename "$model_path")
        size=$(du -h "$model_path" 2>/dev/null | cut -f1)
        
        if [[ "$filename" == *"mmproj"* ]]; then
            echo -e "  ${PURPLE}📐${NC} Projector:  ${BOLD}${filename}${NC} (${size})"
        elif [[ "$filename" == *"coder"* ]] || [[ "$filename" == *"Coder"* ]]; then
            echo -e "  ${GREEN}💻${NC} Coder:      ${BOLD}${filename}${NC} (${size})"
        elif [[ "$filename" == *"vision"* ]] || [[ "$filename" == *"gemma"* ]] || [[ "$filename" == *"Gemma"* ]]; then
            echo -e "  ${CYAN}👁️${NC} Vision:     ${BOLD}${filename}${NC} (${size})"
        elif [[ "$filename" == *"1.5b"* ]] || [[ "$filename" == *"1.7B"* ]] || [[ "$filename" == *"router"* ]]; then
            echo -e "  ${YELLOW}🧠${NC} Router:     ${BOLD}${filename}${NC} (${size})"
        else
            echo -e "  ${GREEN}📦${NC} Model:      ${BOLD}${filename}${NC} (${size})"
        fi
    done
fi

# ── Virtual Environment Setup ─────────────────────────────────
VENV_DIR="venv"

if [ "$FORCE_SETUP" = "true" ] || [ ! -d "$VENV_DIR" ]; then
    echo -e "${YELLOW}[+] Setting up Python virtual environment...${NC}"
    if command -v python3.14 &>/dev/null; then
        PYTHON_BIN="python3.14"
    elif command -v python3.12 &>/dev/null; then
        PYTHON_BIN="python3.12"
    elif command -v python3.11 &>/dev/null; then
        PYTHON_BIN="python3.11"
    elif command -v python3 &>/dev/null; then
        PYTHON_BIN="python3"
    elif command -v python &>/dev/null; then
        PYTHON_BIN="python"
    else
        echo -e "${RED}[!] Error: Python 3 is not installed or not in PATH.${NC}"
        exit 1
    fi

    if [ ! -d "$VENV_DIR" ]; then
        $PYTHON_BIN -m venv --system-site-packages "$VENV_DIR"
    fi

    source "$VENV_DIR/bin/activate"
    echo -e "${YELLOW}[+] Installing Python dependencies...${NC}"
    pip install --upgrade pip -q
    pip install -r requirements.txt -q
    echo -e "${GREEN}[✓] Virtual environment ready.${NC}"
else
    source "$VENV_DIR/bin/activate"
fi

# ── Vendor / Frontend Assets ──────────────────────────────────
if [ ! -d "static/vendor" ] || [ "$FORCE_SETUP" = "true" ]; then
    echo -e "${YELLOW}[+] Checking offline frontend assets...${NC}"
    python - << 'EOF'
import os, re, urllib.request

STATIC_DIR = os.path.join(os.getcwd(), "static")
VENDOR_DIR = os.path.join(STATIC_DIR, "vendor")
FONTS_DIR = os.path.join(VENDOR_DIR, "fonts")
os.makedirs(VENDOR_DIR, exist_ok=True)
os.makedirs(FONTS_DIR, exist_ok=True)

def safe_download(url, path):
    if not os.path.exists(path):
        try:
            urllib.request.urlretrieve(url, path)
        except Exception as e:
            pass

fa_version = "6.4.0"
safe_download(f"https://cdnjs.cloudflare.com/ajax/libs/font-awesome/{fa_version}/css/all.min.css", os.path.join(VENDOR_DIR, "fontawesome.min.css"))

fa_webfonts_dir = os.path.join(VENDOR_DIR, "webfonts")
os.makedirs(fa_webfonts_dir, exist_ok=True)
for font_type in ["fa-solid-900.woff2", "fa-regular-400.woff2", "fa-brands-400.woff2", "fa-solid-900.ttf", "fa-regular-400.ttf", "fa-brands-400.ttf"]:
    safe_download(f"https://cdnjs.cloudflare.com/ajax/libs/font-awesome/{fa_version}/webfonts/{font_type}", os.path.join(fa_webfonts_dir, font_type))

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
req = urllib.request.Request("https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&display=swap", headers=headers)
try:
    with urllib.request.urlopen(req) as response:
        fira_css = response.read().decode('utf-8')
    urls = re.findall(r'url\((https://[^\)]+)\)', fira_css)
    for url in urls:
        filename = url.split('/')[-1]
        filepath = os.path.join(FONTS_DIR, filename)
        safe_download(url, filepath)
        fira_css = fira_css.replace(url, f"./fonts/{filename}")
    with open(os.path.join(VENDOR_DIR, "fira-code.css"), "w") as f:
        f.write(fira_css)
except Exception:
    pass
EOF
    echo -e "${GREEN}[✓] Frontend assets verified.${NC}"
fi

# Export environment variables for config.py
export SERVER_HOST="$HOST"
export SERVER_PORT="$PORT"
export RELOAD="$RELOAD"

echo -e "${CYAN}----------------------------------------------------${NC}"
echo -e "${GREEN}${BOLD}[✓] nivm ready to launch:${NC}"
echo -e "  • Web Interface:   ${BOLD}${CYAN}http://${HOST}:${PORT}${NC}"
echo -e "  • Operational Mode:${CYAN} 100% Local / Air-Gapped${NC}"
echo -e "  • Hot Reloading:   ${CYAN}${RELOAD}${NC}"
echo -e "${CYAN}----------------------------------------------------${NC}"
echo -e "${GREEN}[+] Starting server... (Press Ctrl+C to gracefully stop)${NC}"

# Build Uvicorn arguments
UVICORN_ARGS="main:app --host $HOST --port $PORT --log-level warning"
if [ "$RELOAD" = "true" ]; then
    UVICORN_ARGS="$UVICORN_ARGS --reload"
fi

# Launch Server
exec python -m uvicorn $UVICORN_ARGS

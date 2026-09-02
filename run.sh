#!/usr/bin/env bash

# Exit on error
set -e

# Default parameters
HOST="127.0.0.1"
PORT="8000"
RELOAD="true"
FORCE_SETUP="false"

# Colors for terminal styling
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to show usage help
show_help() {
    echo -e "${CYAN}Sovereign AI Workbench — Local Multi-Model Assistant${NC}"
    echo "Usage: ./run.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --host HOST         Set server bind address (default: 127.0.0.1)"
    echo "  -p, --port PORT         Set server port (default: 8000)"
    echo "  --no-reload             Disable Uvicorn auto-reload"
    echo "  -s, --setup             Force re-installation of dependencies in virtual environment"
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

echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}        Sovereign AI Workbench — nivm v2.0          ${NC}"
echo -e "${CYAN}====================================================${NC}"

# Check models directory
MODELS_DIR="models"
echo -e "${YELLOW}[+] Checking models...${NC}"
if [ -f "$MODELS_DIR/Qwen3-1.7B-Q8_0.gguf" ]; then
    echo -e "  ${GREEN}✓${NC} Router:  Qwen3-1.7B ($(du -h $MODELS_DIR/Qwen3-1.7B-Q8_0.gguf | cut -f1))"
elif [ -f "$MODELS_DIR/qwen2.5-1.5b-instruct-q4_k_m.gguf" ]; then
    echo -e "  ${GREEN}✓${NC} Router:  Qwen2.5-1.5B ($(du -h $MODELS_DIR/qwen2.5-1.5b-instruct-q4_k_m.gguf | cut -f1))"
else
    echo -e "  ${RED}✗${NC} Router:  missing router model"
fi
if [ -f "$MODELS_DIR/qwen2.5-coder-3b-instruct-q4_k_m.gguf" ]; then
    echo -e "  ${GREEN}✓${NC} Worker:  Qwen2.5-Coder-3B ($(du -h $MODELS_DIR/qwen2.5-coder-3b-instruct-q4_k_m.gguf | cut -f1))"
elif [ -f "$MODELS_DIR/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf" ]; then
    echo -e "  ${GREEN}✓${NC} Worker:  Phi-4-mini ($(du -h $MODELS_DIR/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf | cut -f1))"
else
    echo -e "  ${RED}✗${NC} Worker:  missing worker model"
fi
if [ -f "$MODELS_DIR/gemma-4-E2B-it-Q4_K_M.gguf" ]; then
    echo -e "  ${GREEN}✓${NC} Vision:  Gemma-4-E2B ($(du -h $MODELS_DIR/gemma-4-E2B-it-Q4_K_M.gguf | cut -f1))"
else
    echo -e "  ${YELLOW}-${NC} Vision:  optional, not installed"
fi

# Virtual Environment Setup
VENV_DIR="venv"

if [ "$FORCE_SETUP" = "true" ] || [ ! -d "$VENV_DIR" ]; then
    echo -e "${YELLOW}[+] Setting up Python virtual environment...${NC}"
    if command -v python3.14 &>/dev/null; then
        PYTHON_BIN="python3.14"
    elif command -v python3.12 &>/dev/null; then
        PYTHON_BIN="python3.12"
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
    echo -e "${YELLOW}[+] Installing requirements...${NC}"
    pip install --upgrade pip -q
    pip install -r requirements.txt -q
    echo -e "${YELLOW}[+] Installing llama-cpp-python...${NC}"
    pip install llama-cpp-python==0.3.34 -q
    echo -e "${GREEN}[✓] Virtual environment ready.${NC}"
else
    source "$VENV_DIR/bin/activate"
fi

if [ ! -d "static/vendor" ] || [ "$FORCE_SETUP" = "true" ]; then
    echo -e "${YELLOW}[+] Downloading frontend assets...${NC}"
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
            print(f"Failed to download {url}: {e}")

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
except Exception as e:
    pass
EOF
    echo -e "${GREEN}[✓] Assets downloaded.${NC}"
fi

# Export environment variables for config.py
export SERVER_HOST="$HOST"
export SERVER_PORT="$PORT"
export RELOAD="$RELOAD"

echo -e "${GREEN}[✓] Configuration loaded:${NC}"
echo -e "  • Frontend URL:    ${CYAN}http://${HOST}:${PORT}${NC}"
echo -e "  • Air-gapped:      ${CYAN}Yes — no external API calls${NC}"
echo -e "  • Auto Reload:     ${CYAN}${RELOAD}${NC}"
echo -e "${CYAN}----------------------------------------------------${NC}"
echo -e "${GREEN}[+] Starting Uvicorn Server... (Press Ctrl+C to stop)${NC}"

# Build Uvicorn arguments
UVICORN_ARGS="main:app --host $HOST --port $PORT --log-level warning"
if [ "$RELOAD" = "true" ]; then
    UVICORN_ARGS="$UVICORN_ARGS --reload"
fi

# Launch Server
python -m uvicorn $UVICORN_ARGS

#!/usr/bin/env bash

# Exit on error (except where explicitly handled)
set -e

# Default parameters
HOST="0.0.0.0"
PORT="8000"
RELOAD="true"
FORCE_SETUP="false"
KILL_EXISTING="false"
ENABLE_SSL="false"
SSL_CERT=""
SSL_KEY=""
RESET_PASS="false"
SETUP_AUTH="false"
SHOW_KEY="false"

# Terminal Color Palette (Sleek Minimalist Cyber)
CYAN='\033[1;36m'
WHITE='\033[1;37m'
GRAY='\033[38;2;148;163;184m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
GOLD='\033[38;2;245;158;11m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Function to render the clean minimalist logo banner
print_banner() {
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
    echo -e "   ${WHITE}Native Inference Virtual Machine${NC} ${GRAY}— v2.4 LTS${NC}"
    echo -e "   ${GRAY}Local & Hybrid AI Workbench • Zero Telemetry${NC}"
    echo ""
}

# Helper: Prompt and confirm password
prompt_password() {
    local prompt="$1" var="$2" p1 p2
    while true; do
        read -s -p "$(echo -e "${WHITE}  $prompt: ${NC}")" p1; echo ""
        if [ ${#p1} -lt 4 ]; then
            echo -e "${RED}  [!] Password must be at least 4 characters long.${NC}"
            continue
        fi
        read -s -p "$(echo -e "${WHITE}  Confirm $prompt: ${NC}")" p2; echo ""
        if [ "$p1" != "$p2" ]; then
            echo -e "${RED}  [!] Passwords do not match. Try again.${NC}"
            continue
        fi
        eval "$var=\$p1"
        break
    done
}

# Helper: Show recovery key
show_recovery_key() {
    if [ -f "$REC_KEY_FILE" ]; then
        echo -e "${CYAN}┌─ Emergency Recovery Key ──────────────────────────────────────${NC}"
        while IFS= read -r line; do echo -e "${CYAN}│${NC}  ${WHITE}$line${NC}"; done < "$REC_KEY_FILE"
        echo -e "${CYAN}└───────────────────────────────────────────────────────────────${NC}"
    else
        echo -e "${YELLOW}[!] No recovery key file found at ${REC_KEY_FILE}.${NC}"
    fi
}

# Function to show usage help
show_help() {
    print_banner
    echo -e "${CYAN}Usage:${NC} ./run.sh [OPTIONS]\n"
    echo -e "${WHITE}Options:${NC}"
    echo -e "  ${CYAN}-h, --host HOST${NC}         Set server bind address (default: 0.0.0.0)"
    echo -e "  ${CYAN}-p, --port PORT${NC}         Set server port (default: 8000)"
    echo -e "  ${CYAN}--ssl${NC}                   Enable native SSL / HTTPS (auto-generates certs if needed)"
    echo -e "  ${CYAN}--ssl-cert PATH${NC}         Path to custom SSL certificate (PEM)"
    echo -e "  ${CYAN}--ssl-key PATH${NC}          Path to custom SSL private key (PEM)"
    echo -e "  ${CYAN}--no-reload${NC}             Disable Uvicorn auto-reload"
    echo -e "  ${CYAN}-k, --kill${NC}              Kill any existing process currently bound to the target port"
    echo -e "  ${CYAN}-s, --setup${NC}             Force re-installation of dependencies and assets"
    echo -e "  ${CYAN}--setup-auth${NC}            Configure or re-create Owner credentials"
    echo -e "  ${CYAN}--reset-password${NC}        Reset Owner Master Password from terminal"
    echo -e "  ${CYAN}--show-key${NC}              Display current Emergency Recovery Key"
    echo -e "  ${CYAN}--help${NC}                  Show this help message and exit\n"
}

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--host) HOST="$2"; shift 2 ;;
        -p|--port) PORT="$2"; shift 2 ;;
        --ssl) ENABLE_SSL="true"; shift ;;
        --ssl-cert) SSL_CERT="$2"; ENABLE_SSL="true"; shift 2 ;;
        --ssl-key) SSL_KEY="$2"; ENABLE_SSL="true"; shift 2 ;;
        --no-reload) RELOAD="false"; shift ;;
        -k|--kill) KILL_EXISTING="true"; shift ;;
        -s|--setup) FORCE_SETUP="true"; shift ;;
        --setup-auth) SETUP_AUTH="true"; shift ;;
        --reset-password) RESET_PASS="true"; shift ;;
        --show-key) SHOW_KEY="true"; shift ;;
        --help) show_help; exit 0 ;;
        *) echo -e "${RED}[!] Unknown option: $1${NC}"; show_help; exit 1 ;;
    esac
done

print_banner

# Virtual environment setup and activation
VENV_DIR="venv"

if [ "$FORCE_SETUP" = "true" ] || [ ! -d "$VENV_DIR" ]; then
    echo -e "${YELLOW}[+] Preparing Python virtual environment...${NC}"
    for py in python3.14 python3.12 python3.11 python3 python; do
        if command -v "$py" &>/dev/null; then PYTHON_BIN="$py"; break; fi
    done
    if [ -z "$PYTHON_BIN" ]; then
        echo -e "${RED}[!] Error: Python 3 is not installed or not in PATH.${NC}"; exit 1
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

# Ensure User files directory exists
mkdir -p "User files"
AUTH_FILE="User files/auth.json"
REC_KEY_FILE="User files/recovery_key.txt"

# Standalone CLI tasks

# 1. Show Recovery Key
if [ "$SHOW_KEY" = "true" ]; then
    show_recovery_key
    exit 0
fi

# 2. Reset Password CLI
if [ "$RESET_PASS" = "true" ]; then
    echo -e "${CYAN}┌─ Owner Password Reset ────────────────────────────────────────${NC}"
    echo -e "${CYAN}│${NC}  ${GRAY}Resetting the Project NIVM master password directly.${NC}"
    echo -e "${CYAN}└───────────────────────────────────────────────────────────────${NC}\n"
    prompt_password "New Master Password" NEW_P1

    python3 -c "
import sys; sys.path.insert(0, '.')
from core.auth import reset_password_direct
if reset_password_direct('$NEW_P1'):
    print('\033[1;32m[✓] Master password updated. All previous sessions revoked.\033[0m')
else:
    print('\033[1;31m[!] Failed to reset password.\033[0m'); sys.exit(1)
"
    exit 0
fi

# Owner account verification and setup
IS_CONFIGURED=$(python3 -c "import sys; sys.path.insert(0, '.'); from core.auth import is_auth_configured; print('true' if is_auth_configured() else 'false')" 2>/dev/null || echo "false")

if [ "$IS_CONFIGURED" != "true" ] || [ "$SETUP_AUTH" = "true" ]; then
    echo -e "${CYAN}┌─ Security Setup: Master Password ─────────────────────────────${NC}"
    echo -e "${CYAN}│${NC}  ${GRAY}Project NIVM requires a Master Password to safeguard${NC}"
    echo -e "${CYAN}│${NC}  ${GRAY}private chat histories, neural memories, and tools.${NC}"
    echo -e "${CYAN}└───────────────────────────────────────────────────────────────${NC}\n"

    OWNER_USER="admin"
    prompt_password "Master Password" OWNER_P1

    RECOVERY_KEY=$(python3 -c "
import sys
sys.path.insert(0, '.')
from core.auth import setup_owner_account
key = setup_owner_account('$OWNER_USER', '$OWNER_P1')
print(key)
")

    echo ""
    echo -e "${CYAN}┌─ Emergency Recovery Key ──────────────────────────────────────${NC}"
    echo -e "${CYAN}│${NC}  ${WHITE}Key:  ${GOLD}${RECOVERY_KEY}${NC}"
    echo -e "${CYAN}│${NC}"
    echo -e "${CYAN}│${NC}  ${GRAY}Saved to: ${REC_KEY_FILE}${NC}"
    echo -e "${CYAN}│${NC}  ${GRAY}Keep this safe! Use it to reset your password remotely${NC}"
    echo -e "${CYAN}│${NC}  ${GRAY}from your browser if forgotten.${NC}"
    echo -e "${CYAN}└───────────────────────────────────────────────────────────────${NC}"
    echo ""

    if [ "$SETUP_AUTH" = "true" ]; then
        exit 0
    fi
    sleep 0.5
fi

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

# Hardware and environment inspection
GPU_INFO="CPU Mode"
if command -v nvidia-smi &>/dev/null; then
    GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n 1 || echo "NVIDIA GPU")
    VRAM_TOTAL=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader 2>/dev/null | head -n 1 || echo "Unknown VRAM")
    GPU_INFO="${GPU_NAME} (${VRAM_TOTAL})"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    GPU_INFO="Apple Silicon / Metal"
else
    CPU_THREADS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo "4")
    GPU_INFO="CPU Mode (${CPU_THREADS} logical threads)"
fi

# Check aria2 acceleration
DOWNLOADER_INFO="Streaming Fallback (aria2c not in PATH)"
if command -v aria2c &>/dev/null; then
    ARIA2_VER=$(aria2c -v 2>/dev/null | head -n 1 | awk '{print $3}')
    DOWNLOADER_INFO="aria2c v${ARIA2_VER} (Turbo Multi-Stream)"
fi

# Ensure models directory exists silently
mkdir -p "models"

# Auto-discover CUDA & cuDNN paths for GPU acceleration
if [ -d "/usr/local/cuda/bin" ] && [[ ":$PATH:" != *":/usr/local/cuda/bin:"* ]]; then
    export PATH="/usr/local/cuda/bin:$PATH"
fi

for CUDA_LIB in "/usr/local/cuda/lib64" "/usr/local/cuda-13.2/lib64" "$HOME/.local/lib/python3.14/site-packages/nvidia/cudnn/lib" "/home/blubvlub/.local/lib/python3.14/site-packages/nvidia/cudnn/lib"; do
    if [ -d "$CUDA_LIB" ]; then
        export LD_LIBRARY_PATH="$CUDA_LIB:${LD_LIBRARY_PATH:-}"
    fi
done

# Verify llama-cpp acceleration backend
CUDA_CHECK=$(python -c "import llama_cpp, subprocess; print('CUDA' if 'cuda' in subprocess.check_output(['ldd', llama_cpp.llama_cpp._lib._name]).decode().lower() else 'CPU')" 2>/dev/null || echo "Unknown")
if [ "$CUDA_CHECK" = "CUDA" ]; then
    LLAMA_INFO="CUDA (GPU Hardware Acceleration Active)"
else
    LLAMA_INFO="CPU Mode (libggml-cuda not detected)"
fi

# Neural TTS engine setup (Kokoro v1.0)
KOKORO_DIR="models/tts/kokoro"
KOKORO_MODEL="$KOKORO_DIR/kokoro-v1.0.onnx"
KOKORO_VOICES="$KOKORO_DIR/voices-v1.0.bin"

if [ ! -f "$KOKORO_MODEL" ] || [ ! -f "$KOKORO_VOICES" ]; then
    echo -e "${YELLOW}[+] Setting up Neural TTS models (Kokoro v1.0)...${NC}"
    mkdir -p "$KOKORO_DIR"
    
    if [ ! -f "$KOKORO_MODEL" ]; then
        echo -e "  • Downloading Kokoro ONNX model (FP32, 310MB)..."
        curl -L -# -o "$KOKORO_MODEL" "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx" || \
        curl -L -# -o "$KOKORO_MODEL" "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/kokoro-v1.0.onnx"
    fi
    
    if [ ! -f "$KOKORO_VOICES" ]; then
        echo -e "  • Downloading Kokoro voice embeddings (26MB)..."
        curl -L -# -o "$KOKORO_VOICES" "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin" || \
        curl -L -# -o "$KOKORO_VOICES" "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/voices-v1.0.bin"
    fi
fi

# Open-Source CMUdict Pronunciation Dataset (135,000+ entries)
CMUDICT_PATH="models/tts/cmudict.dict"
if [ ! -f "$CMUDICT_PATH" ]; then
    echo -e "${YELLOW}[+] Downloading CMU Pronunciation Lexicon (~3.5MB)...${NC}"
    curl -L -# -o "$CMUDICT_PATH" "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict" || true
fi

# Check Image Studio status
IMAGE_STUDIO_INFO=$(python - << 'EOF' 2>/dev/null || echo "Opt-In Module"
try:
    from core.image_engine.model_checker import check_image_models_status
    from core.image_engine.setup_helper import detect_comfyui
    m = check_image_models_status()
    c = detect_comfyui()
    if m.get("all_installed") and c.get("detected"):
        print("Qwen-Rapid Diffusion [Ready]")
    elif m.get("all_installed"):
        print("Models Cached (ComfyUI Standby)")
    else:
        print("Opt-In Diffusion (Configure in Settings)")
except Exception:
    print("Diffusion Engine Ready")
EOF
)

# Vendor and frontend assets
if [ ! -d "static/vendor" ] || [ "$FORCE_SETUP" = "true" ]; then
    echo -e "${YELLOW}[+] Verifying offline frontend assets...${NC}"
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
        except Exception:
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
fi

# Detect local network IP
get_local_ip() {
    local ip=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || true)
    if [ -z "$ip" ]; then
        ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
    fi
    if [ -z "$ip" ]; then
        ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
    fi
    echo "$ip"
}
LOCAL_IP=$(get_local_ip)

# Determine protocol & SSL configuration
PROTOCOL="http"
if [ "$ENABLE_SSL" = "true" ]; then
    PROTOCOL="https"
    CERTS_DIR="User files/certs"
    mkdir -p "$CERTS_DIR"
    SSL_CERT="${SSL_CERT:-$CERTS_DIR/cert.pem}"
    SSL_KEY="${SSL_KEY:-$CERTS_DIR/key.pem}"

    if [ ! -f "$SSL_CERT" ] || [ ! -f "$SSL_KEY" ]; then
        echo -e "${YELLOW}[*] Generating self-signed SSL certificate for encrypted transfers...${NC}"
        SAN_PARAM="DNS:localhost,IP:127.0.0.1"
        if [ -n "$LOCAL_IP" ]; then
            SAN_PARAM="${SAN_PARAM},IP:${LOCAL_IP}"
        fi
        openssl req -x509 -newkey rsa:2048 -keyout "$SSL_KEY" -out "$SSL_CERT" -days 365 -nodes \
            -subj "/CN=Project-NIVM/O=Local-Inference" \
            -addext "subjectAltName = ${SAN_PARAM}" 2>/dev/null || \
        openssl req -x509 -newkey rsa:2048 -keyout "$SSL_KEY" -out "$SSL_CERT" -days 365 -nodes \
            -subj "/CN=localhost" 2>/dev/null
    fi
fi

# Export environment variables for config.py
export SERVER_HOST="$HOST"
export SERVER_PORT="$PORT"
export SERVER_PROTOCOL="$PROTOCOL"
export RELOAD="$RELOAD"

# Render diagnostics HUD
echo -e "${CYAN}┌─ System Diagnostics ──────────────────────────────────────────${NC}"
echo -e "${CYAN}│${NC}  ${GRAY}Compute Core${NC}      :: ${WHITE}${GPU_INFO}${NC}"
echo -e "${CYAN}│${NC}  ${GRAY}LLM Engine${NC}        :: ${WHITE}${LLAMA_INFO}${NC}"
echo -e "${CYAN}│${NC}  ${GRAY}Neural Voice${NC}      :: ${WHITE}Kokoro v1.0 ONNX (Neural Voice TTS)${NC}"
echo -e "${CYAN}│${NC}  ${GRAY}Phonetic Lex${NC}      :: ${WHITE}CMUdict (135,000+ words) Loaded${NC}"
echo -e "${CYAN}│${NC}  ${GRAY}Downloader${NC}        :: ${WHITE}${DOWNLOADER_INFO}${NC}"
echo -e "${CYAN}│${NC}  ${GRAY}Image Studio${NC}      :: ${WHITE}${IMAGE_STUDIO_INFO}${NC}"
echo -e "${CYAN}│${NC}  ${GRAY}Security Gate${NC}     :: ${GREEN}Single-User Owner Shield [Active]${NC}"
echo -e "${CYAN}└───────────────────────────────────────────────────────────────${NC}"
echo ""

# Render network endpoints
echo -e "${CYAN}┌─ Active Endpoints ────────────────────────────────────────────${NC}"
echo -e "${CYAN}│${NC}  ${GRAY}Local Host${NC}        -> ${WHITE}${PROTOCOL}://localhost:${PORT}${NC}"
if [ -n "$LOCAL_IP" ]; then
    echo -e "${CYAN}│${NC}  ${GRAY}Local Network${NC}     -> ${WHITE}${PROTOCOL}://${LOCAL_IP}:${PORT}${NC}"
fi
echo -e "${CYAN}│${NC}  ${GRAY}Transport${NC}         -> ${WHITE}$([ "$ENABLE_SSL" = "true" ] && echo "Encrypted HTTPS/TLS" || echo "Plain HTTP (pass --ssl for HTTPS)")${NC}"
echo -e "${CYAN}│${NC}  ${GRAY}Access Gate${NC}       -> ${WHITE}Owner Authentication Required${NC}"
echo -e "${CYAN}└───────────────────────────────────────────────────────────────${NC}"
echo ""

# Build Uvicorn command array (handles paths with spaces safely)
UVICORN_CMD=(python -m uvicorn main:app --host "$HOST" --port "$PORT" --log-level warning)
if [ "$RELOAD" = "true" ]; then
    UVICORN_CMD+=(--reload)
fi
if [ "$ENABLE_SSL" = "true" ]; then
    UVICORN_CMD+=(--ssl-keyfile "$SSL_KEY" --ssl-certfile "$SSL_CERT")
fi

# Clean shutdown function (fast, zero hang)
SERVER_PID=""
cleanup() {
    echo -e "\n${YELLOW}[!] Terminating Project NIVM server...${NC}"
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill -TERM -"$SERVER_PID" 2>/dev/null || kill -TERM "$SERVER_PID" 2>/dev/null || true
        for i in {1..15}; do
            if ! kill -0 "$SERVER_PID" 2>/dev/null; then
                break
            fi
            sleep 0.1
        done
        if kill -0 "$SERVER_PID" 2>/dev/null; then
            kill -9 -"$SERVER_PID" 2>/dev/null || kill -9 "$SERVER_PID" 2>/dev/null || true
        fi
    fi
    # Free port if child process lingers
    local lingering=$(lsof -ti :"$PORT" 2>/dev/null || true)
    if [ -n "$lingering" ]; then
        kill -9 $lingering 2>/dev/null || true
    fi
    echo -e "${GREEN}[✓] Server stopped cleanly.${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Launch Server in its own process group with setsid (so Ctrl+C in logs -f never kills uvicorn)
LOG_FILE="User files/nivm.log"
echo -ne "${CYAN}[+] Starting Project NIVM server...${NC}"
setsid "${UVICORN_CMD[@]}" >> "$LOG_FILE" 2>&1 &
SERVER_PID=$!

# Wait for server and model to initialize
SERVER_READY=false
for i in {1..60}; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo -e "\n${RED}[!] Server failed to start or crashed on launch.${NC}"
        echo -e "${YELLOW}Last 25 log entries from ${LOG_FILE}:${NC}"
        tail -n 25 "$LOG_FILE" 2>/dev/null || true
        exit 1
    fi
    if curl -s -k "${PROTOCOL}://127.0.0.1:${PORT}/api/health" 2>/dev/null | grep -q '"status":"online"'; then
        SERVER_READY=true
        break
    fi
    sleep 0.25
done

if [ "$SERVER_READY" = "true" ]; then
    echo -e " ${GREEN}[Online & Ready]${NC}"
else
    echo -e " ${YELLOW}[Started]${NC}"
fi

echo -e "${GRAY}Interactive console ready. Type ${WHITE}help${GRAY} for options or ${WHITE}quit${GRAY} to exit.${NC}"
echo ""

# Authorize local CLI curl commands using the owner signing secret
CLI_SECRET=$(python3 -c "import json; print(json.load(open('User files/auth.json')).get('signing_secret', ''))" 2>/dev/null || true)
CURL_OPTS=(-s -k)
if [ -n "$CLI_SECRET" ]; then
    CURL_OPTS+=(-H "X-NIVM-Internal-Key: $CLI_SECRET")
fi

# Disable exit-on-error in the interactive session to prevent console terminations
set +e

# Interactive Command Loop
while kill -0 "$SERVER_PID" 2>/dev/null; do
    if [ -t 0 ]; then
        read -r -p "$(echo -e "${BOLD}${CYAN}nivm${NC} > ")" CMD
        READ_STATUS=$?
        if [ $READ_STATUS -gt 128 ]; then
            echo ""
            continue
        elif [ $READ_STATUS -ne 0 ]; then
            break
        fi
    else
        read -r CMD || break
    fi
    CMD="$(echo "$CMD" | xargs 2>/dev/null || echo "$CMD")"

    case "$CMD" in
        "q"|"quit"|"exit")
            cleanup
            ;;
        "help"|"?")
            echo -e "${CYAN}┌─ Available Commands ──────────────────────────────────────────${NC}"
            echo -e "${CYAN}│${NC}  ${WHITE}status${NC}         - Show engine status, active model, and memory bars"
            echo -e "${CYAN}│${NC}  ${WHITE}models${NC}         - Scan and list discovered local GGUF models"
            echo -e "${CYAN}│${NC}  ${WHITE}passwd${NC}         - Interactively change owner master password"
            echo -e "${CYAN}│${NC}  ${WHITE}rec-key${NC}        - Display active Emergency Recovery Key"
            echo -e "${CYAN}│${NC}  ${WHITE}urls${NC}           - Print local and network access links"
            echo -e "${CYAN}│${NC}  ${WHITE}logs${NC}           - Print recent server activity logs"
            echo -e "${CYAN}│${NC}  ${WHITE}logs -f${NC}        - Stream live server activity logs (Ctrl+C)"
            echo -e "${CYAN}│${NC}  ${WHITE}logs clear${NC}     - Truncate and clear the server log file"
            echo -e "${CYAN}│${NC}  ${WHITE}clear${NC}          - Clear terminal screen and reprint banner"
            echo -e "${CYAN}│${NC}  ${WHITE}quit, exit, q${NC}  - Clean, instant zero-hang server shutdown"
            echo -e "${CYAN}└───────────────────────────────────────────────────────────────${NC}"
            ;;
        "passwd"|"reset-pass")
            echo -e "${CYAN}┌─ Change Master Password ──────────────────────────────────────${NC}"
            prompt_password "New Master Password" NP1
            python3 -c "
import sys; sys.path.insert(0, '.')
from core.auth import reset_password_direct
if reset_password_direct('$NP1'):
    print('\033[1;32m  [✓] Password successfully changed. All active sessions refreshed.\033[0m')
else:
    print('\033[1;31m  [!] Failed to update password.\033[0m')
"
            echo -e "${CYAN}└───────────────────────────────────────────────────────────────${NC}"
            ;;
        "rec-key"|"recovery"|"key")
            show_recovery_key
            ;;
        "logs"|"log")
            if [ -f "$LOG_FILE" ]; then
                echo -e "${GRAY}--- Recent Logs (${LOG_FILE}) ---${NC}"
                tail -n 30 "$LOG_FILE"
                echo -e "${GRAY}--- End of recent logs (type 'logs -f' for live stream) ---${NC}"
            else
                echo -e "${YELLOW}No log file found at ${LOG_FILE}.${NC}"
            fi
            ;;
        "logs -f"|"logs -tail"|"tail")
            if [ -f "$LOG_FILE" ]; then
                echo -e "${CYAN}Streaming live logs from ${LOG_FILE} (Press Ctrl+C to return)...${NC}"
                trap : SIGINT
                tail -n 30 -f "$LOG_FILE" || true
                trap cleanup SIGINT SIGTERM
                echo -e "${GRAY}[Console resumed]${NC}"
            else
                echo -e "${YELLOW}No log file found at ${LOG_FILE}.${NC}"
            fi
            ;;
        "logs clear"|"clear-logs")
            > "$LOG_FILE"
            echo -e "${GREEN}[✓] Log file cleared.${NC}"
            ;;
        "status")
            curl "${CURL_OPTS[@]}" "${PROTOCOL}://127.0.0.1:${PORT}/api/engine/status" 2>/dev/null | python3 -c "
import sys, json

def make_bar(used, total, width=16):
    if not total or total <= 0:
        return '░' * width, 0.0
    pct = min(100.0, max(0.0, (used / total) * 100))
    filled = int(round((pct / 100.0) * width))
    bar = '█' * filled + '░' * (width - filled)
    return bar, pct

try:
    d = json.load(sys.stdin)
    act = d.get('active') or {}
    hw = d.get('hardware') or {}
    loaded = act.get('loaded', False)
    status_str = '\033[1;32mActive (Model Loaded)\033[0m' if loaded else '\033[1;33mStandby (No Model)\033[0m'
    model_name = act.get('name') or 'None'
    arch = act.get('arch') or 'N/A'
    
    print('\033[1;36m┌─ Engine Status ───────────────────────────────────────────────\033[0m')
    print(f'\033[1;36m│\033[0m  \033[38;2;148;163;184mStatus\033[0m       :: {status_str}')
    print(f'\033[1;36m│\033[0m  \033[38;2;148;163;184mActive Model\033[0m :: \033[1;37m{model_name}\033[0m ({arch})')
    
    if hw:
        v_used = hw.get('vram_used_gb', 0) or 0
        v_total = hw.get('vram_total_gb', 0) or 0
        r_used = hw.get('ram_used_gb', 0) or 0
        r_total = hw.get('ram_total_gb', 0) or 0
        
        v_bar, v_pct = make_bar(v_used, v_total)
        r_bar, r_pct = make_bar(r_used, r_total)
        
        print(f'\033[1;36m│\033[0m  \033[38;2;148;163;184mGPU VRAM\033[0m     :: [\033[1;36m{v_bar}\033[0m] {v_used:.1f} / {v_total:.1f} GB ({v_pct:.1f}%)')
        print(f'\033[1;36m│\033[0m  \033[38;2;148;163;184mSystem RAM\033[0m   :: [\033[38;2;148;163;184m{r_bar}\033[0m] {r_used:.1f} / {r_total:.1f} GB ({r_pct:.1f}%)')
    print('\033[1;36m└───────────────────────────────────────────────────────────────\033[0m')
except Exception:
    print('\033[1;33mServer busy or initializing...\033[0m')
" || echo -e "${YELLOW}Server unreachable.${NC}"
            ;;
        "urls")
            echo -e "${CYAN}┌─ Endpoints ───────────────────────────────────────────────────${NC}"
            echo -e "${CYAN}│${NC}  ${GRAY}Local Host${NC} -> ${WHITE}${PROTOCOL}://localhost:${PORT}${NC}"
            if [ -n "$LOCAL_IP" ]; then
                echo -e "${CYAN}│${NC}  ${GRAY}Local Network${NC} -> ${WHITE}${PROTOCOL}://${LOCAL_IP}:${PORT}${NC}"
            fi
            echo -e "${CYAN}└───────────────────────────────────────────────────────────────${NC}"
            ;;
        "models")
            curl "${CURL_OPTS[@]}" "${PROTOCOL}://127.0.0.1:${PORT}/api/models/scan" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    models = d.get('models', [])
    print(f'\033[1;36m┌─ Discovered GGUF Models ({len(models)}) ───────────────────────────────\033[0m')
    for m in models:
        fn = m.get('filename', '')
        sz = m.get('size_gb', 0)
        arch = m.get('arch', 'gguf')
        print(f'\033[1;36m│\033[0m  \033[1;37m{fn}\033[0m \033[38;2;148;163;184m[{sz:.2f} GB • {arch}]\033[0m')
    print('\033[1;36m└───────────────────────────────────────────────────────────────\033[0m')
except Exception:
    print('Unable to fetch models.')
" || echo -e "${YELLOW}Unable to fetch models.${NC}"
            ;;
        "clear")
            print_banner
            ;;
        "")
            ;;
        *)
            echo -e "${YELLOW}Unknown command: '$CMD'. Type 'help' for options or 'quit' to exit.${NC}"
            ;;
    esac
done

cleanup

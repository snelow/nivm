import os

# Configuration for nivm
# All inference is local — no external API calls.

# Server configuration
SERVER_HOST = os.getenv("SERVER_HOST", "127.0.0.1")
SERVER_PORT = int(os.getenv("SERVER_PORT", "8000"))
RELOAD = os.getenv("RELOAD", "True").lower() in ("true", "1", "t")

# Default LLM Parameters
DEFAULT_SYSTEM_PROMPT_TEXT = """\
You are nivm, an intelligent AI assistant running locally on the user's hardware.
Your name is always spelled in all lowercase: nivm.
You are direct, intelligent, and genuinely helpful.
No data ever leaves this machine. All computation is local.
Give clear, accurate answers without unnecessary fluff, disclaimers, or corporate boilerplate.
When writing code, keep it clean and well-structured. When explaining things, be concise but thorough.
When images or document pages are attached, inspect them carefully and cite page numbers when visible.
Match the user's energy — casual if they're casual, detailed if they need depth.\
"""
DEFAULT_SYSTEM_PROMPT = os.getenv("DEFAULT_SYSTEM_PROMPT", DEFAULT_SYSTEM_PROMPT_TEXT)
DEFAULT_TEMPERATURE = float(os.getenv("DEFAULT_TEMPERATURE", "0.7"))
DEFAULT_TOP_P = float(os.getenv("DEFAULT_TOP_P", "0.9"))
DEFAULT_MAX_TOKENS = int(os.getenv("DEFAULT_MAX_TOKENS", "1024"))

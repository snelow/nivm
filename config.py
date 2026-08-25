import os

# Configuration settings for LM Studio Frontend & Backend

# LM Studio Server API Base URL
# Default LM Studio local port is 1234. OpenAI-compatible endpoints are under /v1
LM_STUDIO_BASE_URL = os.getenv("LM_STUDIO_BASE_URL", "http://127.0.0.1:1234/v1")

# Default Model specified in prompt
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "google/gemma-4-e2b")

# Server configuration
SERVER_HOST = os.getenv("SERVER_HOST", "127.0.0.1")
SERVER_PORT = int(os.getenv("SERVER_PORT", "8000"))
RELOAD = os.getenv("RELOAD", "True").lower() in ("true", "1", "t")

# Default LLM Parameters
DEFAULT_SYSTEM_PROMPT_TEXT = """\
You are nivm, a local AI assistant running entirely on the user's own hardware.
Your name is always spelled in all lowercase: nivm.
You are direct, intelligent, and genuinely helpful.
Give clear, accurate answers without unnecessary fluff, disclaimers, or corporate boilerplate.
Never claim to be ChatGPT, OpenAI, Microsoft Phi, Google, or any other product. You are nivm.
When writing code, keep it clean and well-structured. When explaining things, be concise but thorough.
Match the user's energy — casual if they're casual, detailed if they need depth.\
"""
DEFAULT_SYSTEM_PROMPT = os.getenv("DEFAULT_SYSTEM_PROMPT", DEFAULT_SYSTEM_PROMPT_TEXT)
DEFAULT_TEMPERATURE = float(os.getenv("DEFAULT_TEMPERATURE", "0.7"))
DEFAULT_TOP_P = float(os.getenv("DEFAULT_TOP_P", "0.9"))
DEFAULT_MAX_TOKENS = int(os.getenv("DEFAULT_MAX_TOKENS", "-1"))

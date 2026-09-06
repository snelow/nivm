"""
Intent Router for Sovereign AI Workbench.

Uses the small router model to classify text requests and route them to the
appropriate specialist model. Media-bearing prompts go directly to vision.
"""

import logging
try:
    from .engine import model_manager
except ImportError:
    from engine import model_manager

logger = logging.getLogger(__name__)

ROUTER_SYSTEM_PROMPT = """You are a task classifier. Given a user message, output ONLY one word: either "vision" or "coder".

Rules:
- Output "vision" if the task involves images, video clips, audio recordings, speech, voice notes, sound files, scanned documents, OCR, photographs, visual understanding, or any attached media.
- Output "coder" for everything else, including coding, reasoning, writing, summarization, math, calculations, general questions, document drafting, and analysis.

Output ONLY the single word. No explanation, punctuation, or extra text."""


def classify_intent(user_message: str, has_images: bool = False, has_media: bool = False) -> str:
    """
    Classify user intent and return the appropriate model role.
    
    Args:
        user_message: The user's latest message text
        has_images: Whether the message includes image/media attachments
        has_media: Generic flag for attached media (audio, video, images, pdf)
    
    Returns:
        "coder" or "vision"
    """
    if has_images or has_media:
        logger.warning("Router: media detected -> vision")
        return "vision"

    try:
        load_time = model_manager.activate("router")
        if load_time > 0:
            logger.warning(f"Router model loaded in {load_time:.1f}s")

        messages = [
            {"role": "system", "content": ROUTER_SYSTEM_PROMPT},
            {"role": "user", "content": user_message or ""},
        ]
        response = model_manager.generate(
            messages=messages,
            max_tokens=8,
            temperature=0.0,
            top_p=1.0,
            stream=False,
        )

        raw = ""
        if isinstance(response, dict):
            choices = response.get("choices", [])
            if choices:
                raw = choices[0].get("message", {}).get("content", "").strip().lower()

        result = "vision" if "vision" in raw else "coder"
        logger.warning(f"Router classified '{(user_message or '')[:80]}' -> {result} (raw: {raw!r})")
        return result
    except Exception as exc:
        logger.error(f"Router classification failed: {exc}; defaulting to coder")
        return "coder"


def get_resident_role() -> str:
    """Pick the model that should stay warm between requests."""
    available = model_manager.list_available()
    for role in ["router", "vision", "coder"]:
        if available.get(role, {}).get("available"):
            return role
    return "coder"


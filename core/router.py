"""
Single Model & Intent Dispatcher for Project NIVM.

In Single Model mode, all local prompts are processed directly by the
active local GGUF model without multi-model swap latency.
"""

import logging

logger = logging.getLogger("nivm.router")


def classify_intent(user_message: str = "", has_images: bool = False, has_media: bool = False) -> str:
    """Directly route to the configured local model."""
    return "custom"


def get_resident_role() -> str:
    """Return the active resident single model role."""
    return "custom"

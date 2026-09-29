"""
Neural Memory Engine for nivm.
Combines RAG retrieval, Mem0, and Google TurboQuant vector quantization (4-bit)
over embedded Qdrant with local CPU FastEmbed embeddings (BAAI/bge-small-en-v1.5).

100% offline, private, and local on the host machine.
"""

import os
import re
import json
import time
import logging
import asyncio
from typing import List, Dict, Any, Optional

# Suppress Mem0 telemetry
os.environ["MEM0_TELEMETRY"] = "false"

# Patch FastEmbed to strictly use CPUExecutionProvider to avoid missing cuDNN libraries
# and guarantee zero GPU VRAM consumption.
try:
    import fastembed.text.text_embedding
    _orig_fe_init = fastembed.text.text_embedding.TextEmbedding.__init__
    def _patched_fe_init(self, *args, **kwargs):
        kwargs['providers'] = ['CPUExecutionProvider']
        return _orig_fe_init(self, *args, **kwargs)
    fastembed.text.text_embedding.TextEmbedding.__init__ = _patched_fe_init
except Exception:
    pass

from qdrant_client import QdrantClient, models
from mem0 import Memory

from core.config import USER_FILES_DIR

logger = logging.getLogger("nivm.memory_engine")

COLLECTION_NAME = "nivm_memories"
VECTOR_DIM = 384
EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"

EXTRACTION_SYSTEM_PROMPT = """You are a precise, background memory extractor for an AI companion.
Analyze the conversation context and current turn. Extract only enduring facts, user projects, architecture/database/tech choices, preferences, and personal details stated by the user.
Important guidelines:
- If the user discusses a project (e.g. project name, tech stack, goals, database, framework), always include the project name in the fact (resolve pronouns like 'it', 'the project' to the actual project name).
- Do NOT extract casual greetings, chit-chat, emotional filler, pleasantries, or questions.
- Do NOT extract transient details or recommendations made by the assistant.
Return ONLY a valid JSON list of concise factual statements written in the third person.
Examples:
Context: User: "I'm working on a project called Nexus."
Current Turn: User: "For the database I decided to go with PostgreSQL and Prisma" -> ["User uses PostgreSQL and Prisma for the database of the Nexus project"]
Context: None
Current Turn: User: "I study computer science at UW and have an RTX 3050" -> ["User studies computer science at UW", "User has an NVIDIA RTX 3050 GPU"]
Current Turn: User: "What's the weather today?" -> []
If there are no enduring facts, return [].
JSON output only:"""


def _parse_extracted_facts(raw_text: str) -> List[str]:
    """Parse JSON list of fact strings from LLM output with robust fallbacks."""
    if not raw_text:
        return []
    cleaned = re.sub(r'```(?:json)?', '', raw_text)
    cleaned = re.sub(r'```', '', cleaned).strip()

    try:
        data = json.loads(cleaned)
        if isinstance(data, list):
            return [str(x).strip() for x in data if isinstance(x, str) and len(str(x).strip()) >= 5]
        if isinstance(data, dict):
            for v in data.values():
                if isinstance(v, list):
                    return [str(x).strip() for x in v if isinstance(x, str) and len(str(x).strip()) >= 5]
    except Exception:
        pass

    match = re.search(r'\[[\s\S]*?\]', cleaned)
    if match:
        try:
            arr = json.loads(match.group(0))
            if isinstance(arr, list):
                return [str(x).strip() for x in arr if isinstance(x, str) and len(str(x).strip()) >= 5]
        except Exception:
            pass

    return []


class MemoryEngine:
    """
    Manages neural memory storage, TurboQuant vector quantization,
    RAG retrieval, and background fact extraction.
    """

    def __init__(self):
        self.qdrant_dir = os.path.join(USER_FILES_DIR, "qdrant_data")
        self.history_db_path = os.path.join(USER_FILES_DIR, "mem0_history.db")
        os.makedirs(self.qdrant_dir, exist_ok=True)

        self._mem: Optional[Memory] = None
        self._lock = asyncio.Lock()
        self._init_storage()

    def _init_storage(self):
        """Pre-configure collection with TurboQuant 4-bit and BM25 sparse vectors."""
        try:
            qc = QdrantClient(path=self.qdrant_dir)
            existing_cols = [c.name for c in qc.get_collections().collections]
            if COLLECTION_NAME not in existing_cols:
                qc.create_collection(
                    collection_name=COLLECTION_NAME,
                    vectors_config=models.VectorParams(
                        size=VECTOR_DIM,
                        distance=models.Distance.COSINE
                    ),
                    quantization_config=models.TurboQuantization(
                        turbo=models.TurboQuantQuantizationConfig(
                            bits=models.TurboQuantBitSize.BITS4
                        )
                    ),
                    sparse_vectors_config={
                        "bm25": models.SparseVectorParams(modifier=models.Modifier.IDF)
                    }
                )
                logger.info(f"Initialized collection '{COLLECTION_NAME}' with Google TurboQuant 4-bit.")
            qc.close()
        except Exception as e:
            logger.warning(f"Note during Qdrant collection check: {e}")

        mem_config = {
            "vector_store": {
                "provider": "qdrant",
                "config": {
                    "collection_name": COLLECTION_NAME,
                    "path": self.qdrant_dir,
                    "embedding_model_dims": VECTOR_DIM
                }
            },
            "embedder": {
                "provider": "fastembed",
                "config": {
                    "model": EMBEDDING_MODEL
                }
            },
            "llm": {
                "provider": "openai",
                "config": {
                    "model": "none",
                    "api_key": "none"
                }
            },
            "history_db_path": self.history_db_path
        }

        try:
            self._mem = Memory.from_config(mem_config)
            logger.info("Mem0 memory instance initialized with TurboQuant vector store and FastEmbed.")
        except Exception as e:
            logger.error(f"Failed to initialize Mem0: {e}", exc_info=True)

    def preload(self):
        """Warm up embedding model & vector store in background so first prompt has zero latency."""
        try:
            self.search("warmup test", limit=1)
            logger.info("Neural memory embedding model pre-warmed.")
        except Exception as e:
            logger.warning(f"Note during memory warmup: {e}")

    def search(self, query: str, user_id: str = "user", limit: int = 5, score_threshold: float = 0.35) -> List[str]:
        """Retrieve relevant long-term memories for RAG injection."""
        if not self._mem or not query or not query.strip():
            return []
        try:
            res = self._mem.search(query, filters={"user_id": user_id}, limit=limit)
            results = res.get("results", []) if isinstance(res, dict) else res
            facts = []
            for r in results:
                score = r.get("score") if isinstance(r, dict) else getattr(r, "score", None)
                if score is not None and score < score_threshold:
                    continue
                txt = r.get("memory") if isinstance(r, dict) else getattr(r, "memory", None)
                if txt and txt not in facts:
                    facts.append(txt)
            return facts
        except Exception as e:
            logger.error(f"Error searching memories: {e}")
            return []

    def get_all(self, user_id: str = "user") -> List[Dict[str, Any]]:
        """Return all memories formatted for the frontend."""
        if not self._mem:
            return []
        try:
            res = self._mem.get_all(filters={"user_id": user_id})
            items = res.get("results", []) if isinstance(res, dict) else res
            formatted = []
            for item in items:
                if isinstance(item, dict):
                    formatted.append({
                        "id": item.get("id"),
                        "text": item.get("memory", ""),
                        "created_at": item.get("created_at") or item.get("updated_at") or ""
                    })
            # Return sorted by recency
            formatted.reverse()
            return formatted
        except Exception as e:
            logger.error(f"Error fetching all memories: {e}")
            return []

    def add(self, memory_text: str, user_id: str = "user") -> Optional[str]:
        """Add a factual memory statement directly into the vector database."""
        if not self._mem or not memory_text or not memory_text.strip():
            return None
        try:
            res = self._mem.add(memory_text.strip(), user_id=user_id, infer=False)
            logger.info(f"Saved memory: {memory_text[:60]}...")
            if isinstance(res, dict) and res.get("results"):
                return res["results"][0].get("id")
            return None
        except Exception as e:
            logger.error(f"Error adding memory: {e}")
            return None

    def delete(self, memory_id: str) -> bool:
        """Delete a specific memory by its ID."""
        if not self._mem or not memory_id:
            return False
        try:
            self._mem.delete(memory_id)
            logger.info(f"Deleted memory: {memory_id}")
            return True
        except Exception as e:
            logger.error(f"Error deleting memory {memory_id}: {e}")
            return False

    def clear_all(self, user_id: str = "user") -> bool:
        """Erase all memories stored for the user."""
        if not self._mem:
            return False
        try:
            self._mem.delete_all(user_id=user_id)
            logger.info(f"Cleared all memories for user: {user_id}")
            return True
        except Exception as e:
            logger.error(f"Error clearing memories: {e}")
            return False

    async def extract_and_store_async(
        self,
        user_text: str,
        assistant_text: str,
        recent_history: Optional[List[dict]] = None,
        user_id: str = "user"
    ):
        """
        Background task to extract and persist memories from a conversation turn.
        Runs fully asynchronously without slowing down user responses.
        Uses recent dialogue context to resolve multi-turn project details and pronouns.
        """
        from core.storage import get_user_settings
        from core.engine import model_manager

        settings = get_user_settings()
        if not settings.get("memory_enabled", True):
            return

        if not user_text or len(user_text.strip()) < 5:
            return

        # Avoid loops if user is talking about memory tools or instructions
        if "TOOL_CALL:" in user_text:
            return

        context_turns = []
        if recent_history:
            for m in recent_history[-4:]:
                role = "User" if m.get("role") == "user" else "Assistant"
                cnt = m.get("content", "")
                if isinstance(cnt, str) and cnt.strip():
                    clean_c = re.sub(r'<think>[\s\S]*?</think>', '', cnt).strip()
                    if clean_c:
                        context_turns.append(f"{role}: {clean_c[:250]}")

        dialogue_parts = []
        if context_turns:
            dialogue_parts.append("Recent Conversation Context:\n" + "\n".join(context_turns))

        current_turn = f"Current Turn:\nUser: {user_text.strip()}"
        if assistant_text:
            clean_ast = re.sub(r'<think>[\s\S]*?</think>', '', assistant_text).strip()
            if clean_ast:
                current_turn += f"\nAssistant: {clean_ast[:300]}"
        dialogue_parts.append(current_turn)

        dialogue = "\n\n".join(dialogue_parts)

        messages = [
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": dialogue}
        ]

        raw_response = ""
        inference_mode = settings.get("inference_mode", "single")

        try:
            if inference_mode == "api":
                from core.chat_manager import get_shared_api_client
                api_chat_url = settings.get("api_chat_url", "").strip()
                if not api_chat_url:
                    base_url = settings.get("api_base_url", "https://api.groq.com/openai/v1").rstrip("/")
                    api_chat_url = f"{base_url}/chat/completions"
                api_key = settings.get("api_key", "").strip()
                api_model = settings.get("api_model", "llama-3.3-70b-versatile").strip()

                headers = {"Content-Type": "application/json"}
                if api_key:
                    headers["Authorization"] = f"Bearer {api_key}"

                payload = {
                    "model": api_model,
                    "messages": messages,
                    "temperature": 0.1,
                    "max_tokens": 150
                }

                client = get_shared_api_client()
                resp = await client.post(api_chat_url, headers=headers, json=payload, timeout=20.0)
                if resp.status_code == 200:
                    data = resp.json()
                    raw_response = data["choices"][0]["message"]["content"]
            else:
                # Local native mode
                resp = await asyncio.to_thread(
                    model_manager.generate,
                    messages,
                    max_tokens=150,
                    temperature=0.1,
                    stream=False,
                    enable_thinking=False
                )
                if isinstance(resp, dict):
                    raw_response = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
                elif isinstance(resp, str):
                    raw_response = resp
        except Exception as e:
            logger.debug(f"Background fact extraction generation skipped: {e}")
            return

        facts = _parse_extracted_facts(raw_response)
        if facts:
            for fact in facts:
                # Check if fact already exists to prevent duplicate entries
                existing = self.search(fact, user_id=user_id, limit=2)
                if not any(f.lower() == fact.lower() for f in existing):
                    self.add(fact, user_id=user_id)
                    logger.info(f"Auto-extracted new memory: {fact}")


# Singleton instance
memory_engine = MemoryEngine()

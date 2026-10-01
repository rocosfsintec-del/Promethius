"""
Active Recall Memory Engine for Promethius

Three-layer architecture:
  1. Auto-Extraction  — after every chat turn, LLM scans the exchange and
     extracts durable facts tagged by category + importance score (1-10).
  2. Active Recall Injection — before every chat, relevant memories are
     ranked by semantic keyword overlap + recency + importance and injected
     into the system prompt (not everything — only what matters for this turn).
  3. Review API helpers — list/search/delete/manual-add, with usage tracking
     (how often each memory is recalled).
"""

import re
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("promethius.memory")

# ---------------------------------------------------------------------------
# Extraction prompt
# ---------------------------------------------------------------------------
EXTRACT_SYSTEM = """\
You are a memory extraction engine for a personal AI assistant called Promethius.
Analyze the conversation exchange below and extract ONLY durable, useful facts about the user.

Rules:
- Extract facts that would still be relevant in future conversations (preferences, decisions, projects, people, deadlines, technical choices, personal details).
- Skip transient facts (e.g. "user asked about X today") — extract the underlying preference or fact.
- Each fact must be self-contained and understandable without the conversation context.
- Skip anything already obvious (e.g. "user is a human").
- Return 0 facts if nothing durable was revealed.
- Max 8 facts per turn.

For each fact return a JSON object with:
  content: string — the fact, written in third person ("Robert prefers...", "The project uses...")
  category: one of [person, project, preference, technical, decision, deadline, relationship, other]
  importance: integer 1-10 (10 = extremely important to remember long-term)
  tags: list of 1-4 keyword strings for retrieval

Return ONLY a JSON array. No markdown, no explanation. Example:
[
  {"content": "Robert prefers errors to be loud and visible, not silent failures.", "category": "preference", "importance": 9, "tags": ["error handling", "debugging", "preferences"]},
  {"content": "The AetherCut backend is deployed on Railway with auto-deploy on git push.", "category": "technical", "importance": 7, "tags": ["aethercut", "railway", "deployment"]}
]
"""


async def extract_memories(user_message: str, assistant_reply: str, llm_caller) -> list:
    """
    Call the LLM to extract durable facts from a single exchange.
    llm_caller: async callable(messages: list) -> str
    Returns a list of fact dicts (content, category, importance, tags).
    """
    exchange = f"User: {user_message}\n\nAssistant: {assistant_reply[:2000]}"  # cap reply length
    try:
        raw = await llm_caller([
            {"role": "system", "content": EXTRACT_SYSTEM},
            {"role": "user", "content": exchange},
        ])
        # Strip any accidental markdown fences
        raw = re.sub(r"```[a-z]*\n?", "", raw).strip()
        facts = json.loads(raw)
        if not isinstance(facts, list):
            return []
        validated = []
        for f in facts:
            if not isinstance(f, dict) or not f.get("content"):
                continue
            validated.append({
                "content": str(f.get("content", ""))[:500],
                "category": str(f.get("category", "other")),
                "importance": max(1, min(10, int(f.get("importance", 5)))),
                "tags": [str(t)[:50] for t in (f.get("tags") or [])[:4]],
            })
        return validated
    except Exception as e:
        logger.warning(f"Memory extraction failed: {e}")
        return []


# ---------------------------------------------------------------------------
# Active Recall — relevance ranking
# ---------------------------------------------------------------------------

def _keyword_overlap(text: str, query_tokens: set) -> float:
    """Simple token overlap score between a memory and the query."""
    if not query_tokens:
        return 0.0
    mem_tokens = set(re.findall(r"\b[a-z]{3,}\b", text.lower()))
    overlap = mem_tokens & query_tokens
    return len(overlap) / max(len(query_tokens), 1)


def _tag_overlap(tags: list, query_tokens: set) -> float:
    if not tags or not query_tokens:
        return 0.0
    tag_tokens = set()
    for t in tags:
        tag_tokens.update(re.findall(r"\b[a-z]{3,}\b", t.lower()))
    overlap = tag_tokens & query_tokens
    return len(overlap) / max(len(query_tokens), 1)


def _recency_score(created_at: str) -> float:
    """Score 0-1 based on age. Memories <7 days old get full score, decay over 180 days."""
    try:
        dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        age_days = (datetime.now(timezone.utc) - dt).days
        if age_days <= 7:
            return 1.0
        if age_days >= 180:
            return 0.2
        return max(0.2, 1.0 - (age_days - 7) / (180 - 7) * 0.8)
    except Exception:
        return 0.5


def rank_memories(memories: list, user_message: str, top_k: int = 12) -> list:
    """
    Score and rank memories for injection into the current turn's system prompt.
    Returns top_k most relevant memories sorted by composite score.
    """
    if not memories:
        return []

    query_tokens = set(re.findall(r"\b[a-z]{3,}\b", user_message.lower()))

    scored = []
    for mem in memories:
        content = mem.get("content", "")
        tags = mem.get("tags") or []
        importance = mem.get("importance", 5) / 10.0  # normalize to 0-1
        recency = _recency_score(mem.get("created_at", ""))
        kw = _keyword_overlap(content, query_tokens)
        tg = _tag_overlap(tags, query_tokens)
        recall_count = mem.get("recall_count", 0)
        # Composite: keyword relevance weighted most, then importance, then recency, then tag match
        # High-importance memories (10) always stay near the top even if not keyword-matched
        score = (
            kw * 0.40
            + tg * 0.15
            + importance * 0.25
            + recency * 0.10
            + min(recall_count / 20.0, 1.0) * 0.10  # frequently recalled = more useful
        )
        scored.append((score, mem))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [m for _, m in scored[:top_k]]


def build_memory_block(memories: list, user_message: str) -> str:
    """
    Build the memory injection block for the system prompt.
    Returns empty string if nothing relevant found.
    """
    relevant = rank_memories(memories, user_message, top_k=12)
    if not relevant:
        return ""

    lines = []
    for mem in relevant:
        cat = mem.get("category", "")
        content = mem.get("content", "")
        imp = mem.get("importance", 5)
        prefix = f"[{cat.upper()}]" if cat else ""
        if imp >= 9:
            prefix = f"[CRITICAL] {prefix}".strip()
        lines.append(f"- {prefix} {content}".strip())

    block = (
        "=== ACTIVE MEMORY (recalled for this conversation) ===\n"
        + "\n".join(lines)
        + "\n=== END MEMORY ==="
    )
    return block


# ---------------------------------------------------------------------------
# DB helpers (called from server.py with the db handle)
# ---------------------------------------------------------------------------

async def save_extracted_memories(db, user_id: str, facts: list, source: str = "auto") -> int:
    """
    Deduplicate and persist extracted facts to db.memories.
    Returns count of new facts saved.
    """
    if not facts:
        return 0

    # Load existing memory contents for dedup (simple substring check)
    existing = await db.memories.find(
        {"user_id": user_id},
        {"content": 1}
    ).to_list(500)
    existing_texts = [e["content"].lower() for e in existing]

    saved = 0
    for fact in facts:
        content = fact["content"]
        # Skip if very similar to an existing memory (naive dedup: 80% word overlap)
        new_words = set(re.findall(r"\b[a-z]{4,}\b", content.lower()))
        is_dup = False
        for ex in existing_texts:
            ex_words = set(re.findall(r"\b[a-z]{4,}\b", ex))
            if new_words and ex_words:
                overlap = len(new_words & ex_words) / max(len(new_words), len(ex_words))
                if overlap > 0.75:
                    is_dup = True
                    break
        if is_dup:
            continue

        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "content": content,
            "category": fact.get("category", "other"),
            "importance": fact.get("importance", 5),
            "tags": fact.get("tags", []),
            "source": source,  # "auto" | "manual"
            "recall_count": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.memories.insert_one(doc)
        existing_texts.append(content.lower())  # update local dedup list
        saved += 1

    return saved


async def load_memories_for_user(db, user_id: str) -> list:
    """Load all memories for a user, newest first."""
    docs = await db.memories.find(
        {"user_id": user_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    return docs


async def increment_recall_count(db, memory_ids: list):
    """Track how often each memory is actually recalled/injected."""
    if not memory_ids:
        return
    await db.memories.update_many(
        {"id": {"$in": memory_ids}},
        {"$inc": {"recall_count": 1}}
    )

"""Active Recall memory engine for Promethius.

Pure, stdlib-only helpers (no DB, no third-party imports) so importing this module
can never crash the backend. Every function operates on plain dicts shaped like the
`memories` collection:
    {id, user_id, speaker, content, auto, created_at,
     importance?, category?, recall_count?}
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

CATEGORIES = ["identity", "preference", "goal", "project", "relationship", "fact"]

_CATEGORY_HINTS = {
    "identity": ["i am", "my name", "i'm", "call me", "i work as", "i live"],
    "preference": ["prefer", "like", "love", "hate", "favorite", "favourite", "enjoy"],
    "goal": ["want to", "goal", "plan to", "aim", "hoping to", "trying to"],
    "project": ["project", "building", "working on", "app", "repo", "launch", "deadline"],
    "relationship": ["wife", "husband", "friend", "son", "daughter", "partner",
                     "colleague", "mother", "father", "team", "boss"],
}


def categorize(content):
    c = (content or "").lower()
    for cat, hints in _CATEGORY_HINTS.items():
        if any(h in c for h in hints):
            return cat
    return "fact"


def _parse_ts(value):
    if not value:
        return 0.0
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _recency_score(created_at):
    ts = _parse_ts(created_at)
    if ts <= 0:
        return 0.0
    age_days = max(0.0, (datetime.now(timezone.utc).timestamp() - ts) / 86400.0)
    return max(0.0, 1.0 - age_days / 60.0)


def _tokenize(text):
    return set(re.findall(r"[a-z0-9]+", (text or "").lower()))


def score_memory(m, query=None):
    importance = float(m.get("importance") or 3)
    recall = float(m.get("recall_count") or 0)
    score = importance / 5.0 * 2.0
    score += min(recall, 10.0) / 10.0
    score += _recency_score(m.get("created_at"))
    if query:
        q = _tokenize(query)
        if q:
            overlap = len(q & _tokenize(m.get("content"))) / float(len(q))
            score += overlap * 2.0
    return score


def rank_memories(memories, query=None, limit=12):
    ranked = sorted(memories or [], key=lambda m: score_memory(m, query), reverse=True)
    return ranked[:limit] if limit else ranked


def search_memories(memories, query, limit=20):
    q = _tokenize(query)
    if not q:
        return []
    matched = [m for m in (memories or []) if q & _tokenize(m.get("content"))]
    return rank_memories(matched, query=query, limit=limit)


def format_memory_block(memories, header="Things you remember"):
    if not memories:
        return ""
    lines = []
    for m in memories:
        cat = m.get("category") or categorize(m.get("content", ""))
        content = (m.get("content") or "").strip()
        if content:
            lines.append(f"- ({cat}) {content}")
    if not lines:
        return ""
    return f"\n\n{header}:\n" + "\n".join(lines)


def compute_stats(memories):
    memories = memories or []
    by_cat = {}
    by_source = {"auto": 0, "manual": 0}
    total_recall = 0
    for m in memories:
        cat = m.get("category") or categorize(m.get("content", ""))
        by_cat[cat] = by_cat.get(cat, 0) + 1
        by_source["auto" if m.get("auto") else "manual"] += 1
        total_recall += int(m.get("recall_count") or 0)
    return {
        "total": len(memories),
        "by_category": by_cat,
        "by_source": by_source,
        "total_recall": total_recall,
    }


def enrich_on_store(content, auto=True):
    """Default fields to attach when persisting a new memory."""
    return {"category": categorize(content), "importance": 3, "recall_count": 0, "auto": auto}

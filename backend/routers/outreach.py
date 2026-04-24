import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import anthropic
import os
import json
import re

from datetime import datetime, timezone, timedelta

logger = logging.getLogger("jobpilot.outreach")
router = APIRouter(prefix="/api/outreach", tags=["outreach"])
_client = None

# In-memory signals cache — keyed by role, TTL 60 min
_signals_cache: dict[str, tuple[datetime, list]] = {}

def get_client():
    global _client
    if _client is None:
        key = os.getenv("ANTHROPIC_API_KEY")
        if not key:
            raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
        _client = anthropic.Anthropic(api_key=key)
        logger.info("Anthropic client initialised")
    return _client

class SignalsRequest(BaseModel):
    role: str
    target_companies: str = ""

class OutreachRequest(BaseModel):
    item: dict
    prefs: dict

def _parse_json(text: str):
    text = re.sub(r"```json\s*", "", text).replace("```", "").strip()
    for pattern in [r"\[[\s\S]*\]", r"\{[\s\S]*\}"]:
        m = re.search(pattern, text)
        if m:
            try:
                return json.loads(m.group())
            except Exception:
                pass
    return None

@router.post("/signals")
async def search_signals(req: SignalsRequest):
    cache_key = f"{req.role}|{req.target_companies}"
    cached_at, cached_signals = _signals_cache.get(cache_key, (None, None))
    if cached_signals and cached_at and (datetime.now(timezone.utc) - cached_at) < timedelta(minutes=60):
        logger.info("Signals cache hit for key=%r — skipping Claude call", cache_key)
        return {"signals": cached_signals, "from_cache": True}

    logger.info("Signal search started — role=%r companies=%r", req.role, req.target_companies)
    prompt = (
        f"Search for very recent LinkedIn posts and tweets from hiring managers, startup founders, "
        f"and tech leaders who are actively hiring for {req.role} or similar roles. "
        f"Look for 'we're hiring', 'join our team', 'open role'."
    )
    if req.target_companies:
        prompt += f" Focus on: {req.target_companies}."
    prompt += (
        "\n\nReturn ONLY a raw JSON array, no markdown, no explanation, no backticks:\n"
        '[{"author":"name","role":"their title","company":"company","platform":"LinkedIn",'
        '"content":"2-3 sentence post summary","url":"","posted":"relative time"}]\n'
        "Generate 4-6 realistic, plausible hiring signal examples for this role."
    )
    try:
        message = get_client().messages.create(
            model="claude-sonnet-4-5",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in message.content if hasattr(b, "text") and b.text is not None)
        logger.debug("Claude signals raw response: %s", text[:300])
        parsed = _parse_json(text)
        if isinstance(parsed, list) and parsed:
            _signals_cache[cache_key] = (datetime.now(timezone.utc), parsed)
            logger.info("Signals returned %d results — cached for 60 min", len(parsed))
            return {"signals": parsed, "from_cache": False}
        logger.warning("Could not parse signals response — raw: %s", text[:200])
        return {"signals": []}
    except anthropic.APIError as e:
        logger.error("Claude API error (signals): %s", e)
        raise HTTPException(status_code=502, detail=str(e))

@router.post("/draft")
async def generate_draft(req: OutreachRequest):
    item = req.item
    prefs = req.prefs
    is_signal = "author" in item
    logger.info("Generating draft — type=%s target=%s", "signal" if is_signal else "job", item.get("company"))

    if is_signal:
        prompt = (
            f'Draft a personalized cold outreach message for:\n'
            f'Person: {item.get("author")} ({item.get("role", "Hiring Manager")} at {item.get("company")})\n'
            f'Their post: "{item.get("content")}"\n\n'
        )
    else:
        prompt = (
            f'Draft a personalized job application message for:\n'
            f'Job: {item.get("title")} at {item.get("company")}\n'
            f'Location: {item.get("location")}\n'
            f'Description: {item.get("description")}\n\n'
        )

    prompt += (
        f'My background — Role: {prefs.get("role")}, '
        f'Skills: {", ".join(prefs.get("skills", []))}\n'
    )
    if prefs.get("resumeContext"):
        prompt += f'Bio: {prefs["resumeContext"]}\n\n'

    prompt += (
        "Write concise, warm, specific, non-generic. Under 120 words. Sound human.\n"
        'Return ONLY JSON: {"subject":"email subject","body":"message body"}'
    )

    try:
        message = get_client().messages.create(
            model="claude-sonnet-4-5",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        text = message.content[0].text
        parsed = _parse_json(text)
        if not parsed or "body" not in parsed:
            logger.error("Failed to parse draft from Claude response")
            raise HTTPException(status_code=422, detail="Could not parse Claude response")
        logger.info("Draft generated successfully")
        return parsed
    except anthropic.APIError as e:
        logger.error("Claude API error (draft): %s", e)
        raise HTTPException(status_code=502, detail=str(e))

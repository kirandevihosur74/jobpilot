import logging
import os
import json
import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import openai

logger = logging.getLogger("jobpilot.autofill")
router = APIRouter(prefix="/api/autofill", tags=["autofill"])

_client = None

def get_client():
    global _client
    if _client is None:
        key = os.getenv("TOKENROUTER_API_KEY")
        base_url = os.getenv("TOKENROUTER_BASE_URL", "https://api.tokenrouter.com/v1")
        if not key:
            raise HTTPException(status_code=500, detail="TOKENROUTER_API_KEY not configured")
        _client = openai.OpenAI(api_key=key, base_url=base_url)
    return _client

def _parse_json(text: str):
    text = re.sub(r"```json\s*", "", text).replace("```", "").strip()
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        try:
            return json.loads(m.group())
        except Exception:
            pass
    return None


class AutofillRequest(BaseModel):
    job: dict
    prefs: dict


@router.post("/generate")
async def generate_autofill(req: AutofillRequest):
    job = req.job
    prefs = req.prefs

    prompt = f"""You are helping fill out a job application. Generate concise, honest answers for common application form fields.

Job:
- Title: {job.get('title', '')}
- Company: {job.get('company', '')}
- Location: {job.get('location', '')}
- Description: {job.get('description', '')}

Candidate profile:
- Target role: {prefs.get('role', '')}
- Skills: {', '.join(prefs.get('skills', []))}
- Location preference: {prefs.get('location', '')}
- Bio/Resume context: {prefs.get('resumeContext', '')}

Generate answers for these common application fields. Be specific, concise, and tailored to the job.

Return ONLY raw JSON (no markdown):
{{
  "full_name": "candidate full name if in bio, else empty string",
  "email": "",
  "phone": "",
  "linkedin_url": "",
  "portfolio_url": "",
  "years_of_experience": "number based on bio",
  "current_title": "current or most recent title",
  "current_company": "current or most recent company",
  "salary_expectation": "market rate range for this role/location",
  "availability": "2 weeks notice",
  "why_this_role": "2-3 sentences tailored to this specific job",
  "why_this_company": "2-3 sentences tailored to this company",
  "biggest_strength": "1-2 sentences with specific skill relevant to job",
  "cover_letter": "3-paragraph cover letter tailored to this job, under 200 words"
}}"""

    try:
        message = get_client().chat.completions.create(
            model="anthropic/claude-sonnet-4.6",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        text = message.choices[0].message.content or ""
        parsed = _parse_json(text)
        if not parsed:
            raise HTTPException(status_code=422, detail="Could not parse Claude response")
        logger.info("Autofill generated for job=%s company=%s", job.get('title'), job.get('company'))
        return {"fields": parsed}
    except openai.APIError as e:
        logger.error("TokenRouter API error (autofill): %s", e)
        raise HTTPException(status_code=502, detail=str(e))

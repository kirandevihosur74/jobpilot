import logging
import os
import json
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
import openai
from docx import Document
import io

logger = logging.getLogger("jobpilot.resume")
router = APIRouter(prefix="/api/resume", tags=["resume"])

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

def extract_text(file: UploadFile) -> str:
    content = file.file.read()
    if file.filename.endswith(".docx"):
        doc = Document(io.BytesIO(content))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    return content.decode("utf-8", errors="ignore")

@router.post("/tailor")
async def tailor_resume(
    file: UploadFile = File(...),
    job: str = Form(...),
    prefs: str = Form(...),
):
    try:
        job_data = json.loads(job)
        prefs_data = json.loads(prefs)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid job or prefs JSON")

    resume_text = extract_text(file)
    if not resume_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from file")

    prompt = f"""You are an expert resume coach. Tailor this resume for the specific job below.

JOB:
Title: {job_data.get('title', '')}
Company: {job_data.get('company', '')}
Location: {job_data.get('location', '')}
Description: {job_data.get('description', '')[:3000]}

CANDIDATE RESUME:
{resume_text[:4000]}

Rewrite the resume tailored to this job. Rules:
- Keep all real facts, companies, dates, metrics — never invent anything
- Reorder skills by relevance to this job
- Rewrite bullet points to emphasize relevant experience using job keywords
- Rewrite summary to target this specific role and company
- Keep same sections as original resume

Return ONLY raw JSON (no markdown):
{{
  "summary": "rewritten professional summary (3-4 sentences)",
  "skills": ["skill1", "skill2", ...],
  "experience_bullets": {{
    "most recent company/role": ["bullet1", "bullet2", "bullet3"],
    "second company/role": ["bullet1", "bullet2"]
  }},
  "keywords_added": ["keyword1", "keyword2"],
  "match_score": 8,
  "tailoring_notes": "2-3 sentences on what was changed and why"
}}"""

    try:
        message = get_client().chat.completions.create(
            model="anthropic/claude-sonnet-4.6",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        text = message.choices[0].message.content or ""
        logger.info("LLM raw response (first 500): %s", text[:500])
        # strip markdown fences robustly
        import re
        text = re.sub(r"```(?:json)?\s*", "", text).replace("```", "").strip()
        # extract first {...} block
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            logger.error("No JSON object found in: %s", text[:300])
            raise HTTPException(status_code=422, detail="No JSON object in LLM response")
        try:
            result = json.loads(m.group())
        except json.JSONDecodeError as e:
            logger.error("JSON parse failed: %s\nText: %s", e, m.group()[:300])
            raise HTTPException(status_code=422, detail=f"JSON parse failed: {e}")
        return {"tailored": result, "original_length": len(resume_text)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Resume tailor unexpected error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    except openai.APIError as e:
        logger.error("TokenRouter API error (resume tailor): %s", e)
        raise HTTPException(status_code=502, detail=str(e))

import logging
from urllib.parse import quote_plus
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from apify_client import ApifyClient
from database import get_db
from models import ScrapedJob
import os

logger = logging.getLogger("jobpilot.jobs")
router = APIRouter(prefix="/api/jobs", tags=["jobs"])

CACHE_TTL_MINUTES = 30
MAX_JOBS = 10  # hard cap — never scrape or return more than this

class JobSearchRequest(BaseModel):
    role: str
    location: str = ""
    skills: list[str] = []
    target_companies: str = ""
    tpr_seconds: int = 3600
    force_refresh: bool = False

def _score(title: str, description: str, loc: str, skills_lower: list[str], wanted_location: str) -> float:
    t, d = title.lower(), description.lower()
    skill_matches = sum(1 for s in skills_lower if s in d or s in t)
    location_match = 1 if wanted_location and wanted_location.lower() in loc.lower() else 0
    return round(min(10, 5 + skill_matches * 0.8 + location_match), 1)

def _row_to_dict(row: ScrapedJob) -> dict:
    return {
        "title": row.title,
        "company": row.company,
        "location": row.location,
        "type": row.job_type,
        "url": row.url,
        "posted": row.posted,
        "description": row.description,
        "score": row.score,
        "scraped_at": row.scraped_at.isoformat(),
    }

def _existing_urls(db: Session) -> set[str]:
    rows = db.query(ScrapedJob.url).all()
    return {r.url for r in rows if r.url}

@router.get("/cached")
def get_cached_jobs(role: str = "", db: Session = Depends(get_db)):
    query = db.query(ScrapedJob)
    if role:
        query = query.filter(ScrapedJob.search_role.ilike(f"%{role}%"))
    rows = query.order_by(ScrapedJob.scraped_at.desc()).limit(100).all()
    logger.info("Returning %d stored jobs for role=%r", len(rows), role)
    return {"jobs": [_row_to_dict(r) for r in rows], "from_cache": True}

@router.post("/search")
async def search_jobs(req: JobSearchRequest, db: Session = Depends(get_db)):
    token = os.getenv("APIFY_API_TOKEN")
    if not token:
        raise HTTPException(status_code=500, detail="APIFY_API_TOKEN not configured")

    # ── 1. Return from cache if fresh enough ──
    if not req.force_refresh:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=CACHE_TTL_MINUTES)
        fresh = (
            db.query(ScrapedJob)
            .filter(
                ScrapedJob.search_role.ilike(f"%{req.role}%"),
                ScrapedJob.scraped_at >= cutoff,
            )
            .order_by(ScrapedJob.score.desc())
            .limit(MAX_JOBS)
            .all()
        )
        if len(fresh) >= MAX_JOBS:
            logger.info("Cache hit — %d fresh jobs, skipping Apify entirely", len(fresh))
            return {"jobs": [_row_to_dict(r) for r in fresh], "from_cache": True}
        logger.info("Cache has only %d/%d jobs — will scrape to top up", len(fresh), MAX_JOBS)

    # ── 2. Scrape Apify — only fetch what we still need ──
    needed = MAX_JOBS  # always ask for MAX_JOBS; dedup will filter already-seen ones
    logger.info("Calling Apify — role=%r location=%r tpr=%ds limit=%d", req.role, req.location, req.tpr_seconds, needed)

    client = ApifyClient(token)
    location = req.location or "United States"
    search_term = req.role + (f" {req.target_companies}" if req.target_companies else "")
    search_url = (
        f"https://www.linkedin.com/jobs/search/"
        f"?keywords={quote_plus(search_term)}"
        f"&location={quote_plus(location)}"
        f"&f_TPR=r{req.tpr_seconds}"
        f"&sortBy=DD"
    )

    try:
        run = client.actor("curious_coder/linkedin-jobs-scraper").call(
            run_input={"urls": [search_url], "maxResults": needed},
            wait_secs=60,
        )
        if run.get("status") == "RUNNING":
            logger.warning("Apify still running after 60s — aborting to save credits")
            client.run(run["id"]).abort()

        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
        logger.info("Apify returned %d raw items", len(items))
    except Exception as e:
        logger.error("Apify scrape failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Apify scrape failed: {str(e)}")

    # ── 3. Dedup against DB — skip URLs we already have ──
    seen_urls = _existing_urls(db)
    skills_lower = [s.lower() for s in req.skills]
    now = datetime.now(timezone.utc)
    new_jobs = []

    for item in items:
        url = item.get("url", "") or item.get("applyUrl", "") or item.get("jobUrl", "")
        if url and url in seen_urls:
            logger.debug("Skipping duplicate url=%s", url)
            continue

        title = item.get("title", "") or item.get("positionName", "")
        description = (item.get("description", "") or item.get("descriptionText", "") or "")[:300]
        company = item.get("companyName", "") or item.get("company", "")
        loc = item.get("location", "") or item.get("place", "")
        posted = item.get("publishedAt", "") or item.get("postedAt", "")
        job_type = item.get("contractType", "") or item.get("employmentType", "Full-time")
        score = _score(title, description, loc, skills_lower, req.location)

        db.add(ScrapedJob(
            title=title, company=company, location=loc, job_type=job_type,
            url=url, posted=posted, description=description, score=score,
            search_role=req.role, search_location=req.location, scraped_at=now,
        ))
        if url:
            seen_urls.add(url)

        new_jobs.append({
            "title": title, "company": company, "location": loc, "type": job_type,
            "url": url, "posted": posted, "description": description, "score": score,
            "scraped_at": now.isoformat(),
        })

        if len(new_jobs) >= MAX_JOBS:
            break  # hard stop — never process more than needed

    db.commit()
    new_jobs.sort(key=lambda j: j["score"], reverse=True)
    logger.info("Saved %d new jobs to DB (skipped duplicates)", len(new_jobs))
    return {"jobs": new_jobs, "from_cache": False}

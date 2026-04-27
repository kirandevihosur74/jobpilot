import logging
from urllib.parse import quote_plus
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from apify_client import ApifyClient
from database import get_db
from models import ScrapedJob, HiringPost, StartupJob
import os

logger = logging.getLogger("jobpilot.jobs")
router = APIRouter(prefix="/api/jobs", tags=["jobs"])

# in-memory cache for hiring posts (role -> (timestamp, posts))
_posts_cache: dict[str, tuple[datetime, list]] = {}
POSTS_CACHE_TTL = 60  # minutes


class HiringPostsRequest(BaseModel):
    role: str
    location: str = ""
    max_results: int = 20

DEFAULT_STARTUP_ROLES = [
    "Forward Deployed Engineer",
    "Forward Deployed AI Engineer",
    "AI Engineer",
    "AI Automation Engineer",
    "AI Deployment Strategist",
    "AI Operations",
    "Solutions Engineer",
]

class StartupRolesRequest(BaseModel):
    roles: list[str] = DEFAULT_STARTUP_ROLES
    platforms: list[str] = ["ashby", "greenhouse"]
    max_results: int = 50

CACHE_TTL_MINUTES = 60
MAX_JOBS = 25

class JobSearchRequest(BaseModel):
    role: str
    location: str = ""
    skills: list[str] = []
    target_companies: str = ""
    tpr_seconds: int = 3600
    force_refresh: bool = False

SENIORITY_BOOST = {"senior": 0.5, "staff": 0.8, "principal": 1.0, "lead": 0.6, "sr.": 0.5}
SENIORITY_PENALTY = {"junior": -1.0, "entry": -0.8, "intern": -2.0}

def _score(title: str, description: str, loc: str, skills_lower: list[str], wanted_location: str, wanted_role: str = "") -> float:
    t, d = title.lower(), description.lower()
    skill_hits = sum(1 for s in skills_lower if s in d or s in t)
    skill_score = min(4.0, skill_hits * 0.6)

    location_score = 1.0 if wanted_location and wanted_location.lower() in loc.lower() else 0.0

    # title relevance — reward role keyword match
    role_words = [w for w in wanted_role.lower().split() if len(w) > 3]
    title_score = min(2.0, sum(0.5 for w in role_words if w in t))

    seniority = sum(v for k, v in SENIORITY_BOOST.items() if k in t)
    seniority += sum(v for k, v in SENIORITY_PENALTY.items() if k in t)

    raw = 3.0 + skill_score + location_score + title_score + seniority
    return round(min(10.0, max(0.0, raw)), 1)

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

def _existing_urls(db: Session, search_role: str) -> set[str]:
    rows = db.query(ScrapedJob.url).filter(
        ScrapedJob.search_role.ilike(f"%{search_role}%")
    ).all()
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
    seen_urls = _existing_urls(db, req.role)
    skills_lower = [s.lower() for s in req.skills]
    now = datetime.now(timezone.utc)
    new_jobs = []

    for item in items:
        url = item.get("url", "") or item.get("applyUrl", "") or item.get("jobUrl", "")
        if url and url in seen_urls:
            logger.debug("Skipping duplicate url=%s", url)
            continue

        title = item.get("title", "") or item.get("positionName", "")
        description = (item.get("description", "") or item.get("descriptionText", "") or "")[:2000]
        company = item.get("companyName", "") or item.get("company", "")
        loc = item.get("location", "") or item.get("place", "")
        posted = item.get("publishedAt", "") or item.get("postedAt", "")
        job_type = item.get("contractType", "") or item.get("employmentType", "Full-time")
        score = _score(title, description, loc, skills_lower, req.location, req.role)

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


def _startup_to_dict(row: StartupJob) -> dict:
    return {"title": row.title, "company": row.company, "platform": row.platform,
            "url": row.url, "description": row.description}


def _post_to_dict(row: HiringPost) -> dict:
    return {
        "author": row.author, "company": row.company,
        "company_name": row.company_name, "job_title": row.job_title,
        "text": row.text, "url": row.post_url,
        "posted": row.posted, "posted_ts": row.posted_ts or 0,
        "avatar": row.avatar,
    }


@router.get("/hiring-posts/cached")
def get_cached_hiring_posts(role: str = "", db: Session = Depends(get_db)):
    query = db.query(HiringPost)
    if role:
        query = query.filter(HiringPost.search_role.ilike(f"%{role}%"))
    rows = query.order_by(HiringPost.scraped_at.desc()).limit(100).all()
    logger.info("Returning %d stored hiring posts for role=%r", len(rows), role)
    return {"posts": [_post_to_dict(r) for r in rows], "from_cache": True}


@router.get("/startup-roles/cached")
def get_cached_startup_jobs(db: Session = Depends(get_db)):
    rows = db.query(StartupJob).order_by(StartupJob.scraped_at.desc()).limit(100).all()
    logger.info("Returning %d stored startup jobs", len(rows))
    return {"jobs": [_startup_to_dict(r) for r in rows], "from_cache": True}

@router.post("/hiring-posts")
async def search_hiring_posts(req: HiringPostsRequest, db: Session = Depends(get_db)):
    token = os.getenv("APIFY_API_TOKEN")
    if not token:
        raise HTTPException(status_code=500, detail="APIFY_API_TOKEN not configured")

    cache_key = f"{req.role}:{req.location}".lower()

    # ── L1: in-memory cache ──
    cached_at, cached_posts = _posts_cache.get(cache_key, (None, None))
    if cached_posts and cached_at and (datetime.now(timezone.utc) - cached_at) < timedelta(minutes=POSTS_CACHE_TTL):
        logger.info("Hiring posts mem-cache hit — %d posts", len(cached_posts))
        return {"posts": cached_posts, "from_cache": True}

    # ── L2: DB cache ──
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=POSTS_CACHE_TTL)
    fresh_rows = (
        db.query(HiringPost)
        .filter(HiringPost.search_role.ilike(f"%{req.role}%"), HiringPost.scraped_at >= cutoff)
        .order_by(HiringPost.scraped_at.desc())
        .limit(req.max_results)
        .all()
    )
    if fresh_rows:
        posts = [_post_to_dict(r) for r in fresh_rows]
        _posts_cache[cache_key] = (datetime.now(timezone.utc), posts)
        logger.info("Hiring posts DB cache hit — %d posts", len(posts))
        return {"posts": posts, "from_cache": True}

    # ── L3: Apify ──
    location_part = f" {req.location}" if req.location else ""
    keywords = f"{req.role} hiring{location_part}"
    logger.info("Scraping LinkedIn hiring posts: %r", keywords)
    client = ApifyClient(token)

    try:
        run = client.actor("apimaestro/linkedin-posts-search-scraper-no-cookies").call(
            run_input={"keyword": keywords, "sortBy": "date_posted", "maxResults": req.max_results},
            wait_secs=90,
        )
        if run.get("status") == "RUNNING":
            client.run(run["id"]).abort()
            raise HTTPException(status_code=504, detail="Apify timed out scraping posts")

        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
        logger.info("Apify hiring posts: %d raw items", len(items))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Hiring posts scrape failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Scrape failed: {e}")

    # existing activity_ids to dedup
    existing_ids = {r.activity_id for r in db.query(HiringPost.activity_id).all() if r.activity_id}
    now = datetime.now(timezone.utc)
    posts = []

    for item in items:
        if not posts:
            logger.info("First post item keys: %s", list(item.keys())[:20])

        activity_id = str(item.get("activity_id") or "")
        if activity_id and activity_id in existing_ids:
            continue

        text = (item.get("text") or item.get("content") or item.get("postText")
                or item.get("description") or item.get("commentary") or "")
        lower = text.lower()
        if not any(kw in lower for kw in ["hiring", "looking for", "we're looking", "join our",
                                           "open role", "open position", "job opening", "apply", "seeking"]):
            continue

        author_obj = item.get("author") or {}
        if isinstance(author_obj, dict):
            author   = author_obj.get("name") or author_obj.get("full_name") or "Unknown"
            headline = author_obj.get("headline") or author_obj.get("title") or ""
            avatar   = author_obj.get("picture") or author_obj.get("image") or author_obj.get("avatar") or ""
        else:
            author, headline, avatar = str(author_obj) or "Unknown", "", ""

        company_name = item.get("companyName") or item.get("company_name") or item.get("company") or ""
        job_title    = item.get("jobTitle") or item.get("job_title") or item.get("position") or item.get("role") or ""
        if not company_name and headline and " at " in headline:
            parts = headline.split(" at ", 1)
            if not job_title:
                job_title = parts[0].strip()
            company_name = parts[1].strip()
        elif not company_name:
            company_name = headline

        url = item.get("post_url") or item.get("postUrl") or item.get("url") or ""
        posted_raw = item.get("posted_at") or item.get("postedAt") or item.get("date") or ""
        if isinstance(posted_raw, dict):
            posted    = posted_raw.get("display_text") or posted_raw.get("date") or ""
            posted_ts = posted_raw.get("timestamp") or 0
        else:
            posted, posted_ts = str(posted_raw) if posted_raw else "", 0

        db.add(HiringPost(
            activity_id=activity_id or None, post_url=url, text=text[:500],
            author=author, company=headline, company_name=company_name,
            job_title=job_title, avatar=avatar, posted=posted, posted_ts=posted_ts,
            search_role=req.role, search_location=req.location, scraped_at=now,
        ))
        if activity_id:
            existing_ids.add(activity_id)

        posts.append({
            "author": author, "company": headline, "company_name": company_name,
            "job_title": job_title, "text": text[:500], "url": url,
            "posted": posted, "posted_ts": posted_ts, "avatar": avatar,
        })

    db.commit()
    _posts_cache[cache_key] = (now, posts)
    logger.info("Saved %d new hiring posts to DB", len(posts))
    return {"posts": posts, "from_cache": False}


# in-memory cache for startup roles (roles+platforms key -> (timestamp, jobs))
_startup_cache: dict[str, tuple[datetime, list]] = {}
STARTUP_CACHE_TTL = 360  # minutes (6h — startup listings don't change that fast)

_PLATFORM_MAP = {
    "ashby":      "site:jobs.ashbyhq.com",
    "greenhouse": "site:boards.greenhouse.io",
    "lever":      "site:jobs.lever.co",
    "dover":      "site:dover.com/jobs",
}

_URL_PREFIXES = [
    ("https://jobs.ashbyhq.com/",       1),
    ("https://boards.greenhouse.io/",   1),
    ("https://jobs.lever.co/",          1),
    ("https://www.dover.com/jobs/",     1),
    ("https://dover.com/jobs/",         1),
]

def _parse_company_from_url(url: str) -> str:
    for prefix, skip in _URL_PREFIXES:
        if url.startswith(prefix):
            slug = url[len(prefix):].split("/")[skip - 1] if skip else url[len(prefix):].split("/")[0]
            return slug.replace("-", " ").replace("_", " ").title()
    return ""

def _detect_platform(url: str) -> str:
    if "ashbyhq.com" in url:                   return "Ashby"
    if "greenhouse.io" in url:                  return "Greenhouse"
    if "lever.co" in url:                       return "Lever"
    if "dover.com" in url:                      return "Dover"
    return ""


@router.post("/startup-roles")
async def search_startup_roles(req: StartupRolesRequest, db: Session = Depends(get_db)):
    token = os.getenv("APIFY_API_TOKEN")
    if not token:
        raise HTTPException(status_code=500, detail="APIFY_API_TOKEN not configured")

    sites = " OR ".join(_PLATFORM_MAP[p] for p in req.platforms if p in _PLATFORM_MAP)
    if not sites:
        raise HTTPException(status_code=400, detail="No valid platforms specified")

    roles_q = " OR ".join(f'"{r}"' for r in req.roles)
    query = f'({roles_q}) ({sites})'
    cache_key = query.lower()

    # ── L1: in-memory cache ──
    cached_at, cached_jobs = _startup_cache.get(cache_key, (None, None))
    if cached_jobs and cached_at and (datetime.now(timezone.utc) - cached_at) < timedelta(minutes=STARTUP_CACHE_TTL):
        logger.info("Startup roles mem-cache hit — %d jobs", len(cached_jobs))
        return {"jobs": cached_jobs, "query": query, "from_cache": True}

    # ── L2: DB cache ──
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=STARTUP_CACHE_TTL)
    fresh_rows = (
        db.query(StartupJob)
        .filter(StartupJob.search_query == query, StartupJob.scraped_at >= cutoff)
        .order_by(StartupJob.scraped_at.desc())
        .limit(req.max_results)
        .all()
    )
    if fresh_rows:
        jobs = [_startup_to_dict(r) for r in fresh_rows]
        _startup_cache[cache_key] = (datetime.now(timezone.utc), jobs)
        logger.info("Startup roles DB cache hit — %d jobs", len(jobs))
        return {"jobs": jobs, "query": query, "from_cache": True}

    logger.info("Startup roles Google query: %s", query)

    client = ApifyClient(token)
    try:
        run = client.actor("apify/google-search-scraper").call(
            run_input={
                "queries": query,
                "maxPagesPerQuery": 5,
                "resultsPerPage": 10,
                "countryCode": "us",
                "languageCode": "en",
                "mobileResults": False,
            },
            wait_secs=120,
        )
        if run.get("status") == "RUNNING":
            client.run(run["id"]).abort()
            raise HTTPException(status_code=504, detail="Google search timed out")

        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
        logger.info("Google scraper: %d dataset items", len(items))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Startup roles search failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Search failed: {e}")

    jobs = []
    seen = set()
    # existing URLs in DB to skip duplicates
    existing_urls = {r.url for r in db.query(StartupJob.url).all() if r.url}
    now = datetime.now(timezone.utc)
    jobs = []

    for item in items:
        results = item.get("organicResults") or []
        if not results and item.get("url"):
            results = [item]

        for r in results:
            url = r.get("url") or ""
            if not url or url in seen:
                continue
            platform = _detect_platform(url)
            if not platform:
                continue
            seen.add(url)

            title = r.get("title") or ""
            description = (r.get("description") or r.get("snippet") or "")[:300]
            company = _parse_company_from_url(url)

            role_part = title
            for sep in [" - ", " | ", " – ", " — "]:
                if sep in title:
                    role_part = title.split(sep)[0].strip()
                    break

            if url not in existing_urls:
                db.add(StartupJob(
                    url=url, title=role_part, company=company,
                    platform=platform, description=description,
                    search_query=query, scraped_at=now,
                ))
                existing_urls.add(url)

            jobs.append({"title": role_part, "company": company,
                         "platform": platform, "url": url, "description": description})

            if len(jobs) >= req.max_results:
                break
        if len(jobs) >= req.max_results:
            break

    db.commit()
    _startup_cache[cache_key] = (now, jobs)
    logger.info("Startup roles: %d jobs saved to DB, cached for %dm", len(jobs), STARTUP_CACHE_TTL)
    return {"jobs": jobs, "query": query, "from_cache": False}

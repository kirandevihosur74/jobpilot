import logging
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

load_dotenv()

# Log to both stdout AND backend.log (10MB rotation, keep 3 backups)
LOG_FILE = Path(__file__).parent / "backend.log"
_fmt = logging.Formatter(
    "%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
_root = logging.getLogger()
_root.setLevel(logging.INFO)
# Clear default handlers to avoid duplicate logs
_root.handlers.clear()
# Console handler
_console = logging.StreamHandler()
_console.setFormatter(_fmt)
_root.addHandler(_console)
# File handler (rotating)
_file = RotatingFileHandler(LOG_FILE, maxBytes=10_000_000, backupCount=3, encoding="utf-8")
_file.setFormatter(_fmt)
_root.addHandler(_file)

logger = logging.getLogger("jobpilot")
logger.info("Logging to %s", LOG_FILE)

from database import engine, Base
import models  # noqa: F401
from routers import jobs, outreach, email, history, autofill, resume, apply, prefs
from sqlalchemy import text, inspect

Base.metadata.create_all(bind=engine)


def _ensure_columns():
    """Lightweight SQLite migration — ALTER TABLE for missing columns added in
    later versions. SQLAlchemy create_all() only creates NEW tables."""
    inspector = inspect(engine)
    expected = {
        "user_prefs": {
            "resume_filename":  "TEXT DEFAULT ''",
            "resume_file_path": "TEXT DEFAULT ''",
        },
        "hiring_posts": {},
        "startup_jobs": {},
    }
    for table, cols in expected.items():
        if table not in inspector.get_table_names():
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        with engine.begin() as conn:
            for col_name, col_def in cols.items():
                if col_name not in existing:
                    logger.info("Migration: ALTER TABLE %s ADD COLUMN %s", table, col_name)
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}"))


_ensure_columns()
logger.info("Database tables ensured")

app = FastAPI(title="JobPilot API")

_env = os.getenv("ENV", "development")
_origins = (
    ["*"]
    if _env == "development"
    else [os.getenv("FRONTEND_URL", ""), "https://kirandevihosur74.github.io"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=_env != "development",
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=600,
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration = (time.perf_counter() - start) * 1000
    logger.info("%s %s → %d (%.1fms)", request.method, request.url.path, response.status_code, duration)
    return response

app.include_router(jobs.router)
app.include_router(outreach.router)
app.include_router(email.router)
app.include_router(history.router)
app.include_router(autofill.router)
app.include_router(resume.router)
app.include_router(apply.router)
app.include_router(prefs.router)

@app.get("/health")
def health():
    logger.debug("Health check")
    return {"status": "ok"}

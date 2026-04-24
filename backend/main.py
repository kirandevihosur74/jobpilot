import logging
import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("jobpilot")

from database import engine, Base
import models  # noqa: F401
from routers import jobs, outreach, email, history

Base.metadata.create_all(bind=engine)
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

@app.get("/health")
def health():
    logger.debug("Health check")
    return {"status": "ok"}

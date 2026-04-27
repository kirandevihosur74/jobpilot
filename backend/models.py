from sqlalchemy import Column, Integer, String, DateTime, Text, Float, BigInteger
from datetime import datetime, timezone
from database import Base

class ScrapedJob(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    company = Column(String)
    location = Column(String)
    job_type = Column(String)
    url = Column(String)
    posted = Column(String)
    description = Column(Text)
    score = Column(Float)
    search_role = Column(String, index=True)
    search_location = Column(String)
    scraped_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

class UserPrefs(Base):
    __tablename__ = "user_prefs"

    id = Column(Integer, primary_key=True)
    role = Column(String, default="")
    location = Column(String, default="")
    skills = Column(Text, default="")        # JSON array string
    target_companies = Column(String, default="")
    resume_context = Column(Text, default="")
    resume_filename = Column(String, default="")     # uploaded resume original filename
    resume_file_path = Column(String, default="")    # absolute path to stored resume file
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class HiringPost(Base):
    __tablename__ = "hiring_posts"

    id          = Column(Integer, primary_key=True, index=True)
    activity_id = Column(String, unique=True, index=True)   # LinkedIn activity_id dedup key
    post_url    = Column(String)
    text        = Column(Text)
    author      = Column(String)
    company     = Column(String)        # poster headline
    company_name = Column(String)
    job_title   = Column(String)
    avatar      = Column(String)
    posted      = Column(String)
    posted_ts   = Column(BigInteger, default=0)
    search_role = Column(String, index=True)
    search_location = Column(String)
    scraped_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)


class StartupJob(Base):
    __tablename__ = "startup_jobs"

    id          = Column(Integer, primary_key=True, index=True)
    url         = Column(String, unique=True, index=True)
    title       = Column(String)
    company     = Column(String)
    platform    = Column(String)
    description = Column(Text)
    search_query = Column(Text)
    scraped_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)


class ApplicationHistory(Base):
    __tablename__ = "history"

    id = Column(Integer, primary_key=True, index=True)
    company = Column(String, nullable=False)
    role = Column(String, nullable=False)
    status = Column(String, default="sent")
    recipient = Column(String)
    subject = Column(String)
    body = Column(Text)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

from sqlalchemy import Column, Integer, String, DateTime, Text, Float
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

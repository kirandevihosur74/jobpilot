import logging
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database import get_db
from models import ApplicationHistory

logger = logging.getLogger("jobpilot.history")
router = APIRouter(prefix="/api/history", tags=["history"])

class HistoryEntry(BaseModel):
    company: str
    role: str
    status: str = "sent"
    recipient: str = ""
    subject: str = ""
    body: str = ""

@router.get("/")
def get_history(db: Session = Depends(get_db)):
    rows = db.query(ApplicationHistory).order_by(ApplicationHistory.created_at.desc()).limit(50).all()
    logger.info("Fetched %d history entries", len(rows))
    return [
        {
            "id": r.id,
            "company": r.company,
            "role": r.role,
            "status": r.status,
            "recipient": r.recipient,
            "subject": r.subject,
            "date": r.created_at.strftime("%b %d, %Y"),
        }
        for r in rows
    ]

@router.post("/")
def add_history(entry: HistoryEntry, db: Session = Depends(get_db)):
    row = ApplicationHistory(**entry.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("History entry saved — id=%d company=%s", row.id, row.company)
    return {"id": row.id}

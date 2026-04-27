import json
import logging
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database import get_db
from models import UserPrefs

logger = logging.getLogger("jobpilot.prefs")
router = APIRouter(prefix="/api/prefs", tags=["prefs"])


class PrefsIn(BaseModel):
    role: str = ""
    location: str = ""
    skills: list[str] = []
    targetCompanies: str = ""
    resumeContext: str = ""


def _to_dict(row: UserPrefs) -> dict:
    return {
        "role": row.role or "",
        "location": row.location or "",
        "skills": json.loads(row.skills) if row.skills else [],
        "targetCompanies": row.target_companies or "",
        "resumeContext": row.resume_context or "",
        "resumeFilename": row.resume_filename or "",
        "hasResume": bool(row.resume_file_path),
    }


@router.get("")
def get_prefs(db: Session = Depends(get_db)):
    row = db.query(UserPrefs).first()
    if not row:
        return {"role": "", "location": "", "skills": [], "targetCompanies": "", "resumeContext": "", "resumeFilename": "", "hasResume": False}
    return _to_dict(row)


@router.post("")
def save_prefs(prefs: PrefsIn, db: Session = Depends(get_db)):
    row = db.query(UserPrefs).first()
    if not row:
        row = UserPrefs()
        db.add(row)
    row.role = prefs.role
    row.location = prefs.location
    row.skills = json.dumps(prefs.skills)
    row.target_companies = prefs.targetCompanies
    row.resume_context = prefs.resumeContext
    db.commit()
    logger.info("Prefs saved: role=%r", prefs.role)
    return _to_dict(row)

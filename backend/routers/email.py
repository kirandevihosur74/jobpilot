import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os

logger = logging.getLogger("jobpilot.email")
router = APIRouter(prefix="/api/email", tags=["email"])

class SendEmailRequest(BaseModel):
    to: EmailStr
    subject: str
    body: str

@router.post("/send")
async def send_email(req: SendEmailRequest):
    gmail_user = os.getenv("GMAIL_USER")
    gmail_password = os.getenv("GMAIL_APP_PASSWORD")

    if not gmail_user or not gmail_password:
        raise HTTPException(status_code=500, detail="Gmail credentials not configured")

    logger.info("Sending email — to=%s subject=%r", req.to, req.subject)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = req.subject
    msg["From"] = gmail_user
    msg["To"] = req.to
    msg.attach(MIMEText(req.body, "plain"))

    try:
        await aiosmtplib.send(
            msg,
            hostname="smtp.gmail.com",
            port=587,
            start_tls=True,
            username=gmail_user,
            password=gmail_password,
        )
        logger.info("Email sent successfully to %s", req.to)
    except Exception as e:
        logger.error("Email send failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Email send failed: {str(e)}")

    return {"status": "sent", "to": req.to}

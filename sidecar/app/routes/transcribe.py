"""
POST /transcribe — Transcribe audio files to text.
Replaces external speech-to-text API calls with local Whisper inference.
"""

from fastapi import APIRouter, File, Request, UploadFile, HTTPException
from pydantic import BaseModel
import logging


logger = logging.getLogger(__name__)
router = APIRouter()


class TranscribeResponse(BaseModel):
    text: str
    language: str
    confidence: float
    filename: str


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(file: UploadFile, request: Request):
    """
    Transcribe an uploaded audio file to text.
    
    Supported formats: mp3 (.mp3), mp4 (.mp4)
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    
    # Validate file extension
    allowed_extensions = {".mp3", ".mp4"}
    file_ext = "." + file.filename.split(".")[-1].lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file format. Supported: {', '.join(allowed_extensions)}"
        )

    try:
        transcriber = request.app.state.transcriber
        
        # Read the uploaded file into bytes
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="File is empty")

        logger.info(f"[Transcribe] Processing: {file.filename} ({len(content)} bytes)")

        # Transcribe using the transcriber
        result = transcriber.transcribe_bytes(content, file.filename)

        logger.info(f"[Transcribe] Complete: {file.filename} → {len(result['text'])} chars, lang={result['language']}")

        return TranscribeResponse(
            text=result["text"],
            language=result["language"],
            confidence=result["confidence"],
            filename=file.filename,
        )

    except Exception as e:
        logger.error(f"[Transcribe] Error transcribing {file.filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

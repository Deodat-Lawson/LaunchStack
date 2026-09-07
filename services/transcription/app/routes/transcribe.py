"""
POST /transcribe — Transcribe audio files to text.
Replaces external speech-to-text API calls with local Whisper inference.

Wire format frozen: packages/schema-generator/schemas/v1/transcription.transcribe-response.schema.json
"""

from fastapi import APIRouter, Depends, File, Request, UploadFile, HTTPException
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
import logging

from app.auth import verify_api_key


logger = logging.getLogger(__name__)
# Authenticated at the router level: local Whisper inference is expensive and
# this port is published to the host, so an unauthenticated /transcribe is free
# compute for anything that can reach it.
router = APIRouter(dependencies=[Depends(verify_api_key)])

# Stream-read granularity for the upload size cap.
_READ_CHUNK_BYTES = 1024 * 1024


class TranscriptSegment(BaseModel):
    start: float
    end: float
    text: str


class TranscribeResponse(BaseModel):
    text: str
    language: str
    confidence: float
    filename: str
    segments: list[TranscriptSegment] = []


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
        max_upload_bytes = request.app.state.config.max_upload_bytes

        # Stream-read the upload with a running count (mirrors the converter's
        # MAX_FETCH_BYTES enforcement) — an unbounded `await file.read()`
        # buffered arbitrarily large uploads wholesale.
        buffer = bytearray()
        while chunk := await file.read(_READ_CHUNK_BYTES):
            buffer.extend(chunk)
            if len(buffer) > max_upload_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=(
                        "Upload exceeds TRANSCRIPTION_MAX_UPLOAD_BYTES "
                        f"({max_upload_bytes} bytes)"
                    ),
                )
        content = bytes(buffer)
        if not content:
            raise HTTPException(status_code=400, detail="File is empty")

        logger.info(f"[Transcribe] Processing: {file.filename} ({len(content)} bytes)")

        # Whisper inference is CPU-bound and synchronous — run it in the
        # threadpool so the event loop (and /health) stays responsive.
        result = await run_in_threadpool(
            transcriber.transcribe_bytes, content, file.filename
        )

        logger.info(f"[Transcribe] Complete: {file.filename} → {len(result['text'])} chars, lang={result['language']}")

        return TranscribeResponse(
            text=result["text"],
            language=result["language"],
            confidence=result["confidence"],
            filename=file.filename,
            segments=[
                TranscriptSegment(start=s["start"], end=s["end"], text=s["text"])
                for s in result.get("segments", [])
            ],
        )

    except HTTPException:
        # The route's own 400/413s must reach the client as-is, not be
        # swallowed by the broad handler below and re-raised as 500s.
        raise
    except Exception as e:
        logger.error(f"[Transcribe] Error transcribing {file.filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

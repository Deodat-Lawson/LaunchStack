"""
FastAPI Sidecar — DOCX Redlining + Audio Transcription
Lightweight service for reading/editing DOCX (Adeu) and transcribing
audio/video via local Whisper (download-and-transcribe + /transcribe).
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.models.transcriber import Transcriber
from app.routes.transcribe import router as transcribe_router
from app.routes.download_and_transcribe import router as download_transcribe_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the Whisper transcriber once and share it for the app lifetime."""
    app.state.transcriber = Transcriber()
    print("[Sidecar] Transcriber loaded — ready to serve.")
    yield
    print("[Sidecar] Shutting down.")


app = FastAPI(
    title="Launchstack Sidecar",
    description="DOCX redlining (Adeu) + audio/video transcription (Whisper).",
    version="0.2.0",
    lifespan=lifespan,
)

app.include_router(transcribe_router)
app.include_router(download_transcribe_router)

# Conditionally register adeu routes — sidecar starts even if adeu is not installed
try:
    from app.routes.adeu import router as adeu_router
    app.include_router(adeu_router)
    _adeu_available = True
except ImportError:
    _adeu_available = False
    print("[Sidecar] adeu package not installed — ADEU routes disabled")


@app.get("/health")
async def health():
    if _adeu_available:
        try:
            from adeu import __version__ as adeu_version
            return {"status": "ok", "adeu": {"available": True, "version": adeu_version}}
        except Exception:
            return {"status": "ok", "adeu": {"available": True, "version": "unknown"}}
    return {"status": "degraded", "adeu": {"available": False, "version": None}}

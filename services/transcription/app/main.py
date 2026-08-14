"""
LaunchStack Transcription Service
Standalone FastAPI service for audio/video transcription via local Whisper
(/transcribe) and yt-dlp download-then-transcribe (/download-and-transcribe).

Split out of the former `sidecar/` per ADR-004 (compute service
consolidation): transcription and DOCX redlining have unrelated lifecycles,
so the Adeu half now lives in `services/document-editor`.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import load_config
from app.models.transcriber import Transcriber
from app.routes.transcribe import router as transcribe_router
from app.routes.download_and_transcribe import router as download_transcribe_router
from app.tracing import TraceIdMiddleware, configure_logging

configure_logging("transcription")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Read/validate env once, then load the Whisper transcriber and share it
    for the app lifetime."""
    config = load_config()
    app.state.config = config
    app.state.transcriber = Transcriber(
        model_name=config.whisper_model, device=config.device
    )
    logger.info("transcriber loaded — ready to serve")
    yield
    logger.info("shutting down")


app = FastAPI(
    title="LaunchStack Transcription Service",
    description="Audio/video transcription (Whisper + yt-dlp).",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(TraceIdMiddleware)
app.include_router(transcribe_router)
app.include_router(download_transcribe_router)


@app.get("/health")
async def health():
    """Unauthenticated by design — the container healthcheck calls it with no
    headers. Serving traffic implies the model finished loading (uvicorn only
    accepts connections after the lifespan startup completes)."""
    config = getattr(app.state, "config", None)
    return {
        "status": "ok",
        "service": "transcription",
        "whisper_model": config.whisper_model if config else None,
        "device": config.device if config else None,
    }

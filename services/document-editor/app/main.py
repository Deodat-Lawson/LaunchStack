"""
LaunchStack Document Editor Service
The single authoritative DOCX-editing (Adeu redlining) service: reading,
tracked-change edits, review actions, accept-all, CriticMarkup preview, and
diffing, behind the five /adeu/* routes.

Split out of the former `sidecar/` per ADR-004 (compute service
consolidation): transcription and DOCX redlining have unrelated lifecycles,
so the Whisper half now lives in `services/transcription`.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import load_config
from app.tracing import TraceIdMiddleware, configure_logging

configure_logging("document-editor")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Read/validate env once at startup."""
    app.state.config = load_config()
    yield
    logger.info("shutting down")


app = FastAPI(
    title="LaunchStack Document Editor Service",
    description="DOCX redlining (Adeu): tracked changes, review actions, "
    "CriticMarkup preview, and diffing.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(TraceIdMiddleware)

# Conditionally register adeu routes — the service still boots (and reports
# "degraded" on /health) if the adeu package is missing.
try:
    from app.routes.adeu import router as adeu_router

    app.include_router(adeu_router)
    _adeu_available = True
except ImportError:
    _adeu_available = False
    logger.warning("adeu package not installed — ADEU routes disabled")


@app.get("/health")
async def health():
    """Unauthenticated by design — the container healthcheck calls it with no
    headers. Same shape the sidecar reported so existing probes keep working."""
    if _adeu_available:
        try:
            from adeu import __version__ as adeu_version

            return {"status": "ok", "adeu": {"available": True, "version": adeu_version}}
        except Exception:
            return {"status": "ok", "adeu": {"available": True, "version": "unknown"}}
    return {"status": "degraded", "adeu": {"available": False, "version": None}}

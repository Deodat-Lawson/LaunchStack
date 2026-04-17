"""
FastAPI Sidecar — DOCX Redlining Service (Adeu)
Lightweight service for reading, editing, and diffing DOCX files.
"""

from fastapi import FastAPI

app = FastAPI(
    title="Launchstack DOCX Service",
    description="DOCX redlining via Adeu — read, edit, accept, diff.",
    version="0.2.0",
)

# Register adeu routes
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

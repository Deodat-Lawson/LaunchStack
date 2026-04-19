"""
Lightweight sidecar that only mounts the Adeu routes.
No ML dependencies (torch, sentence-transformers) required.

Usage:
    /tmp/sidecar-test-venv/bin/python scripts/run-adeu-sidecar.py
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sidecar"))

from fastapi import FastAPI
from app.routes.adeu import router as adeu_router
import uvicorn

app = FastAPI(title="Adeu-only sidecar (test)")
app.include_router(adeu_router)

@app.get("/health")
async def health():
    from adeu import __version__ as v
    return {"status": "ok", "adeu": {"available": True, "version": v}}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

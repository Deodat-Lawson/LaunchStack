"""Shared fixtures for sidecar Adeu route tests.

We build a lightweight FastAPI app with only the adeu router and health
endpoint so that tests don't require ML dependencies (torch, etc.).
"""

import io

import pytest
from docx import Document
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes.adeu import router as adeu_router


def _build_test_app() -> FastAPI:
    """Minimal app containing only the adeu routes + health check."""
    app = FastAPI()
    app.include_router(adeu_router)

    @app.get("/health")
    async def health():
        try:
            from adeu import __version__ as adeu_version
            adeu_status = {"available": True, "version": adeu_version}
        except ImportError:
            adeu_status = {"available": False, "version": None}
        status = "ok" if adeu_status["available"] else "degraded"
        return {"status": status, "adeu": adeu_status}

    return app


@pytest.fixture
def client():
    """FastAPI test client with adeu routes only."""
    return TestClient(_build_test_app())


@pytest.fixture
def simple_docx() -> bytes:
    """A minimal valid DOCX with known text content."""
    doc = Document()
    doc.add_paragraph("Hello world. This is a test document.")
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


@pytest.fixture
def multi_paragraph_docx() -> bytes:
    """A DOCX with multiple paragraphs for edit testing."""
    doc = Document()
    doc.add_paragraph("The quick brown fox jumps over the lazy dog.")
    doc.add_paragraph("Pack my box with five dozen liquor jugs.")
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()

"""
Integration tests for POST /extract-relationships.
Tests the boundary between the FastAPI endpoint and the LLM client.
"""

import json
import re
import pathlib
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes.relationships import router as relationships_router


def _build_relationships_app() -> FastAPI:
    """Minimal app with only the relationships router — no ML models."""
    test_app = FastAPI()
    test_app.include_router(relationships_router)

    @test_app.get("/health")
    async def health():
        return {"status": "ok"}

    return test_app


@pytest.fixture()
def client():
    return TestClient(_build_relationships_app())


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _patch_llm(return_value: str):
    return patch(
        "app.routes.relationships.call_llm",
        new_callable=AsyncMock,
        return_value=return_value,
    )


def _good_llm_response():
    return json.dumps({
        "entities": [
            {"name": "Satya Nadella", "type": "PERSON"},
            {"name": "Microsoft", "type": "ORGANIZATION"},
        ],
        "relationships": [
            {
                "source": "Satya Nadella",
                "target": "Microsoft",
                "type": "CEO_OF",
                "detail": "Satya Nadella is the CEO of Microsoft",
            }
        ],
    })


class TestExtractRelationships:
    """Tests for the relationship extraction endpoint."""

    def test_relationship_types_are_screaming_snake_case(self, client, monkeypatch):
        """Every relationship type in the response matches ^[A-Z][A-Z0-9_]*$."""
        monkeypatch.setenv("EXTRACTION_LLM_BASE_URL", "http://fake:1234/v1")
        monkeypatch.setenv("EXTRACTION_LLM_MODEL", "test-model")

        pattern = re.compile(r"^[A-Z][A-Z0-9_]*$")

        with _patch_llm(_good_llm_response()):
            resp = client.post(
                "/extract-relationships",
                json={"chunks": ["Satya Nadella is the CEO of Microsoft"]},
            )

        body = resp.json()
        for chunk in body["results"]:
            for rel in chunk["relationships"] + chunk["dropped_relationships"]:
                assert pattern.match(rel["type"]), f"Invalid type: {rel['type']}"

    def test_invalid_source_target_goes_to_dropped(self, client, monkeypatch):
        """Relationships referencing entities not in the chunk's entity list
        appear in dropped_relationships, not relationships."""
        monkeypatch.setenv("EXTRACTION_LLM_BASE_URL", "http://fake:1234/v1")
        monkeypatch.setenv("EXTRACTION_LLM_MODEL", "test-model")

        llm_resp = json.dumps({
            "entities": [
                {"name": "Microsoft", "type": "ORGANIZATION"},
            ],
            "relationships": [
                {
                    "source": "Ghost Entity",
                    "target": "Microsoft",
                    "type": "WORKS_FOR",
                    "detail": "orphan source",
                }
            ],
        })

        with _patch_llm(llm_resp):
            resp = client.post(
                "/extract-relationships",
                json={"chunks": ["test chunk"]},
            )

        body = resp.json()
        chunk = body["results"][0]
        assert len(chunk["relationships"]) == 0
        assert len(chunk["dropped_relationships"]) == 1
        assert chunk["dropped_relationships"][0]["source"] == "Ghost Entity"
        assert body["total_dropped"] == 1

    def test_graceful_empty_when_llm_unconfigured(self, client, monkeypatch):
        """When EXTRACTION_LLM_BASE_URL is unset, returns HTTP 200 with
        {"results": [], "total_entities": 0, "total_relationships": 0, "total_dropped": 0}."""
        monkeypatch.delenv("EXTRACTION_LLM_BASE_URL", raising=False)
        monkeypatch.delenv("EXTRACTION_LLM_MODEL", raising=False)

        resp = client.post("/extract-relationships", json={"chunks": ["some text"]})
        assert resp.status_code == 200
        body = resp.json()
        assert body == {
            "results": [],
            "total_entities": 0,
            "total_relationships": 0,
            "total_dropped": 0,
        }

    def test_think_tag_stripping(self, client, monkeypatch):
        """When LLM response contains <think>...</think> before JSON,
        the tags are stripped and JSON parses correctly."""
        monkeypatch.setenv("EXTRACTION_LLM_BASE_URL", "http://fake:1234/v1")
        monkeypatch.setenv("EXTRACTION_LLM_MODEL", "test-model")

        llm_resp = "<think>Let me analyze this carefully.</think>" + _good_llm_response()

        with _patch_llm(llm_resp):
            resp = client.post(
                "/extract-relationships",
                json={"chunks": ["Satya Nadella is the CEO of Microsoft"]},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["total_entities"] == 2
        assert body["total_relationships"] == 1

    def test_health_returns_200_without_llm(self, client):
        """GET /health returns 200 even when LLM endpoint is unavailable."""
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    # ------------------------------------------------------------------
    # Additional coverage beyond the required skeleton
    # ------------------------------------------------------------------

    def test_clean_response_shape(self, client, monkeypatch):
        """Every field required by the Zod schema is present."""
        monkeypatch.setenv("EXTRACTION_LLM_BASE_URL", "http://fake:1234/v1")
        monkeypatch.setenv("EXTRACTION_LLM_MODEL", "test-model")

        with _patch_llm(_good_llm_response()):
            resp = client.post(
                "/extract-relationships",
                json={"chunks": ["Satya Nadella is the CEO of Microsoft"]},
            )

        assert resp.status_code == 200
        body = resp.json()

        assert "results" in body
        assert "total_entities" in body
        assert "total_relationships" in body
        assert "total_dropped" in body

        chunk = body["results"][0]
        assert "text" in chunk
        assert "entities" in chunk
        assert "relationships" in chunk
        assert "dropped_relationships" in chunk

        ent = chunk["entities"][0]
        assert "name" in ent
        assert "type" in ent

        rel = chunk["relationships"][0]
        assert "source" in rel
        assert "target" in rel
        assert "type" in rel
        assert "detail" in rel

    def test_empty_chunks(self, client, monkeypatch):
        monkeypatch.setenv("EXTRACTION_LLM_BASE_URL", "http://fake:1234/v1")
        monkeypatch.setenv("EXTRACTION_LLM_MODEL", "test-model")

        resp = client.post("/extract-relationships", json={"chunks": []})
        assert resp.status_code == 200
        body = resp.json()
        assert body["results"] == []
        assert body["total_entities"] == 0

    def test_invalid_rel_type_auto_fixed(self, client, monkeypatch):
        """Relationship with lowercase type is auto-fixed to SCREAMING_SNAKE_CASE."""
        monkeypatch.setenv("EXTRACTION_LLM_BASE_URL", "http://fake:1234/v1")
        monkeypatch.setenv("EXTRACTION_LLM_MODEL", "test-model")

        llm_resp = json.dumps({
            "entities": [
                {"name": "Alice", "type": "PERSON"},
                {"name": "Bob", "type": "PERSON"},
            ],
            "relationships": [
                {
                    "source": "Alice",
                    "target": "Bob",
                    "type": "ceo_of",
                    "detail": "lowercase type",
                }
            ],
        })

        with _patch_llm(llm_resp):
            resp = client.post(
                "/extract-relationships",
                json={"chunks": ["test"]},
            )

        body = resp.json()
        chunk = body["results"][0]
        assert len(chunk["relationships"]) == 1
        assert chunk["relationships"][0]["type"] == "CEO_OF"

    def test_unfixable_rel_type_skipped(self, client, monkeypatch):
        """Completely invalid relationship type (e.g. emoji) is skipped entirely."""
        monkeypatch.setenv("EXTRACTION_LLM_BASE_URL", "http://fake:1234/v1")
        monkeypatch.setenv("EXTRACTION_LLM_MODEL", "test-model")

        llm_resp = json.dumps({
            "entities": [
                {"name": "Alice", "type": "PERSON"},
                {"name": "Bob", "type": "PERSON"},
            ],
            "relationships": [
                {
                    "source": "Alice",
                    "target": "Bob",
                    "type": "\U0001f44d",
                    "detail": "emoji type",
                }
            ],
        })

        with _patch_llm(llm_resp):
            resp = client.post(
                "/extract-relationships",
                json={"chunks": ["test"]},
            )

        body = resp.json()
        chunk = body["results"][0]
        assert len(chunk["relationships"]) == 0
        assert len(chunk["dropped_relationships"]) == 0

    def test_llm_returns_empty_string(self, client, monkeypatch):
        """LLM failure (empty response) produces graceful empty results."""
        monkeypatch.setenv("EXTRACTION_LLM_BASE_URL", "http://fake:1234/v1")
        monkeypatch.setenv("EXTRACTION_LLM_MODEL", "test-model")

        with _patch_llm(""):
            resp = client.post(
                "/extract-relationships",
                json={"chunks": ["some text"]},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["results"][0]["entities"] == []
        assert body["results"][0]["relationships"] == []
        assert body["total_entities"] == 0

    def test_llm_returns_garbage(self, client, monkeypatch):
        """LLM returns unparseable text — graceful empty results."""
        monkeypatch.setenv("EXTRACTION_LLM_BASE_URL", "http://fake:1234/v1")
        monkeypatch.setenv("EXTRACTION_LLM_MODEL", "test-model")

        with _patch_llm("I cannot help with that."):
            resp = client.post(
                "/extract-relationships",
                json={"chunks": ["some text"]},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["total_entities"] == 0

    def test_multiple_chunks(self, client, monkeypatch):
        monkeypatch.setenv("EXTRACTION_LLM_BASE_URL", "http://fake:1234/v1")
        monkeypatch.setenv("EXTRACTION_LLM_MODEL", "test-model")

        with _patch_llm(_good_llm_response()):
            resp = client.post(
                "/extract-relationships",
                json={"chunks": ["chunk one", "chunk two"]},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert len(body["results"]) == 2
        assert body["total_entities"] == 4
        assert body["total_relationships"] == 2

    def test_no_hardcoded_providers(self):
        """No model names or provider URLs hardcoded in sidecar/app/."""
        app_dir = pathlib.Path(__file__).resolve().parent.parent / "app"
        forbidden = ["gemma", "ollama", "openai.com", "localhost:11434"]

        for py_file in app_dir.rglob("*.py"):
            content = py_file.read_text(encoding="utf-8")
            for term in forbidden:
                assert term not in content, (
                    f"Hardcoded term '{term}' found in {py_file.relative_to(app_dir.parent)}"
                )

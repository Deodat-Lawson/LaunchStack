"""
Live tests against a real Neo4j (and, for ingest, a real model endpoint).

Skipped unless NEO4J_URI is set. The ingest test also needs the GRAPH_LLM_*
and GRAPH_EMBEDDING_* settings and SCENARIO_GRAPH_LIVE_INGEST=1, since it
spends model tokens. Each test uses a fresh random group and deletes it.

    NEO4J_URI=bolt://127.0.0.1:17687 NEO4J_PASSWORD=… \
    GRAPH_LLM_BASE_URL=http://localhost:11434/v1 GRAPH_LLM_MODEL=qwen3.5:9b \
    GRAPH_LLM_EXTRA_BODY='{"reasoning_effort":"none"}' \
    GRAPH_EMBEDDING_BASE_URL=http://localhost:11434/v1 \
    GRAPH_EMBEDDING_MODEL=nomic-embed-text GRAPH_EMBEDDING_DIM=768 \
    SCENARIO_GRAPH_LIVE_INGEST=1 python -m pytest tests/test_live.py -v
"""

from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient

from .conftest import AUTH, BASE_ONTOLOGY

pytestmark = pytest.mark.skipif(not os.environ.get("NEO4J_URI"), reason="NEO4J_URI not set")


@pytest.fixture
def live_client(monkeypatch):
    monkeypatch.setenv("GRAPH_LLM_MODEL", os.environ.get("GRAPH_LLM_MODEL") or "unused")
    monkeypatch.setenv("GRAPH_EMBEDDING_MODEL", os.environ.get("GRAPH_EMBEDDING_MODEL") or "unused")
    from app.main import app

    with TestClient(app) as client:  # runs the real lifespan: real Graphiti + Neo4j
        client.headers.update(AUTH)
        yield client


@pytest.fixture
def group(live_client):
    group_id = f"live-{uuid.uuid4().hex[:12]}"
    yield group_id
    live_client.delete(f"/v1/groups/{group_id}")


def test_health_reports_real_versions(live_client):
    body = live_client.get("/healthz").json()
    assert body["ok"] is True
    assert body["graphiti"] == "0.31.2"
    assert body["neo4j"].startswith("5.") and body["neo4j"].endswith("community")


def test_empty_group_reads(live_client, group):
    assert live_client.get(f"/v1/groups/{group}/episodes").json() == {"uuids": []}
    assert live_client.get(f"/v1/groups/{group}/export").json() == {
        "nodes": [],
        "edges": [],
        "episode_uuids": [],
    }
    assert live_client.delete(f"/v1/groups/{group}").json() == {"deleted_nodes": 0}


@pytest.mark.skipif(
    os.environ.get("SCENARIO_GRAPH_LIVE_INGEST") != "1", reason="SCENARIO_GRAPH_LIVE_INGEST not set"
)
def test_ingest_is_idempotent_and_group_scoped(live_client, group):
    episode = {
        "uuid": f"{group}-E1",
        "name": "E1 contacts.pdf v3 p2",
        "body": "Maya recommends Northwind's software purchases; Lee approves them.",
        "source_description": "contacts.pdf v3 p2",
        "reference_time": "2026-11-01T12:00:00Z",
    }
    body = {"ontology": BASE_ONTOLOGY, "episodes": [episode]}

    first = live_client.post(f"/v1/groups/{group}/episodes", json=body).json()
    assert first["outcomes"] == [{"uuid": episode["uuid"], "status": "done"}]
    assert first["usage"]["calls"] > 0 and first["usage"]["input_tokens"] > 0

    again = live_client.post(f"/v1/groups/{group}/episodes", json=body).json()
    assert again["outcomes"] == [{"uuid": episode["uuid"], "status": "done"}]
    assert again["usage"]["calls"] == 0

    assert live_client.get(f"/v1/groups/{group}/episodes").json() == {"uuids": [episode["uuid"]]}
    export = live_client.get(f"/v1/groups/{group}/export").json()
    assert export["episode_uuids"] == [episode["uuid"]]
    assert export["nodes"], "extraction produced no entities"
    for edge in export["edges"]:
        assert edge["episodes"] == [episode["uuid"]]

    hits = live_client.post(
        f"/v1/groups/{group}/search", json={"query": "who approves Northwind purchases", "limit": 3}
    ).json()["hits"]
    assert [h["score"] for h in hits] == [round(1 / (i + 1), 6) for i in range(len(hits))]

    other = f"{group}-other"
    try:
        assert live_client.get(f"/v1/groups/{other}/export").json()["nodes"] == []
        refused = live_client.post(f"/v1/groups/{other}/episodes", json=body).json()
        assert refused["outcomes"][0]["status"] == "failed"
    finally:
        live_client.delete(f"/v1/groups/{other}")

    deleted = live_client.delete(f"/v1/groups/{group}").json()["deleted_nodes"]
    assert deleted >= 1 + len(export["nodes"])
    assert live_client.get(f"/v1/groups/{group}/episodes").json() == {"uuids": []}

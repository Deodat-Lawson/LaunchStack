"""Shared fixtures. The suite uses the REAL app, service and backend but never
runs the lifespan (TestClient is not used as a context manager), so no Neo4j
driver or OpenAI client is ever built; ``FakeGraphiti`` is installed instead."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.backend import GraphitiBackend
from app.main import app
from app.service import GraphService

from .fakes import FakeGraphiti

TEST_TOKEN = "test-scenario-graph-token"
AUTH = {"Authorization": f"Bearer {TEST_TOKEN}"}
BASE_ONTOLOGY = json.loads((Path(__file__).parent / "fixtures" / "base_ontology.json").read_text())


@pytest.fixture(autouse=True)
def token_env(monkeypatch):
    monkeypatch.setenv("SCENARIO_GRAPH_TOKEN", TEST_TOKEN)


@pytest.fixture
def graphiti() -> FakeGraphiti:
    return FakeGraphiti()


@pytest.fixture
def service(graphiti) -> GraphService:
    service = GraphService(
        GraphitiBackend(graphiti),  # type: ignore[arg-type]
        ingest_concurrency=2,
        context_episodes=3,
        export_max_nodes=100,
        export_max_edges=100,
    )
    app.state.service = service
    return service


@pytest.fixture
def client(service) -> TestClient:
    test_client = TestClient(app)
    test_client.headers.update(AUTH)
    return test_client


@pytest.fixture
def client_no_auth(service) -> TestClient:
    return TestClient(app)


def episode(uuid: str, body: str = "Maya recommends Northwind's software purchases.", **extra):
    return {
        "uuid": uuid,
        "name": f"episode {uuid}",
        "body": body,
        "source_description": "contacts.pdf v3 p2",
        "reference_time": "2026-11-01T12:00:00Z",
        **extra,
    }


def ingest_body(*episodes, ontology=None):
    return {"ontology": ontology or BASE_ONTOLOGY, "episodes": list(episodes)}

"""Bearer auth: every route but /healthz, constant-time compare, fail closed."""

import pytest

from app.auth import token_matches

from .conftest import TEST_TOKEN, episode, ingest_body

ROUTES = [
    ("post", "/v1/groups/g1/episodes"),
    ("get", "/v1/groups/g1/episodes"),
    ("post", "/v1/groups/g1/search"),
    ("get", "/v1/groups/g1/export"),
    ("delete", "/v1/groups/g1"),
]


@pytest.mark.parametrize("method,path", ROUTES)
def test_routes_reject_missing_token(client_no_auth, method, path):
    response = getattr(client_no_auth, method)(path)
    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("method,path", ROUTES)
def test_routes_reject_wrong_token(client_no_auth, method, path):
    response = getattr(client_no_auth, method)(path, headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401


@pytest.mark.parametrize(
    "header",
    [TEST_TOKEN, f"Basic {TEST_TOKEN}", "Bearer", "Bearer ", f"Token {TEST_TOKEN}", "Bearer ñandú"],
)
def test_malformed_authorization_is_rejected(client_no_auth, header):
    # Sent as latin-1 bytes, the way a raw non-ASCII header arrives.
    response = client_no_auth.get(
        "/v1/groups/g1/episodes", headers={"Authorization": header.encode("latin-1")}
    )
    assert response.status_code == 401
    assert not token_matches(header)


def test_fails_closed_when_token_unset(client_no_auth, monkeypatch):
    monkeypatch.delenv("SCENARIO_GRAPH_TOKEN")
    response = client_no_auth.get("/v1/groups/g1/episodes", headers={"Authorization": "Bearer "})
    assert response.status_code == 401
    assert not token_matches("Bearer ")
    assert not token_matches(None)


def test_auth_runs_before_the_body_is_parsed(client_no_auth, graphiti):
    """An unauthenticated caller learns nothing, not even a validation error."""
    response = client_no_auth.post(
        "/v1/groups/g1/episodes", content=b"{not json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 401
    response = client_no_auth.post("/v1/groups/g1/episodes", json=ingest_body(episode("e1")))
    assert response.status_code == 401
    assert graphiti.add_calls == []


def test_correct_token_passes(client):
    assert client.get("/v1/groups/g1/episodes").status_code == 200


def test_health_is_open_and_minimal(client_no_auth):
    response = client_no_auth.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "graphiti": None, "neo4j": None}


def test_health_rejects_a_wrong_token(client_no_auth):
    response = client_no_auth.get("/healthz", headers={"Authorization": "Bearer wrong"})
    assert response.status_code == 401


def test_health_shows_versions_to_the_worker(client):
    body = client.get("/healthz").json()
    assert body["ok"] is True
    assert body["graphiti"] == "0.31.2"
    assert body["neo4j"] == "5.26.0-community"


def test_health_reports_503_when_neo4j_is_down(client, graphiti):
    import neo4j.exceptions

    graphiti.driver.unavailable = neo4j.exceptions.ServiceUnavailable("connection refused")
    response = client.get("/healthz")
    assert response.status_code == 503
    assert response.json() == {"ok": False, "graphiti": None, "neo4j": None}


def test_docs_and_schema_are_not_served(client_no_auth, client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client_no_auth.get(path).status_code == 401
        assert client.get(path).status_code == 404

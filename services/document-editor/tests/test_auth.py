"""
Auth coverage for the X-API-Key dependency (ported from the sidecar suite).

Pins the contract for all five adeu routes, the fail-closed behaviour when no
key env var is set — the property that makes a missing key safe rather than
silently open — and the DOCUMENT_EDITOR_API_KEY-first / SIDECAR_API_KEY-
fallback resolution introduced by the sidecar split.

verify_api_key is a coroutine, but driven with asyncio.run rather than a
pytest.mark.asyncio marker: pytest-asyncio is deliberately not a test
dependency, and under strict mode an unrecognised marker would make these
silently fail rather than assert anything.
"""

import asyncio

import pytest
from fastapi import HTTPException

from app.auth import verify_api_key

from .conftest import TEST_API_KEY

ADEU_ROUTES = [
    "/adeu/read",
    "/adeu/process-batch",
    "/adeu/accept-all",
    "/adeu/apply-edits-markdown",
    "/adeu/diff",
]


# ── All adeu routes reject requests without a valid key ─────────────────────

@pytest.mark.parametrize("path", ADEU_ROUTES)
def test_adeu_routes_reject_missing_key(client_no_auth, path):
    resp = client_no_auth.post(path)
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Unauthorized"


@pytest.mark.parametrize("path", ADEU_ROUTES)
def test_adeu_routes_reject_wrong_key(client_no_auth, path):
    resp = client_no_auth.post(path, headers={"X-API-Key": "not-the-key"})
    assert resp.status_code == 401


def test_route_passes_auth_then_validates_body(client_no_auth):
    """A correct key gets past auth — the 422 proves the dependency ran first."""
    resp = client_no_auth.post("/adeu/read", headers={"X-API-Key": TEST_API_KEY})
    assert resp.status_code == 422


def test_health_is_open(client_no_auth):
    """/health stays unauthenticated — healthchecks send no headers."""
    assert client_no_auth.get("/health").status_code == 200


# ── Fail-closed is the property that makes an unset key safe ────────────────

@pytest.mark.parametrize("unset_value", ["", None])
def test_unset_key_rejects_every_request(monkeypatch, client_no_auth, unset_value):
    for var in ("DOCUMENT_EDITOR_API_KEY", "SIDECAR_API_KEY"):
        if unset_value is None:
            monkeypatch.delenv(var, raising=False)
        else:
            monkeypatch.setenv(var, unset_value)

    # Even presenting the key the rest of the suite uses must fail.
    resp = client_no_auth.post("/adeu/read", headers={"X-API-Key": TEST_API_KEY})
    assert resp.status_code == 401


# ── SIDECAR_API_KEY compat fallback (deprecated, see app/auth.py) ───────────

def test_sidecar_api_key_fallback_accepted(monkeypatch, client_no_auth):
    """With only the legacy SIDECAR_API_KEY set, that key still works."""
    monkeypatch.delenv("DOCUMENT_EDITOR_API_KEY", raising=False)
    monkeypatch.setenv("SIDECAR_API_KEY", "legacy-key")
    resp = client_no_auth.post("/adeu/read", headers={"X-API-Key": "legacy-key"})
    assert resp.status_code == 422  # past auth, failed body validation


def test_document_editor_key_takes_precedence(monkeypatch, client_no_auth):
    """When both are set, only DOCUMENT_EDITOR_API_KEY is accepted."""
    monkeypatch.setenv("DOCUMENT_EDITOR_API_KEY", "primary-key")
    monkeypatch.setenv("SIDECAR_API_KEY", "legacy-key")

    resp = client_no_auth.post("/adeu/read", headers={"X-API-Key": "legacy-key"})
    assert resp.status_code == 401

    resp = client_no_auth.post("/adeu/read", headers={"X-API-Key": "primary-key"})
    assert resp.status_code == 422


# ── Trace-id middleware ─────────────────────────────────────────────────────

def test_incoming_trace_id_is_echoed(client_no_auth):
    resp = client_no_auth.get("/health", headers={"X-Trace-Id": "trace-abc-123"})
    assert resp.headers["X-Trace-Id"] == "trace-abc-123"


def test_trace_id_generated_when_absent(client_no_auth):
    resp = client_no_auth.get("/health")
    assert resp.headers.get("X-Trace-Id")


# ── Direct unit tests of the dependency ─────────────────────────────────────

def test_verify_api_key_accepts_exact_match():
    assert asyncio.run(verify_api_key(TEST_API_KEY)) is None


def test_verify_api_key_rejects_none():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(verify_api_key(None))
    assert exc.value.status_code == 401


def test_verify_api_key_rejects_key_of_different_length():
    """compare_digest raises on mixed types/lengths if guards are wrong."""
    with pytest.raises(HTTPException) as exc:
        asyncio.run(verify_api_key(TEST_API_KEY + "-extra"))
    assert exc.value.status_code == 401


@pytest.mark.parametrize("bad_key", ["ключ-секрет", "clé-secrète", "🔑"])
def test_verify_api_key_rejects_non_ascii_key_with_401(bad_key):
    """hmac.compare_digest raises TypeError on non-ASCII str — malformed
    input must compare unequal (401), never crash the dependency (500)."""
    with pytest.raises(HTTPException) as exc:
        asyncio.run(verify_api_key(bad_key))
    assert exc.value.status_code == 401

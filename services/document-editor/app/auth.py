"""
Shared API-key authentication for the document-editor service's routes.

Fails closed: an unset or empty key env var rejects every request rather than
serving an open endpoint. `/health` is deliberately left unauthenticated,
because container healthchecks call it with no headers.

Key resolution and compatibility
--------------------------------
The key is read from ``DOCUMENT_EDITOR_API_KEY``. When that variable is unset
(or empty), ``SIDECAR_API_KEY`` is honoured as a deprecated fallback so
deployments that predate the sidecar split (ADR-004) keep working without a
config change. New deployments should set ``DOCUMENT_EDITOR_API_KEY``; the
fallback will be removed once the migration completes.

The env var is read per request (a read, not a mutation). This keeps tests
with ``monkeypatch.setenv`` working and means key rotation applies without a
restart.
"""

import hmac
import os

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def expected_api_key() -> str:
    """Resolve the configured API key: DOCUMENT_EDITOR_API_KEY, then the
    deprecated SIDECAR_API_KEY fallback (see module docstring)."""
    return os.environ.get("DOCUMENT_EDITOR_API_KEY") or os.environ.get(
        "SIDECAR_API_KEY", ""
    )


async def verify_api_key(api_key: str | None = Security(_api_key_header)) -> None:
    """Validate X-API-Key against the configured service key."""
    expected = expected_api_key()
    # compare_digest over `!=` so a wrong key cannot be recovered by timing the
    # response. Both sides are encoded to bytes first: compare_digest raises
    # TypeError on non-ASCII str (turning a garbage header into a 500), whereas
    # on bytes malformed input simply compares unequal -> 401.
    if (
        not expected
        or not api_key
        or not hmac.compare_digest(
            api_key.encode("utf-8"), expected.encode("utf-8")
        )
    ):
        raise HTTPException(status_code=401, detail="Unauthorized")

"""
Bearer-token authentication (applied to every route but /healthz).

Fails closed: an unset or empty ``SCENARIO_GRAPH_TOKEN`` rejects every request
rather than serving an open graph. The token is read per request so rotation
applies without a restart and tests can ``monkeypatch.setenv`` it.
"""

from __future__ import annotations

import hmac
import os


def expected_token() -> str:
    return os.environ.get("SCENARIO_GRAPH_TOKEN", "")


def token_matches(authorization: str | None) -> bool:
    expected = expected_token()
    if not expected or not authorization:
        return False
    scheme, _, presented = authorization.partition(" ")
    if scheme.lower() != "bearer" or not presented:
        return False
    # compare_digest on bytes: constant time, and non-ASCII input compares
    # unequal instead of raising (which would turn garbage into a 500).
    return hmac.compare_digest(
        presented.strip().encode("utf-8"), expected.encode("utf-8")
    )


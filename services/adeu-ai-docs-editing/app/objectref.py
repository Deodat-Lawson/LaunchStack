"""
Outbound document fetching, constrained by the startup allow-list.

ADR-004 §6 says compute services receive "typed jobs plus validated object
references … arbitrary URLs are rejected". The converter has enforced that
since the split; this service accepted multipart uploads only, which is why a
stored document had to make four full-body transfers to be edited.

The guard mirrors `services/document-converter/src/fetch.ts` deliberately —
same rules, same failure codes — so there is one story about outbound fetching
across the compute services:

  * http/https only;
  * the URL's origin must appear in ALLOWED_FETCH_ORIGINS;
  * redirects are refused, because only the initial URL was validated and a
    redirect could tunnel to an origin that is not on the list;
  * the body is size-capped while streaming and the whole fetch is timed out.
"""

from __future__ import annotations

import io
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException


class ObjectRefError(HTTPException):
    """A 400 with the same shape the rest of the service returns."""

    def __init__(self, detail: str) -> None:
        super().__init__(status_code=400, detail=detail)


def assert_allowed_url(raw_url: str, allowed_origins: tuple[str, ...], field: str = "url") -> str:
    """Validate a request-supplied URL against the origin allow-list."""
    if not allowed_origins:
        raise ObjectRefError(
            f"{field} cannot be fetched: ALLOWED_FETCH_ORIGINS is not configured, "
            "so object references are disabled. Upload the file directly, or set "
            "the variable on the service."
        )

    try:
        parsed = urlparse(raw_url)
    except Exception:
        raise ObjectRefError(f"{field} is not a valid URL") from None

    if parsed.scheme not in {"http", "https"}:
        raise ObjectRefError(
            f'{field} scheme "{parsed.scheme or "(none)"}" is not allowed; '
            "only http and https are supported"
        )
    if not parsed.hostname:
        raise ObjectRefError(f"{field} is not a valid URL")

    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in allowed_origins:
        raise ObjectRefError(f"{field} origin {origin} is not in ALLOWED_FETCH_ORIGINS")
    return origin


async def fetch_document(
    raw_url: str,
    *,
    allowed_origins: tuple[str, ...],
    max_bytes: int,
    timeout_seconds: float,
    field: str = "url",
) -> io.BytesIO:
    """Fetch a document from an allow-listed origin into memory."""
    assert_allowed_url(raw_url, allowed_origins, field)

    try:
        async with httpx.AsyncClient(
            follow_redirects=False, timeout=timeout_seconds
        ) as client:
            async with client.stream("GET", raw_url) as response:
                if response.is_redirect:
                    raise ObjectRefError(
                        f"{field} returned a redirect; only the original URL is "
                        "validated against the allow-list, so redirects are refused"
                    )
                if response.status_code >= 400:
                    raise ObjectRefError(
                        f"{field} could not be fetched: HTTP {response.status_code}"
                    )

                buffer = io.BytesIO()
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise HTTPException(
                            status_code=413,
                            detail=f"{field} exceeds the {max_bytes} byte limit",
                        )
                    buffer.write(chunk)
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise ObjectRefError(f"{field} timed out after {timeout_seconds}s") from None
    except httpx.HTTPError as exc:
        raise ObjectRefError(f"{field} could not be fetched: {exc}") from None

    buffer.seek(0)
    return buffer

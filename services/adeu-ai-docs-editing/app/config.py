"""
Typed startup configuration for the adeu-ai-docs-editing service.

The environment is read and validated exactly once, at startup (from the
FastAPI lifespan).

The API key itself is never logged — only whether one is configured. The key
is deliberately NOT stored on the config object either: authentication
(``app.auth``) re-reads the env per request so rotation applies without a
restart, and so a config dump can never leak the secret.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from urllib.parse import urlparse

from app.auth import expected_api_key

logger = logging.getLogger(__name__)

DEFAULT_MAX_FETCH_BYTES = 50 * 1024 * 1024  # matches MAX_UPLOAD_SIZE
DEFAULT_FETCH_TIMEOUT_SECONDS = 30.0


def _parse_origins(raw: str | None) -> tuple[str, ...]:
    """Parse ALLOWED_FETCH_ORIGINS into a tuple of validated origins.

    Unset means "object references are disabled", not "everything is allowed" —
    an empty allow-list fails every fetch closed. Malformed entries are dropped
    with a warning rather than crashing the service, because a typo in one
    entry should not take down redlining for uploads that do not use refs.
    """
    if not raw:
        return ()
    origins: list[str] = []
    for entry in raw.split(","):
        trimmed = entry.strip()
        if not trimmed:
            continue
        parsed = urlparse(trimmed)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            logger.warning(
                "ignoring ALLOWED_FETCH_ORIGINS entry %r: not an http(s) origin", trimmed
            )
            continue
        origins.append(f"{parsed.scheme}://{parsed.netloc}")
    return tuple(dict.fromkeys(origins))


def _positive_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("%s=%r is not an integer; using default %d", name, raw, default)
        return default
    if value <= 0:
        logger.warning("%s=%d must be positive; using default %d", name, value, default)
        return default
    return value


@dataclass(frozen=True)
class ServiceConfig:
    """Validated startup configuration."""

    api_key_configured: bool
    adeu_available: bool
    adeu_version: str | None
    allowed_fetch_origins: tuple[str, ...] = field(default_factory=tuple)
    max_fetch_bytes: int = DEFAULT_MAX_FETCH_BYTES
    fetch_timeout_seconds: float = DEFAULT_FETCH_TIMEOUT_SECONDS


def load_config() -> ServiceConfig:
    """Read and validate the environment once at startup."""
    api_key_configured = bool(expected_api_key())

    try:
        from adeu import __version__ as adeu_version

        adeu_available, version = True, adeu_version
    except ImportError:
        adeu_available, version = False, None
    except Exception:
        adeu_available, version = True, "unknown"

    allowed_origins = _parse_origins(os.environ.get("ALLOWED_FETCH_ORIGINS"))

    config = ServiceConfig(
        api_key_configured=api_key_configured,
        adeu_available=adeu_available,
        adeu_version=version,
        allowed_fetch_origins=allowed_origins,
        max_fetch_bytes=_positive_int("MAX_FETCH_BYTES", DEFAULT_MAX_FETCH_BYTES),
        fetch_timeout_seconds=float(
            _positive_int(
                "FETCH_TIMEOUT_SECONDS", int(DEFAULT_FETCH_TIMEOUT_SECONDS)
            )
        ),
    )

    logger.info(
        "configuration loaded",
        extra={
            "adeu_available": adeu_available,
            "adeu_version": version,
            "allowed_fetch_origins": list(allowed_origins) or "(object refs disabled)",
            # Presence only — the key itself must never be logged.
            "api_key": "configured" if api_key_configured else "NOT configured",
        },
    )
    if not api_key_configured:
        logger.warning(
            "no API key configured (ADEU_SERVICE_API_KEY / DOCUMENT_EDITOR_API_KEY "
            "/ SIDECAR_API_KEY unset) — every authenticated route will fail closed "
            "with 401"
        )
    if not allowed_origins:
        logger.info(
            "ALLOWED_FETCH_ORIGINS unset — object references are disabled; "
            "documents must be uploaded directly"
        )

    return config


# Pre-2.4 name, kept so an out-of-tree importer does not break on the rename.
DocumentEditorConfig = ServiceConfig

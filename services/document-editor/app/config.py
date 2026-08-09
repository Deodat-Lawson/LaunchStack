"""
Typed startup configuration for the document-editor service.

The environment is read and validated exactly once, at startup (from the
FastAPI lifespan).

The API key itself is never logged — only whether one is configured. The key
is deliberately NOT stored on the config object either: authentication
(``app.auth``) re-reads the env per request so rotation applies without a
restart, and so a config dump can never leak the secret.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.auth import expected_api_key

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DocumentEditorConfig:
    """Validated startup configuration."""

    api_key_configured: bool
    adeu_available: bool
    adeu_version: str | None


def load_config() -> DocumentEditorConfig:
    """Read and validate the environment once at startup."""
    api_key_configured = bool(expected_api_key())

    try:
        from adeu import __version__ as adeu_version

        adeu_available, version = True, adeu_version
    except ImportError:
        adeu_available, version = False, None
    except Exception:
        adeu_available, version = True, "unknown"

    config = DocumentEditorConfig(
        api_key_configured=api_key_configured,
        adeu_available=adeu_available,
        adeu_version=version,
    )

    logger.info(
        "configuration loaded",
        extra={
            "adeu_available": adeu_available,
            "adeu_version": version,
            # Presence only — the key itself must never be logged.
            "api_key": "configured" if api_key_configured else "NOT configured",
        },
    )
    if not api_key_configured:
        logger.warning(
            "no API key configured (DOCUMENT_EDITOR_API_KEY / SIDECAR_API_KEY "
            "unset) — every authenticated route will fail closed with 401"
        )

    return config

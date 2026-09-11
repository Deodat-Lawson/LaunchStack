"""
Typed startup configuration for the transcription service.

The environment is read and validated exactly once, at startup (from the
FastAPI lifespan). Routes and models receive values from the loaded config
instead of reading ``os.environ`` themselves.

The API key itself is never logged — only whether one is configured. The key
is deliberately NOT stored on the config object either: authentication
(``app.auth``) re-reads the env per request so rotation applies without a
restart, and so a config dump can never leak the secret.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

from app.auth import expected_api_key

logger = logging.getLogger(__name__)

# Device strings accepted by torch/whisper. "cuda" may carry an index
# (e.g. "cuda:0"), so it is validated as a prefix.
_VALID_DEVICE_PREFIXES = ("cpu", "cuda", "mps")

# Host suffixes /download-and-transcribe may hand to yt-dlp when
# TRANSCRIPTION_ALLOWED_HOSTS is unset — the platforms the route's docstring
# advertises. Handing arbitrary URLs to yt-dlp made the service an open
# proxy/SSRF surface (ADR-004 §6).
DEFAULT_ALLOWED_HOSTS: tuple[str, ...] = (
    "youtube.com",
    "youtu.be",
    "vimeo.com",
    "twitter.com",
    "x.com",
    "tiktok.com",
)

# Streaming cap on /transcribe uploads (mirrors the document-converter's
# MAX_FETCH_BYTES): 200 MiB unless TRANSCRIPTION_MAX_UPLOAD_BYTES overrides.
DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024


@dataclass(frozen=True)
class TranscriptionConfig:
    """Validated startup configuration."""

    whisper_model: str
    device: str
    api_key_configured: bool
    # Host suffixes (dot-boundary matched) /download-and-transcribe accepts.
    allowed_hosts: tuple[str, ...] = DEFAULT_ALLOWED_HOSTS
    # Maximum /transcribe upload size in bytes; larger uploads answer 413.
    max_upload_bytes: int = DEFAULT_MAX_UPLOAD_BYTES


def _parse_allowed_hosts(raw: str | None) -> tuple[str, ...]:
    """Parse TRANSCRIPTION_ALLOWED_HOSTS: comma-separated host suffixes.
    Unset/blank falls back to DEFAULT_ALLOWED_HOSTS. Entries are lowercased
    and stripped of leading dots (".youtube.com" == "youtube.com")."""
    if raw is None or not raw.strip():
        return DEFAULT_ALLOWED_HOSTS
    hosts: list[str] = []
    for entry in raw.split(","):
        host = entry.strip().lower().lstrip(".")
        if host and host not in hosts:
            hosts.append(host)
    if not hosts:
        raise ValueError(
            "TRANSCRIPTION_ALLOWED_HOSTS must contain at least one host suffix"
        )
    return tuple(hosts)


def _parse_max_upload_bytes(raw: str | None) -> int:
    """Parse TRANSCRIPTION_MAX_UPLOAD_BYTES: positive integer byte count."""
    if raw is None or not raw.strip():
        return DEFAULT_MAX_UPLOAD_BYTES
    try:
        value = int(raw.strip())
    except ValueError:
        raise ValueError(
            "TRANSCRIPTION_MAX_UPLOAD_BYTES must be a positive integer, "
            f"got {raw!r}"
        ) from None
    if value <= 0:
        raise ValueError(
            "TRANSCRIPTION_MAX_UPLOAD_BYTES must be a positive integer, "
            f"got {raw!r}"
        )
    return value


def load_config() -> TranscriptionConfig:
    """Read and validate the environment once. Raises ValueError on bad input."""
    whisper_model = (os.environ.get("WHISPER_MODEL") or "base").strip()
    device = (os.environ.get("DEVICE") or "cpu").strip()

    if not whisper_model:
        raise ValueError("WHISPER_MODEL must not be blank")
    if not device.startswith(_VALID_DEVICE_PREFIXES):
        raise ValueError(
            f"DEVICE must be one of cpu, mps, or cuda[:N] — got {device!r}"
        )

    allowed_hosts = _parse_allowed_hosts(
        os.environ.get("TRANSCRIPTION_ALLOWED_HOSTS")
    )
    max_upload_bytes = _parse_max_upload_bytes(
        os.environ.get("TRANSCRIPTION_MAX_UPLOAD_BYTES")
    )

    api_key_configured = bool(expected_api_key())

    config = TranscriptionConfig(
        whisper_model=whisper_model,
        device=device,
        api_key_configured=api_key_configured,
        allowed_hosts=allowed_hosts,
        max_upload_bytes=max_upload_bytes,
    )

    logger.info(
        "configuration loaded",
        extra={
            "whisper_model": config.whisper_model,
            "device": config.device,
            # Presence only — the key itself must never be logged.
            "api_key": "configured" if api_key_configured else "NOT configured",
            # The active download-host allowlist (hosts only, never full URLs).
            "allowed_hosts": ",".join(config.allowed_hosts),
            "max_upload_bytes": config.max_upload_bytes,
        },
    )
    logger.info(
        "download-and-transcribe host allowlist active: %s",
        ", ".join(config.allowed_hosts),
    )
    if not api_key_configured:
        logger.warning(
            "no API key configured (TRANSCRIPTION_API_KEY / SIDECAR_API_KEY unset) "
            "— every authenticated route will fail closed with 401"
        )

    return config

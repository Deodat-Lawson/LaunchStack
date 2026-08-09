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


@dataclass(frozen=True)
class TranscriptionConfig:
    """Validated startup configuration."""

    whisper_model: str
    device: str
    api_key_configured: bool


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

    api_key_configured = bool(expected_api_key())

    config = TranscriptionConfig(
        whisper_model=whisper_model,
        device=device,
        api_key_configured=api_key_configured,
    )

    logger.info(
        "configuration loaded",
        extra={
            "whisper_model": config.whisper_model,
            "device": config.device,
            # Presence only — the key itself must never be logged.
            "api_key": "configured" if api_key_configured else "NOT configured",
        },
    )
    if not api_key_configured:
        logger.warning(
            "no API key configured (TRANSCRIPTION_API_KEY / SIDECAR_API_KEY unset) "
            "— every authenticated route will fail closed with 401"
        )

    return config

"""
Contract tests: the transcription service's pydantic wire models must satisfy
the frozen JSON Schemas in packages/schema-generator/schemas/v1. A field added,
removed, or retyped on either side fails here instead of drifting silently.
"""

import json
from pathlib import Path

import jsonschema
import pytest

from app.routes.download_and_transcribe import (
    VideoTranscribeRequest,
    VideoTranscribeResponse,
)
from app.routes.transcribe import TranscribeResponse, TranscriptSegment


def _schema_dir() -> Path:
    """Locate packages/schema-generator/schemas/v1 by walking up from this file, so
    the tests work regardless of the pytest invocation directory."""
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "packages" / "schema-generator" / "schemas" / "v1"
        if candidate.is_dir():
            return candidate
    raise RuntimeError(
        "Could not locate packages/schema-generator/schemas/v1 above " + __file__
    )


def _load_schema(name: str) -> dict:
    return json.loads((_schema_dir() / name).read_text())


def _wire(model) -> dict:
    """Serialize the way FastAPI does: through JSON."""
    return json.loads(model.model_dump_json())


# ── transcription.transcribe-response ───────────────────────────────────────

class TestTranscribeResponseContract:
    SCHEMA = "transcription.transcribe-response.schema.json"

    def test_full_response_validates(self):
        model = TranscribeResponse(
            text="hello world",
            language="en",
            confidence=0.87,
            filename="clip.mp3",
            segments=[
                TranscriptSegment(start=0.0, end=1.5, text="hello"),
                TranscriptSegment(start=1.5, end=3.0, text="world"),
            ],
        )
        jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))

    def test_empty_segments_validates(self):
        model = TranscribeResponse(
            text="", language="unknown", confidence=0.0, filename="clip.mp4"
        )
        payload = _wire(model)
        assert payload["segments"] == []  # default serializes, key is required
        jsonschema.validate(payload, _load_schema(self.SCHEMA))

    def test_out_of_range_confidence_rejected_by_schema(self):
        model = TranscribeResponse(
            text="x", language="en", confidence=1.5, filename="a.mp3"
        )
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))


# ── transcription.video-response ────────────────────────────────────────────

class TestVideoTranscribeResponseContract:
    SCHEMA = "transcription.video-response.schema.json"

    def test_full_response_validates(self):
        model = VideoTranscribeResponse(
            text="a transcript",
            language="en",
            confidence=0.42,
            title="Some Video",
            duration=123.4,
            source_url="https://example.com/watch?v=abc",
        )
        jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))

    def test_null_duration_validates(self):
        model = VideoTranscribeResponse(
            text="a transcript",
            language="en",
            confidence=0.42,
            title="Some Video",
            duration=None,
            source_url="https://example.com/watch?v=abc",
        )
        payload = _wire(model)
        assert payload["duration"] is None  # null must be sent, not omitted
        jsonschema.validate(payload, _load_schema(self.SCHEMA))


# ── transcription.video-request ─────────────────────────────────────────────

class TestVideoTranscribeRequestContract:
    SCHEMA = "transcription.video-request.schema.json"

    def test_request_with_default_max_duration_validates(self):
        model = VideoTranscribeRequest(url="https://example.com/watch?v=abc")
        payload = _wire(model)
        assert payload["max_duration"] == 7200
        jsonschema.validate(payload, _load_schema(self.SCHEMA))

    def test_request_with_unlimited_duration_validates(self):
        model = VideoTranscribeRequest(
            url="https://example.com/watch?v=abc", max_duration=0
        )
        jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))

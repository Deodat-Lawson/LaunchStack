"""
Route behaviour for /transcribe, /health, and the trace-id middleware.

The Whisper model is never loaded — a fake transcriber is injected on
app.state (see conftest.py).
"""

import math

import pytest

from app.models.transcriber import confidence_from_segments

from .conftest import FAKE_RESULT


# ── /transcribe ─────────────────────────────────────────────────────────────

class TestTranscribe:
    def test_valid_mp3_returns_transcript(self, client, fake_transcriber):
        resp = client.post(
            "/transcribe", files={"file": ("clip.mp3", b"fake-mp3-bytes")}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body == {
            "text": FAKE_RESULT["text"],
            "language": FAKE_RESULT["language"],
            "confidence": FAKE_RESULT["confidence"],
            "filename": "clip.mp3",
            "segments": FAKE_RESULT["segments"],
        }
        assert fake_transcriber.calls == [
            ("transcribe_bytes", "clip.mp3", len(b"fake-mp3-bytes"))
        ]

    def test_mp4_extension_accepted(self, client):
        resp = client.post(
            "/transcribe", files={"file": ("video.mp4", b"fake-mp4-bytes")}
        )
        assert resp.status_code == 200
        assert resp.json()["filename"] == "video.mp4"

    def test_unsupported_extension_rejected_with_400(self, client, fake_transcriber):
        resp = client.post(
            "/transcribe", files={"file": ("notes.wav", b"fake-wav-bytes")}
        )
        assert resp.status_code == 400
        assert "Invalid file format" in resp.json()["detail"]
        assert fake_transcriber.calls == []

    def test_missing_file_field_returns_422(self, client):
        assert client.post("/transcribe").status_code == 422


# ── /health ─────────────────────────────────────────────────────────────────

class TestHealth:
    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["service"] == "transcription"


# ── Trace-id middleware ─────────────────────────────────────────────────────

class TestTraceId:
    def test_incoming_trace_id_is_echoed(self, client):
        resp = client.get("/health", headers={"X-Trace-Id": "trace-abc-123"})
        assert resp.headers["X-Trace-Id"] == "trace-abc-123"

    def test_trace_id_generated_when_absent(self, client):
        resp = client.get("/health")
        generated = resp.headers.get("X-Trace-Id")
        assert generated
        assert generated != ""

    def test_trace_id_present_on_error_responses(self, client_no_auth):
        resp = client_no_auth.post("/transcribe")
        assert resp.status_code == 401
        assert resp.headers.get("X-Trace-Id")


# ── Confidence derivation (the fabricated 0.0 is gone) ──────────────────────

class TestConfidenceFromSegments:
    """confidence must be exp(mean(avg_logprob)) over Whisper segments —
    a real model-derived value, never a constant."""

    def test_exp_of_mean_logprob(self):
        segments = [
            {"avg_logprob": -0.2},
            {"avg_logprob": -0.4},
        ]
        expected = math.exp((-0.2 + -0.4) / 2)
        assert confidence_from_segments(segments) == pytest.approx(expected)

    def test_single_segment(self):
        assert confidence_from_segments([{"avg_logprob": -1.0}]) == pytest.approx(
            math.exp(-1.0)
        )

    def test_empty_segments_yield_zero_not_certainty(self):
        assert confidence_from_segments([]) == 0.0

    def test_segments_without_logprob_are_ignored(self):
        segments = [{"start": 0, "end": 1, "text": "x"}]
        assert confidence_from_segments(segments) == 0.0

    def test_clamped_to_unit_interval(self):
        # avg_logprob should be <= 0, but a defensive clamp keeps the wire
        # contract (0 <= confidence <= 1) even on degenerate input.
        assert confidence_from_segments([{"avg_logprob": 0.5}]) == 1.0
        assert confidence_from_segments([{"avg_logprob": -1000.0}]) >= 0.0

    def test_result_always_in_unit_interval(self):
        for logprob in (-5.0, -1.0, -0.5, -0.01, 0.0):
            value = confidence_from_segments([{"avg_logprob": logprob}])
            assert 0.0 <= value <= 1.0

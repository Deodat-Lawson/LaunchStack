"""
Route behaviour for /transcribe, /health, and the trace-id middleware.

The Whisper model is never loaded — a fake transcriber is injected on
app.state (see conftest.py).
"""

import math
import threading
from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from app.config import load_config
from app.main import app
from app.models.transcriber import confidence_from_segments

from .conftest import FAKE_RESULT, TEST_API_KEY, FakeTranscriber


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

    def test_empty_file_returns_400_not_500(self, client, fake_transcriber):
        """The route's own HTTPException(400) must not be swallowed by the
        broad except and re-raised as a 500."""
        resp = client.post("/transcribe", files={"file": ("clip.mp3", b"")})
        assert resp.status_code == 400
        assert resp.json()["detail"] == "File is empty"
        assert fake_transcriber.calls == []

    def test_upload_over_cap_returns_413(self, client, fake_transcriber, monkeypatch):
        """TRANSCRIPTION_MAX_UPLOAD_BYTES caps the streamed upload size."""
        monkeypatch.setenv("TRANSCRIPTION_MAX_UPLOAD_BYTES", "8")
        app.state.config = load_config()

        resp = client.post(
            "/transcribe", files={"file": ("clip.mp3", b"123456789")}
        )
        assert resp.status_code == 413
        assert "TRANSCRIPTION_MAX_UPLOAD_BYTES" in resp.json()["detail"]
        assert fake_transcriber.calls == []

        # A payload at the cap still transcribes.
        resp = client.post("/transcribe", files={"file": ("clip.mp3", b"12345678")})
        assert resp.status_code == 200


# ── Event-loop liveness (blocking work must run in the threadpool) ──────────

class TestEventLoopNotBlocked:
    def test_health_answers_while_transcription_is_in_flight(self, monkeypatch):
        """Proof by construction that Whisper no longer starves the loop.

        A shared-portal TestClient (context manager) drives BOTH requests
        through ONE event loop. The fake transcriber blocks until the main
        thread releases it — and the main thread only releases it AFTER
        /health has answered. If transcribe_bytes ran on the event loop
        (pre-fix), /health could never be served while it blocks, the release
        would never fire, and the wait below would time out. With
        run_in_threadpool the loop stays free and everything completes.
        """
        entered = threading.Event()
        release = threading.Event()

        class SlowTranscriber(FakeTranscriber):
            def transcribe_bytes(self, audio_bytes, filename="audio"):
                entered.set()
                assert release.wait(timeout=10), (
                    "never released — /health was starved, so the blocking "
                    "call is still on the event loop"
                )
                return super().transcribe_bytes(audio_bytes, filename)

        app.state.transcriber = SlowTranscriber()

        # The context-managed client shares one portal/event loop across
        # requests, but would run the real lifespan (loading Whisper) — swap
        # in a no-op lifespan; app.state is already primed by the fixtures.
        @asynccontextmanager
        async def no_op_lifespan(_app):
            yield

        monkeypatch.setattr(app.router, "lifespan_context", no_op_lifespan)

        with TestClient(app) as shared_client:
            shared_client.headers.update({"X-API-Key": TEST_API_KEY})

            results: dict[str, object] = {}

            def do_transcribe():
                results["resp"] = shared_client.post(
                    "/transcribe", files={"file": ("clip.mp3", b"bytes")}
                )

            worker = threading.Thread(target=do_transcribe)
            worker.start()
            try:
                assert entered.wait(timeout=10), "transcription never started"
                # The transcription is blocked RIGHT NOW — /health must answer.
                health = shared_client.get("/health")
                assert health.status_code == 200
                assert health.json()["status"] == "ok"
            finally:
                release.set()
                worker.join(timeout=10)

            assert not worker.is_alive()
            resp = results["resp"]
            assert resp.status_code == 200  # type: ignore[union-attr]


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

"""Shared fixtures for the transcription service tests.

The suite uses the REAL app from ``app.main`` but never runs its lifespan
(TestClient is not used as a context manager), so no Whisper model is ever
loaded — the same "never load torch" discipline the old sidecar suite used.
``whisper`` itself is imported lazily inside ``Transcriber.__init__``, which
keeps ``import app.main`` cheap. A fake transcriber is injected on
``app.state.transcriber`` instead.
"""

import pytest
from fastapi.testclient import TestClient

from app.config import load_config
from app.main import app

# Test API key used for all authenticated requests
TEST_API_KEY = "test-transcription-api-key"

# Canned Whisper-style result the fake transcriber returns. confidence is the
# value a real Transcriber would derive from segment avg_logprob.
FAKE_RESULT = {
    "text": "hello world",
    "language": "en",
    "confidence": 0.87,
    "segments": [
        {"start": 0.0, "end": 1.5, "text": "hello"},
        {"start": 1.5, "end": 3.0, "text": "world"},
    ],
}


class FakeTranscriber:
    """Stands in for app.models.transcriber.Transcriber without torch."""

    def __init__(self, result: dict | None = None):
        self.result = result or FAKE_RESULT
        self.calls: list[tuple] = []

    def transcribe(self, audio_path):
        self.calls.append(("transcribe", audio_path))
        return dict(self.result)

    def transcribe_bytes(self, audio_bytes: bytes, filename: str = "audio"):
        self.calls.append(("transcribe_bytes", filename, len(audio_bytes)))
        return dict(self.result)


@pytest.fixture(autouse=True)
def set_api_key_env(monkeypatch):
    """Set TRANSCRIPTION_API_KEY for all tests so the auth dependency passes.
    SIDECAR_API_KEY is cleared so tests exercise the primary variable."""
    monkeypatch.delenv("SIDECAR_API_KEY", raising=False)
    monkeypatch.setenv("TRANSCRIPTION_API_KEY", TEST_API_KEY)


@pytest.fixture(autouse=True)
def app_config(set_api_key_env, monkeypatch):
    """Install the typed config the lifespan would have set — the routes read
    the upload cap and download-host allowlist from ``app.state.config``.
    Policy env vars are cleared first so every test starts from the defaults;
    tests that need different values setenv and re-run ``load_config()``."""
    monkeypatch.delenv("TRANSCRIPTION_ALLOWED_HOSTS", raising=False)
    monkeypatch.delenv("TRANSCRIPTION_MAX_UPLOAD_BYTES", raising=False)
    app.state.config = load_config()
    return app.state.config


@pytest.fixture
def fake_transcriber():
    transcriber = FakeTranscriber()
    app.state.transcriber = transcriber
    return transcriber


@pytest.fixture
def client(fake_transcriber):
    """Test client with the API key header pre-injected."""
    test_client = TestClient(app)
    test_client.headers.update({"X-API-Key": TEST_API_KEY})
    return test_client


@pytest.fixture
def client_no_auth(fake_transcriber):
    """Test client with no default API key header attached."""
    return TestClient(app)

"""
Speech-to-Text transcriber wrapper.
Uses OpenAI Whisper for local audio transcription,
replacing API calls to reduce cost.

`whisper` (and therefore torch) is imported lazily inside
``Transcriber.__init__`` so that importing this module — and anything that
imports it, like ``app.main`` — stays cheap and testable. The test suite
never constructs a real ``Transcriber``; it injects a fake on
``app.state.transcriber`` instead (see ``tests/conftest.py``).
"""

import logging
import math
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


def confidence_from_segments(segments: list[dict]) -> float:
    """
    Derive an overall confidence in [0, 1] from Whisper's per-segment
    ``avg_logprob`` (the mean log-probability per decoded token of that
    segment).

    Whisper does not emit a top-level confidence value, so this is the real,
    model-derived signal: ``exp(mean(avg_logprob))`` converts the mean
    log-probability back into an average per-token probability. Clean speech
    typically lands around 0.7–0.95; noisy or uncertain audio well below.
    The result is clamped to [0, 1] defensively.

    An empty segment list yields 0.0 — no decoded segments means no evidence,
    not certainty.
    """
    logprobs = [
        seg["avg_logprob"]
        for seg in segments
        if isinstance(seg, dict) and isinstance(seg.get("avg_logprob"), (int, float))
    ]
    if not logprobs:
        return 0.0
    mean_logprob = sum(logprobs) / len(logprobs)
    return max(0.0, min(1.0, math.exp(mean_logprob)))


class Transcriber:
    """Wraps OpenAI Whisper for local audio transcription."""

    def __init__(self, model_name: str = "base", device: str = "cpu"):
        # Lazy import: loading whisper pulls in torch, which is only needed
        # when a real model is constructed (i.e. at service startup).
        import whisper

        logger.info(f"[Transcriber] Loading Whisper {model_name} on {device}...")
        self.model = whisper.load_model(model_name, device=device)
        self.device = device
        logger.info(f"[Transcriber] Ready — model={model_name}, device={device}")

    def transcribe(self, audio_path: str | Path) -> dict:
        """
        Transcribe audio file to text.

        Args:
            audio_path: Path to audio file (mp3, mp4, wav, flac, etc.)

        Returns:
            Dictionary with:
                - text: Transcribed text
                - language: Detected language code (e.g., "en")
                - confidence: exp(mean segment avg_logprob), in [0, 1]
                  (see confidence_from_segments)
                - segments: list of {start, end, text}
        """
        audio_path = Path(audio_path)
        try:
            if not audio_path.exists():
                raise FileNotFoundError(f"Audio file not found: {audio_path}")

            logger.info(f"[Transcriber] Transcribing: {audio_path.name}...")
            result = self.model.transcribe(str(audio_path), language=None)  # auto-detect language

            raw_segments = result.get("segments", [])
            segments = [
                {
                    "start": seg["start"],
                    "end": seg["end"],
                    "text": seg["text"].strip(),
                }
                for seg in raw_segments
            ]

            return {
                "text": result["text"].strip(),
                "language": result.get("language", "unknown"),
                "confidence": confidence_from_segments(raw_segments),
                "segments": segments,
            }
        except Exception as e:
            logger.error(f"[Transcriber] Error transcribing {audio_path.name}: {e}")
            raise

    def transcribe_bytes(self, audio_bytes: bytes, filename: str = "audio") -> dict:
        """
        Transcribe audio from bytes (useful for uploaded files).

        Args:
            audio_bytes: Raw audio file bytes
            filename: Original filename (for extension detection)

        Returns:
            Same as transcribe()
        """
        # Create a temporary file to hold the audio bytes
        with tempfile.NamedTemporaryFile(suffix=Path(filename).suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp.flush()
            tmp_path = tmp.name

        try:
            return self.transcribe(tmp_path)
        finally:
            # Clean up temporary file
            Path(tmp_path).unlink(missing_ok=True)

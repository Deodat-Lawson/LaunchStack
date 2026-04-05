"""
Speech-to-Text transcriber wrapper.
Uses OpenAI Whisper for local audio transcription,
replacing API calls to reduce cost.
"""

import os
import tempfile
from pathlib import Path

import whisper


DEFAULT_MODEL = os.getenv("WHISPER_MODEL", "base")
DEFAULT_DEVICE = os.getenv("DEVICE", "cpu")


class Transcriber:
    """Wraps OpenAI Whisper for local audio transcription."""

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL,
        device: str = DEFAULT_DEVICE,
    ):
        print(f"[Transcriber] Loading Whisper {model_name} on {device}...")
        self.model = whisper.load_model(model_name, device=device)
        self.device = device
        print(f"[Transcriber] Ready — model={model_name}, device={device}")

    def transcribe(self, audio_path: str | Path) -> dict:
        """
        Transcribe audio file to text.
        
        Args:
            audio_path: Path to audio file (mp3, mp4, wav, flac, etc.)
        
        Returns:
            Dictionary with:
                - text: Transcribed text
                - language: Detected language code (e.g., "en")
                - confidence: Confidence score
        """
        try:
            audio_path = Path(audio_path)
            if not audio_path.exists():
                raise FileNotFoundError(f"Audio file not found: {audio_path}")

            print(f"[Transcriber] Transcribing: {audio_path.name}...")
            result = self.model.transcribe(str(audio_path), language=None)  # auto-detect language
            
            return {
                "text": result["text"].strip(),
                "language": result.get("language", "unknown"),
                "confidence": result.get("confidence", 0.0),
            }
        except Exception as e:
            print(f"[Transcriber] Error transcribing {audio_path.name}: {e}")
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

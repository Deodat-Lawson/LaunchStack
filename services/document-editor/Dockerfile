# syntax=docker/dockerfile:1
# Slim by design: no whisper, no torch, no yt-dlp, no ffmpeg — the
# transcription workload lives in services/transcription (ADR-004).
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

RUN useradd --create-home --shell /bin/bash editor && chown -R editor:editor /app

EXPOSE 8000

USER editor

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

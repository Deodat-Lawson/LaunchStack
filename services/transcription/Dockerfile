# syntax=docker/dockerfile:1
FROM python:3.12-slim

WORKDIR /app

# ffmpeg: required by whisper's audio loader and yt-dlp's audio postprocessor.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

RUN useradd --create-home --shell /bin/bash transcription && chown -R transcription:transcription /app

EXPOSE 8000

USER transcription

# Long start period: the Whisper model loads (torch) during lifespan startup.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

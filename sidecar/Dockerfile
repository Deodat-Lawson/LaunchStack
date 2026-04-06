# syntax=docker/dockerfile:1
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install Adeu (lightweight DOCX redlining) in its own layer — cached independently from ML deps
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install adeu==0.9.0

# Install CPU-only PyTorch first (~200MB vs ~2GB with CUDA), then remaining deps.
# BuildKit cache mount keeps pip's download cache across rebuilds.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install -r requirements.txt

COPY app/ ./app/

ENV TRANSFORMERS_CACHE=/app/model-cache
ENV HF_HOME=/app/model-cache

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

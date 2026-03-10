FROM python:3.12-slim

WORKDIR /app

# Install system dependencies (for sentence-transformers / torch)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# Model cache volume — avoids re-downloading on every restart
ENV TRANSFORMERS_CACHE=/app/model-cache
ENV HF_HOME=/app/model-cache

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

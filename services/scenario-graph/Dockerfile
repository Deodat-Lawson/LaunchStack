# LaunchStack scenario graph service: Graphiti (Apache-2.0) behind an
# authenticated API. Neo4j is NOT in this image — it runs as its own,
# unmodified neo4j:5.26-community container (see NOTICE).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # Graphiti sends PostHog telemetry unless this is false.
    GRAPHITI_TELEMETRY_ENABLED=false

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app/ ./app/
COPY NOTICE ./

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin graph \
    && chown -R graph:graph /app

USER graph

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4)"]

# One process: per-group ordering and the ingest bound are in-process locks.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

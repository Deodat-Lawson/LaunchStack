# syntax=docker/dockerfile:1
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

RUN useradd --create-home --shell /bin/bash sidecar && chown -R sidecar:sidecar /app

EXPOSE 8000

USER sidecar

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

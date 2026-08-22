"""
Structured logging with request trace IDs.

- ``TraceIdMiddleware`` honours an incoming ``X-Trace-Id`` header, generates a
  fresh ID when the header is absent, exposes it to every log record emitted
  while handling the request (via a contextvar), and echoes it back on the
  response so callers can correlate logs across services.
- ``configure_logging`` installs a single JSON-lines formatter on the root
  logger so every record carries ``ts``, ``level``, ``logger``, ``service``,
  ``trace_id``, ``message``, and any structured fields passed via ``extra=``.
"""

from __future__ import annotations

import contextvars
import datetime
import json
import logging
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

TRACE_HEADER = "X-Trace-Id"

# "-" marks records emitted outside any request (startup, shutdown).
trace_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "trace_id", default="-"
)

# logging.LogRecord attributes that are not user-supplied "extra" fields.
_RESERVED_RECORD_ATTRS = frozenset(
    logging.LogRecord("", 0, "", 0, "", (), None).__dict__
) | {"message", "asctime", "taskName", "trace_id"}


class TraceIdMiddleware(BaseHTTPMiddleware):
    """Bind a trace ID to the request context and echo it on the response."""

    async def dispatch(self, request: Request, call_next):
        trace_id = request.headers.get(TRACE_HEADER) or uuid.uuid4().hex
        token = trace_id_var.set(trace_id)
        try:
            response = await call_next(request)
        finally:
            trace_id_var.reset(token)
        response.headers[TRACE_HEADER] = trace_id
        return response


class _JsonFormatter(logging.Formatter):
    def __init__(self, service: str) -> None:
        super().__init__()
        self._service = service

    def format(self, record: logging.LogRecord) -> str:
        entry: dict = {
            "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "service": self._service,
            "trace_id": trace_id_var.get(),
            "message": record.getMessage(),
        }
        # Structured fields passed via `extra=` on the log call.
        for key, value in record.__dict__.items():
            if key not in _RESERVED_RECORD_ATTRS:
                entry[key] = value
        if record.exc_info:
            entry["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


def configure_logging(service: str, level: int = logging.INFO) -> None:
    """Install the JSON formatter on the root logger (idempotent)."""
    root = logging.getLogger()
    root.setLevel(level)
    handler = logging.StreamHandler()
    handler.setFormatter(_JsonFormatter(service))
    root.handlers = [handler]

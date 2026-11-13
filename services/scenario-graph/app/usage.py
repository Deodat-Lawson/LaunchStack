"""
Provider usage, measured at the provider client.

Graphiti's generic OpenAI-compatible client does not record token usage, so
the service hands Graphiti a wrapped ``AsyncOpenAI`` whose
``chat.completions.create`` and ``embeddings.create`` add each response's
reported ``usage`` to the meter of the ingest call that is running. The meter
lives in a ``ContextVar``: Graphiti fans work out with ``asyncio.gather``, and
every task it creates copies the caller's context, so concurrent ingest calls
for different groups each count only their own provider calls.

Tokens are never estimated. A response with no ``usage`` block is counted in
``unmetered_calls`` so an under-reporting provider is visible, not silent.
"""

from __future__ import annotations

import contextvars
import threading
from dataclasses import dataclass
from typing import Any


@dataclass
class UsageMeter:
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    embedding_tokens: int = 0
    unmetered_calls: int = 0

    def __post_init__(self) -> None:
        self._lock = threading.Lock()

    def add_llm(self, usage: Any) -> None:
        with self._lock:
            self.calls += 1
            if usage is None:
                self.unmetered_calls += 1
                return
            self.input_tokens += _int(getattr(usage, "prompt_tokens", 0))
            self.output_tokens += _int(getattr(usage, "completion_tokens", 0))

    def add_embedding(self, usage: Any) -> None:
        with self._lock:
            self.calls += 1
            if usage is None:
                self.unmetered_calls += 1
                return
            tokens = getattr(usage, "prompt_tokens", None)
            if tokens is None:
                tokens = getattr(usage, "total_tokens", 0)
            self.embedding_tokens += _int(tokens)

    def snapshot(self) -> dict[str, int]:
        with self._lock:
            return {
                "calls": self.calls,
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens,
                "embedding_tokens": self.embedding_tokens,
                "unmetered_calls": self.unmetered_calls,
            }


def _int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


current_meter: contextvars.ContextVar[UsageMeter | None] = contextvars.ContextVar(
    "scenario_graph_usage_meter", default=None
)


class _MeteredCompletions:
    def __init__(self, inner: Any, extra_body: dict[str, Any] | None = None):
        self._inner = inner
        self._extra_body = extra_body

    async def create(self, *args: Any, **kwargs: Any) -> Any:
        if self._extra_body:
            kwargs["extra_body"] = {**self._extra_body, **(kwargs.get("extra_body") or {})}
        response = await self._inner.create(*args, **kwargs)
        meter = current_meter.get()
        if meter is not None:
            meter.add_llm(getattr(response, "usage", None))
        return response

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


class _MeteredChat:
    def __init__(self, inner: Any, extra_body: dict[str, Any] | None = None):
        self._inner = inner
        self.completions = _MeteredCompletions(inner.completions, extra_body)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


class _MeteredEmbeddings:
    def __init__(self, inner: Any):
        self._inner = inner

    async def create(self, *args: Any, **kwargs: Any) -> Any:
        response = await self._inner.create(*args, **kwargs)
        meter = current_meter.get()
        if meter is not None:
            meter.add_embedding(getattr(response, "usage", None))
        return response

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


class MeteredOpenAI:
    """Duck-typed stand-in for ``AsyncOpenAI``: the two endpoints Graphiti's
    generic client and embedder call are metered, everything else passes
    through to the real client. ``chat_extra_body`` adds provider-specific
    fields to every chat request (``GRAPH_LLM_EXTRA_BODY``), e.g. turning a
    local model's thinking off."""

    def __init__(self, inner: Any, chat_extra_body: dict[str, Any] | None = None):
        self._inner = inner
        self.chat = _MeteredChat(inner.chat, chat_extra_body)
        self.embeddings = _MeteredEmbeddings(inner.embeddings)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

"""
Service logic between the routes and the backend: per-group serialisation,
bounded ingestion, idempotent episodes, usage metering and error hygiene.

Idempotency. An episode uuid already stored *and marked done* in the group is
reported ``done`` without being re-added. A pending leftover (a crash between
the pending save and the end of extraction) is discarded and redone, unless
Graphiti had already committed its extraction, in which case it is marked done.
A uuid held by another group is refused: Graphiti merges episodes by uuid
alone, so re-using it would overwrite another build's episode.

Ordering. Episodes of one request run in order, one at a time (Graphiti
requires sequential episodes within a group). Requests for the same group
wait for each other; ``GRAPH_INGEST_CONCURRENCY`` bounds episodes in flight
across all groups. Locks are in-process: run one service process.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, AsyncIterator

import neo4j.exceptions
import openai
from graphiti_core.llm_client.errors import RateLimitError as GraphitiRateLimitError

from app.backend import MAX_EPISODES, EpisodeInput, EpisodeState, GraphBackend
from app.ontology import CompiledOntology
from app.usage import UsageMeter, current_meter

logger = logging.getLogger(__name__)

ERROR_MAX = 200

# Errors that mean "the graph database or a provider is unreachable or
# refusing": the rest of the batch is not attempted, so the worker can wait
# and retry instead of watching every episode time out in turn.
UNAVAILABLE_ERRORS: tuple[type[BaseException], ...] = (
    neo4j.exceptions.ServiceUnavailable,
    neo4j.exceptions.SessionExpired,
    openai.APIConnectionError,  # includes APITimeoutError
    openai.InternalServerError,
    openai.RateLimitError,
    GraphitiRateLimitError,
    asyncio.TimeoutError,
    ConnectionError,
)

# Messages from these are about the transport, never about document text, so a
# trimmed message is safe to return.
_TRANSPORT_ERRORS: tuple[type[BaseException], ...] = (
    neo4j.exceptions.DriverError,
    openai.APIConnectionError,
    asyncio.TimeoutError,
    ConnectionError,
)


def describe_error(error: BaseException) -> str:
    """A short, text-free description: class name, plus a trimmed message for
    transport errors, the Neo4j status code (a server message can quote
    property values) or the provider's HTTP status (a provider message can
    quote the prompt). Anything else — e.g. a parse error over model output —
    is reported by class name only."""
    name = type(error).__name__
    if isinstance(error, neo4j.exceptions.Neo4jError):
        detail = error.code or ""
    elif isinstance(error, openai.APIStatusError):
        detail = f"HTTP {error.status_code}"
    elif isinstance(error, _TRANSPORT_ERRORS):
        detail = " ".join(str(error).split())
    else:
        detail = ""
    text = f"{name}: {detail}" if detail else name
    return text if len(text) <= ERROR_MAX else f"{text[: ERROR_MAX - 1]}…"


def is_unavailable(error: BaseException) -> bool:
    return isinstance(error, UNAVAILABLE_ERRORS)


@dataclass(frozen=True)
class Outcome:
    uuid: str
    status: str
    error: str | None = None

    def to_json(self) -> dict[str, Any]:
        body: dict[str, Any] = {"uuid": self.uuid, "status": self.status}
        if self.error is not None:
            body["error"] = self.error
        return body


class _Unavailable(Exception):
    def __init__(self, outcome: Outcome):
        super().__init__(outcome.error)
        self.outcome = outcome


class GraphService:
    def __init__(
        self,
        backend: GraphBackend,
        *,
        ingest_concurrency: int,
        context_episodes: int,
        export_max_nodes: int,
        export_max_edges: int,
    ):
        self.backend = backend
        self._slots = asyncio.Semaphore(ingest_concurrency)
        self._context_episodes = context_episodes
        self._export_max_nodes = export_max_nodes
        self._export_max_edges = export_max_edges
        self._locks: dict[str, asyncio.Lock] = {}
        self._waiters: dict[str, int] = {}

    @asynccontextmanager
    async def _group(self, group_id: str) -> AsyncIterator[None]:
        lock = self._locks.setdefault(group_id, asyncio.Lock())
        self._waiters[group_id] = self._waiters.get(group_id, 0) + 1
        try:
            async with lock:
                yield
        finally:
            self._waiters[group_id] -= 1
            if self._waiters[group_id] == 0:
                del self._waiters[group_id]
                del self._locks[group_id]

    # ── health ──

    async def health(self) -> tuple[bool, str | None, str | None]:
        try:
            await self.backend.ensure_ready()
            graphiti_version, neo4j_version = await self.backend.versions()
        except Exception as error:  # health reports, never raises
            logger.warning("health check failed: %s", describe_error(error))
            return False, None, None
        return True, graphiti_version, neo4j_version

    # ── ingest ──

    async def ingest(
        self,
        group_id: str,
        ontology: CompiledOntology,
        episodes: list[EpisodeInput],
    ) -> tuple[list[Outcome], dict[str, int]]:
        """Raises on a database failure before any episode is attempted (the
        route answers 503); after that, failures are per-episode outcomes so
        the tokens already spent are always reported."""
        await self.backend.ensure_ready()
        async with self._group(group_id):
            states = await self.backend.episode_states([episode.uuid for episode in episodes])
            meter = UsageMeter()
            token = current_meter.set(meter)
            outcomes: list[Outcome] = []
            try:
                blocked: str | None = None
                for episode in episodes:
                    if blocked is not None:
                        outcomes.append(Outcome(episode.uuid, "failed", f"not attempted: {blocked}"))
                        continue
                    try:
                        outcome = await self._ingest_one(
                            group_id, episode, ontology, states.get(episode.uuid, [])
                        )
                    except _Unavailable as unavailable:
                        outcome = unavailable.outcome
                        blocked = outcome.error or "graph unavailable"
                    outcomes.append(outcome)
            finally:
                current_meter.reset(token)
            return outcomes, meter.snapshot()

    async def _ingest_one(
        self,
        group_id: str,
        episode: EpisodeInput,
        ontology: CompiledOntology,
        states: list[EpisodeState],
    ) -> Outcome:
        if any(state.group_id != group_id for state in states):
            return Outcome(episode.uuid, "failed", "episode uuid is already used by another group")
        mine = next((state for state in states if state.group_id == group_id), None)
        try:
            if mine is not None and mine.done:
                return Outcome(episode.uuid, "done")
            if mine is not None and mine.committed:
                await self.backend.mark_done(group_id, episode.uuid)
                return Outcome(episode.uuid, "done")
            if mine is not None:
                await self.backend.discard_pending(group_id, episode.uuid)

            async with self._slots:
                previous = await self.backend.recent_done_episodes(group_id, self._context_episodes)
                await self.backend.save_pending_episode(group_id, episode)
                try:
                    await self.backend.run_episode(group_id, episode, ontology, previous)
                except Exception as error:
                    logger.exception("episode %s failed in group %s", episode.uuid, group_id)
                    if await self._settle_failed(group_id, episode.uuid):
                        return Outcome(episode.uuid, "done")
                    outcome = Outcome(episode.uuid, "failed", describe_error(error))
                    if is_unavailable(error):
                        raise _Unavailable(outcome) from error
                    return outcome
                await self.backend.mark_done(group_id, episode.uuid)
                return Outcome(episode.uuid, "done")
        except _Unavailable:
            raise
        except Exception as error:
            # Bookkeeping against the database failed; the episode stays pending
            # (or committed-unmarked) and the next attempt reconciles it.
            logger.exception("episode %s bookkeeping failed in group %s", episode.uuid, group_id)
            outcome = Outcome(episode.uuid, "failed", describe_error(error))
            if is_unavailable(error):
                raise _Unavailable(outcome) from error
            return outcome

    async def _settle_failed(self, group_id: str, uuid: str) -> bool:
        """After add_episode raised: True when Graphiti had committed anyway
        (marked done); otherwise the pending episode is removed."""
        try:
            states = await self.backend.episode_states([uuid])
            mine = next((s for s in states.get(uuid, []) if s.group_id == group_id), None)
            if mine is not None and mine.committed:
                await self.backend.mark_done(group_id, uuid)
                return True
            await self.backend.discard_pending(group_id, uuid)
        except Exception:
            logger.exception("could not clean up pending episode %s in group %s", uuid, group_id)
        return False

    # ── reads and delete ──

    async def list_episodes(self, group_id: str) -> list[str]:
        return await self.backend.done_episodes(group_id, MAX_EPISODES)

    async def search(self, group_id: str, query: str, limit: int) -> list[dict[str, Any]]:
        edges = await self.backend.search(group_id, query, limit)
        # Scores depend only on the result order: rank 0 → 1.0, rank 1 → 0.5, …
        return [
            {"edge": edge, "score": round(1.0 / (rank + 1), 6)}
            for rank, edge in enumerate(edges[:limit])
        ]

    async def export(self, group_id: str) -> dict[str, Any]:
        return await self.backend.export(group_id, self._export_max_nodes, self._export_max_edges)

    async def delete_group(self, group_id: str) -> int:
        async with self._group(group_id):
            return await self.backend.delete_group(group_id)

"""
Typed startup configuration for the scenario graph service.

Read and validated once, from the FastAPI lifespan. The bearer token and the
provider keys are never stored on the config object or logged — only whether
they are set. Authentication (``app.auth``) re-reads the token per request so
rotation applies without a restart.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_INGEST_CONCURRENCY = 2
DEFAULT_EMBEDDING_DIM = 1024
# Episodes Graphiti reads as context when it extracts a new one. Graphiti's
# own add_episode default is 10; evidence sections run to thousands of tokens,
# so this keeps each extraction prompt bounded.
DEFAULT_CONTEXT_EPISODES = 3
# Export is a single response; past these the service answers 413 instead of
# returning a silently truncated graph that would then be frozen and hashed.
DEFAULT_EXPORT_MAX_NODES = 10_000
DEFAULT_EXPORT_MAX_EDGES = 20_000


@dataclass(frozen=True)
class GraphServiceConfig:
    neo4j_uri: str
    neo4j_user: str
    llm_base_url: str | None
    llm_model: str
    llm_small_model: str
    embedding_base_url: str | None
    embedding_model: str
    embedding_dim: int
    ingest_concurrency: int
    max_coroutines: int | None
    context_episodes: int
    export_max_nodes: int
    export_max_edges: int
    llm_structured_output: str = "json_schema"
    llm_extra_body: dict[str, Any] = field(default_factory=dict)


def _json_object(name: str) -> dict[str, Any]:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        raise ValueError(f"{name} must be a JSON object") from None
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be a JSON object")
    return value


def _positive_int(name: str, default: int | None) -> int | None:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        raise ValueError(f"{name} must be a positive integer, got {raw!r}") from None
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer, got {raw!r}")
    return value


def _required(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise ValueError(f"{name} must be set")
    return value


def _optional(name: str) -> str | None:
    value = (os.environ.get(name) or "").strip()
    return value or None


def load_config() -> GraphServiceConfig:
    """Read and validate the environment once. Raises ValueError on bad input."""
    llm_model = _required("GRAPH_LLM_MODEL")
    structured = (os.environ.get("GRAPH_LLM_STRUCTURED_OUTPUT") or "json_schema").strip()
    if structured not in ("json_schema", "json_object"):
        raise ValueError("GRAPH_LLM_STRUCTURED_OUTPUT must be json_schema or json_object")
    config = GraphServiceConfig(
        neo4j_uri=_required("NEO4J_URI"),
        neo4j_user=(os.environ.get("NEO4J_USER") or "neo4j").strip(),
        llm_base_url=_optional("GRAPH_LLM_BASE_URL"),
        llm_model=llm_model,
        llm_small_model=_optional("GRAPH_LLM_SMALL_MODEL") or llm_model,
        embedding_base_url=_optional("GRAPH_EMBEDDING_BASE_URL"),
        embedding_model=_required("GRAPH_EMBEDDING_MODEL"),
        embedding_dim=_positive_int("GRAPH_EMBEDDING_DIM", DEFAULT_EMBEDDING_DIM) or 0,
        ingest_concurrency=_positive_int(
            "GRAPH_INGEST_CONCURRENCY", DEFAULT_INGEST_CONCURRENCY
        )
        or DEFAULT_INGEST_CONCURRENCY,
        max_coroutines=_positive_int("GRAPH_MAX_COROUTINES", None),
        context_episodes=_positive_int(
            "GRAPH_CONTEXT_EPISODES", DEFAULT_CONTEXT_EPISODES
        )
        or DEFAULT_CONTEXT_EPISODES,
        export_max_nodes=_positive_int(
            "GRAPH_EXPORT_MAX_NODES", DEFAULT_EXPORT_MAX_NODES
        )
        or DEFAULT_EXPORT_MAX_NODES,
        export_max_edges=_positive_int(
            "GRAPH_EXPORT_MAX_EDGES", DEFAULT_EXPORT_MAX_EDGES
        )
        or DEFAULT_EXPORT_MAX_EDGES,
        llm_structured_output=structured,
        llm_extra_body=_json_object("GRAPH_LLM_EXTRA_BODY"),
    )
    logger.info(
        "configuration loaded",
        extra={
            "neo4j_uri": config.neo4j_uri,
            "llm_model": config.llm_model,
            "llm_small_model": config.llm_small_model,
            "llm_extra_body_keys": ",".join(sorted(config.llm_extra_body)),
            "embedding_model": config.embedding_model,
            "embedding_dim": config.embedding_dim,
            "ingest_concurrency": config.ingest_concurrency,
            # Presence only — secrets are never logged.
            "token": "configured" if os.environ.get("SCENARIO_GRAPH_TOKEN") else "NOT configured",
            "llm_api_key": "configured" if os.environ.get("GRAPH_LLM_API_KEY") else "unset",
            "embedding_api_key": "configured"
            if os.environ.get("GRAPH_EMBEDDING_API_KEY")
            else "unset",
        },
    )
    if not os.environ.get("SCENARIO_GRAPH_TOKEN"):
        logger.warning(
            "SCENARIO_GRAPH_TOKEN is unset — every /v1 route fails closed with 401"
        )
    return config

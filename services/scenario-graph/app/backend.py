"""
The only module that talks to Graphiti and Neo4j.

Graphiti owns extraction (``add_episode``) and search (``search_``); every
other read and write is a parameterised Cypher query written here, and every
one of them filters on ``group_id``. Each query carries a ``// ls:<name>`` tag
so logs (and the unit tests' fake driver) can tell them apart.

Episode bookkeeping. Graphiti's ``add_episode(uuid=…)`` does not create an
episode with that uuid — it loads an existing one. So a deterministic episode
is first saved "pending" (Graphiti's own ``EpisodicNode.save``), then
processed, then marked done with ``ls_ingested_at``. Graphiti writes the
episode, its entities and its edges in one transaction at the end of
``add_episode``; an episode whose MENTIONS edges or ``entity_edges`` are set
was committed by Graphiti even if the marker is missing (a crash in between).
"""

from __future__ import annotations

import importlib.metadata
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from graphiti_core import Graphiti
from graphiti_core.cross_encoder.client import CrossEncoderClient
from graphiti_core.edges import EntityEdge
from graphiti_core.llm_client.config import DEFAULT_MAX_TOKENS, ModelSize
from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient
from graphiti_core.nodes import EpisodeType, EpisodicNode
from graphiti_core.prompts.models import Message
from graphiti_core.search.search_config_recipes import EDGE_HYBRID_SEARCH_RRF
from graphiti_core.utils.datetime_utils import utc_now
from pydantic import BaseModel

from app.ontology import CompiledOntology

logger = logging.getLogger(__name__)

DONE_PROPERTY = "ls_ingested_at"

# Properties Graphiti keeps on every entity node / relationship; whatever else
# a node or edge carries is a custom attribute from the ontology.
NODE_BASE_PROPERTIES = [
    "uuid",
    "name",
    "group_id",
    "labels",
    "created_at",
    "summary",
    "name_embedding",
    "attributes",
]
EDGE_BASE_PROPERTIES = [
    "uuid",
    "name",
    "group_id",
    "fact",
    "fact_embedding",
    "episodes",
    "created_at",
    "expired_at",
    "valid_at",
    "invalid_at",
    "reference_time",
    "source_node_uuid",
    "target_node_uuid",
    "attributes",
]

# Most episode uuids one group reports (a build ingests at most a few hundred).
MAX_EPISODES = 10_000

_DELETE_LABELS = ("Entity", "Episodic", "Community", "Saga")
_DELETE_BATCH = 1000


@dataclass(frozen=True)
class EpisodeState:
    group_id: str
    done: bool
    committed: bool


@dataclass(frozen=True)
class EpisodeInput:
    uuid: str
    name: str
    body: str
    source_description: str
    reference_time: datetime


class ExportTooLarge(Exception):
    def __init__(self, kind: str, limit: int):
        super().__init__(f"group has more than {limit} {kind}; export refused")
        self.kind = kind
        self.limit = limit


class GraphBackend(Protocol):
    async def ensure_ready(self) -> None: ...
    async def versions(self) -> tuple[str | None, str | None]: ...
    async def episode_states(self, uuids: list[str]) -> dict[str, list[EpisodeState]]: ...
    async def recent_done_episodes(self, group_id: str, limit: int) -> list[str]: ...
    async def save_pending_episode(self, group_id: str, episode: EpisodeInput) -> None: ...
    async def run_episode(
        self,
        group_id: str,
        episode: EpisodeInput,
        ontology: CompiledOntology,
        previous_episode_uuids: list[str],
    ) -> None: ...
    async def mark_done(self, group_id: str, uuid: str) -> None: ...
    async def discard_pending(self, group_id: str, uuid: str) -> None: ...
    async def done_episodes(self, group_id: str, limit: int) -> list[str]: ...
    async def search(self, group_id: str, query: str, limit: int) -> list[dict[str, Any]]: ...
    async def export(self, group_id: str, max_nodes: int, max_edges: int) -> dict[str, Any]: ...
    async def delete_group(self, group_id: str) -> int: ...


# ─── Provider clients ────────────────────────────────────────────────────────


class RoutedGenericClient(OpenAIGenericClient):
    """OpenAIGenericClient ignores ``model_size``; Graphiti asks for the small
    model on its lighter prompts, so route those to ``small_model``."""

    async def _generate_response(
        self,
        messages: list[Message],
        response_model: type[BaseModel] | None = None,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        model_size: ModelSize = ModelSize.medium,
        *,
        model: str | None = None,
    ) -> dict[str, Any]:
        if model is None and model_size == ModelSize.small and self.small_model:
            model = self.small_model
        return await super()._generate_response(
            messages, response_model, max_tokens, model_size, model=model
        )


class PassthroughReranker(CrossEncoderClient):
    """Graphiti builds an OpenAI reranker (which needs an OpenAI key) unless
    given one. Search here uses reciprocal-rank fusion, which never calls a
    cross-encoder; this keeps the input order if anything ever does."""

    async def rank(self, query: str, passages: list[str]) -> list[tuple[str, float]]:
        count = len(passages)
        return [(passage, (count - index) / count) for index, passage in enumerate(passages)]


# ─── Value mapping ───────────────────────────────────────────────────────────


def to_json_value(value: Any) -> Any:
    """Neo4j temporal values → ISO strings; lists/maps recursively; the rest as is."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    if hasattr(value, "to_native"):
        return to_json_value(value.to_native())
    if hasattr(value, "iso_format"):
        return value.iso_format()
    if isinstance(value, (list, tuple)):
        return [to_json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): to_json_value(item) for key, item in value.items()}
    return str(value)


def clean_labels(labels: list[str]) -> list[str]:
    """``Entity`` first, then the type labels sorted; Graphiti's per-group
    dynamic ``Entity_<group>`` label is dropped."""
    kept = sorted({label for label in labels if not label.startswith("Entity_") and label != "Entity"})
    return ["Entity", *kept] if "Entity" in labels else kept


def _attributes(pairs: list[list[Any]] | None) -> dict[str, Any]:
    return {str(pair[0]): to_json_value(pair[1]) for pair in pairs or [] if len(pair) == 2}


def node_from_record(record: Any) -> dict[str, Any]:
    return {
        "uuid": record["uuid"],
        "name": record["name"] or "",
        "labels": clean_labels(list(record["labels"] or [])),
        "summary": record["summary"] or "",
        "attributes": _attributes(record["attrs"]),
    }


def edge_from_record(record: Any) -> dict[str, Any]:
    return {
        "uuid": record["uuid"],
        "name": record["name"] or "RELATES_TO",
        "fact": record["fact"] or "",
        "source_node_uuid": record["source_node_uuid"],
        "target_node_uuid": record["target_node_uuid"],
        "episodes": sorted(str(uuid) for uuid in record["episodes"] or []),
        "valid_at": to_json_value(record["valid_at"]),
        "invalid_at": to_json_value(record["invalid_at"]),
        "attributes": _attributes(record["attrs"]),
    }


def edge_from_model(edge: EntityEdge) -> dict[str, Any]:
    return {
        "uuid": edge.uuid,
        "name": edge.name or "RELATES_TO",
        "fact": edge.fact or "",
        "source_node_uuid": edge.source_node_uuid,
        "target_node_uuid": edge.target_node_uuid,
        "episodes": sorted(edge.episodes or []),
        "valid_at": to_json_value(edge.valid_at),
        "invalid_at": to_json_value(edge.invalid_at),
        "attributes": {key: to_json_value(value) for key, value in (edge.attributes or {}).items()},
    }


# ─── Graphiti + Neo4j backend ────────────────────────────────────────────────


class GraphitiBackend:
    def __init__(self, graphiti: Graphiti):
        self._graphiti = graphiti
        self._driver = graphiti.driver
        self._ready = False

    async def _query(self, cypher: str, **params: Any) -> list[Any]:
        records, _, _ = await self._driver.execute_query(cypher, params=params)
        return list(records)

    async def ensure_ready(self) -> None:
        if self._ready:
            return
        # Graphiti's Neo4j driver already scheduled an index build when it was
        # constructed inside the event loop; wait for that one rather than race
        # it (concurrent CREATE INDEX IF NOT EXISTS logs spurious errors).
        init_task = getattr(self._driver, "_init_task", None)
        if init_task is not None and not init_task.cancelled():
            try:
                await init_task
                self._ready = True
                return
            except Exception:  # e.g. Neo4j was not up yet: build again below
                pass
        await self._graphiti.build_indices_and_constraints()
        self._ready = True

    async def versions(self) -> tuple[str | None, str | None]:
        graphiti_version = importlib.metadata.version("graphiti-core")
        records = await self._query(
            "// ls:versions\n"
            "CALL dbms.components() YIELD name, versions, edition "
            "RETURN name, versions[0] AS version, edition"
        )
        neo4j = next(
            (f"{r['version']}-{r['edition']}" for r in records if r["name"] == "Neo4j Kernel"),
            None,
        )
        return graphiti_version, neo4j

    async def episode_states(self, uuids: list[str]) -> dict[str, list[EpisodeState]]:
        # Deliberately not group-filtered: the caller refuses a uuid another
        # group already holds (Graphiti merges episodes by uuid alone).
        records = await self._query(
            "// ls:episode_states\n"
            "MATCH (e:Episodic) WHERE e.uuid IN $uuids "
            "OPTIONAL MATCH (e)-[m:MENTIONS]->(:Entity) "
            "WITH e, count(m) AS mentions "
            f"RETURN e.uuid AS uuid, e.group_id AS group_id, e.{DONE_PROPERTY} IS NOT NULL AS done, "
            "(mentions > 0 OR size(coalesce(e.entity_edges, [])) > 0) AS committed",
            uuids=uuids,
        )
        states: dict[str, list[EpisodeState]] = {}
        for r in records:
            states.setdefault(r["uuid"], []).append(
                EpisodeState(group_id=r["group_id"], done=bool(r["done"]), committed=bool(r["committed"]))
            )
        return states

    async def recent_done_episodes(self, group_id: str, limit: int) -> list[str]:
        records = await self._query(
            "// ls:recent_done\n"
            "MATCH (e:Episodic {group_id: $group_id}) "
            f"WHERE e.{DONE_PROPERTY} IS NOT NULL "
            f"RETURN e.uuid AS uuid ORDER BY e.{DONE_PROPERTY} DESC, e.uuid DESC LIMIT $limit",
            group_id=group_id,
            limit=limit,
        )
        return [r["uuid"] for r in records]

    async def save_pending_episode(self, group_id: str, episode: EpisodeInput) -> None:
        await EpisodicNode(
            uuid=episode.uuid,
            name=episode.name,
            group_id=group_id,
            labels=[],
            source=EpisodeType.text,
            content=episode.body,
            source_description=episode.source_description,
            created_at=utc_now(),
            valid_at=episode.reference_time,
        ).save(self._driver)

    async def run_episode(
        self,
        group_id: str,
        episode: EpisodeInput,
        ontology: CompiledOntology,
        previous_episode_uuids: list[str],
    ) -> None:
        await self._graphiti.add_episode(
            name=episode.name,
            episode_body=episode.body,
            source_description=episode.source_description,
            reference_time=episode.reference_time,
            source=EpisodeType.text,
            group_id=group_id,
            uuid=episode.uuid,
            entity_types=ontology.entity_types,
            edge_types=ontology.edge_types,
            edge_type_map=ontology.edge_type_map,
            previous_episode_uuids=previous_episode_uuids,
        )

    async def mark_done(self, group_id: str, uuid: str) -> None:
        await self._query(
            "// ls:mark_done\n"
            "MATCH (e:Episodic {uuid: $uuid, group_id: $group_id}) "
            f"SET e.{DONE_PROPERTY} = datetime() RETURN e.uuid AS uuid",
            uuid=uuid,
            group_id=group_id,
        )

    async def discard_pending(self, group_id: str, uuid: str) -> None:
        await self._query(
            "// ls:discard_pending\n"
            "MATCH (e:Episodic {uuid: $uuid, group_id: $group_id}) "
            f"WHERE e.{DONE_PROPERTY} IS NULL DETACH DELETE e",
            uuid=uuid,
            group_id=group_id,
        )

    async def done_episodes(self, group_id: str, limit: int) -> list[str]:
        records = await self._query(
            "// ls:done_episodes\n"
            "MATCH (e:Episodic {group_id: $group_id}) "
            f"WHERE e.{DONE_PROPERTY} IS NOT NULL "
            "RETURN e.uuid AS uuid ORDER BY uuid LIMIT $limit",
            group_id=group_id,
            limit=limit,
        )
        return [r["uuid"] for r in records]

    async def search(self, group_id: str, query: str, limit: int) -> list[dict[str, Any]]:
        # A private copy: Graphiti's own search() mutates the shared recipe's
        # limit, which is not safe with concurrent requests. Reciprocal-rank
        # fusion over BM25 + cosine needs no cross-encoder.
        config = EDGE_HYBRID_SEARCH_RRF.model_copy(deep=True)
        config.limit = limit
        # group_ids is never empty here (validated upstream): Graphiti treats
        # an empty list as "every group".
        results = await self._graphiti.search_(query, config=config, group_ids=[group_id])
        return [edge_from_model(edge) for edge in results.edges if edge.group_id == group_id]

    async def export(self, group_id: str, max_nodes: int, max_edges: int) -> dict[str, Any]:
        node_records = await self._query(
            "// ls:export_nodes\n"
            "MATCH (n:Entity {group_id: $group_id}) "
            "RETURN n.uuid AS uuid, n.name AS name, labels(n) AS labels, n.summary AS summary, "
            "[k IN keys(n) WHERE NOT k IN $skip | [k, n[k]]] AS attrs "
            "ORDER BY uuid LIMIT $limit",
            group_id=group_id,
            skip=NODE_BASE_PROPERTIES,
            limit=max_nodes + 1,
        )
        if len(node_records) > max_nodes:
            raise ExportTooLarge("nodes", max_nodes)
        edge_records = await self._query(
            "// ls:export_edges\n"
            "MATCH (s:Entity {group_id: $group_id})-[e:RELATES_TO {group_id: $group_id}]->"
            "(t:Entity {group_id: $group_id}) "
            "RETURN e.uuid AS uuid, e.name AS name, e.fact AS fact, "
            "s.uuid AS source_node_uuid, t.uuid AS target_node_uuid, e.episodes AS episodes, "
            "e.valid_at AS valid_at, e.invalid_at AS invalid_at, "
            "[k IN keys(e) WHERE NOT k IN $skip | [k, e[k]]] AS attrs "
            "ORDER BY uuid LIMIT $limit",
            group_id=group_id,
            skip=EDGE_BASE_PROPERTIES,
            limit=max_edges + 1,
        )
        if len(edge_records) > max_edges:
            raise ExportTooLarge("edges", max_edges)
        episode_uuids = await self.done_episodes(group_id, MAX_EPISODES)
        return {
            "nodes": [node_from_record(r) for r in node_records],
            "edges": [edge_from_record(r) for r in edge_records],
            "episode_uuids": episode_uuids,
        }

    async def delete_group(self, group_id: str) -> int:
        deleted = 0
        for label in _DELETE_LABELS:  # constants, never input
            while True:
                records = await self._query(
                    f"// ls:delete_group\n"
                    f"MATCH (n:{label} {{group_id: $group_id}}) WITH n LIMIT $batch "
                    "DETACH DELETE n RETURN count(*) AS deleted",
                    group_id=group_id,
                    batch=_DELETE_BATCH,
                )
                count = int(records[0]["deleted"]) if records else 0
                deleted += count
                if count < _DELETE_BATCH:
                    break
        return deleted

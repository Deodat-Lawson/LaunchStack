"""
Fakes for Graphiti and Neo4j.

The real ``GraphitiBackend`` and ``GraphService`` run unchanged on top of
these: ``FakeDriver`` answers the backend's tagged Cypher (``// ls:<name>``)
and Graphiti's own episode-save query from an in-memory store, and
``FakeGraphiti`` stands in for ``Graphiti`` — its ``add_episode`` behaves like
the real one where the service depends on it (it loads the pre-saved episode
by uuid and fails if there is none) and spends provider tokens through the
same ``MeteredOpenAI`` wrapper production uses, so usage accounting is tested
end to end.
"""

from __future__ import annotations

import asyncio
import itertools
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

from graphiti_core.driver.driver import GraphProvider
from graphiti_core.edges import EntityEdge
from graphiti_core.errors import NodeNotFoundError
from graphiti_core.search.search_config import SearchResults

from app.usage import MeteredOpenAI


@dataclass
class StoredEpisode:
    uuid: str
    group_id: str
    name: str
    content: str
    source_description: str
    valid_at: Any
    done_seq: int | None = None
    entity_edges: list[str] = field(default_factory=list)
    mentions: list[str] = field(default_factory=list)


@dataclass
class StoredNode:
    uuid: str
    group_id: str
    name: str
    labels: list[str]
    summary: str
    props: dict[str, Any]


@dataclass
class StoredEdge:
    uuid: str
    group_id: str
    name: str
    fact: str
    source: str
    target: str
    episodes: list[str]
    valid_at: Any
    invalid_at: Any
    props: dict[str, Any]


class FakeStore:
    def __init__(self) -> None:
        self.episodes: dict[str, StoredEpisode] = {}
        self.nodes: dict[str, StoredNode] = {}
        self.edges: dict[str, StoredEdge] = {}
        self.sagas: dict[str, str] = {}  # uuid → group_id
        self._seq = itertools.count(1)

    def next_seq(self) -> int:
        return next(self._seq)


_TAG = re.compile(r"//\s*ls:(\w+)")


class FakeDriver:
    # What Graphiti's own model methods look at on a driver.
    provider = GraphProvider.NEO4J
    graph_operations_interface = None
    search_interface = None

    def __init__(self, store: FakeStore):
        self.store = store
        self.queries: list[tuple[str, dict[str, Any]]] = []
        self.unavailable: BaseException | None = None

    async def execute_query(self, cypher: str, params: dict[str, Any] | None = None, **kwargs: Any):
        if self.unavailable is not None:
            raise self.unavailable
        args = dict(params or {})
        args.update({k: v for k, v in kwargs.items() if not k.endswith("_")})
        self.queries.append((cypher, args))
        tag = _TAG.search(cypher)
        if tag:
            records = getattr(self, f"_q_{tag.group(1)}")(cypher, args)
        elif "MERGE (n:Episodic {uuid: $uuid})" in cypher:
            records = self._graphiti_episode_save(args)
        else:
            raise AssertionError(f"unexpected query: {cypher[:80]}")
        return records, None, None

    # Graphiti's EpisodicNode.save (SET n = {...}: replaces every property)
    def _graphiti_episode_save(self, a: dict[str, Any]) -> list[dict[str, Any]]:
        self.store.episodes[a["uuid"]] = StoredEpisode(
            uuid=a["uuid"],
            group_id=a["group_id"],
            name=a["name"],
            content=a["content"],
            source_description=a["source_description"],
            valid_at=a["valid_at"],
            entity_edges=list(a["entity_edges"]),
        )
        return [{"uuid": a["uuid"]}]

    def _q_versions(self, _: str, __: dict[str, Any]):
        return [
            {"name": "Neo4j Kernel", "version": "5.26.0", "edition": "community"},
        ]

    def _q_episode_states(self, _: str, a: dict[str, Any]):
        return [
            {
                "uuid": e.uuid,
                "group_id": e.group_id,
                "done": e.done_seq is not None,
                "committed": bool(e.mentions or e.entity_edges),
            }
            for e in self.store.episodes.values()
            if e.uuid in a["uuids"]
        ]

    def _q_recent_done(self, _: str, a: dict[str, Any]):
        done = [
            e for e in self.store.episodes.values() if e.group_id == a["group_id"] and e.done_seq is not None
        ]
        done.sort(key=lambda e: (e.done_seq, e.uuid), reverse=True)
        return [{"uuid": e.uuid} for e in done[: a["limit"]]]

    def _q_mark_done(self, _: str, a: dict[str, Any]):
        episode = self.store.episodes.get(a["uuid"])
        if episode is None or episode.group_id != a["group_id"]:
            return []
        episode.done_seq = self.store.next_seq()
        return [{"uuid": episode.uuid}]

    def _q_discard_pending(self, _: str, a: dict[str, Any]):
        episode = self.store.episodes.get(a["uuid"])
        if episode is not None and episode.group_id == a["group_id"] and episode.done_seq is None:
            del self.store.episodes[a["uuid"]]
        return []

    def _q_done_episodes(self, _: str, a: dict[str, Any]):
        uuids = sorted(
            e.uuid for e in self.store.episodes.values() if e.group_id == a["group_id"] and e.done_seq is not None
        )
        return [{"uuid": u} for u in uuids[: a["limit"]]]

    def _q_export_nodes(self, _: str, a: dict[str, Any]):
        nodes = sorted(
            (n for n in self.store.nodes.values() if n.group_id == a["group_id"]), key=lambda n: n.uuid
        )
        return [
            {
                "uuid": n.uuid,
                "name": n.name,
                "labels": list(n.labels),
                "summary": n.summary,
                "attrs": [[k, v] for k, v in n.props.items() if k not in a["skip"]],
            }
            for n in nodes[: a["limit"]]
        ]

    def _q_export_edges(self, _: str, a: dict[str, Any]):
        gid = a["group_id"]
        edges = sorted(
            (
                e
                for e in self.store.edges.values()
                if e.group_id == gid
                and self.store.nodes[e.source].group_id == gid
                and self.store.nodes[e.target].group_id == gid
            ),
            key=lambda e: e.uuid,
        )
        return [
            {
                "uuid": e.uuid,
                "name": e.name,
                "fact": e.fact,
                "source_node_uuid": e.source,
                "target_node_uuid": e.target,
                "episodes": list(e.episodes),
                "valid_at": e.valid_at,
                "invalid_at": e.invalid_at,
                "attrs": [[k, v] for k, v in e.props.items() if k not in a["skip"]],
            }
            for e in edges[: a["limit"]]
        ]

    def _q_delete_group(self, cypher: str, a: dict[str, Any]):
        label = re.search(r"MATCH \(n:(\w+)", cypher).group(1)  # type: ignore[union-attr]
        gid, batch = a["group_id"], a["batch"]
        if label == "Entity":
            victims = [u for u, n in self.store.nodes.items() if n.group_id == gid][:batch]
            for u in victims:
                del self.store.nodes[u]
                for eu in [eu for eu, e in self.store.edges.items() if u in (e.source, e.target)]:
                    del self.store.edges[eu]
        elif label == "Episodic":
            victims = [u for u, e in self.store.episodes.items() if e.group_id == gid][:batch]
            for u in victims:
                del self.store.episodes[u]
        elif label == "Saga":
            victims = [u for u, g in self.store.sagas.items() if g == gid][:batch]
            for u in victims:
                del self.store.sagas[u]
        else:
            victims = []
        return [{"deleted": len(victims)}]


class FakeOpenAI:
    """Provider responses carrying a ``usage`` block, like a real endpoint."""

    def __init__(self, prompt_tokens: int = 100, completion_tokens: int = 20, embedding_tokens: int = 8):
        self.report_usage = True
        self.chat_calls: list[dict[str, Any]] = []
        self.embedding_calls: list[dict[str, Any]] = []
        fake = self

        class _Completions:
            async def create(self, **kwargs: Any):
                fake.chat_calls.append(kwargs)
                await asyncio.sleep(0)
                usage = (
                    SimpleNamespace(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)
                    if fake.report_usage
                    else None
                )
                return SimpleNamespace(
                    usage=usage,
                    choices=[SimpleNamespace(message=SimpleNamespace(content='{"ok": true}'))],
                )

        class _Embeddings:
            async def create(self, **kwargs: Any):
                fake.embedding_calls.append(kwargs)
                await asyncio.sleep(0)
                usage = (
                    SimpleNamespace(prompt_tokens=embedding_tokens, total_tokens=embedding_tokens)
                    if fake.report_usage
                    else None
                )
                return SimpleNamespace(usage=usage, data=[SimpleNamespace(embedding=[0.1, 0.2])])

        self.chat = SimpleNamespace(completions=_Completions())
        self.embeddings = _Embeddings()
        self.base_url = "http://fake-provider/v1"


@dataclass
class Extraction:
    """What one fake add_episode writes: nodes as (name, type, attrs) and
    edges as (name, fact, source name, target name)."""

    nodes: list[tuple[str, str, dict[str, Any]]] = field(default_factory=list)
    edges: list[tuple[str, str, str, str]] = field(default_factory=list)


class FakeGraphiti:
    def __init__(self) -> None:
        self.store = FakeStore()
        self.driver = FakeDriver(self.store)
        self.provider = FakeOpenAI()
        self.llm = MeteredOpenAI(self.provider)
        self.add_calls: list[dict[str, Any]] = []
        self.search_calls: list[dict[str, Any]] = []
        self.extractions: dict[str, Extraction] = {}
        self.failures: dict[str, BaseException] = {}
        self.foreign_search_edge: EntityEdge | None = None
        self.indices_built = 0
        self._uuids = itertools.count(1)

    async def build_indices_and_constraints(self) -> None:
        self.indices_built += 1

    async def close(self) -> None:
        pass

    def _uuid(self, prefix: str) -> str:
        return f"{prefix}-{next(self._uuids):04d}"

    async def add_episode(self, **kwargs: Any) -> None:
        self.add_calls.append(kwargs)
        uuid, group_id = kwargs["uuid"], kwargs["group_id"]
        # Graphiti: add_episode(uuid=…) loads the stored episode, never creates it.
        episode = self.store.episodes.get(uuid)
        if episode is None:
            raise NodeNotFoundError(uuid)
        # Two extraction prompts and one embedding batch per episode.
        await self.llm.chat.completions.create(model="m", messages=[])
        await self.llm.chat.completions.create(model="m", messages=[])
        await self.llm.embeddings.create(model="e", input=["x"])
        if uuid in self.failures:
            raise self.failures[uuid]
        extraction = self.extractions.get(uuid, Extraction(nodes=[(episode.name, "Organization", {})]))
        by_name: dict[str, str] = {}
        for name, type_name, attrs in extraction.nodes:
            existing = next(
                (n for n in self.store.nodes.values() if n.group_id == group_id and n.name == name), None
            )
            node_uuid = existing.uuid if existing else self._uuid("node")
            if existing is None:
                self.store.nodes[node_uuid] = StoredNode(
                    uuid=node_uuid,
                    group_id=group_id,
                    name=name,
                    labels=["Entity", type_name, f"Entity_{group_id.replace('-', '')}"],
                    summary=f"{name} summary",
                    props={
                        "uuid": node_uuid,
                        "name": name,
                        "group_id": group_id,
                        "summary": f"{name} summary",
                        "name_embedding": [0.1, 0.2],
                        "created_at": datetime(2026, 11, 1, tzinfo=timezone.utc),
                        **attrs,
                    },
                )
            by_name[name] = node_uuid
            episode.mentions.append(node_uuid)
        for name, fact, source, target in extraction.edges:
            edge_uuid = self._uuid("edge")
            self.store.edges[edge_uuid] = StoredEdge(
                uuid=edge_uuid,
                group_id=group_id,
                name=name,
                fact=fact,
                source=by_name[source],
                target=by_name[target],
                episodes=[uuid],
                valid_at=None,
                invalid_at=None,
                props={"uuid": edge_uuid, "fact_embedding": [0.3], "episodes": [uuid], "group_id": group_id},
            )
            episode.entity_edges.append(edge_uuid)

    async def search_(self, query: str, config: Any = None, group_ids: list[str] | None = None, **_: Any):
        self.search_calls.append({"query": query, "limit": config.limit, "group_ids": group_ids})
        await self.llm.embeddings.create(model="e", input=[query])
        edges = [
            EntityEdge(
                uuid=e.uuid,
                group_id=e.group_id,
                source_node_uuid=e.source,
                target_node_uuid=e.target,
                name=e.name,
                fact=e.fact,
                episodes=list(e.episodes),
                created_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
                valid_at=e.valid_at,
                invalid_at=e.invalid_at,
            )
            for e in sorted(self.store.edges.values(), key=lambda e: e.uuid)
            if group_ids and e.group_id in group_ids
        ]
        if self.foreign_search_edge is not None:
            edges.insert(0, self.foreign_search_edge)
        return SearchResults(edges=edges[: config.limit])

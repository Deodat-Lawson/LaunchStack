"""Export mapping, export bounds, search scoring, delete."""

from datetime import datetime, timezone

import neo4j.time

from app.backend import EDGE_BASE_PROPERTIES, NODE_BASE_PROPERTIES, clean_labels, edge_from_record, node_from_record, to_json_value

from .conftest import episode, ingest_body
from .fakes import Extraction


def test_node_record_mapping():
    node = node_from_record(
        {
            "uuid": "n1",
            "name": "Maya",
            "labels": ["Person", "Entity_build1", "Entity"],
            "summary": None,
            "attrs": [["title", "IT lead"], ["seen_at", neo4j.time.DateTime(2026, 11, 1, 9, 30, 0, tzinfo=timezone.utc)]],
        }
    )
    assert node == {
        "uuid": "n1",
        "name": "Maya",
        "labels": ["Entity", "Person"],
        "summary": "",
        "attributes": {"title": "IT lead", "seen_at": "2026-11-01T09:30:00+00:00"},
    }


def test_edge_record_mapping():
    edge = edge_from_record(
        {
            "uuid": "x1",
            "name": "APPROVES",
            "fact": "Lee approves Northwind's software purchases.",
            "source_node_uuid": "n2",
            "target_node_uuid": "n3",
            "episodes": ["ep-b", "ep-a"],
            "valid_at": neo4j.time.DateTime(2026, 11, 1, 12, 0, 0, tzinfo=timezone.utc),
            "invalid_at": None,
            "attrs": [["confidence", 0.9]],
        }
    )
    assert edge == {
        "uuid": "x1",
        "name": "APPROVES",
        "fact": "Lee approves Northwind's software purchases.",
        "source_node_uuid": "n2",
        "target_node_uuid": "n3",
        "episodes": ["ep-a", "ep-b"],
        "valid_at": "2026-11-01T12:00:00+00:00",
        "invalid_at": None,
        "attributes": {"confidence": 0.9},
    }
    assert edge_from_record({**_bare_edge(), "name": None})["name"] == "RELATES_TO"


def _bare_edge():
    return {
        "uuid": "x",
        "name": "R",
        "fact": None,
        "source_node_uuid": "a",
        "target_node_uuid": "b",
        "episodes": None,
        "valid_at": None,
        "invalid_at": None,
        "attrs": None,
    }


def test_value_and_label_helpers():
    assert to_json_value(datetime(2026, 1, 2, 3, 4, 5)) == "2026-01-02T03:04:05+00:00"
    assert to_json_value([1, "a", None, {"k": True}]) == [1, "a", None, {"k": True}]
    assert clean_labels(["Entity"]) == ["Entity"]
    assert clean_labels(["Product", "Entity", "Entity_g1", "Organization"]) == ["Entity", "Organization", "Product"]


def test_export_route_strips_graphiti_internals(client, graphiti):
    graphiti.extractions["e1"] = Extraction(
        nodes=[("Northwind", "Organization", {"industry": "Logistics"}), ("Acme Legacy", "Product", {})],
        edges=[("USES", "Northwind uses Acme Legacy.", "Northwind", "Acme Legacy")],
    )
    client.post("/v1/groups/g/episodes", json=ingest_body(episode("e1")))
    export = client.get("/v1/groups/g/export").json()
    assert export["episode_uuids"] == ["e1"]
    northwind = next(n for n in export["nodes"] if n["name"] == "Northwind")
    assert northwind["attributes"] == {"industry": "Logistics"}  # no embedding, uuid, created_at, …
    assert northwind["labels"] == ["Entity", "Organization"]
    (edge,) = export["edges"]
    assert edge["name"] == "USES"
    assert edge["fact"] == "Northwind uses Acme Legacy."
    assert edge["attributes"] == {}
    assert edge["source_node_uuid"] == northwind["uuid"]
    # The base-property lists the Cypher excludes are what the backend sends.
    sent = {cypher.split("\n")[0]: args for cypher, args in graphiti.driver.queries}
    assert sent["// ls:export_nodes"]["skip"] == NODE_BASE_PROPERTIES
    assert sent["// ls:export_edges"]["skip"] == EDGE_BASE_PROPERTIES
    assert "name_embedding" in NODE_BASE_PROPERTIES and "fact_embedding" in EDGE_BASE_PROPERTIES


def test_export_refuses_rather_than_truncates(client, graphiti, service):
    service._export_max_nodes = 2
    graphiti.extractions["e1"] = Extraction(nodes=[("A", "Person", {}), ("B", "Person", {}), ("C", "Person", {})])
    client.post("/v1/groups/g/episodes", json=ingest_body(episode("e1")))
    response = client.get("/v1/groups/g/export")
    assert response.status_code == 413
    assert response.json() == {"detail": "group has more than 2 nodes; export refused"}
    sent = [args for cypher, args in graphiti.driver.queries if "ls:export_nodes" in cypher]
    assert sent[-1]["limit"] == 3


def test_search_scores_depend_only_on_rank(client, graphiti):
    graphiti.extractions["e1"] = Extraction(
        nodes=[("Maya", "Person", {}), ("Lee", "Person", {}), ("Northwind", "Organization", {})],
        edges=[
            ("INFLUENCES", "Maya recommends Northwind's software purchases.", "Maya", "Northwind"),
            ("APPROVES", "Lee approves Northwind's software purchases.", "Lee", "Northwind"),
            ("WORKS_FOR", "Lee works for Northwind.", "Lee", "Northwind"),
        ],
    )
    client.post("/v1/groups/g/episodes", json=ingest_body(episode("e1")))
    hits = client.post("/v1/groups/g/search", json={"query": "who approves Northwind purchases", "limit": 3}).json()["hits"]
    assert [h["score"] for h in hits] == [1.0, 0.5, 0.333333]
    assert set(hits[0]["edge"]) == {
        "uuid",
        "name",
        "fact",
        "source_node_uuid",
        "target_node_uuid",
        "episodes",
        "valid_at",
        "invalid_at",
        "attributes",
    }
    assert graphiti.search_calls[-1] == {
        "query": "who approves Northwind purchases",
        "limit": 3,
        "group_ids": ["g"],
    }


def test_search_bounds(client):
    assert client.post("/v1/groups/g/search", json={"query": "", "limit": 3}).status_code == 422
    assert client.post("/v1/groups/g/search", json={"query": "x", "limit": 0}).status_code == 422
    assert client.post("/v1/groups/g/search", json={"query": "x", "limit": 51}).status_code == 422
    assert client.post("/v1/groups/g/search", json={"query": "x" * 2001, "limit": 3}).status_code == 422


def test_search_on_an_empty_group(client):
    assert client.post("/v1/groups/empty/search", json={"query": "x", "limit": 3}).json() == {"hits": []}


def test_delete_group_removes_nodes_edges_and_episodes(client, graphiti):
    graphiti.extractions["e1"] = Extraction(
        nodes=[("Maya", "Person", {}), ("Northwind", "Organization", {})],
        edges=[("WORKS_FOR", "Maya works for Northwind.", "Maya", "Northwind")],
    )
    client.post("/v1/groups/g/episodes", json=ingest_body(episode("e1"), episode("e2")))
    response = client.delete("/v1/groups/g")
    assert response.status_code == 200
    # 2 entities from e1 + 1 default entity from e2 + 2 episodes
    assert response.json() == {"deleted_nodes": 5}
    assert graphiti.store.nodes == {} and graphiti.store.edges == {} and graphiti.store.episodes == {}
    assert client.delete("/v1/groups/g").json() == {"deleted_nodes": 0}

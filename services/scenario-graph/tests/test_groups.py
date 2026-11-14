"""Group ids are validated (never echoed) and every call stays inside its group."""

import pytest

from .conftest import episode, ingest_body
from .fakes import Extraction

BAD_IDS = [
    "a" * 129,
    "has space",
    "semi;colon",
    "x})-[r]-() DETACH DELETE r //",
    "dot.ted",
    "ümlaut",
    "%00",
]


@pytest.mark.parametrize("bad", BAD_IDS)
@pytest.mark.parametrize(
    "method,suffix,body",
    [
        ("post", "/episodes", ingest_body(episode("e1"))),
        ("get", "/episodes", None),
        ("post", "/search", {"query": "x", "limit": 3}),
        ("get", "/export", None),
        ("delete", "", None),
    ],
)
def test_invalid_group_ids_are_refused(client, graphiti, bad, method, suffix, body):
    from urllib.parse import quote

    path = f"/v1/groups/{quote(bad, safe='')}{suffix}"
    kwargs = {"json": body} if body is not None else {}
    response = getattr(client, method)(path, **kwargs)
    assert response.status_code in (400, 404)
    if response.status_code == 400:
        assert response.json() == {"detail": "invalid group id"}
    assert bad not in response.text
    assert graphiti.add_calls == []
    assert graphiti.driver.queries == []


@pytest.mark.parametrize("good", ["g", "build_42-abc", "A" * 128, "0123-4567_89ab"])
def test_valid_group_ids_are_accepted(client, good):
    assert client.get(f"/v1/groups/{good}/episodes").status_code == 200


def test_operations_never_cross_groups(client, graphiti):
    graphiti.extractions["a1"] = Extraction(
        nodes=[("Maya", "Person", {}), ("Northwind", "Organization", {})],
        edges=[("WORKS_FOR", "Maya works for Northwind.", "Maya", "Northwind")],
    )
    graphiti.extractions["b1"] = Extraction(
        nodes=[("Lee", "Person", {}), ("Acme", "Organization", {})],
        edges=[("WORKS_FOR", "Lee works for Acme.", "Lee", "Acme")],
    )
    assert client.post("/v1/groups/group-a/episodes", json=ingest_body(episode("a1"))).status_code == 200
    assert client.post("/v1/groups/group-b/episodes", json=ingest_body(episode("b1"))).status_code == 200

    assert client.get("/v1/groups/group-a/episodes").json() == {"uuids": ["a1"]}
    export_a = client.get("/v1/groups/group-a/export").json()
    assert {n["name"] for n in export_a["nodes"]} == {"Maya", "Northwind"}
    assert [e["fact"] for e in export_a["edges"]] == ["Maya works for Northwind."]
    assert export_a["episode_uuids"] == ["a1"]

    hits = client.post("/v1/groups/group-b/search", json={"query": "works for", "limit": 5}).json()["hits"]
    assert [h["edge"]["fact"] for h in hits] == ["Lee works for Acme."]
    assert graphiti.search_calls[-1]["group_ids"] == ["group-b"]

    assert client.delete("/v1/groups/group-a").status_code == 200
    assert client.get("/v1/groups/group-a/export").json() == {"nodes": [], "edges": [], "episode_uuids": []}
    export_b = client.get("/v1/groups/group-b/export").json()
    assert {n["name"] for n in export_b["nodes"]} == {"Lee", "Acme"}
    assert export_b["episode_uuids"] == ["b1"]

    # Every query the backend sent was parameterised on one group id.
    for cypher, args in graphiti.driver.queries:
        if "ls:episode_states" in cypher or "ls:versions" in cypher:
            continue  # uuid lookup across groups by design; versions has no group
        assert args.get("group_id") in ("group-a", "group-b"), cypher


def test_search_drops_an_edge_from_another_group(client, graphiti):
    from graphiti_core.edges import EntityEdge
    from datetime import datetime, timezone

    graphiti.foreign_search_edge = EntityEdge(
        uuid="foreign",
        group_id="other",
        source_node_uuid="x",
        target_node_uuid="y",
        name="USES",
        fact="Someone else's fact.",
        episodes=[],
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    hits = client.post("/v1/groups/mine/search", json={"query": "anything", "limit": 5}).json()["hits"]
    assert hits == []

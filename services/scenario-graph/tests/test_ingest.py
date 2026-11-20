"""Ingest: deterministic uuids, idempotency, crash reconciliation, error hygiene, usage."""

import asyncio

import neo4j.exceptions
import openai
import pytest

from app.backend import EpisodeInput, GraphitiBackend
from app.ontology import OntologyIn, compile_ontology
from app.service import GraphService

from .conftest import BASE_ONTOLOGY, episode, ingest_body
from .fakes import Extraction, FakeGraphiti, StoredEpisode

# Each fake add_episode makes two chat calls (100 in / 20 out) and one
# embedding call (8 tokens).
PER_EPISODE = {"calls": 3, "input_tokens": 200, "output_tokens": 40, "embedding_tokens": 8}


def usage(n: int, unmetered: int = 0) -> dict:
    return {**{k: v * n for k, v in PER_EPISODE.items()}, "unmetered_calls": unmetered}


def test_first_ingest_adds_each_episode_with_the_callers_uuid(client, graphiti):
    response = client.post("/v1/groups/build-1/episodes", json=ingest_body(episode("e1"), episode("e2")))
    assert response.status_code == 200
    body = response.json()
    assert body["outcomes"] == [{"uuid": "e1", "status": "done"}, {"uuid": "e2", "status": "done"}]
    assert body["usage"] == usage(2)

    first, second = graphiti.add_calls
    assert first["uuid"] == "e1" and first["group_id"] == "build-1"
    assert first["source_description"] == "contacts.pdf v3 p2"
    assert first["reference_time"].isoformat() == "2026-11-01T12:00:00+00:00"
    assert list(first["entity_types"]) == ["Organization", "Person", "Product", "PurchaseDecision"]
    assert list(first["edge_types"]) == ["WORKS_FOR", "USES", "INFLUENCES", "APPROVES", "DECIDES_ON"]
    assert first["edge_type_map"][("Person", "PurchaseDecision")] == ["INFLUENCES", "APPROVES"]
    # Episodes run in order; the second sees the first as context.
    assert first["previous_episode_uuids"] == []
    assert second["previous_episode_uuids"] == ["e1"]

    stored = graphiti.store.episodes["e1"]
    assert stored.group_id == "build-1"
    assert stored.content == "Maya recommends Northwind's software purchases."
    assert stored.done_seq is not None
    assert client.get("/v1/groups/build-1/episodes").json() == {"uuids": ["e1", "e2"]}


def test_repeating_an_ingest_is_a_no_op(client, graphiti):
    body = ingest_body(episode("e1"), episode("e2"))
    client.post("/v1/groups/build-1/episodes", json=body)
    nodes_before = dict(graphiti.store.nodes)

    again = client.post("/v1/groups/build-1/episodes", json=body).json()
    assert again["outcomes"] == [{"uuid": "e1", "status": "done"}, {"uuid": "e2", "status": "done"}]
    assert again["usage"] == usage(0)
    assert len(graphiti.add_calls) == 2
    assert graphiti.store.nodes == nodes_before


def test_a_partly_done_batch_only_adds_what_is_missing(client, graphiti):
    client.post("/v1/groups/build-1/episodes", json=ingest_body(episode("e1")))
    body = client.post("/v1/groups/build-1/episodes", json=ingest_body(episode("e1"), episode("e2"))).json()
    assert [o["status"] for o in body["outcomes"]] == ["done", "done"]
    assert [call["uuid"] for call in graphiti.add_calls] == ["e1", "e2"]
    assert body["usage"] == usage(1)


def test_context_is_the_most_recent_done_episodes_of_the_group(client, graphiti):
    client.post(
        "/v1/groups/g/episodes",
        json=ingest_body(*(episode(f"e{i}") for i in range(1, 6))),
    )
    assert graphiti.add_calls[-1]["previous_episode_uuids"] == ["e4", "e3", "e2"]
    client.post("/v1/groups/other/episodes", json=ingest_body(episode("x1")))
    assert graphiti.add_calls[-1]["previous_episode_uuids"] == []


def test_pending_leftover_from_a_crash_is_redone(client, graphiti):
    graphiti.store.episodes["e1"] = StoredEpisode(
        uuid="e1", group_id="g", name="old", content="old", source_description="", valid_at=None
    )
    body = client.post("/v1/groups/g/episodes", json=ingest_body(episode("e1"))).json()
    assert body["outcomes"] == [{"uuid": "e1", "status": "done"}]
    assert len(graphiti.add_calls) == 1
    assert graphiti.store.episodes["e1"].content == "Maya recommends Northwind's software purchases."


def test_committed_but_unmarked_episode_is_marked_done_without_rework(client, graphiti):
    graphiti.store.episodes["e1"] = StoredEpisode(
        uuid="e1",
        group_id="g",
        name="n",
        content="c",
        source_description="",
        valid_at=None,
        entity_edges=["edge-1"],
    )
    body = client.post("/v1/groups/g/episodes", json=ingest_body(episode("e1"))).json()
    assert body["outcomes"] == [{"uuid": "e1", "status": "done"}]
    assert graphiti.add_calls == []
    assert graphiti.store.episodes["e1"].done_seq is not None
    assert body["usage"] == usage(0)


def test_a_uuid_held_by_another_group_is_refused_and_left_alone(client, graphiti):
    client.post("/v1/groups/group-a/episodes", json=ingest_body(episode("shared")))
    before = graphiti.store.episodes["shared"]
    body = client.post("/v1/groups/group-b/episodes", json=ingest_body(episode("shared"))).json()
    assert body["outcomes"] == [
        {"uuid": "shared", "status": "failed", "error": "episode uuid is already used by another group"}
    ]
    assert graphiti.store.episodes["shared"] is before
    assert before.group_id == "group-a"
    assert len(graphiti.add_calls) == 1


def test_a_failed_episode_is_cleaned_up_and_the_batch_goes_on(client, graphiti):
    secret = "Maya's private salary is 250k"
    graphiti.failures["e1"] = ValueError(f"could not parse model output: {secret}")
    body = client.post(
        "/v1/groups/g/episodes", json=ingest_body(episode("e1", body=secret), episode("e2"))
    ).json()
    assert body["outcomes"] == [
        {"uuid": "e1", "status": "failed", "error": "ValueError"},
        {"uuid": "e2", "status": "done"},
    ]
    assert secret not in str(body)
    assert "e1" not in graphiti.store.episodes  # pending removed, retry starts clean
    # The failed attempt still spent tokens, and they are reported.
    assert body["usage"] == usage(2)
    assert client.get("/v1/groups/g/episodes").json() == {"uuids": ["e2"]}

    graphiti.failures.clear()
    retry = client.post("/v1/groups/g/episodes", json=ingest_body(episode("e1"), episode("e2"))).json()
    assert [o["status"] for o in retry["outcomes"]] == ["done", "done"]


def test_provider_outage_stops_the_batch(client, graphiti):
    graphiti.failures["e2"] = openai.APIConnectionError(request=None)  # type: ignore[arg-type]
    body = client.post(
        "/v1/groups/g/episodes", json=ingest_body(episode("e1"), episode("e2"), episode("e3"))
    ).json()
    outcomes = body["outcomes"]
    assert outcomes[0] == {"uuid": "e1", "status": "done"}
    assert outcomes[1]["status"] == "failed"
    assert outcomes[1]["error"].startswith("APIConnectionError: Connection error")
    assert outcomes[2] == {
        "uuid": "e3",
        "status": "failed",
        "error": f"not attempted: {outcomes[1]['error']}",
    }
    assert [call["uuid"] for call in graphiti.add_calls] == ["e1", "e2"]
    assert body["usage"] == usage(2)


def test_database_and_provider_messages_are_not_returned(client, graphiti):
    """A Neo4j server message can quote property values and a provider 4xx
    can quote the prompt: only the status code goes back."""
    import httpx2

    secret = "Maya's private salary is 250k"
    graphiti.failures["e1"] = neo4j.exceptions.Neo4jError._hydrate_neo4j(
        code="Neo.ClientError.Schema.ConstraintValidationFailed",
        message=f"Node(1) already exists with property name = '{secret}'",
    )
    graphiti.failures["e2"] = openai.BadRequestError(
        f"context too long: {secret}",
        response=httpx2.Response(400, request=httpx2.Request("POST", "http://provider/v1")),
        body=None,
    )
    body = client.post("/v1/groups/g/episodes", json=ingest_body(episode("e1"), episode("e2"))).json()
    assert body["outcomes"] == [
        {
            "uuid": "e1",
            "status": "failed",
            "error": "ConstraintError: Neo.ClientError.Schema.ConstraintValidationFailed",
        },
        {"uuid": "e2", "status": "failed", "error": "BadRequestError: HTTP 400"},
    ]
    assert secret not in str(body)


def test_errors_are_bounded(client, graphiti):
    graphiti.failures["e1"] = openai.APIConnectionError(message="x" * 1000, request=None)  # type: ignore[arg-type]
    outcome = client.post("/v1/groups/g/episodes", json=ingest_body(episode("e1"))).json()["outcomes"][0]
    assert len(outcome["error"]) <= 200


def test_database_down_before_work_answers_503(client, graphiti):
    graphiti.driver.unavailable = neo4j.exceptions.ServiceUnavailable("refused")
    response = client.post("/v1/groups/g/episodes", json=ingest_body(episode("e1")))
    assert response.status_code == 503
    assert response.json() == {"detail": "graph database unavailable"}
    assert graphiti.add_calls == []


def test_unmetered_provider_calls_are_counted(client, graphiti):
    graphiti.provider.report_usage = False
    body = client.post("/v1/groups/g/episodes", json=ingest_body(episode("e1"))).json()
    assert body["usage"] == {
        "calls": 3,
        "input_tokens": 0,
        "output_tokens": 0,
        "embedding_tokens": 0,
        "unmetered_calls": 3,
    }


def test_concurrent_ingests_meter_only_their_own_calls():
    graphiti = FakeGraphiti()
    service = GraphService(
        GraphitiBackend(graphiti),  # type: ignore[arg-type]
        ingest_concurrency=4,
        context_episodes=3,
        export_max_nodes=10,
        export_max_edges=10,
    )
    ontology = compile_ontology(OntologyIn.model_validate(BASE_ONTOLOGY))

    def episodes(prefix: str, n: int):
        from datetime import datetime, timezone

        return [
            EpisodeInput(f"{prefix}{i}", f"{prefix}{i}", "body", "", datetime(2026, 1, 1, tzinfo=timezone.utc))
            for i in range(n)
        ]

    async def both():
        return await asyncio.gather(
            service.ingest("group-a", ontology, episodes("a", 1)),
            service.ingest("group-b", ontology, episodes("b", 3)),
        )

    (_, usage_a), (_, usage_b) = asyncio.run(both())
    assert usage_a == usage(1)
    assert usage_b == usage(3)


def test_same_group_requests_wait_for_each_other():
    graphiti = FakeGraphiti()
    service = GraphService(
        GraphitiBackend(graphiti),  # type: ignore[arg-type]
        ingest_concurrency=4,
        context_episodes=3,
        export_max_nodes=10,
        export_max_edges=10,
    )
    ontology = compile_ontology(OntologyIn.model_validate(BASE_ONTOLOGY))
    from datetime import datetime, timezone

    same = [EpisodeInput("e1", "e1", "body", "", datetime(2026, 1, 1, tzinfo=timezone.utc))]

    async def twice():
        return await asyncio.gather(
            service.ingest("g", ontology, same), service.ingest("g", ontology, same)
        )

    (out1, use1), (out2, use2) = asyncio.run(twice())
    assert out1[0].status == out2[0].status == "done"
    assert len(graphiti.add_calls) == 1  # the second request saw it done
    assert sorted([use1["calls"], use2["calls"]]) == [0, 3]
    assert service._locks == {}  # released once nobody waits


@pytest.mark.parametrize(
    "body",
    [
        ingest_body(episode("e1"), episode("e1")),
        ingest_body(*(episode(f"e{i}") for i in range(51))),
        ingest_body(episode("bad uuid with spaces")),
        ingest_body(episode("e1", evidence_id="E1")),
        ingest_body(episode("e1", body="")),
        {"ontology": BASE_ONTOLOGY, "episodes": []},
    ],
)
def test_malformed_requests_are_refused_without_echoing_text(client, graphiti, body):
    response = client.post("/v1/groups/g/episodes", json=body)
    assert response.status_code == 422
    assert "Maya recommends" not in response.text
    assert graphiti.add_calls == []


def test_naive_reference_time_is_utc(client, graphiti):
    client.post(
        "/v1/groups/g/episodes", json=ingest_body(episode("e1", reference_time="2026-11-01T12:00:00"))
    )
    assert graphiti.add_calls[0]["reference_time"].isoformat() == "2026-11-01T12:00:00+00:00"


def test_extraction_lands_in_the_graph(client, graphiti):
    graphiti.extractions["e1"] = Extraction(
        nodes=[("Maya", "Person", {"title": "IT lead"}), ("Northwind", "Organization", {})],
        edges=[("WORKS_FOR", "Maya works at Northwind.", "Maya", "Northwind")],
    )
    client.post("/v1/groups/g/episodes", json=ingest_body(episode("e1")))
    export = client.get("/v1/groups/g/export").json()
    maya = next(n for n in export["nodes"] if n["name"] == "Maya")
    assert maya["labels"] == ["Entity", "Person"]
    assert maya["attributes"] == {"title": "IT lead"}
    assert export["edges"][0]["episodes"] == ["e1"]

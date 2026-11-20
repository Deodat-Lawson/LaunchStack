"""Usage is measured at the provider client, per ingest call, never estimated."""

import asyncio
import os

import pytest
from graphiti_core.llm_client.config import ModelSize
from graphiti_core.prompts.models import Message

from app.backend import PassthroughReranker, RoutedGenericClient
from app.usage import MeteredOpenAI, UsageMeter, current_meter

from .fakes import FakeOpenAI


def test_metered_client_adds_reported_usage():
    provider = FakeOpenAI(prompt_tokens=11, completion_tokens=7, embedding_tokens=5)
    client = MeteredOpenAI(provider)
    meter = UsageMeter()

    async def run():
        token = current_meter.set(meter)
        try:
            await client.chat.completions.create(model="m", messages=[])
            await client.embeddings.create(model="e", input=["a", "b"])
        finally:
            current_meter.reset(token)

    asyncio.run(run())
    assert meter.snapshot() == {
        "calls": 2,
        "input_tokens": 11,
        "output_tokens": 7,
        "embedding_tokens": 5,
        "unmetered_calls": 0,
    }
    assert client.base_url == "http://fake-provider/v1"  # everything else passes through


def test_no_meter_means_no_counting_and_no_error():
    client = MeteredOpenAI(FakeOpenAI())
    asyncio.run(client.chat.completions.create(model="m", messages=[]))


def test_meters_are_isolated_across_concurrent_tasks():
    client = MeteredOpenAI(FakeOpenAI(prompt_tokens=1, completion_tokens=1, embedding_tokens=1))

    async def job(n: int) -> dict:
        meter = UsageMeter()
        current_meter.set(meter)

        async def one():
            await client.chat.completions.create(model="m", messages=[])

        # Graphiti fans out with gather: child tasks inherit the meter.
        await asyncio.gather(*(one() for _ in range(n)))
        return meter.snapshot()

    async def run():
        return await asyncio.gather(job(2), job(5))

    a, b = asyncio.run(run())
    assert a["calls"] == 2 and a["input_tokens"] == 2
    assert b["calls"] == 5 and b["input_tokens"] == 5


def test_embedding_usage_falls_back_to_total_tokens():
    meter = UsageMeter()

    class Usage:
        prompt_tokens = None
        total_tokens = 9

    meter.add_embedding(Usage())
    assert meter.embedding_tokens == 9


def test_small_prompts_go_to_the_small_model():
    from graphiti_core.llm_client.config import LLMConfig

    provider = FakeOpenAI()
    client = RoutedGenericClient(
        config=LLMConfig(api_key="k", model="big", small_model="small", base_url="http://x"),
        client=MeteredOpenAI(provider),
    )

    async def run():
        await client._generate_response([Message(role="user", content="hi")], model_size=ModelSize.small)
        await client._generate_response([Message(role="user", content="hi")], model_size=ModelSize.medium)
        await client._generate_response(
            [Message(role="user", content="hi")], model_size=ModelSize.small, model="explicit"
        )

    asyncio.run(run())
    assert [call["model"] for call in provider.chat_calls] == ["small", "big", "explicit"]


def test_passthrough_reranker_keeps_order():
    ranked = asyncio.run(PassthroughReranker().rank("q", ["a", "b", "c"]))
    assert [p for p, _ in ranked] == ["a", "b", "c"]
    assert ranked[0][1] > ranked[1][1] > ranked[2][1]
    assert asyncio.run(PassthroughReranker().rank("q", [])) == []


def test_service_builds_without_an_openai_key(monkeypatch):
    """Graphiti defaults to OpenAI clients (and an OpenAI reranker) that need
    OPENAI_API_KEY; the service must hand it its own for every role."""
    from app.main import build_service

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("NEO4J_URI", "bolt://127.0.0.1:1")
    monkeypatch.setenv("NEO4J_PASSWORD", "unused-password")
    monkeypatch.setenv("GRAPH_LLM_BASE_URL", "http://127.0.0.1:1/v1")
    monkeypatch.setenv("GRAPH_LLM_MODEL", "big")
    monkeypatch.setenv("GRAPH_LLM_SMALL_MODEL", "small")
    monkeypatch.setenv("GRAPH_EMBEDDING_BASE_URL", "http://127.0.0.1:1/v1")
    monkeypatch.setenv("GRAPH_EMBEDDING_MODEL", "embed")
    monkeypatch.setenv("GRAPH_EMBEDDING_DIM", "768")
    monkeypatch.setenv("GRAPH_INGEST_CONCURRENCY", "3")

    async def build_and_close():
        service = build_service()
        graphiti = service.backend._graphiti
        try:
            assert isinstance(graphiti.cross_encoder, PassthroughReranker)
            assert isinstance(graphiti.llm_client, RoutedGenericClient)
            assert graphiti.llm_client.model == "big" and graphiti.llm_client.small_model == "small"
            assert graphiti.llm_client.temperature == 0
            assert isinstance(graphiti.llm_client.client, MeteredOpenAI)
            assert isinstance(graphiti.embedder.client, MeteredOpenAI)
            assert graphiti.embedder.config.embedding_dim == 768
            assert service._slots._value == 3
        finally:
            await graphiti.close()

    asyncio.run(build_and_close())
    assert os.environ["GRAPHITI_TELEMETRY_ENABLED"] == "false"


@pytest.mark.parametrize("missing", ["NEO4J_URI", "GRAPH_LLM_MODEL", "GRAPH_EMBEDDING_MODEL"])
def test_required_config(monkeypatch, missing):
    from app.config import load_config

    for name, value in {
        "NEO4J_URI": "bolt://x:7687",
        "GRAPH_LLM_MODEL": "m",
        "GRAPH_EMBEDDING_MODEL": "e",
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv(missing)
    with pytest.raises(ValueError, match=missing):
        load_config()


def test_bad_concurrency_is_refused(monkeypatch):
    from app.config import load_config

    monkeypatch.setenv("NEO4J_URI", "bolt://x:7687")
    monkeypatch.setenv("GRAPH_LLM_MODEL", "m")
    monkeypatch.setenv("GRAPH_EMBEDDING_MODEL", "e")
    monkeypatch.setenv("GRAPH_INGEST_CONCURRENCY", "0")
    with pytest.raises(ValueError, match="GRAPH_INGEST_CONCURRENCY"):
        load_config()


def test_extra_body_is_added_to_every_chat_request():
    provider = FakeOpenAI()
    client = MeteredOpenAI(provider, chat_extra_body={"reasoning_effort": "none"})

    async def run():
        await client.chat.completions.create(model="m", messages=[])
        await client.chat.completions.create(model="m", messages=[], extra_body={"seed": 1})
        await client.embeddings.create(model="e", input=["x"])

    asyncio.run(run())
    assert provider.chat_calls[0]["extra_body"] == {"reasoning_effort": "none"}
    assert provider.chat_calls[1]["extra_body"] == {"reasoning_effort": "none", "seed": 1}
    assert "extra_body" not in provider.embedding_calls[0]


def _minimal_env(monkeypatch):
    monkeypatch.setenv("NEO4J_URI", "bolt://x:7687")
    monkeypatch.setenv("GRAPH_LLM_MODEL", "m")
    monkeypatch.setenv("GRAPH_EMBEDDING_MODEL", "e")


@pytest.mark.parametrize("raw", ["not json", "[1, 2]", '"text"'])
def test_extra_body_must_be_a_json_object(monkeypatch, raw):
    from app.config import load_config

    _minimal_env(monkeypatch)
    monkeypatch.setenv("GRAPH_LLM_EXTRA_BODY", raw)
    with pytest.raises(ValueError, match="GRAPH_LLM_EXTRA_BODY"):
        load_config()


def test_structured_output_mode_is_checked(monkeypatch):
    from app.config import load_config

    _minimal_env(monkeypatch)
    monkeypatch.setenv("GRAPH_LLM_STRUCTURED_OUTPUT", "xml")
    with pytest.raises(ValueError, match="GRAPH_LLM_STRUCTURED_OUTPUT"):
        load_config()
    monkeypatch.setenv("GRAPH_LLM_STRUCTURED_OUTPUT", "json_object")
    monkeypatch.setenv("GRAPH_LLM_EXTRA_BODY", '{"reasoning_effort": "none"}')
    config = load_config()
    assert config.llm_structured_output == "json_object"
    assert config.llm_extra_body == {"reasoning_effort": "none"}

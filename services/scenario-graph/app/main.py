"""
LaunchStack scenario graph service.

A private service that owns Graphiti and the Neo4j connection for Scenarios
graph mode (contract v2). Only the worker calls it, with a bearer token, after
it has authorised the caller; every route is pinned to one ``group_id`` (one
per graph build). Group ids are validated here but are not permission checks.
"""

from __future__ import annotations

import logging
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import neo4j.exceptions
import openai
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.auth import token_matches
from app.backend import EpisodeInput, ExportTooLarge
from app.ontology import OntologyError, OntologyIn, compile_ontology
from app.service import GraphService, describe_error, is_unavailable

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("scenario_graph")
# The Neo4j driver logs a server notification for every "index already exists"
# and "property key does not exist" on a young graph; they are not problems.
logging.getLogger("neo4j.notifications").setLevel(logging.ERROR)

GROUP_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
EPISODE_UUID = r"^[A-Za-z0-9_.:-]{1,128}$"
MAX_EPISODES_PER_CALL = 50
MAX_EPISODE_CHARS = 200_000
MAX_SEARCH_LIMIT = 50


def build_service() -> GraphService:
    """Wire Graphiti to the configured providers. Imported lazily so the unit
    tests never construct a Neo4j driver or an OpenAI client."""
    from graphiti_core import Graphiti
    from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
    from graphiti_core.llm_client.config import LLMConfig
    from openai import AsyncOpenAI

    from app.backend import GraphitiBackend, PassthroughReranker, RoutedGenericClient
    from app.config import load_config
    from app.usage import MeteredOpenAI

    config = load_config()
    # A local endpoint (Ollama, vLLM) needs no key, but the OpenAI SDK
    # refuses to construct without one.
    llm_key = os.environ.get("GRAPH_LLM_API_KEY") or "not-needed"
    embedding_key = os.environ.get("GRAPH_EMBEDDING_API_KEY") or "not-needed"

    llm_client = RoutedGenericClient(
        config=LLMConfig(
            api_key=llm_key,
            model=config.llm_model,
            small_model=config.llm_small_model,
            base_url=config.llm_base_url,
            temperature=0,
        ),
        client=MeteredOpenAI(
            AsyncOpenAI(api_key=llm_key, base_url=config.llm_base_url),
            chat_extra_body=config.llm_extra_body,
        ),
        structured_output_mode=config.llm_structured_output,  # type: ignore[arg-type]
    )
    embedder = OpenAIEmbedder(
        config=OpenAIEmbedderConfig(
            embedding_model=config.embedding_model,
            embedding_dim=config.embedding_dim,
            api_key=embedding_key,
            base_url=config.embedding_base_url,
        ),
        client=MeteredOpenAI(  # type: ignore[arg-type]
            AsyncOpenAI(api_key=embedding_key, base_url=config.embedding_base_url)
        ),
    )
    graphiti = Graphiti(
        config.neo4j_uri,
        config.neo4j_user,
        os.environ.get("NEO4J_PASSWORD", ""),
        llm_client=llm_client,
        embedder=embedder,
        cross_encoder=PassthroughReranker(),
        max_coroutines=config.max_coroutines,
    )
    return GraphService(
        GraphitiBackend(graphiti),
        ingest_concurrency=config.ingest_concurrency,
        context_episodes=config.context_episodes,
        export_max_nodes=config.export_max_nodes,
        export_max_edges=config.export_max_edges,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    service = build_service()
    app.state.service = service
    ok, graphiti_version, neo4j_version = await service.health()
    if ok:
        logger.info("ready: graphiti %s, neo4j %s", graphiti_version, neo4j_version)
    else:
        logger.warning("Neo4j not reachable yet; /healthz reports 503 until it is")
    yield
    graphiti = getattr(service.backend, "_graphiti", None)
    if graphiti is not None:
        await graphiti.close()


app = FastAPI(
    title="LaunchStack Scenario Graph Service",
    description="Graphiti + Neo4j behind an authenticated, group-pinned API.",
    version="1.0.0",
    lifespan=lifespan,
    # A private API: no interactive docs or schema endpoint.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


# ─── Errors: never echo request bodies (they carry document text) ────────────


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    detail = [
        {"loc": [str(part) for part in error.get("loc", ())], "msg": error.get("msg", ""), "type": error.get("type", "")}
        for error in exc.errors()[:20]
    ]
    return JSONResponse(status_code=422, content={"detail": detail})


@app.exception_handler(OntologyError)
async def _ontology_error(_: Request, exc: OntologyError) -> JSONResponse:
    return JSONResponse(
        status_code=422, content={"detail": "invalid ontology", "errors": exc.errors[:50]}
    )


@app.exception_handler(ExportTooLarge)
async def _export_too_large(_: Request, exc: ExportTooLarge) -> JSONResponse:
    return JSONResponse(status_code=413, content={"detail": str(exc)})


@app.exception_handler(neo4j.exceptions.Neo4jError)
@app.exception_handler(neo4j.exceptions.DriverError)
async def _database_error(_: Request, exc: Exception) -> JSONResponse:
    logger.error("graph database error: %s", describe_error(exc))
    if is_unavailable(exc):
        return JSONResponse(status_code=503, content={"detail": "graph database unavailable"})
    return JSONResponse(status_code=500, content={"detail": "graph database error"})


@app.exception_handler(openai.APIError)
async def _provider_error(_: Request, exc: Exception) -> JSONResponse:
    # Search embeds the query; a provider failure there is an upstream failure.
    logger.error("graph provider error: %s", describe_error(exc))
    status = 503 if is_unavailable(exc) else 502
    return JSONResponse(status_code=status, content={"detail": "graph provider unavailable"})


@app.middleware("http")
async def _authenticate(request: Request, call_next):
    """Everything but /healthz needs the bearer token, checked before the
    body is read or parsed. Fails closed when SCENARIO_GRAPH_TOKEN is unset."""
    if request.url.path != "/healthz" and not token_matches(
        request.headers.get("authorization")
    ):
        return JSONResponse(
            status_code=401,
            content={"detail": "Unauthorized"},
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await call_next(request)


# ─── Request shapes ──────────────────────────────────────────────────────────


class EpisodeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    uuid: str = Field(pattern=EPISODE_UUID)
    name: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=MAX_EPISODE_CHARS)
    source_description: str = Field(default="", max_length=500)
    reference_time: datetime

    @field_validator("reference_time")
    @classmethod
    def _aware(cls, value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


class IngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ontology: OntologyIn
    episodes: list[EpisodeIn] = Field(min_length=1, max_length=MAX_EPISODES_PER_CALL)

    @field_validator("episodes")
    @classmethod
    def _unique(cls, episodes: list[EpisodeIn]) -> list[EpisodeIn]:
        if len({episode.uuid for episode in episodes}) != len(episodes):
            raise ValueError("episode uuids must be unique within a call")
        return episodes


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=10, ge=1, le=MAX_SEARCH_LIMIT)


# ─── Dependencies ────────────────────────────────────────────────────────────


def get_service(request: Request) -> GraphService:
    return request.app.state.service


def group_id_param(group_id: str) -> str:
    # Checked by hand so a bad id is never echoed back in a validation error.
    if not GROUP_ID.match(group_id):
        raise HTTPException(status_code=400, detail="invalid group id")
    return group_id


# ─── Routes ──────────────────────────────────────────────────────────────────


@app.get("/healthz")
async def healthz(request: Request) -> JSONResponse:
    """Open without credentials so container healthchecks work, and minimal
    then; versions only for a caller presenting the token. A caller that
    presents a wrong token gets 401, so a misconfigured worker finds out."""
    authorization = request.headers.get("authorization")
    authed = token_matches(authorization)
    if authorization is not None and not authed:
        return JSONResponse(
            status_code=401,
            content={"detail": "Unauthorized"},
            headers={"WWW-Authenticate": "Bearer"},
        )
    ok, graphiti_version, neo4j_version = await get_service(request).health()
    body = {
        "ok": ok,
        "graphiti": graphiti_version if authed else None,
        "neo4j": neo4j_version if authed else None,
    }
    return JSONResponse(status_code=200 if ok else 503, content=body)


@app.post("/v1/groups/{group_id}/episodes")
async def ingest(
    body: IngestRequest,
    group_id: str = Depends(group_id_param),
    service: GraphService = Depends(get_service),
) -> dict[str, Any]:
    ontology = compile_ontology(body.ontology)
    episodes = [
        EpisodeInput(
            uuid=episode.uuid,
            name=episode.name,
            body=episode.body,
            source_description=episode.source_description,
            reference_time=episode.reference_time,
        )
        for episode in body.episodes
    ]
    outcomes, usage = await service.ingest(group_id, ontology, episodes)
    return {"outcomes": [outcome.to_json() for outcome in outcomes], "usage": usage}


@app.get("/v1/groups/{group_id}/episodes")
async def list_episodes(
    group_id: str = Depends(group_id_param),
    service: GraphService = Depends(get_service),
) -> dict[str, Any]:
    return {"uuids": await service.list_episodes(group_id)}


@app.post("/v1/groups/{group_id}/search")
async def search(
    body: SearchRequest,
    group_id: str = Depends(group_id_param),
    service: GraphService = Depends(get_service),
) -> dict[str, Any]:
    return {"hits": await service.search(group_id, body.query, body.limit)}


@app.get("/v1/groups/{group_id}/export")
async def export(
    group_id: str = Depends(group_id_param),
    service: GraphService = Depends(get_service),
) -> dict[str, Any]:
    return await service.export(group_id)


@app.delete("/v1/groups/{group_id}")
async def delete_group(
    group_id: str = Depends(group_id_param),
    service: GraphService = Depends(get_service),
) -> dict[str, Any]:
    return {"deleted_nodes": await service.delete_group(group_id)}

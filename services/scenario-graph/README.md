# Scenario graph service

A private service that owns [Graphiti](https://github.com/getzep/graphiti)
(Apache-2.0) and the connection to Neo4j Community (GPLv3, its own unmodified
container). It builds and serves the knowledge graph behind Scenarios graph
mode (contract v2, `pipelines/src/scenarios/v2/contracts.ts` →
`ScenarioGraphPort`).

```
worker ──bearer token──▶ scenario-graph (this service) ──bolt──▶ neo4j
  │                         │
  │ authorises first,       └─▶ GRAPH_LLM_* / GRAPH_EMBEDDING_* providers
  │ then picks one group_id     (configured here, separately from chat)
  └─ @launchstack/pipelines/scenarios/v2/graph-http
```

- Only the worker calls it, through `createGraphitiHttpPort`
  (`pipelines/src/scenarios/v2/graph-http.ts`). Only this service reaches
  Neo4j. Neither publishes a port in Compose (profile `scenarios-graph`).
- Every ingest, search, export and delete is pinned to one `group_id` (one
  per graph build). Group ids are validated (`^[A-Za-z0-9_-]{1,128}$`) but are
  not permission checks: the worker authorises the caller first. No query
  spans groups.
- The ontology arrives as data and is re-validated here (names, attribute
  types, reserved names, `ONTOLOGY_LIMITS`), then turned into Graphiti models
  with `pydantic.create_model`. Nothing in a schema is evaluated or imported.

## Endpoints

All routes except `/healthz` need `Authorization: Bearer $SCENARIO_GRAPH_TOKEN`
(constant-time compare; unset token = every call 401). Bodies are snake_case.

| Route                                 | Body → reply                                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz`                        | → `{ok, graphiti, neo4j}`; 503 with `ok: false` when Neo4j is unreachable. Versions only with the token; a wrong token is 401                                                                                                               |
| `POST /v1/groups/{group_id}/episodes` | `{ontology, episodes: [{uuid, name, body, source_description, reference_time}]}` (1–50 episodes) → `{outcomes: [{uuid, status: "done"\|"failed", error?}], usage: {calls, input_tokens, output_tokens, embedding_tokens, unmetered_calls}}` |
| `GET /v1/groups/{group_id}/episodes`  | → `{uuids}`: episodes stored and finished in the group, sorted                                                                                                                                                                              |
| `POST /v1/groups/{group_id}/search`   | `{query, limit ≤ 50}` → `{hits: [{edge, score}]}`; `score = 1 / (rank + 1)`                                                                                                                                                                 |
| `GET /v1/groups/{group_id}/export`    | → `{nodes, edges, episode_uuids}`, sorted by uuid; 413 rather than a truncated graph past `GRAPH_EXPORT_MAX_NODES` / `_EDGES`                                                                                                               |
| `DELETE /v1/groups/{group_id}`        | → `{deleted_nodes}`: every entity, episode, community and saga of the group, and their relationships                                                                                                                                        |

Edges carry `uuid, name, fact, source_node_uuid, target_node_uuid, episodes,
valid_at, invalid_at, attributes`; nodes carry `uuid, name, labels` (`Entity`
first), `summary, attributes`. Embeddings and Graphiti's bookkeeping
properties are never returned.

Errors never echo request bodies (they carry document text): validation
errors list location and message only, episode errors are an exception class
name (plus a trimmed message for transport and database errors, ≤ 200
characters). Database unreachable → 503; provider failure during search →
502/503.

### Ingest semantics

- **Deterministic uuids, idempotent.** The caller supplies each episode's
  uuid. Graphiti's `add_episode(uuid=…)` loads an existing episode rather than
  creating one, so the service saves the episode first (Graphiti's own
  `EpisodicNode.save`), runs `add_episode`, then marks it done
  (`ls_ingested_at`). An episode already done in the group is reported `done`
  without re-adding. A pending leftover from a crash is discarded and redone,
  unless Graphiti had committed its extraction (its MENTIONS edges exist), in
  which case it is just marked done. A uuid another group holds is refused,
  since Graphiti merges episodes by uuid alone.
- **Reconcile after a crash** with `GET …/episodes` before resubmitting; the
  list holds only finished episodes.
- **Order and concurrency.** Episodes of one call run in order (Graphiti
  needs sequential episodes per group); calls for the same group wait for each
  other; `GRAPH_INGEST_CONCURRENCY` bounds episodes in flight across groups.
  These are in-process locks: run **one** service process.
- **Failures.** A failed episode is cleaned up and reported `failed`; the rest
  of the call continues. After a provider or database outage the remaining
  episodes are reported `failed` with `not attempted: …` so the worker can
  wait and retry. A database failure before any work is a 503.
- **Usage is measured, not estimated.** Graphiti's generic client does not
  record tokens, so the service hands it a wrapped `AsyncOpenAI` whose chat
  and embedding calls add the provider's reported `usage` to the running
  call's meter (a `ContextVar`, so concurrent calls never mix). Tokens spent
  by a failed episode are reported too. `unmetered_calls` counts responses
  with no `usage` block. Note: Ollama does not count a thinking model's
  reasoning tokens in `completion_tokens`.

## Configuration

| Variable                      | Default        | Meaning                                                                                                 |
| ----------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| `SCENARIO_GRAPH_TOKEN`        | —              | Bearer token shared with the worker. Unset = fail closed                                                |
| `NEO4J_URI`                   | required       | e.g. `bolt://neo4j:7687`                                                                                |
| `NEO4J_USER`                  | `neo4j`        |                                                                                                         |
| `NEO4J_PASSWORD`              | —              |                                                                                                         |
| `GRAPH_LLM_BASE_URL`          | OpenAI         | Any OpenAI-compatible `/chat/completions` endpoint                                                      |
| `GRAPH_LLM_API_KEY`           | —              | Not needed for a local endpoint                                                                         |
| `GRAPH_LLM_MODEL`             | required       | Extraction model                                                                                        |
| `GRAPH_LLM_SMALL_MODEL`       | the main model | Graphiti's lighter prompts                                                                              |
| `GRAPH_LLM_STRUCTURED_OUTPUT` | `json_schema`  | `json_object` for endpoints without `json_schema` response formats                                      |
| `GRAPH_LLM_EXTRA_BODY`        | —              | JSON object added to every chat request, e.g. `{"reasoning_effort":"none"}` to turn Ollama thinking off |
| `GRAPH_EMBEDDING_BASE_URL`    | OpenAI         | Any OpenAI-compatible `/embeddings` endpoint                                                            |
| `GRAPH_EMBEDDING_API_KEY`     | —              |                                                                                                         |
| `GRAPH_EMBEDDING_MODEL`       | required       |                                                                                                         |
| `GRAPH_EMBEDDING_DIM`         | `1024`         | Vectors are cut to this length (Graphiti's `embedding_dim`)                                             |
| `GRAPH_INGEST_CONCURRENCY`    | `2`            | Episodes extracted at once across all groups                                                            |
| `GRAPH_MAX_COROUTINES`        | Graphiti's     | Graphiti's fan-out inside one episode (`max_coroutines`)                                                |
| `GRAPH_CONTEXT_EPISODES`      | `3`            | Previous episodes of the group shown to the extractor                                                   |
| `GRAPH_EXPORT_MAX_NODES`      | `10000`        | Export refuses (413) beyond this                                                                        |
| `GRAPH_EXPORT_MAX_EDGES`      | `20000`        |                                                                                                         |
| `GRAPHITI_TELEMETRY_ENABLED`  | `false`        | Graphiti's PostHog telemetry; off here unless an operator turns it on                                   |

## Graphiti API this relies on (graphiti-core 0.31.2)

- `Graphiti(uri, user, password, llm_client=, embedder=, cross_encoder=, max_coroutines=)`.
  Without `cross_encoder` Graphiti builds an `OpenAIRerankerClient`, which
  needs an OpenAI key; the service passes `PassthroughReranker`, and search
  uses `EDGE_HYBRID_SEARCH_RRF` (BM25 + cosine, reciprocal-rank fusion), which
  never calls a cross-encoder.
- LLM: `OpenAIGenericClient(config=LLMConfig(api_key, model, small_model, base_url, temperature=0), client=…, structured_output_mode=…)`,
  subclassed as `RoutedGenericClient` because the generic client ignores
  `small_model`.
- Embedder: `OpenAIEmbedder(config=OpenAIEmbedderConfig(embedding_model, embedding_dim, api_key, base_url), client=…)`.
- `add_episode(name, episode_body, source_description, reference_time, source=EpisodeType.text, group_id, uuid, entity_types, edge_types, edge_type_map, previous_episode_uuids)`.
  With `uuid`, it loads the stored episode (`NodeNotFoundError` if absent);
  it writes the episode, entities and edges in one transaction at the end.
  An extracted edge whose name is a typed edge but whose endpoints do not
  match `edge_type_map` is renamed `RELATES_TO`.
- `search_(query, config, group_ids=[group_id])`. Graphiti treats an empty
  `group_ids` as every group, so the group is never empty here. `search()` is
  not used: it mutates a shared config recipe.
- Neo4j: one database; `group_id` is a property on every node and
  relationship (Graphiti's driver `clone(database=…)` is a no-op for Neo4j).

## Running

```bash
cd services/scenario-graph
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r requirements-dev.txt

# unit tests (Graphiti and Neo4j faked; no network)
.venv/bin/python -m pytest -q

# live tests: a real Neo4j, plus a model endpoint for the ingest test
docker run -d --name sg-neo4j -p 127.0.0.1:17687:7687 \
  -e NEO4J_AUTH=neo4j/local-password -e NEO4J_server_memory_heap_max__size=512m \
  neo4j:5.26-community
NEO4J_URI=bolt://127.0.0.1:17687 NEO4J_PASSWORD=local-password \
GRAPH_LLM_BASE_URL=http://localhost:11434/v1 GRAPH_LLM_MODEL=qwen3.5:9b \
GRAPH_LLM_EXTRA_BODY='{"reasoning_effort":"none"}' \
GRAPH_EMBEDDING_BASE_URL=http://localhost:11434/v1 \
GRAPH_EMBEDDING_MODEL=nomic-embed-text GRAPH_EMBEDDING_DIM=768 \
SCENARIO_GRAPH_LIVE_INGEST=1 .venv/bin/python -m pytest tests/test_live.py -v

# the service itself (same env plus SCENARIO_GRAPH_TOKEN)
.venv/bin/uvicorn app.main:app --port 8000
```

In Compose: `docker compose --profile scenarios-graph up -d` (see
`docker-compose.yml` and `.env.example`). `VERIFY.md` records a live run.

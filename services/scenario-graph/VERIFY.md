# Live verification — 2026-11-13

The service on the host (Python 3.11 venv), a real Neo4j Community container,
and local models on Ollama 0.32.5. Commands and output are as run; tokens
and the Neo4j password are throwaway values for this run.

## Setup

```console
$ docker run -d --name scenario-graph-neo4j-verify -p 127.0.0.1:17687:7687 \
    -e NEO4J_AUTH=neo4j/verify-neo4j-pass \
    -e NEO4J_server_memory_heap_initial__size=256m -e NEO4J_server_memory_heap_max__size=512m \
    -e NEO4J_server_memory_pagecache_size=128m -e NEO4J_dbms_usage__report_enabled=false \
    --memory=900m neo4j:5.26-community
$ ollama pull nomic-embed-text

$ env NEO4J_URI=bolt://127.0.0.1:17687 NEO4J_USER=neo4j NEO4J_PASSWORD=verify-neo4j-pass \
    GRAPH_LLM_BASE_URL=http://localhost:11434/v1 GRAPH_LLM_MODEL=qwen3.5:9b GRAPH_LLM_SMALL_MODEL=qwen3.5:9b \
    'GRAPH_LLM_EXTRA_BODY={"reasoning_effort":"none"}' \
    GRAPH_EMBEDDING_BASE_URL=http://localhost:11434/v1 GRAPH_EMBEDDING_MODEL=nomic-embed-text GRAPH_EMBEDDING_DIM=768 \
    GRAPH_INGEST_CONCURRENCY=1 GRAPH_MAX_COROUTINES=2 SCENARIO_GRAPH_TOKEN=verify-token-5b1f0c2e9a \
    .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 18030
... INFO scenario_graph ready: graphiti 0.31.2, neo4j 5.26.33-community
```

Request bodies: `ingest-e1.json` / `ingest-e2.json` / `ingest-both.json` hold
`BASE_ONTOLOGY` (generated from `contracts.ts`, = `tests/fixtures/base_ontology.json`)
and these episodes, reference time `2026-11-01T12:00:00Z`:

- `verify-build-1-E1` (contacts.pdf v3 p2): "Maya recommends Northwind's software purchases; Lee approves them."
- `verify-build-1-E2` (renewal.pdf v5 p4): "Northwind uses Acme Legacy. Migration requires approximately fourteen days."

## Health

```console
$ curl -s -w ' HTTP %{http_code}\n' http://127.0.0.1:18030/healthz
{"ok":true,"graphiti":null,"neo4j":null} HTTP 200
$ curl -s -w ' HTTP %{http_code}\n' -H 'Authorization: Bearer verify-token-5b1f0c2e9a' http://127.0.0.1:18030/healthz
{"ok":true,"graphiti":"0.31.2","neo4j":"5.26.33-community"} HTTP 200
```

## First attempt: qwen3.5:9b with thinking on (aborted)

Without `GRAPH_LLM_EXTRA_BODY`, the first extraction call for E1 took 4 min
(00:18 → 00:21:59) and the second was still running 4 min later, so the
service was stopped mid-episode. A direct probe shows why, and one metering
caveat:

```console
$ curl -s http://localhost:11434/v1/chat/completions -d '{"model":"qwen3.5:9b","messages":[{"role":"user","content":"Reply with the JSON {\"a\":1} only."}],"max_tokens":2000,"response_format":{"type":"json_object"}}'
content: {"a":1}
reasoning chars: 2452
usage: {'prompt_tokens': 623, 'completion_tokens': 6, 'total_tokens': 629}
HTTP 200 39.604789s

$ curl -s ... '"reasoning_effort":"none"' ...
{"choices":[{"message":{"content":"{\"a\": 1}"}, ...}],"usage":{"prompt_tokens":23,"completion_tokens":7,"total_tokens":30}}
HTTP 200 0.937739s
```

Ollama does not count reasoning tokens in `completion_tokens`, so metered
usage under-states a thinking model's real work. Hence the
`GRAPH_LLM_EXTRA_BODY` knob; everything below ran with thinking off.

The stopped run left exactly the crash state the service reconciles — a
pending episode, nothing committed:

```console
$ docker exec scenario-graph-neo4j-verify cypher-shell -u neo4j -p verify-neo4j-pass \
    "MATCH (e:Episodic) RETURN e.uuid AS uuid, e.group_id AS group_id, e.ls_ingested_at AS done, size(e.entity_edges) AS edges; MATCH (n:Entity) RETURN count(n) AS entities;"
uuid, group_id, done, edges
"verify-build-1-E1", "verify-build-1", NULL, 0
entities
0
```

## Ingest E1 (over the pending leftover), then E2

```console
$ curl -s -w '\nHTTP %{http_code} in %{time_total}s\n' -H 'Authorization: Bearer verify-token-5b1f0c2e9a' \
    -H 'Content-Type: application/json' --data @ingest-e1.json http://127.0.0.1:18030/v1/groups/verify-build-1/episodes
{"outcomes":[{"uuid":"verify-build-1-E1","status":"done"}],"usage":{"calls":11,"input_tokens":6347,"output_tokens":299,"embedding_tokens":74,"unmetered_calls":0}}
HTTP 200 in 46.719664s

$ curl ... --data @ingest-e2.json .../v1/groups/verify-build-1/episodes
{"outcomes":[{"uuid":"verify-build-1-E2","status":"done"}],"usage":{"calls":11,"input_tokens":7444,"output_tokens":315,"embedding_tokens":66,"unmetered_calls":0}}
HTTP 200 in 53.121073s
```

## List, then repeat both (idempotent)

```console
$ curl -s -H 'Authorization: Bearer verify-token-5b1f0c2e9a' http://127.0.0.1:18030/v1/groups/verify-build-1/episodes
{"uuids":["verify-build-1-E1","verify-build-1-E2"]}
HTTP 200 in 0.058633s

$ curl ... --data @ingest-both.json .../v1/groups/verify-build-1/episodes
{"outcomes":[{"uuid":"verify-build-1-E1","status":"done"},{"uuid":"verify-build-1-E2","status":"done"}],"usage":{"calls":0,"input_tokens":0,"output_tokens":0,"embedding_tokens":0,"unmetered_calls":0}}
HTTP 200 in 0.037790s
```

## Search "who approves Northwind purchases" (limit 5)

```console
$ curl -s ... --data '{"query":"who approves Northwind purchases","limit":5}' .../v1/groups/verify-build-1/search
HTTP 200 in 0.145391s
```

| score    | name                         | fact                                                                         |
| -------- | ---------------------------- | ---------------------------------------------------------------------------- |
| 1.0      | `RELATES_TO`                 | Lee approves Northwind's software purchases.                                 |
| 0.5      | `RELATES_TO`                 | Northwind uses Acme Legacy.                                                  |
| 0.333333 | `RELATES_TO`                 | Maya recommends Northwind's software purchases.                              |
| 0.25     | `HAS_MIGRATION_DURATION_FOR` | Migration of Acme Legacy for Northwind requires approximately fourteen days. |

## Export

```console
$ curl -s -H 'Authorization: Bearer verify-token-5b1f0c2e9a' http://127.0.0.1:18030/v1/groups/verify-build-1/export | python3 -m json.tool
```

```json
{
    "nodes": [
        { "uuid": "4f7c6903-…", "name": "Northwind", "labels": ["Entity"],
          "summary": "Northwind uses Acme Legacy.\nMigration of Acme Legacy for Northwind requires approximately fourteen days.", "attributes": {} },
        { "uuid": "5d674b5a-…", "name": "Lee", "labels": ["Entity"],
          "summary": "Lee approves Northwind's software purchases.", "attributes": {} },
        { "uuid": "a268ffa4-…", "name": "Acme Legacy", "labels": ["Entity", "Product"],
          "summary": "Northwind uses Acme Legacy.\nMigration of Acme Legacy for Northwind requires approximately fourteen days.", "attributes": {} },
        { "uuid": "b879eec4-…", "name": "Maya", "labels": ["Entity", "Person"],
          "summary": "Maya recommends Northwind's software purchases.", "attributes": { "title": "null" } },
        { "uuid": "cfd29e70-…", "name": "Northwind's software purchases", "labels": ["Entity", "Product"],
          "summary": "Maya recommends Northwind's software purchases.\nLee approves Northwind's software purchases.", "attributes": {} }
    ],
    "edges": [
        { "name": "RELATES_TO", "fact": "Maya recommends Northwind's software purchases.",
          "source": "Maya", "target": "Northwind's software purchases", "episodes": ["verify-build-1-E1"],
          "valid_at": "2026-11-01T00:00:00+00:00", "invalid_at": null, "attributes": {} },
        { "name": "RELATES_TO", "fact": "Northwind uses Acme Legacy.",
          "source": "Northwind", "target": "Acme Legacy", "episodes": ["verify-build-1-E2"],
          "valid_at": "2026-11-01T14:00:00+00:00", "invalid_at": null, "attributes": {} },
        { "name": "HAS_MIGRATION_DURATION_FOR", "fact": "Migration of Acme Legacy for Northwind requires approximately fourteen days.",
          "source": "Acme Legacy", "target": "Northwind", "episodes": ["verify-build-1-E2"],
          "valid_at": null, "invalid_at": null, "attributes": {} },
        { "name": "RELATES_TO", "fact": "Lee approves Northwind's software purchases.",
          "source": "Lee", "target": "Northwind's software purchases", "episodes": ["verify-build-1-E1"],
          "valid_at": "2026-11-01T00:00:00+00:00", "invalid_at": null, "attributes": {} }
    ],
    "episode_uuids": ["verify-build-1-E1", "verify-build-1-E2"]
}
```

(Abridged for reading: uuids shortened, `source`/`target` shown by name in
place of `source_node_uuid`/`target_node_uuid`; the service returns the full
uuids.)

What the local model got right and wrong:

- Every fact is there and traced to the right episode.
- Typing was imperfect: Northwind and Lee stayed plain `Entity` (not
  Organization / Person), and "Northwind's software purchases" became a
  `Product` instead of a `PurchaseDecision`. Because Graphiti enforces the
  edge type map, the APPROVES, INFLUENCES and USES edges it proposed did not
  match their endpoint types and were renamed `RELATES_TO`. The duration
  fact got a free-form name, `HAS_MIGRATION_DURATION_FOR`.
- Maya's `title` came back as the string `"null"` (model output).
- `valid_at` differs between E1 and E2 although both carry the same
  reference time: Graphiti's extractor dates each fact itself.

## Delete

```console
$ curl -s -w '\nHTTP %{http_code} in %{time_total}s\n' -X DELETE -H 'Authorization: Bearer verify-token-5b1f0c2e9a' http://127.0.0.1:18030/v1/groups/verify-build-1
{"deleted_nodes":7}
HTTP 200 in 0.053642s
$ curl ... /v1/groups/verify-build-1/episodes
{"uuids":[]}
$ curl ... /v1/groups/verify-build-1/export
{"nodes":[],"edges":[],"episode_uuids":[]}
$ docker exec scenario-graph-neo4j-verify cypher-shell -u neo4j -p verify-neo4j-pass \
    "MATCH (n) RETURN labels(n) AS labels, count(*) AS n; MATCH ()-[r]->() RETURN count(r) AS relationships;"
relationships
0
```

(7 = 5 entities + 2 episodes; the node query returned no rows.)

## Refusals

```console
$ curl -s -w ' HTTP %{http_code}\n' http://127.0.0.1:18030/v1/groups/verify-build-1/episodes
{"detail":"Unauthorized"} HTTP 401
$ curl -s -w ' HTTP %{http_code}\n' -H 'Authorization: Bearer wrong' http://127.0.0.1:18030/healthz
{"detail":"Unauthorized"} HTTP 401
$ curl -s -w ' HTTP %{http_code}\n' -H 'Authorization: Bearer verify-token-5b1f0c2e9a' 'http://127.0.0.1:18030/v1/groups/bad%20id;MATCH/episodes'
{"detail":"invalid group id"} HTTP 400
$ curl -s -w ' HTTP %{http_code}\n' -H 'Authorization: Bearer verify-token-5b1f0c2e9a' -H 'Content-Type: application/json' \
    -d '{"ontology":{"entities":[{"name":"Entity","description":"x","attributes":[{"name":"uuid","type":"object"}]}],"edges":[]},"episodes":[…]}' \
    http://127.0.0.1:18030/v1/groups/verify-build-3/episodes
{"detail":"invalid ontology","errors":["entity type name 'Entity' is reserved"]} HTTP 422
```

## TypeScript adapter against the live service

`createGraphitiHttpPort({ baseUrl: "http://127.0.0.1:18030", token })`, run
with tsx before the delete above:

```text
# health()
{ "ok": true, "graphiti": "0.31.2", "neo4j": "5.26.33-community" }

# ingest(verify-build-1, [E1, E2]) — already stored
{ "outcomes": [ { "uuid": "verify-build-1-E1", "status": "done" }, { "uuid": "verify-build-1-E2", "status": "done" } ],
  "usage": { "calls": 0, "inputTokens": 0, "outputTokens": 0, "embeddingTokens": 0 } }
(88 ms)

# listEpisodes(verify-build-1)
[ "verify-build-1-E1", "verify-build-1-E2" ]

# search(verify-build-1, 'who approves Northwind purchases', 3)
[ { "score": 1, "name": "RELATES_TO", "fact": "Lee approves Northwind's software purchases.", "episodeUuids": [ "verify-build-1-E1" ] },
  { "score": 0.5, "name": "RELATES_TO", "fact": "Northwind uses Acme Legacy.", "episodeUuids": [ "verify-build-1-E2" ] },
  { "score": 0.333333, "name": "RELATES_TO", "fact": "Maya recommends Northwind's software purchases.", "episodeUuids": [ "verify-build-1-E1" ] } ]

# exportGroup(verify-build-1) — summary
{ "nodes": [ "Northwind [Entity]", "Lee [Entity]", "Acme Legacy [Entity, Product]", "Maya [Entity, Person]",
             "Northwind's software purchases [Entity, Product]" ],
  "edges": [ "RELATES_TO: Maya recommends Northwind's software purchases. (b879eec4 → cfd29e70)",
             "RELATES_TO: Northwind uses Acme Legacy. (4f7c6903 → a268ffa4)",
             "HAS_MIGRATION_DURATION_FOR: Migration of Acme Legacy for Northwind requires approximately fourteen days. (a268ffa4 → 4f7c6903)",
             "RELATES_TO: Lee approves Northwind's software purchases. (5d674b5a → cfd29e70)" ],
  "episodeUuids": [ "verify-build-1-E1", "verify-build-1-E2" ] }

# ingest(verify-build-2, [E1 with build-1's uuid])
{ "outcomes": [ { "uuid": "verify-build-1-E1", "status": "failed", "error": "episode uuid is already used by another group" } ],
  "usage": { "calls": 0, "inputTokens": 0, "outputTokens": 0, "embeddingTokens": 0 } }

# ingest(verify-build-2, [fresh E1])
{ "outcomes": [ { "uuid": "verify-build-2-E1", "status": "done" } ],
  "usage": { "calls": 11, "inputTokens": 6347, "outputTokens": 299, "embeddingTokens": 74 } }
(34196 ms)

# listEpisodes(verify-build-2)
[ "verify-build-2-E1" ]

# after deleteGroup(verify-build-2): listEpisodes
[]

# after deleteGroup(verify-build-2): exportGroup
{ "nodes": [], "edges": [], "episodeUuids": [] }

# wrong token → listEpisodes
{ "type": "GraphHttpError", "status": 401,
  "message": "Scenario graph service: GET /v1/groups/verify-build-1/episodes answered 401: Unauthorized" }

# wrong token → health
{ "type": "GraphHttpError", "message": "Scenario graph service rejected the token" }

# nothing listening → listEpisodes
{ "type": "GraphUnavailableError", "message": "Scenario graph service: GET /v1/groups/verify-build-1/episodes failed (fetch failed)" }

# nothing listening → health
{ "ok": false, "graphiti": null, "neo4j": null }
```

The fresh E1 in a second group spent exactly the tokens the first E1 did
(6347 / 299 / 74 over 11 calls): temperature 0 on a local model.

## Live pytest module

```console
$ env NEO4J_URI=bolt://127.0.0.1:17687 NEO4J_PASSWORD=verify-neo4j-pass GRAPH_LLM_BASE_URL=http://localhost:11434/v1 \
    GRAPH_LLM_MODEL=qwen3.5:9b 'GRAPH_LLM_EXTRA_BODY={"reasoning_effort":"none"}' \
    GRAPH_EMBEDDING_BASE_URL=http://localhost:11434/v1 GRAPH_EMBEDDING_MODEL=nomic-embed-text GRAPH_EMBEDDING_DIM=768 \
    SCENARIO_GRAPH_LIVE_INGEST=1 .venv/bin/python -m pytest tests/test_live.py -v
======================== 3 passed, 1 warning in 37.92s =========================
```

## The image

The first image build exposed a packaging bug the venv had hidden:
`graphiti_core.llm_client` imports `httpx`, which graphiti-core 0.31.2 does
not declare (openai 3.x moved to `httpx2`), so the container exited at import
with `ModuleNotFoundError: No module named 'httpx'`. `requirements.txt` now
pins `httpx==0.28.1`, checked in a clean venv from `requirements.txt` alone
(`import app.main` OK). The Dockerfile also no longer names a remote
`# syntax=` frontend, which hung resolving `docker/dockerfile:1` here.

```console
$ docker build -t launchstack-scenario-graph:verify services/scenario-graph   # 406 MB
$ docker network create sg-verify-net
$ docker network connect --alias neo4j sg-verify-net scenario-graph-neo4j-verify
$ docker run -d --name scenario-graph-verify --network sg-verify-net -p 127.0.0.1:18031:8000 \
    --add-host host.docker.internal:host-gateway -e NEO4J_URI=bolt://neo4j:7687 -e NEO4J_PASSWORD=verify-neo4j-pass \
    -e GRAPH_LLM_BASE_URL=http://host.docker.internal:11434/v1 -e GRAPH_LLM_MODEL=qwen3.5:9b \
    -e 'GRAPH_LLM_EXTRA_BODY={"reasoning_effort":"none"}' -e GRAPH_EMBEDDING_BASE_URL=http://host.docker.internal:11434/v1 \
    -e GRAPH_EMBEDDING_MODEL=nomic-embed-text -e GRAPH_EMBEDDING_DIM=768 -e SCENARIO_GRAPH_TOKEN=verify-token-5b1f0c2e9a \
    launchstack-scenario-graph:verify
health=healthy
$ docker exec scenario-graph-verify id
uid=10001(graph) gid=10001(graph) groups=10001(graph)
$ docker exec scenario-graph-verify printenv GRAPHITI_TELEMETRY_ENABLED
false
$ curl -s -w ' HTTP %{http_code}\n' -H 'Authorization: Bearer verify-token-5b1f0c2e9a' http://127.0.0.1:18031/healthz
{"ok":true,"graphiti":"0.31.2","neo4j":"5.26.33-community"} HTTP 200
$ curl -s -w ' HTTP %{http_code}\n' http://127.0.0.1:18031/v1/groups/docker-check/episodes
{"detail":"Unauthorized"} HTTP 401

$ curl ... --data @ingest-both.json http://127.0.0.1:18031/v1/groups/docker-check/episodes
{"outcomes":[{"uuid":"verify-build-1-E1","status":"done"},{"uuid":"verify-build-1-E2","status":"done"}],"usage":{"calls":22,"input_tokens":13791,"output_tokens":614,"embedding_tokens":140,"unmetered_calls":0}}
HTTP 200 in 112.171955s
nodes: [("Northwind's software purchases", ['Entity', 'Product']), ('Maya', ['Entity', 'Person']), ('Acme Legacy', ['Entity', 'Product']), ('Lee', ['Entity']), ('Northwind', ['Entity'])]
edges: [('RELATES_TO', "Maya recommends Northwind's software purchases."), ('RELATES_TO', 'Northwind uses Acme Legacy.'), ('HAS_MIGRATION_DURATION_FOR', 'Migration of Acme Legacy for Northwind requires approximately fourteen days.'), ('RELATES_TO', "Lee approves Northwind's software purchases.")]
episodes: ['verify-build-1-E1', 'verify-build-1-E2']
$ curl -s -X DELETE ... http://127.0.0.1:18031/v1/groups/docker-check
{"deleted_nodes":7} HTTP 200
```

Same graph as the host run, and the usage is exactly E1 + E2 from the host
run (6347 + 7444 input tokens, 299 + 315 output, 74 + 66 embedding).

## Compose

```console
$ docker compose -f docker-compose.yml config -q; echo $?
0
$ docker compose -f docker-compose.yml --profile scenarios-graph config -q; echo $?
0
$ docker compose -f docker-compose.yml config --services
db migrate seaweedfs worker inngest-dev gotenberg transcription adeu-docs-editing document-converter app
$ docker compose -f docker-compose.yml --profile scenarios-graph config --services
gotenberg db migrate seaweedfs transcription adeu-docs-editing document-converter app neo4j scenario-graph worker inngest-dev
```

Then the two profile services alone, as Compose defines them (the rest of the
stack was not started: the Docker VM here already runs another one):

```console
$ env GRAPH_LLM_BASE_URL=http://host.docker.internal:11434/v1 GRAPH_LLM_MODEL=qwen3.5:9b \
    'GRAPH_LLM_EXTRA_BODY={"reasoning_effort":"none"}' GRAPH_EMBEDDING_BASE_URL=http://host.docker.internal:11434/v1 \
    GRAPH_EMBEDDING_MODEL=nomic-embed-text GRAPH_EMBEDDING_DIM=768 SCENARIO_GRAPH_TOKEN=compose-verify-token \
    NEO4J_HEAP_SIZE=256m NEO4J_PAGECACHE_SIZE=128m \
    docker compose -p sg-compose-verify -f docker-compose.yml --profile scenarios-graph up -d --build scenario-graph
 Container sg-compose-verify-neo4j-1 Started
 Container sg-compose-verify-neo4j-1 Waiting
 Container sg-compose-verify-neo4j-1 Healthy
 Container sg-compose-verify-scenario-graph-1 Started
scenario-graph health=healthy
$ docker port sg-compose-verify-neo4j-1; docker port sg-compose-verify-scenario-graph-1
(nothing: no published ports)
$ docker exec sg-compose-verify-scenario-graph-1 python -c "…urlopen(Request('http://127.0.0.1:8000/healthz', headers={'Authorization': 'Bearer compose-verify-token'}))…"
{"ok":true,"graphiti":"0.31.2","neo4j":"5.26.33-community"}
$ docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' …
sg-compose-verify-neo4j-1 595.5MiB / 7.653GiB
sg-compose-verify-scenario-graph-1 99.15MiB / 7.653GiB
$ docker compose -p sg-compose-verify -f docker-compose.yml --profile scenarios-graph down -v
```

At the defaults (heap 512m, page cache 256m) Neo4j sits a little higher.

All verification containers, the network and the image were removed
afterwards.

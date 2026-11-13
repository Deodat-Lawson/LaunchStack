/**
 * The worker's side of the scenario graph service: `ScenarioGraphPort` over
 * HTTP (services/scenario-graph). Only the worker holds this adapter and the
 * service token; only the service imports Graphiti or reaches Neo4j.
 *
 * Wire format is the service's snake_case; this maps it to and from the
 * contract's camelCase. Failure mapping:
 *   - network errors, timeouts, 502/503/504 → GraphUnavailableError (the unit
 *     waits and retries);
 *   - any other non-2xx → GraphHttpError carrying the status;
 *   - `health()` reports unavailability as `{ ok: false }` instead of throwing.
 * Error messages carry at most ~200 characters of the service's reply, never
 * request text.
 */
import { z } from "zod";

import {
    GraphUnavailableError,
    type GraphEdge,
    type GraphEpisodeInput,
    type GraphExport,
    type GraphIngestOutcome,
    type GraphNode,
    type GraphSearchHit,
    type GraphUsage,
    type OntologySchema,
    type ScenarioGraphPort,
} from "./contracts";

export interface GraphitiHttpPortOptions {
    /** e.g. "http://scenario-graph:8000" (SCENARIOS_GRAPH_URL). */
    baseUrl: string;
    /** SCENARIO_GRAPH_TOKEN, sent as a bearer token. */
    token: string;
    /** Timeout for health, reads, search and delete. Default 30 s. */
    timeoutMs?: number;
    /**
     * Timeout for one ingest call, which runs model extraction for every
     * episode in it. Default 15 minutes. A timed-out ingest keeps running on
     * the service; the next attempt reconciles through `listEpisodes`.
     */
    ingestTimeoutMs?: number;
    fetch?: typeof fetch;
}

/** A non-2xx answer that is not an availability problem (401, 404, 413, 422, …). */
export class GraphHttpError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
        this.name = "GraphHttpError";
    }
}

/** Mirrors the service's check; an invalid id never leaves the worker. */
export const GRAPH_GROUP_ID = /^[A-Za-z0-9_-]{1,128}$/;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_INGEST_TIMEOUT_MS = 15 * 60_000;
const DETAIL_MAX = 200;

// ─── Wire shapes (responses are checked, not trusted) ────────────────────────

const wireEdge = z.object({
    uuid: z.string(),
    name: z.string(),
    fact: z.string(),
    source_node_uuid: z.string(),
    target_node_uuid: z.string(),
    episodes: z.array(z.string()),
    valid_at: z.string().nullable(),
    invalid_at: z.string().nullable(),
    attributes: z.record(z.unknown()),
});

const wireNode = z.object({
    uuid: z.string(),
    name: z.string(),
    labels: z.array(z.string()),
    summary: z.string(),
    attributes: z.record(z.unknown()),
});

const healthResponse = z.object({
    ok: z.boolean(),
    graphiti: z.string().nullable(),
    neo4j: z.string().nullable(),
});

const ingestResponse = z.object({
    outcomes: z.array(
        z.object({
            uuid: z.string(),
            status: z.enum(["done", "failed"]),
            error: z.string().optional(),
        })
    ),
    usage: z.object({
        calls: z.number().int().nonnegative(),
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
        embedding_tokens: z.number().int().nonnegative(),
    }),
});

const episodesResponse = z.object({ uuids: z.array(z.string()) });

const searchResponse = z.object({
    hits: z.array(z.object({ edge: wireEdge, score: z.number() })),
});

const exportResponse = z.object({
    nodes: z.array(wireNode),
    edges: z.array(wireEdge),
    episode_uuids: z.array(z.string()),
});

// ─── Mapping ─────────────────────────────────────────────────────────────────

function toWireOntology(ontology: OntologySchema) {
    const attributes = (list: OntologySchema["entities"][number]["attributes"]) =>
        list.map(a => ({ name: a.name, type: a.type, description: a.description }));
    return {
        entities: ontology.entities.map(e => ({
            name: e.name,
            description: e.description,
            attributes: attributes(e.attributes),
            origin: e.origin,
            motivating_evidence_id: e.motivatingEvidenceId,
        })),
        edges: ontology.edges.map(e => ({
            name: e.name,
            description: e.description,
            attributes: attributes(e.attributes),
            endpoints: e.endpoints.map(p => ({ source: p.source, target: p.target })),
            origin: e.origin,
            motivating_evidence_id: e.motivatingEvidenceId,
        })),
    };
}

/** `evidenceId` stays in our records; the service never sees it. */
function toWireEpisode(episode: GraphEpisodeInput) {
    return {
        uuid: episode.uuid,
        name: episode.name,
        body: episode.body,
        source_description: episode.sourceDescription,
        reference_time: episode.referenceTime,
    };
}

function fromWireEdge(edge: z.infer<typeof wireEdge>): GraphEdge {
    return {
        uuid: edge.uuid,
        name: edge.name,
        fact: edge.fact,
        sourceUuid: edge.source_node_uuid,
        targetUuid: edge.target_node_uuid,
        episodeUuids: edge.episodes,
        validAt: edge.valid_at,
        invalidAt: edge.invalid_at,
        attributes: edge.attributes,
    };
}

function fromWireNode(node: z.infer<typeof wireNode>): GraphNode {
    return {
        uuid: node.uuid,
        name: node.name,
        labels: node.labels,
        summary: node.summary,
        attributes: node.attributes,
    };
}

function shorten(text: string): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length <= DETAIL_MAX ? flat : `${flat.slice(0, DETAIL_MAX - 1)}…`;
}

/** The service's `detail` (and ontology `errors`) as one bounded line. */
function describeBody(text: string): string {
    try {
        const body = JSON.parse(text) as { detail?: unknown; errors?: unknown };
        const parts: string[] = [];
        if (typeof body.detail === "string") parts.push(body.detail);
        else if (Array.isArray(body.detail)) {
            parts.push(
                body.detail
                    .map(d => {
                        const item = d as { loc?: unknown[]; msg?: unknown };
                        const msg = typeof item.msg === "string" ? item.msg : "";
                        return `${(item.loc ?? []).join(".")}: ${msg}`;
                    })
                    .join("; ")
            );
        }
        if (Array.isArray(body.errors)) {
            parts.push(body.errors.filter(e => typeof e === "string").join("; "));
        }
        return shorten(parts.join(" — "));
    } catch {
        return shorten(text);
    }
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export function createGraphitiHttpPort(options: GraphitiHttpPortOptions): ScenarioGraphPort {
    const baseUrl = options.baseUrl.replace(/\/+$/, "");
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ingestTimeoutMs = options.ingestTimeoutMs ?? DEFAULT_INGEST_TIMEOUT_MS;

    function groupPath(groupId: string, suffix = ""): string {
        if (!GRAPH_GROUP_ID.test(groupId)) {
            throw new Error("Invalid scenario graph group id");
        }
        return `/v1/groups/${encodeURIComponent(groupId)}${suffix}`;
    }

    /** One request: returns status + text, or throws GraphUnavailableError. */
    async function send(
        method: string,
        path: string,
        body: unknown,
        limitMs: number
    ): Promise<{ status: number; text: string }> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), limitMs);
        const label = `${method} ${path}`;
        try {
            const response = await fetchImpl(`${baseUrl}${path}`, {
                method,
                headers: {
                    Authorization: `Bearer ${options.token}`,
                    Accept: "application/json",
                    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: controller.signal,
            });
            const text = await response.text();
            return { status: response.status, text };
        } catch (error) {
            const reason = controller.signal.aborted
                ? `timed out after ${limitMs} ms`
                : shorten(error instanceof Error ? error.message : String(error));
            throw new GraphUnavailableError(`Scenario graph service: ${label} failed (${reason})`);
        } finally {
            clearTimeout(timer);
        }
    }

    async function call<T>(
        method: string,
        path: string,
        schema: z.ZodType<T>,
        body?: unknown,
        limitMs = timeoutMs
    ): Promise<T> {
        const { status, text } = await send(method, path, body, limitMs);
        const label = `${method} ${path}`;
        if (status === 502 || status === 503 || status === 504) {
            throw new GraphUnavailableError(`Scenario graph service: ${label} answered ${status}`);
        }
        if (status < 200 || status >= 300) {
            const detail = describeBody(text);
            throw new GraphHttpError(
                status,
                `Scenario graph service: ${label} answered ${status}${detail ? `: ${detail}` : ""}`
            );
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error(`Scenario graph service: ${label} returned invalid JSON`);
        }
        const result = schema.safeParse(parsed);
        if (!result.success) {
            throw new Error(`Scenario graph service: ${label} returned an unexpected shape`);
        }
        return result.data;
    }

    return {
        async health() {
            try {
                const { status, text } = await send("GET", "/healthz", undefined, timeoutMs);
                if (status === 401) {
                    throw new GraphHttpError(401, "Scenario graph service rejected the token");
                }
                if (status !== 200 && status !== 503) {
                    return { ok: false, graphiti: null, neo4j: null };
                }
                const parsed = healthResponse.safeParse(JSON.parse(text));
                return parsed.success ? parsed.data : { ok: false, graphiti: null, neo4j: null };
            } catch (error) {
                if (error instanceof GraphHttpError) throw error;
                return { ok: false, graphiti: null, neo4j: null };
            }
        },

        async ingest({ groupId, ontology, episodes }) {
            const path = groupPath(groupId, "/episodes");
            if (episodes.length === 0) {
                return {
                    outcomes: [],
                    usage: { calls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0 },
                };
            }
            const response = await call(
                "POST",
                path,
                ingestResponse,
                { ontology: toWireOntology(ontology), episodes: episodes.map(toWireEpisode) },
                ingestTimeoutMs
            );
            // One outcome per input episode, in input order, whatever the reply held.
            const byUuid = new Map(response.outcomes.map(o => [o.uuid, o]));
            const outcomes: GraphIngestOutcome[] = episodes.map(episode => {
                const outcome = byUuid.get(episode.uuid);
                if (!outcome) {
                    return { uuid: episode.uuid, status: "failed", error: "no outcome reported" };
                }
                return outcome.error === undefined
                    ? { uuid: outcome.uuid, status: outcome.status }
                    : { uuid: outcome.uuid, status: outcome.status, error: shorten(outcome.error) };
            });
            const usage: GraphUsage = {
                calls: response.usage.calls,
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
                embeddingTokens: response.usage.embedding_tokens,
            };
            return { outcomes, usage };
        },

        async listEpisodes(groupId) {
            const response = await call("GET", groupPath(groupId, "/episodes"), episodesResponse);
            return response.uuids;
        },

        async search({ groupId, query, limit }): Promise<GraphSearchHit[]> {
            const response = await call("POST", groupPath(groupId, "/search"), searchResponse, {
                query,
                limit,
            });
            return response.hits.map(hit => ({ edge: fromWireEdge(hit.edge), score: hit.score }));
        },

        async exportGroup(groupId): Promise<GraphExport> {
            const response = await call("GET", groupPath(groupId, "/export"), exportResponse);
            return {
                nodes: response.nodes.map(fromWireNode),
                edges: response.edges.map(fromWireEdge),
                episodeUuids: response.episode_uuids,
            };
        },

        async deleteGroup(groupId) {
            await call("DELETE", groupPath(groupId), z.unknown());
        },
    };
}

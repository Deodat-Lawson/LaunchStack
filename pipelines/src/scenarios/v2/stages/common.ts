/**
 * Helpers the generation stages share: reading committed artifacts and unit
 * inputs, turning evidence snapshots into the shapes the simulation and the
 * v1 screens read, lexical ranking, and the graph build's derived names.
 *
 * Everything here is deterministic: the same committed inputs give the same
 * output on any host, so a retried unit sends the same model requests and the
 * journal serves the replies it already accepted.
 */
import { clip, tokenize, type Account, type EvidenceItem } from "@launchstack/simulation";

import type { StoredEvidence } from "../../types";
import {
    GraphUnavailableError,
    type CastPlan,
    type EvidenceSnapshot,
    type SourceManifest,
} from "../contracts";
import { approxTokens, sha256Hex } from "../hash";
import { unitKeys } from "../plan";
import { RetryLaterError, type StageContext } from "../stage";

/** Who a scenario's cast is drawn from (the v1 scenario audience, word for word). */
export const SCENARIO_AUDIENCE =
    "people who would plausibly hear about this situation and have a view on it: customers, prospects, people in the market, critics and bystanders";

/** Generic segments for slots the cast plan left empty, in the audience's order. */
export const FALLBACK_SEGMENTS = [
    "a customer who would hear about this situation",
    "a prospect weighing whether to buy",
    "someone working in the market",
    "a critic of the idea",
    "a bystander with a passing interest",
] as const;

export const NARRATOR: Account = { id: "narrator", name: "Newswire", handle: "@newswire" };

// ─── Reading model replies ───────────────────────────────────────────────────

export function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

export function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return undefined;
}

export function asNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))
        return Number(value);
    return undefined;
}

// ─── Committed artifacts ─────────────────────────────────────────────────────

export async function requireManifest(ctx: StageContext): Promise<SourceManifest> {
    const manifest = await ctx.artifacts.sourceManifest();
    if (!manifest) throw new Error("The run has no source manifest yet");
    return manifest;
}

export async function requireCastPlan(ctx: StageContext): Promise<CastPlan> {
    const plan = await ctx.artifacts.unitOutput<CastPlan>(unitKeys.castPlan);
    if (!plan) throw new Error("The run has no cast plan yet");
    return plan;
}

// ─── Unit inputs ─────────────────────────────────────────────────────────────

export function inputStrings(ctx: StageContext, key: string): string[] {
    const raw = ctx.unit.input[key];
    if (!Array.isArray(raw)) throw new Error(`Unit ${ctx.unit.key} has no ${key}`);
    return raw.filter((v): v is string => typeof v === "string");
}

export function inputNumber(ctx: StageContext, key: string): number {
    const raw = ctx.unit.input[key];
    if (typeof raw !== "number" || !Number.isFinite(raw))
        throw new Error(`Unit ${ctx.unit.key} has no ${key}`);
    return raw;
}

// ─── Evidence shapes ─────────────────────────────────────────────────────────

/** "E12" → 12, for sorting evidence ids in manifest order. */
export function evidenceNumber(id: string): number {
    const n = Number(/^E(\d+)$/i.exec(id)?.[1]);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export function sortEvidenceIds(ids: Iterable<string>): string[] {
    return [...new Set(ids)].sort((a, b) => evidenceNumber(a) - evidenceNumber(b));
}

function refType(item: EvidenceSnapshot): string {
    if (item.sourceType === "document" || item.sourceType === "search") return "document";
    if (item.sourceType === "company_fact") return "company_profile";
    return item.sourceType;
}

/** A snapshot as v1 screens read run evidence. */
export function toStoredEvidence(item: EvidenceSnapshot): StoredEvidence {
    return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        text: item.quote,
        ref: { type: refType(item), id: item.sourceId },
        href: item.href,
        documentIds: item.documentIds,
    };
}

/** A snapshot as the simulation's prompt builders read evidence. */
export function toEvidenceItem(item: EvidenceSnapshot): EvidenceItem {
    return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        text: item.quote,
        ref: { type: refType(item), id: item.sourceId },
    };
}

/**
 * Items, in manifest order, that fit `budgetTokens` once each is clipped to
 * `perItemChars` (the clip the prompt builder applies) plus a line of
 * framing. The first item that does not fit ends the list, so a smaller
 * budget always gives a prefix of a larger one.
 */
export function fitEvidence<T extends { quote: string; label: string }>(
    items: T[],
    budgetTokens: number,
    perItemChars: number
): T[] {
    const out: T[] = [];
    let used = 0;
    for (const item of items) {
        const cost = approxTokens(item.quote.slice(0, perItemChars)) + approxTokens(item.label) + 8;
        if (used + cost > budgetTokens) break;
        out.push(item);
        used += cost;
    }
    return out;
}

// ─── Lexical ranking ─────────────────────────────────────────────────────────

/**
 * Scores texts against a query by IDF-weighted overlap of distinct tokens
 * (the simulation's `tokenize`). Rare words count for more, so a slot about
 * "migration" finds the one passage that mentions it before the many that
 * name the company.
 */
export function lexicalScorer(corpus: string[]): (query: string, text: string) => number {
    const docs = corpus.map(t => new Set(tokenize(t)));
    const df = new Map<string, number>();
    for (const doc of docs) for (const t of doc) df.set(t, (df.get(t) ?? 0) + 1);
    const n = docs.length;
    const idf = (t: string) => Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1;
    return (query, text) => {
        const have = new Set(tokenize(text));
        let score = 0;
        for (const t of new Set(tokenize(query))) if (have.has(t)) score += idf(t);
        return score;
    };
}

/**
 * The part of a long text that matters to a query: the best-matching
 * sentence and its neighbours up to `maxChars`. Short texts come back whole.
 */
export function focusText(text: string, query: string, maxChars: number): string {
    const flat = text.replace(/\s+/g, " ").trim();
    if (flat.length <= maxChars) return flat;
    const sentences = flat.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length <= 1) return clip(flat, maxChars);
    const wanted = new Set(tokenize(query));
    const scores = sentences.map(s => tokenize(s).filter(t => wanted.has(t)).length);
    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[best]!) best = i;
    let lo = best;
    let hi = best;
    let length = sentences[best]!.length;
    if (length > maxChars) return clip(sentences[best]!, maxChars);
    for (let grew = true; grew; ) {
        grew = false;
        const next = sentences[hi + 1];
        if (next !== undefined && length + 1 + next.length <= maxChars) {
            hi += 1;
            length += 1 + next.length;
            grew = true;
        }
        const prev = sentences[lo - 1];
        if (prev !== undefined && length + 1 + prev.length <= maxChars) {
            lo -= 1;
            length += 1 + prev.length;
            grew = true;
        }
    }
    return sentences.slice(lo, hi + 1).join(" ");
}

/** Whether `name` appears in `text` as whole words, ignoring case. */
export function mentions(text: string, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

// ─── Graph build names ───────────────────────────────────────────────────────

/** sha-256 of company | manifest | ontology | extraction policy: one build per distinct input. */
export function graphBuildKey(
    companyId: bigint,
    manifestHash: string,
    ontologyHash: string,
    policyVersion: string
): string {
    return sha256Hex(`${companyId}|${manifestHash}|${ontologyHash}|${policyVersion}`);
}

/** The Graphiti group a build lives in. Derived, so every worker names it the same. */
export function graphGroupId(companyId: bigint, buildKey: string): string {
    return `ls_${companyId}_${buildKey.slice(0, 24)}`;
}

/** A uuid-shaped id from sha-256(build key | evidence id): the same episode on every retry. */
export function episodeUuid(buildKey: string, evidenceId: string): string {
    const h = sha256Hex(`${buildKey}|${evidenceId}`);
    const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Run graph work, turning "the service is down" into "wait and retry". */
export async function withGraph<T>(work: () => Promise<T>): Promise<T> {
    try {
        return await work();
    } catch (error) {
        if (error instanceof GraphUnavailableError) throw new RetryLaterError(error.message);
        throw error;
    }
}

export function requireGraph(ctx: StageContext) {
    const graph = ctx.ports.graph;
    if (!graph) throw new RetryLaterError("No scenario graph service is configured");
    return graph;
}

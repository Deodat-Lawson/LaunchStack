/**
 * The call journal behind a v2 stage's `ctx.model`.
 *
 * Every model call is one logical call (`scenario_calls`, keyed by run,
 * generation, unit, purpose and the canonical request hash) with one or more
 * physical attempts (`scenario_call_attempts`). The intent is journaled before
 * the provider is called and the raw reply is saved, and accepted, before the
 * stage sees it. So a unit that crashes between the reply and its commit, or a
 * second worker that runs the same unit, is served the accepted reply again
 * instead of paying for it twice.
 *
 * Only an exact match is reused: a different prompt, model policy or prompt
 * version is a different request hash and so a different call. Every attempt
 * is kept, including ones that failed and ones whose outcome is unknown (a
 * timeout or a dropped connection: the provider may have done the work and
 * billed it). The usage a unit is billed for is the accepted attempts it used,
 * fresh or reused.
 */
import type { ModelReply, ModelRequest, SimulationModel, Usage } from "@launchstack/simulation";

import { V2_VERSIONS } from "./contracts";
import { requestHash, sha256Hex } from "./hash";

export interface CallScope {
    companyId: bigint;
    runId: number;
    generation: number;
    unitKey: string;
}

export interface AcceptedReply {
    attemptId: number;
    text: string;
    inputTokens: number;
    outputTokens: number;
}

/** What the journal needs from storage. The real one is in store.ts; tests use a map. */
export interface CallJournalStore {
    /** The logical call for `logicalKey`, created if new, with its accepted reply when it has one. */
    openCall(input: {
        scope: CallScope;
        logicalKey: string;
        requestHash: string;
        purpose: string;
        actorId: string | null;
        round: number | null;
    }): Promise<{ callId: number; accepted: AcceptedReply | null }>;
    /** Journal an attempt as `started`, before the provider is called. */
    startAttempt(input: {
        companyId: bigint;
        callId: number;
        at: Date;
    }): Promise<{ attemptId: number; attempt: number }>;
    /**
     * Save the provider's reply and accept it. When another attempt of the
     * same call was accepted first, that one's reply is returned instead, so
     * every worker builds on the same text.
     */
    acceptAttempt(input: {
        callId: number;
        attemptId: number;
        text: string;
        inputTokens: number;
        outputTokens: number;
        latencyMs: number;
        model: string | null;
        at: Date;
    }): Promise<AcceptedReply>;
    /** The attempt failed, or its outcome is unknown (counted in the run's `flags.unknownAttempts`). */
    failAttempt(input: {
        runId: number;
        callId: number;
        attemptId: number;
        status: "failed" | "unknown";
        error: string;
        latencyMs: number;
        at: Date;
    }): Promise<void>;
}

/**
 * The logical key of a call. Identical requests inside one unit are told
 * apart by their order (`occurrence`), which a re-run reproduces because the
 * stage's committed inputs are the same.
 */
export function logicalKey(
    scope: Pick<CallScope, "runId" | "generation" | "unitKey">,
    purpose: string,
    hash: string,
    occurrence = 1
): string {
    const base = `${scope.runId}/${scope.generation}/${scope.unitKey}/${purpose}/${hash}`;
    return sha256Hex(occurrence > 1 ? `${base}#${occurrence}` : base);
}

const UNKNOWN_PATTERNS = [
    /timed? ?out/i,
    /timeout/i,
    /aborted?/i,
    /socket hang up/i,
    /ECONNRESET/,
    /ETIMEDOUT/,
    /EPIPE/,
    /network/i,
    /fetch failed/i,
    /terminated/i,
    /premature close/i,
];

/** Errors that mean the request never left this host: nothing could have been billed. */
const NEVER_SENT_PATTERNS = [/ECONNREFUSED/, /ENOTFOUND/, /EAI_AGAIN/];

/**
 * Whether a failed call may still have cost money. A provider that answered
 * with an error status says so; a timeout, an abort or a connection dropped
 * mid-request does not, so its outcome is unknown.
 */
export function classifyFailure(error: unknown): "failed" | "unknown" {
    const e = error as { name?: string; message?: string; status?: unknown; code?: unknown };
    if (typeof e?.status === "number") return "failed";
    const text = `${e?.name ?? ""} ${e?.message ?? String(error)} ${typeof e?.code === "string" ? e.code : ""}`;
    if (NEVER_SENT_PATTERNS.some(p => p.test(text))) return "failed";
    if (e?.name === "AbortError" || e?.name === "TimeoutError") return "unknown";
    return UNKNOWN_PATTERNS.some(p => p.test(text)) ? "unknown" : "failed";
}

/**
 * Whether a definite failure is worth trying again at once: the provider was
 * busy (429) or broken (5xx), or the request never left this host. A 4xx would
 * fail the same way again, and an attempt whose outcome is unknown is retried
 * only by a fresh execution of its unit, so a slow provider is never asked the
 * same question several times inside one attempt window.
 */
export function isTransientFailure(error: unknown): boolean {
    const e = error as { name?: string; message?: string; status?: unknown; code?: unknown };
    if (typeof e?.status === "number") return e.status === 429 || e.status >= 500;
    const text = `${e?.name ?? ""} ${e?.message ?? String(error)} ${typeof e?.code === "string" ? e.code : ""}`;
    return NEVER_SENT_PATTERNS.some(p => p.test(text));
}

/**
 * Pauses before each further attempt of a transient failure. The provider
 * client is built without retries of its own (`maxRetries: 0`), so these are
 * the only retries and every provider request is one recorded attempt.
 */
export const CALL_RETRY_DELAYS_MS: readonly number[] = [2_000, 8_000];

function errorText(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 2_000);
}

export interface JournalStats {
    /** Replies served from the journal (no provider call). */
    reused: number;
    /** Provider calls that were accepted. */
    fresh: number;
    failed: number;
    unknown: number;
}

export interface JournaledModel {
    model: SimulationModel;
    /** Billed usage so far: the accepted attempts this execution used. */
    usage(): Usage;
    stats(): JournalStats;
}

export function createJournaledModel(args: {
    store: CallJournalStore;
    provider: SimulationModel;
    scope: CallScope;
    /** Recorded on turn calls. */
    round?: number | null;
    versions?: Pick<typeof V2_VERSIONS, "modelPolicy" | "prompts">;
    now?: () => Date;
    clock?: () => number;
    /** Pauses before retrying a transient failure; one entry per retry (default {@link CALL_RETRY_DELAYS_MS}). */
    retryDelaysMs?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
}): JournaledModel {
    const { store, provider, scope } = args;
    const now = args.now ?? (() => new Date());
    const clock = args.clock ?? (() => Date.now());
    const retryDelays = args.retryDelaysMs ?? CALL_RETRY_DELAYS_MS;
    const sleep = args.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
    const stats: JournalStats = { reused: 0, fresh: 0, failed: 0, unknown: 0 };
    const occurrences = new Map<string, number>();

    const count = (reply: AcceptedReply) => {
        usage.calls += 1;
        usage.inputTokens += reply.inputTokens;
        usage.outputTokens += reply.outputTokens;
    };
    const toReply = (reply: AcceptedReply): ModelReply => ({
        text: reply.text,
        usage: { inputTokens: reply.inputTokens, outputTokens: reply.outputTokens },
    });

    return {
        usage: () => ({ ...usage }),
        stats: () => ({ ...stats }),
        model: {
            async complete(request: ModelRequest): Promise<ModelReply> {
                const hash = requestHash(request, args.versions ?? V2_VERSIONS);
                const base = `${request.purpose}/${hash}`;
                const occurrence = (occurrences.get(base) ?? 0) + 1;
                occurrences.set(base, occurrence);
                const key = logicalKey(scope, request.purpose, hash, occurrence);

                const { callId, accepted } = await store.openCall({
                    scope,
                    logicalKey: key,
                    requestHash: hash,
                    purpose: request.purpose,
                    actorId: null,
                    round: args.round ?? null,
                });
                if (accepted) {
                    stats.reused += 1;
                    count(accepted);
                    return toReply(accepted);
                }

                let attemptId: number;
                let started: number;
                let reply: ModelReply;
                for (let retry = 0; ; retry += 1) {
                    ({ attemptId } = await store.startAttempt({
                        companyId: scope.companyId,
                        callId,
                        at: now(),
                    }));
                    started = clock();
                    try {
                        reply = await provider.complete(request);
                        break;
                    } catch (error) {
                        const status = classifyFailure(error);
                        stats[status] += 1;
                        await store.failAttempt({
                            runId: scope.runId,
                            callId,
                            attemptId,
                            status,
                            error: errorText(error),
                            latencyMs: clock() - started,
                            at: now(),
                        });
                        const delay = retryDelays[retry];
                        if (
                            status === "unknown" ||
                            delay === undefined ||
                            !isTransientFailure(error)
                        )
                            throw error;
                        await sleep(delay);
                    }
                }
                const kept = await store.acceptAttempt({
                    callId,
                    attemptId,
                    text: reply.text,
                    inputTokens: reply.usage?.inputTokens ?? 0,
                    outputTokens: reply.usage?.outputTokens ?? 0,
                    latencyMs: clock() - started,
                    model: null,
                    at: now(),
                });
                if (kept.attemptId === attemptId) stats.fresh += 1;
                else stats.reused += 1;
                count(kept);
                return toReply(kept);
            },
        },
    };
}

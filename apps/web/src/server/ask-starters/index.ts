/**
 * Starter questions for a workspace: the brief, one model call on the `fast`
 * route, and a per-process cache keyed on the evidence.
 *
 * The cache key carries the brief's fingerprint, so a new upload, a re-run of
 * profile extraction, or a new connection invalidates the set on its own;
 * the TTL only bounds how long an unchanged workspace keeps the same four.
 * `refresh` skips the read, tells the model which questions were already
 * shown, and overwrites the entry — that is the Shuffle button.
 */

import { createTtlCache } from "@launchstack/tools/web-research";
import { GeneratedStartersSchema, type AskStartersPayload } from "~/lib/ask-starters/contract";
import { generateStructured } from "~/lib/llm";

import { buildWorkspaceBrief } from "./brief";
import {
    STARTERS_SYSTEM_PROMPT,
    buildStarterPrompt,
    completeStarters,
    fallbackStarters,
    hasEvidence,
    sanitizeStarters,
    type WorkspaceBrief,
} from "./starters";

export type { WorkspaceBrief } from "./starters";

const STARTERS_TTL_MS = 12 * 60 * 60 * 1000;

const cache = createTtlCache<AskStartersPayload>({ ttlMs: STARTERS_TTL_MS, maxEntries: 2000 });

export interface GetAskStartersArgs {
    companyId: bigint;
    /** Bypass the cached set and ask for a different one. */
    refresh?: boolean;
}

export async function getAskStarters(args: GetAskStartersArgs): Promise<AskStartersPayload> {
    const brief = await buildWorkspaceBrief(args.companyId);
    const key = `${args.companyId}:${brief.fingerprint}`;

    const cached = cache.get(key);
    if (cached && !args.refresh) return cached;

    const payload = await generateStarters(brief, {
        avoid: args.refresh ? (cached?.starters.map(s => s.question) ?? []) : [],
    });
    cache.set(key, payload);
    return payload;
}

/** Exposed for tests; production never clears it. */
export function resetAskStartersCache(): void {
    // createTtlCache has no clear(); a fresh module instance would be
    // heavier than expiring by key, so tests use distinct company ids.
}

async function generateStarters(
    brief: WorkspaceBrief,
    options: { avoid: string[] }
): Promise<AskStartersPayload> {
    const basis = {
        companyName: brief.company.name,
        sourceCount: brief.sourceCount,
        hasProfile: Boolean(brief.profileText),
        generatedAt: new Date().toISOString(),
    };

    // Nothing to ground a question in — don't spend a model call on filler.
    if (!hasEvidence(brief)) {
        return { starters: fallbackStarters(brief), basis: { ...basis, mode: "fallback" } };
    }

    try {
        const raw = await generateStructured({
            capability: "smallExtraction",
            system: STARTERS_SYSTEM_PROMPT,
            prompt: buildStarterPrompt(brief, { avoid: options.avoid }),
            schema: GeneratedStartersSchema,
            schemaName: "ask_starters",
        });
        const starters = completeStarters(sanitizeStarters(raw, brief), brief);
        return { starters, basis: { ...basis, mode: "generated" } };
    } catch (error) {
        // An unconfigured or failing model degrades to the deterministic set;
        // the home screen must never be empty because a provider is.
        console.warn(
            "[ask-starters] generation failed, using fallback:",
            error instanceof Error ? error.message : error
        );
        return { starters: fallbackStarters(brief), basis: { ...basis, mode: "fallback" } };
    }
}

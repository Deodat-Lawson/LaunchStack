/**
 * `brief` — the shared background and opening post, with the v1 request and
 * parser (packages/simulation brief.ts) over the manifest's evidence. The
 * manifest can hold more than one call reads, so evidence is taken in
 * manifest order (best first) until the prompt would pass the unit's input cap.
 */
import { buildBriefRequest, parseBrief, type Brief } from "@launchstack/simulation";

import { approxTokens } from "../hash";
import { UNIT_TOKEN_CAPS } from "../plan";
import type { Stage } from "../stage";
import { fitEvidence, requireManifest, toEvidenceItem } from "./common";

/** buildBriefRequest clips each item to this many characters. */
const BRIEF_ITEM_CHARS = 900;
/** System prompt and framing, rounded up. */
const BRIEF_OVERHEAD_TOKENS = 800;

export const briefStage: Stage = async ctx => {
    const manifest = await requireManifest(ctx);
    const budget = Math.max(
        0,
        UNIT_TOKEN_CAPS.brief.input - BRIEF_OVERHEAD_TOKENS - approxTokens(ctx.spec.subject)
    );
    const items = fitEvidence(manifest.items, budget, BRIEF_ITEM_CHARS);
    const evidence = items.map(toEvidenceItem);
    const reply = await ctx.model.complete(
        buildBriefRequest({ subject: ctx.spec.subject, evidence, mode: "scenario" })
    );
    const brief: Brief = parseBrief(reply.text, new Set(evidence.map(e => e.id))) ?? {
        brief: "",
        openingPost: "",
        evidenceIds: [],
    };
    return {
        output: { brief, evidenceRead: evidence.map(e => e.id) },
        run: { brief },
    };
};

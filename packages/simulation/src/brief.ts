/**
 * The shared background every agent reads, and the opening post that starts
 * a scenario — MiroFish's "seed extraction" step, with citations kept.
 */

import { formatEvidence } from "./cast";
import { asArray, asRecord, asString, extractJson } from "./json";
import { clip } from "./text";
import type { EvidenceItem, ModelRequest } from "./types";

export const BRIEF_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        brief: { type: "string" },
        openingPost: { type: "string" },
        evidenceIds: { type: "array", items: { type: "string" } },
    },
    required: ["brief", "openingPost", "evidenceIds"],
};

export interface Brief {
    /** Background with inline [E#] citations, for people to read. */
    brief: string;
    /** The narrator's opening post ("" for post tests, where the draft is the opening post). */
    openingPost: string;
    evidenceIds: string[];
}

export function buildBriefRequest(input: {
    subject: string;
    evidence: EvidenceItem[];
    mode: "scenario" | "post_test";
}): ModelRequest {
    const scenario = input.mode === "scenario";
    const system = [
        "You prepare the shared background for a social-network simulation.",
        "brief: at most 180 words of neutral, factual background that everyone in the simulation would know, drawn only from the evidence. Cite evidence inline as [E1]. Do not take sides or predict reactions.",
        scenario
            ? "openingPost: the post that starts the simulation, written as a neutral news account would post it (at most 60 words, no hashtags, no citations). It describes the situation in the subject as having happened."
            : 'openingPost: "" (the post under test is supplied separately).',
        "evidenceIds: the ids you cited.",
        "Reply with JSON only.",
    ].join("\n");
    const prompt = [
        `Subject: ${input.subject}`,
        "",
        "Evidence:",
        formatEvidence(input.evidence, 900),
    ].join("\n");
    return { purpose: "brief", system, prompt, schema: BRIEF_SCHEMA, maxOutputTokens: 900 };
}

export function parseBrief(text: string, evidenceIds: Set<string>): Brief | undefined {
    const root = asRecord(extractJson(text));
    if (!root) return undefined;
    const brief = clip(asString(root.brief) ?? "", 1600);
    if (!brief) return undefined;
    // Keep only citations to evidence that exists.
    const cleaned = brief.replace(/\[(E\d+)\]/gi, (_match, id: string) => (evidenceIds.has(id.toUpperCase()) ? `[${id.toUpperCase()}]` : ""));
    const cited = [...cleaned.matchAll(/\[(E\d+)\]/g)].map(m => m[1]!);
    const declared = asArray(root.evidenceIds)
        .map(v => asString(v)?.toUpperCase())
        .filter((v): v is string => !!v && evidenceIds.has(v));
    return {
        brief: cleaned.replace(/\s{2,}/g, " ").trim(),
        openingPost: clip(stripCitations(asString(root.openingPost) ?? ""), 500),
        evidenceIds: [...new Set([...cited, ...declared])],
    };
}

/** The brief as agents read it: without citation markers. */
export function stripCitations(text: string): string {
    return text.replace(/\s*\[E\d+\]/gi, "").replace(/\s+([.,;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

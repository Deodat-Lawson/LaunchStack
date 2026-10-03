/**
 * The stages, each a function of its ports and its inputs: find funders,
 * extract a request, draft a section, rewrite it, review an application. The
 * organisation profile they write from is the company profile (built by
 * ../company-metadata), read through ./profile. Nothing here touches the database — ./run does the reading
 * and writing around these, so each stage can be exercised with fake ports.
 */
import type { DocumentScope } from "@launchstack/retrieval";
import type { GrantOpportunity } from "@launchstack/tools/grant-search";
import type { SnippetPolicy } from "@launchstack/tools/grounded-retrieval";

import { formatEvidenceBlock, numberEvidence, validCites } from "./evidence";
import { formatLibraryBlock, matchLibrary } from "./library";
import type { ProposalPorts } from "./ports";
import {
    DRAFT_SYSTEM,
    EXTRACT_SYSTEM,
    FIT_SYSTEM,
    FUNDER_PLAN_SYSTEM,
    PROPOSALS_PROMPT_VERSION,
    REVIEW_SYSTEM,
    REWRITE_SYSTEM,
} from "./prompts";
import { requirementsFromExtracted, sanitizeExtracted } from "./requirements";
import {
    deterministicFindings,
    mergeFindings,
    computeReadiness,
    syncSectionRequirements,
} from "./review";
import { blankToNull, wordCount } from "./text";
import {
    DraftResultSchema,
    ExtractedRequestSchema,
    FitBatchSchema,
    FunderPlanSchema,
    ReviewDraftSchema,
    RewriteResultSchema,
    type ApplicationRecord,
    type DraftMeta,
    type Evidence,
    type ExtractedRequest,
    type Fit,
    type FunderSearchInput,
    type LibraryItemRecord,
    type OrgProfile,
    type Requirement,
    type Review,
    type RewritePreset,
    type SectionRecord,
} from "./types";

// ─── Profile ─────────────────────────────────────────────────────────────────

const DRAFT_POLICY: SnippetPolicy = {
    topK: 8,
    weights: [0.4, 0.6],
    maxSnippets: 8,
    maxSnippetChars: 700,
};

/** The profile as a prompt block; facts first, then the summary. */
export function formatProfileBlock(profile: OrgProfile | null): string {
    if (!profile) return "(no organisation profile has been built yet)";
    const facts = profile.facts.map(f => `- ${f.label}: ${f.value}`).join("\n");
    return [
        profile.summary,
        `Applicant type: ${profile.applicantType}`,
        profile.focusAreas.length ? `Focus areas: ${profile.focusAreas.join(", ")}` : "",
        profile.geography.length ? `Geography: ${profile.geography.join(", ")}` : "",
        facts ? `Facts:\n${facts}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

// ─── Funders ─────────────────────────────────────────────────────────────────

export interface FindFundersInput {
    profile: OrgProfile | null;
    overrides?: FunderSearchInput;
    onStep?: (step: "plan" | "search" | "score", detail: string) => void;
}

export interface ScoredOpportunity {
    opportunity: GrantOpportunity;
    fit: Fit | null;
}

export interface FindFundersResult {
    plan: {
        keywords: string[];
        applicantType: OrgProfile["applicantType"];
        geography: string | null;
        rationale: string;
    };
    scored: ScoredOpportunity[];
    sources: Array<{ id: string; status: string; found: number; detail: string | null }>;
    modelId?: string;
}

const SCORE_BATCH = 20;

export async function findFunders(
    ports: ProposalPorts,
    input: FindFundersInput
): Promise<FindFundersResult> {
    const overrides = input.overrides ?? {};
    let plan: FindFundersResult["plan"];
    let modelId: string | undefined;
    if (overrides.keywords && overrides.keywords.length > 0) {
        plan = {
            keywords: overrides.keywords,
            applicantType: overrides.applicantType ?? input.profile?.applicantType ?? "any",
            geography: overrides.geography ?? input.profile?.geography[0] ?? null,
            rationale: "Keywords given by hand.",
        };
    } else if (input.profile) {
        const planned = await ports.structured(
            "plan",
            FunderPlanSchema,
            FUNDER_PLAN_SYSTEM,
            `ORGANISATION PROFILE\n${formatProfileBlock(input.profile)}`,
            "funder_plan"
        );
        modelId = planned.modelId;
        plan = {
            keywords: planned.result.keywords,
            applicantType: overrides.applicantType ?? planned.result.applicantType,
            geography: overrides.geography ?? planned.result.geography,
            rationale: planned.result.rationale,
        };
    } else {
        throw new Error("Build the organisation profile first, or give keywords to search for.");
    }
    input.onStep?.("plan", plan.keywords.join(", "));

    const found = await ports.searchGrants({
        keywords: plan.keywords,
        applicantType: plan.applicantType,
        geography: plan.geography ?? undefined,
        includeWeb: overrides.includeWeb,
        limit: 25,
    });
    input.onStep?.("search", `${found.opportunities.length} found`);
    if (found.opportunities.length === 0 || !input.profile) {
        return {
            plan,
            scored: found.opportunities.map(opportunity => ({ opportunity, fit: null })),
            sources: found.sources,
            modelId,
        };
    }

    const fits = new Map<string, Fit>();
    for (let i = 0; i < found.opportunities.length; i += SCORE_BATCH) {
        const batch = found.opportunities.slice(i, i + SCORE_BATCH);
        const listing = batch
            .map(o =>
                [
                    `externalId: ${o.externalId}`,
                    `Title: ${o.title}`,
                    `Funder: ${o.funder}`,
                    o.closesOn ? `Closes: ${o.closesOn}` : "",
                    o.amountMax ? `Award up to: ${o.amountMax}` : "",
                    o.eligibility ? `Eligibility: ${o.eligibility.slice(0, 600)}` : "",
                    o.summary ? `Summary: ${o.summary.slice(0, 900)}` : "",
                ]
                    .filter(Boolean)
                    .join("\n")
            )
            .join("\n\n");
        const scored = await ports.structured(
            "score",
            FitBatchSchema,
            FIT_SYSTEM,
            `ORGANISATION PROFILE\n${formatProfileBlock(input.profile)}\n\nOPPORTUNITIES\n${listing}`,
            "funder_fit"
        );
        modelId = scored.modelId;
        for (const s of scored.result.scores)
            fits.set(s.externalId, {
                score: s.score,
                why: s.why.slice(0, 4),
                concerns: s.concerns.slice(0, 4),
            });
    }
    input.onStep?.("score", `${fits.size} scored`);
    const scored = found.opportunities
        .map(opportunity => ({ opportunity, fit: fits.get(opportunity.externalId) ?? null }))
        .sort((a, b) => (b.fit?.score ?? -1) - (a.fit?.score ?? -1));
    return { plan, scored, sources: found.sources, modelId };
}

// ─── Extract ─────────────────────────────────────────────────────────────────

export const MAX_REQUEST_CHARS = 60_000;

export interface ExtractInput {
    text: string;
    /** Named when the request came from a URL, for the model's context. */
    sourceLabel?: string | null;
}

export async function extractRequest(
    ports: ProposalPorts,
    input: ExtractInput
): Promise<{ extracted: ExtractedRequest; requirements: Requirement[]; modelId: string }> {
    const text = input.text.replace(/\r\n/g, "\n").trim();
    if (text.length < 40) throw new Error("The request is too short to read anything from.");
    const clipped =
        text.length > MAX_REQUEST_CHARS
            ? `${text.slice(0, MAX_REQUEST_CHARS)}\n\n[truncated]`
            : text;
    const { result, modelId } = await ports.structured(
        "extract",
        ExtractedRequestSchema,
        EXTRACT_SYSTEM,
        `${input.sourceLabel ? `SOURCE: ${input.sourceLabel}\n\n` : ""}FUNDER'S REQUEST\n${clipped}`,
        "grant_request"
    );
    const extracted = sanitizeExtracted(result);
    return { extracted, requirements: requirementsFromExtracted(extracted), modelId };
}

// ─── Draft ───────────────────────────────────────────────────────────────────

export interface DraftSectionInput {
    companyId: number;
    application: Pick<ApplicationRecord, "title" | "funder" | "extracted">;
    section: Pick<SectionRecord, "key" | "question" | "guidance" | "wordLimit">;
    profile: OrgProfile | null;
    library: LibraryItemRecord[];
    scope?: DocumentScope;
}

export interface DraftSectionResult {
    draft: string;
    meta: DraftMeta;
}

export async function draftSection(
    ports: ProposalPorts,
    input: DraftSectionInput
): Promise<DraftSectionResult> {
    const question = `${input.section.question}${input.section.guidance ? ` ${input.section.guidance}` : ""}`;
    const focus = input.profile?.focusAreas.slice(0, 3).join(" ") ?? "";
    const results = await ports.retrieve({
        companyId: input.companyId,
        query: `${question} ${focus}`.trim(),
        policy: DRAFT_POLICY,
        scope: input.scope,
    });
    const evidence: Evidence[] = numberEvidence(results);
    const matches = matchLibrary(input.section.question, input.library);
    const request = input.application.extracted;

    const user = [
        `FUNDER: ${input.application.funder ?? request?.funder ?? "unknown"}`,
        `APPLICATION: ${input.application.title}`,
        request?.summary ? `ABOUT THE CALL: ${request.summary}` : "",
        request?.eligibility.length ? `ELIGIBILITY: ${request.eligibility.join("; ")}` : "",
        "",
        `QUESTION: ${input.section.question}`,
        input.section.guidance ? `GUIDANCE: ${input.section.guidance}` : "",
        input.section.wordLimit
            ? `WORD LIMIT: ${input.section.wordLimit}`
            : "WORD LIMIT: none stated; keep it under 400 words",
        "",
        `ORGANISATION PROFILE`,
        formatProfileBlock(input.profile),
        "",
        `NUMBERED EVIDENCE`,
        formatEvidenceBlock(evidence, "(no excerpts were retrieved for this question)"),
        "",
        `SAVED ANSWERS`,
        formatLibraryBlock(matches),
    ]
        .filter(line => line !== "")
        .join("\n");

    const { result, modelId } = await ports.structured(
        "draft",
        DraftResultSchema,
        DRAFT_SYSTEM,
        user,
        "section_draft"
    );
    const draft = result.draft.trim();
    return {
        draft,
        meta: {
            cites: validCites(result.cites, evidence),
            gaps: result.gaps
                .map(g => g.trim())
                .filter(Boolean)
                .slice(0, 8),
            evidence,
            libraryItemIds: matches.map(m => m.item.id),
            modelId,
            promptVersion: PROPOSALS_PROMPT_VERSION,
            draftedAt: ports.now().toISOString(),
        },
    };
}

// ─── Rewrite ─────────────────────────────────────────────────────────────────

/** The instruction each preset stands for; `custom` uses the person's words. */
export function rewriteInstruction(
    preset: RewritePreset,
    custom: string | undefined,
    wordLimit: number | null
): string {
    switch (preset) {
        case "tighten":
            return wordLimit
                ? `Tighten it to at most ${wordLimit} words without losing any fact.`
                : "Tighten it: cut a third of the words without losing any fact.";
        case "specific":
            return "Make it more specific: replace general claims with the numbers, names, dates and places the evidence gives.";
        case "plainer":
            return "Make it plainer: shorter sentences, everyday words, no jargon, same facts.";
        case "stronger":
            return "Make it stronger: lead with the result, cut hedging and throat-clearing, keep every claim supported.";
        case "custom":
            return blankToNull(custom) ?? "Improve it without changing what it claims.";
    }
}

export interface RewriteSectionInput {
    application: Pick<ApplicationRecord, "title" | "funder" | "extracted">;
    section: Pick<
        SectionRecord,
        "key" | "question" | "guidance" | "wordLimit" | "draft" | "draftMeta"
    >;
    profile: OrgProfile | null;
    preset: RewritePreset;
    instruction?: string;
}

/**
 * Revise a section's draft under an instruction, citing only the evidence
 * the draft already had. No retrieval: a rewrite changes how the answer
 * reads, not what it may claim; "Redraft from sources" is for that.
 */
export async function rewriteSection(
    ports: ProposalPorts,
    input: RewriteSectionInput
): Promise<DraftSectionResult> {
    const current = input.section.draft?.trim();
    if (!current) throw new Error("There is no draft to rewrite yet.");
    const evidence = input.section.draftMeta?.evidence ?? [];
    const instruction = rewriteInstruction(
        input.preset,
        input.instruction,
        input.section.wordLimit
    );
    const user = [
        `FUNDER: ${input.application.funder ?? input.application.extracted?.funder ?? "unknown"}`,
        `APPLICATION: ${input.application.title}`,
        "",
        `QUESTION: ${input.section.question}`,
        input.section.guidance ? `GUIDANCE: ${input.section.guidance}` : "",
        input.section.wordLimit ? `WORD LIMIT: ${input.section.wordLimit}` : "",
        "",
        `INSTRUCTION: ${instruction}`,
        "",
        `CURRENT DRAFT (${wordCount(current)} words)`,
        current,
        "",
        `ORGANISATION PROFILE`,
        formatProfileBlock(input.profile),
        "",
        `NUMBERED EVIDENCE`,
        formatEvidenceBlock(
            evidence,
            "(the draft cites no excerpts; do not add figures the profile does not give)"
        ),
    ]
        .filter(line => line !== "")
        .join("\n");
    const { result, modelId } = await ports.structured(
        "rewrite",
        RewriteResultSchema,
        REWRITE_SYSTEM,
        user,
        "section_rewrite"
    );
    return {
        draft: result.draft.trim(),
        meta: {
            cites: validCites(result.cites, evidence),
            gaps: [
                ...new Set([
                    ...(input.section.draftMeta?.gaps ?? []),
                    ...result.gaps.map(g => g.trim()).filter(Boolean),
                ]),
            ].slice(0, 8),
            evidence,
            libraryItemIds: input.section.draftMeta?.libraryItemIds ?? [],
            modelId,
            promptVersion: PROPOSALS_PROMPT_VERSION,
            draftedAt: ports.now().toISOString(),
        },
    };
}

// ─── Review ──────────────────────────────────────────────────────────────────

export interface ReviewInput {
    application: ApplicationRecord;
    sections: SectionRecord[];
    profile: OrgProfile | null;
}

export async function reviewApplication(ports: ProposalPorts, input: ReviewInput): Promise<Review> {
    const now = ports.now();
    const requirements = syncSectionRequirements(input.application.requirements, input.sections);
    const base = deterministicFindings({
        application: { ...input.application, requirements },
        sections: input.sections,
        now,
    });
    const written = input.sections.filter(s => s.draft && s.status !== "empty");
    let modelFindings: Review["findings"] = [];
    let summary = written.length === 0 ? "Nothing has been written yet." : "";
    let modelId: string | undefined;
    if (written.length > 0) {
        const user = [
            `APPLICATION: ${input.application.title} — ${input.application.funder ?? "funder unknown"}`,
            input.application.deadline ? `DEADLINE: ${input.application.deadline}` : "",
            input.application.extracted?.summary
                ? `ABOUT THE CALL: ${input.application.extracted.summary}`
                : "",
            "",
            `REQUIREMENTS`,
            requirements.map(r => `- [${r.done ? "x" : " "}] (${r.kind}) ${r.text}`).join("\n"),
            "",
            `SECTIONS`,
            input.sections
                .map(
                    s =>
                        `## ${s.key} — ${s.question}${s.wordLimit ? ` (limit ${s.wordLimit} words; draft has ${wordCount(s.draft)})` : ""}\n${blankToNull(s.draft) ?? "(empty)"}`
                )
                .join("\n\n"),
            "",
            `ORGANISATION PROFILE`,
            formatProfileBlock(input.profile),
        ]
            .filter(line => line !== "")
            .join("\n");
        const { result, modelId: usedModel } = await ports.structured(
            "review",
            ReviewDraftSchema,
            REVIEW_SYSTEM,
            user,
            "application_review"
        );
        modelId = usedModel;
        summary = result.summary.trim();
        const keys = new Set(input.sections.map(s => s.key));
        modelFindings = result.findings.slice(0, 12).map((f, i) => ({
            id: `model:${f.kind}:${f.sectionKey ?? "all"}:${i}`,
            severity: f.severity,
            kind: f.kind,
            sectionKey: f.sectionKey && keys.has(f.sectionKey) ? f.sectionKey : null,
            message: f.message.trim(),
            suggestion: blankToNull(f.suggestion),
        }));
    }
    return {
        readiness: computeReadiness({ sections: input.sections, requirements }),
        summary,
        findings: mergeFindings(base, modelFindings),
        reviewedAt: now.toISOString(),
        modelId,
        promptVersion: PROPOSALS_PROMPT_VERSION,
    };
}

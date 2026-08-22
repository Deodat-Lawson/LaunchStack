#!/usr/bin/env tsx

/**
 * LIVE / OPT-IN Call Notes A1 configured-model smoke.
 *
 * This script invokes the configured reasoning model once through the same
 * adapter used by the A1 enrichment core. It never imports persistence,
 * lifecycle, KnowledgeNoteSink, or embedding code.
 *
 * Run from apps/web with:
 *   CALL_NOTES_ENRICHMENT_SMOKE=1 pnpm exec tsx scripts/run-call-notes-enrichment-smoke.ts
 */

import "dotenv/config";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { pickNativeStructuredMode, StructuredOutputError } from "@launchstack/core/llm";
import {
    CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
    EnrichedNoteProposalSchema,
    EnrichmentInputSchema,
    EnrichmentResultSchema,
    type EnrichmentInput,
    type EnrichmentResult,
} from "@launchstack/features/call-notes";
import { ZodError } from "zod";

import { EnrichmentProvenanceValidationError } from "../src/server/call-notes/enrichment-validation";

const SMOKE_OPT_IN = "CALL_NOTES_ENRICHMENT_SMOKE";

export function createCallNotesSmokeInput(): EnrichmentInput {
    return EnrichmentInputSchema.parse({
        schemaVersion: CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
        callId: "call-smoke-2026-08-21",
        transcriptFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        transcript: [
            {
                id: "segment-owner-1",
                attemptId: "attempt-smoke-1",
                participantId: "participant-owner",
                speakerName: "Alex Founder",
                providerStartMs: 60_000,
                providerEndMs: 66_000,
                receivedAt: "2026-08-21T09:01:06.000Z",
                receiveOrder: 1,
                text: "We agreed that the onboarding checklist is the next launch blocker.",
                language: "en",
            },
            {
                id: "segment-guest-1",
                attemptId: "attempt-smoke-1",
                participantId: "participant-guest",
                speakerName: "Maya Customer",
                providerStartMs: 72_000,
                providerEndMs: 79_000,
                receivedAt: "2026-08-21T09:01:19.000Z",
                receiveOrder: 2,
                text: "A short walkthrough would help our team complete onboarding before September.",
                language: "en",
            },
            {
                id: "segment-owner-2",
                attemptId: "attempt-smoke-1",
                participantId: "participant-owner",
                speakerName: "Alex Founder",
                providerStartMs: 300_000,
                providerEndMs: 307_000,
                receivedAt: "2026-08-21T09:05:07.000Z",
                receiveOrder: 3,
                text: "I will send the revised onboarding checklist by Friday.",
                language: "en",
            },
            {
                id: "segment-guest-2",
                attemptId: "attempt-smoke-1",
                participantId: "participant-guest",
                speakerName: "Maya Customer",
                providerStartMs: 315_000,
                providerEndMs: 321_000,
                receivedAt: "2026-08-21T09:05:21.000Z",
                receiveOrder: 4,
                text: "That checklist and a short walkthrough should unblock our team.",
                language: "en",
            },
        ],
        gaps: [
            {
                id: "gap-smoke-pause",
                attemptId: "attempt-smoke-1",
                kind: "user_paused",
                startedAt: "2026-08-21T09:02:00.000Z",
                endedAt: "2026-08-21T09:04:00.000Z",
            },
        ],
        bookmarks: [
            {
                id: "bookmark-smoke-decision",
                segmentId: "segment-owner-1",
                comment:
                    "Please preserve the agreed onboarding blocker and connect it to the next action.",
                createdAt: "2026-08-21T09:01:30.000Z",
            },
        ],
        note: {
            documentNoteId: 42021,
            ownerUserId: "user-smoke-owner",
            visibility: "company",
            knowledgeIncluded: false,
            revision: 4,
            title: "Customer onboarding review",
            contentMarkdown:
                "- Reduce onboarding time before September.\n- Follow up on the checklist and walkthrough.",
            contentRich: { type: "doc", content: [] },
            saveState: "saved",
        },
    });
}

function oneLine(value: string, maxLength = 360): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length <= maxLength
        ? normalized
        : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function errorCategory(error: unknown): string {
    if (error instanceof EnrichmentProvenanceValidationError) return "semantic provenance failure";
    if (error instanceof StructuredOutputError) return "structured-output failure";
    if (error instanceof ZodError) return "Zod validation failure";

    const name = error instanceof Error ? error.name : "";
    if (/Configuration|RouteUnavailable|ChatRequest/.test(name)) return "route/config failure";
    return "provider/API failure";
}

function printReport(lines: readonly string[]): void {
    console.log(["CALL NOTES A1 CONFIGURED-MODEL SMOKE", ...lines].join("\n"));
}

function printSuccess(
    result: EnrichmentResult,
    modelId: string,
    structuredPath: string,
    elapsedMs: number
): void {
    const proposal = EnrichedNoteProposalSchema.parse(result.proposal);
    const citations = proposal.bookmarkPassages.flatMap(passage => passage.citations);
    printReport([
        "status: PASS",
        "route: reasoning",
        `resolvedModelId: ${modelId}`,
        "provider/operator metadata: not exposed",
        `promptVersion: ${result.modelMetadata.promptVersion}`,
        `structuredOutputPath: ${structuredPath}`,
        "structuredProposalValidation: PASS",
        "semanticProvenanceValidation: PASS",
        "finalEnrichmentResultValidation: PASS",
        `summary: ${oneLine(proposal.summary)}`,
        `actionItemCount: ${proposal.actionItems.length}`,
        `decisionOrKeyPointCount: ${proposal.chronologicalSections.length}`,
        `bookmarkCitationCount: ${citations.length}`,
        `bookmarkCitationIds: ${citations.map(citation => citation.bookmarkId).join(", ") || "none"}`,
        `elapsedMs: ${Math.round(elapsedMs)}`,
    ]);
}

async function loadSmokeRuntime() {
    const enrichmentModel = await import("../src/server/call-notes/enrichment-model");
    const models = await import("../src/lib/models");
    const environment = await import("../src/env");
    const endpoint = await import("../src/server/chat-endpoint");

    return {
        ConfiguredCallNotesEnrichmentModel: enrichmentModel.ConfiguredCallNotesEnrichmentModel,
        CALL_NOTES_ENRICHMENT_ROUTE: enrichmentModel.CALL_NOTES_ENRICHMENT_ROUTE,
        resolveConfiguredChatModel: models.resolveConfiguredChatModel,
        env: environment.env,
        resolveChatEndpoint: endpoint.resolveChatEndpoint,
    };
}

async function runSmoke(): Promise<void> {
    if (process.env[SMOKE_OPT_IN] !== "1") {
        printReport([
            "status: NOT RUN",
            `opt-in required: set ${SMOKE_OPT_IN}=1 to authorize the single live invocation`,
        ]);
        process.exitCode = 2;
        return;
    }

    const input = createCallNotesSmokeInput();
    const startedAt = performance.now();

    let runtime: Awaited<ReturnType<typeof loadSmokeRuntime>>;
    try {
        runtime = await loadSmokeRuntime();
    } catch (error) {
        printReport([
            "status: FAIL",
            `errorCategory: ${errorCategory(error)}`,
            "route: reasoning",
            "resolvedModelId: unavailable",
            "no model invocation was attempted",
        ]);
        process.exitCode = 1;
        return;
    }

    const {
        ConfiguredCallNotesEnrichmentModel,
        CALL_NOTES_ENRICHMENT_ROUTE,
        resolveConfiguredChatModel,
        env,
        resolveChatEndpoint,
    } = runtime;

    let resolved: ReturnType<typeof resolveConfiguredChatModel>;
    try {
        resolved = resolveConfiguredChatModel({ route: CALL_NOTES_ENRICHMENT_ROUTE });
    } catch (error) {
        printReport([
            "status: FAIL",
            `errorCategory: ${errorCategory(error)}`,
            `route: ${CALL_NOTES_ENRICHMENT_ROUTE}`,
            "resolvedModelId: unavailable",
            "no model invocation was attempted",
        ]);
        process.exitCode = 1;
        return;
    }

    const nativeMode = pickNativeStructuredMode(resolved.behavior.nativeStructuredOutput);
    const structuredPath =
        nativeMode === "json-schema"
            ? "validated JSON fallback (optional/defaulted schema compatibility guard)"
            : nativeMode
              ? `${nativeMode} native structured output`
              : "validated JSON fallback";

    const endpoint = resolveChatEndpoint(env.server);
    if (!endpoint.apiKey && endpoint.baseUrl.includes("generativelanguage.googleapis.com")) {
        printReport([
            "status: FAIL",
            "errorCategory: route/config failure",
            `route: ${CALL_NOTES_ENRICHMENT_ROUTE}`,
            `resolvedModelId: ${resolved.modelId}`,
            "configuration: default Gemini endpoint selected but no chat credential is configured",
            "required configuration: GOOGLE_AI_API_KEY, or CHAT_BASE_URL together with CHAT_API_KEY",
            "no model invocation was attempted",
        ]);
        process.exitCode = 1;
        return;
    }

    try {
        // Exactly one A1 generation call. invokeStructured may perform its one
        // built-in repair attempt; this script never retries the operation.
        const result = await new ConfiguredCallNotesEnrichmentModel().generate(input);
        EnrichmentResultSchema.parse(result);
        printSuccess(result, resolved.modelId, structuredPath, performance.now() - startedAt);
    } catch (error) {
        printReport([
            "status: FAIL",
            `errorCategory: ${errorCategory(error)}`,
            `route: ${CALL_NOTES_ENRICHMENT_ROUTE}`,
            `resolvedModelId: ${resolved.modelId}`,
            `elapsedMs: ${Math.round(performance.now() - startedAt)}`,
            "no retry was attempted by the smoke script",
        ]);
        process.exitCode = 1;
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    await runSmoke();
}

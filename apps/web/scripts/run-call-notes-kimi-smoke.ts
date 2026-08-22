#!/usr/bin/env tsx

/**
 * LIVE / OPT-IN developer Kimi Call Notes smoke.
 *
 * This uses an in-memory model configuration and the existing OpenAI-compatible
 * transport. It never changes the production reasoning route or writes app
 * state. Run from apps/web with:
 *
 *   CALL_NOTES_KIMI_SMOKE=1 pnpm exec tsx scripts/run-call-notes-kimi-smoke.ts
 */

import "dotenv/config";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { StructuredOutputError } from "@launchstack/core/llm";
import {
    EnrichedNoteProposalSchema,
    EnrichmentResultSchema,
} from "@launchstack/features/call-notes";
import { ZodError } from "zod";

import { EnrichmentProvenanceValidationError } from "../src/server/call-notes/enrichment-validation";
import { createCallNotesSmokeInput } from "./run-call-notes-enrichment-smoke";
import {
    KimiSmokeEnrichmentModel,
    readKimiSmokeConfig,
    type KimiSmokeConfig,
} from "./call-notes-kimi-smoke-adapter";

const KIMI_SMOKE_OPT_IN = "CALL_NOTES_KIMI_SMOKE";

function safeBaseUrl(value: string): string {
    try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`.replace(/\/$/, "");
    } catch {
        return "invalid-url";
    }
}

export interface SafeKimiDiagnostic {
    errorClass: string;
    httpStatus?: number;
    providerErrorType?: string;
    providerErrorCode?: string;
    providerErrorMessage?: string;
    requestUrl: string;
    responsePhase: "before_http_response" | "after_http_response" | "unknown";
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
    return typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;
}

function firstRecord(...values: unknown[]): UnknownRecord | undefined {
    return values.map(asRecord).find((value): value is UnknownRecord => value !== undefined);
}

function safeText(value: unknown, maxLength = 500): string | undefined {
    if (typeof value !== "string" || value.length === 0) return undefined;
    const redacted = value
        .replace(
            /(["']?(?:authorization|bearer|api[_ -]?key|token|secret)["']?)\s*[:=]\s*["']?[^\s,;"'}]+/gi,
            "$1=[redacted]"
        )
        .replace(/\b(?:sk|key|token|secret)[-_][A-Za-z0-9._~-]{8,}\b/gi, "[redacted]");
    return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength - 1)}…`;
}

function numberField(...values: unknown[]): number | undefined {
    for (const value of values) {
        if (typeof value === "number" && Number.isInteger(value)) return value;
        if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
    }
    return undefined;
}

function safeRequestUrl(baseUrl: string): string {
    try {
        const url = new URL(baseUrl);
        return `${url.origin}${url.pathname.replace(/\/$/, "")}/chat/completions`;
    } catch {
        return "invalid-url/chat/completions";
    }
}

function diagnosticText(diagnostic: SafeKimiDiagnostic): string {
    return [
        diagnostic.providerErrorType,
        diagnostic.providerErrorCode,
        diagnostic.providerErrorMessage,
        diagnostic.errorClass,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
}

export function normalizeKimiDiagnostic(
    error: unknown,
    config: KimiSmokeConfig
): SafeKimiDiagnostic {
    const root = asRecord(error);
    const cause = asRecord(root?.cause);
    const response = firstRecord(root?.response, cause?.response);
    const body = firstRecord(root?.body, cause?.body, response?.body);
    const providerError = firstRecord(root?.error, cause?.error, body?.error);
    const errorClass =
        error instanceof Error && error.constructor.name !== "Error"
            ? error.constructor.name
            : error instanceof Error
              ? error.name
              : typeof error;
    const httpStatus = numberField(
        root?.status,
        root?.statusCode,
        cause?.status,
        cause?.statusCode,
        response?.status,
        providerError?.status
    );
    const providerErrorType = safeText(providerError?.type ?? root?.type ?? cause?.type, 120);
    const providerErrorCode = safeText(providerError?.code ?? root?.code ?? cause?.code, 120);
    const providerErrorMessage = safeText(
        providerError?.message ?? body?.message ?? root?.message ?? cause?.message
    );
    const text = [providerErrorType, providerErrorCode, providerErrorMessage]
        .filter(Boolean)
        .join(" ");

    return {
        errorClass,
        ...(httpStatus === undefined ? {} : { httpStatus }),
        ...(providerErrorType === undefined ? {} : { providerErrorType }),
        ...(providerErrorCode === undefined ? {} : { providerErrorCode }),
        ...(providerErrorMessage === undefined ? {} : { providerErrorMessage }),
        requestUrl: safeRequestUrl(config.baseUrl),
        responsePhase:
            httpStatus !== undefined || providerError || response
                ? "after_http_response"
                : /fetch failed|econn|enotfound|etimedout|socket hang up|timeout|timed ?out|network/i.test(
                        text
                    )
                  ? "before_http_response"
                  : "unknown",
    };
}

export function classifyKimiFailure(error: unknown, diagnostic: SafeKimiDiagnostic): string {
    if (error instanceof EnrichmentProvenanceValidationError) return "semantic_provenance";
    if (error instanceof StructuredOutputError) return "structured_output";
    if (error instanceof ZodError) return "schema_validation";

    const text = diagnosticText(diagnostic);
    const status = diagnostic.httpStatus;
    if (
        status === 401 ||
        status === 403 ||
        /authentication|unauthorized|invalid api key|credential/.test(text)
    ) {
        return "credential/authentication";
    }
    if (
        status === 402 ||
        /billing|insufficient balance|insufficient funds|payment required/.test(text)
    ) {
        return "quota/billing";
    }
    if (status === 429) return /quota|balance|billing/.test(text) ? "quota/billing" : "rate_limit";
    if (status === 404 && /model|deployment|engine/.test(text)) return "model_not_found";
    if (
        /model[_ -]?not[_ -]?found|unknown model|does not exist|no such model|invalid model/.test(
            text
        )
    ) {
        return "model_not_found";
    }
    if (diagnostic.responsePhase === "before_http_response") return "network";
    if (status !== undefined && status >= 500) return "provider_internal";
    if (status === 400) {
        return /response[_ -]?format|json schema|structured|tool/.test(text)
            ? "transport_compatibility"
            : "invalid_request";
    }
    if (/response[_ -]?format|json schema|structured|tool calling/.test(text)) {
        return "transport_compatibility";
    }
    if (status !== undefined && status >= 400) return "endpoint";
    return "unknown";
}

function report(lines: readonly string[]): void {
    console.log(["CALL NOTES A3 KIMI SMOKE", ...lines].join("\n"));
}

async function run(): Promise<void> {
    if (process.env[KIMI_SMOKE_OPT_IN] !== "1") {
        report([
            "status: NOT RUN",
            `opt-in required: set ${KIMI_SMOKE_OPT_IN}=1 to authorize the single live Kimi attempt`,
        ]);
        process.exitCode = 2;
        return;
    }

    let config;
    try {
        config = readKimiSmokeConfig();
    } catch {
        report([
            "status: FAIL",
            "provider: Kimi / Moonshot",
            "endpoint: https://api.moonshot.ai/v1",
            "model: unavailable",
            `failureClass: credential/authentication`,
            "actualLiveRequest: false",
            "no provider request was attempted",
        ]);
        process.exitCode = 1;
        return;
    }

    const adapter = new KimiSmokeEnrichmentModel(config);
    const input = createCallNotesSmokeInput();
    const startedAt = performance.now();

    try {
        // Exactly one adapter generation attempt. The shared structured-output
        // layer may perform its one built-in repair request; this script never
        // retries the generation operation.
        const result = await adapter.generate(input);
        const finalResult = EnrichmentResultSchema.parse(result);
        const proposal = EnrichedNoteProposalSchema.parse(finalResult.proposal);
        const citations = proposal.bookmarkPassages.flatMap(passage => passage.citations);

        report([
            "status: PASS",
            "provider: Kimi / Moonshot",
            `endpoint: ${safeBaseUrl(config.baseUrl)}`,
            `model: ${config.model}`,
            `actualLiveRequest: ${adapter.providerRequestAttempted}`,
            "invocationPath: EnrichmentInput -> production A1 prompt -> developer Kimi adapter -> shared structured output -> provenance validator -> EnrichmentResult",
            `structuredOutputPath: ${adapter.structuredOutputPath}`,
            `promptVersion: ${finalResult.modelMetadata.promptVersion}`,
            "provider/operator metadata: kimi-smoke (local output label only; not persisted)",
            "structuredProposalValidation: PASS",
            "semanticProvenanceValidation: PASS",
            "finalEnrichmentResultValidation: PASS",
            `proposalSummary: ${proposal.summary.replace(/\s+/g, " ").trim().slice(0, 360)}`,
            `actionItems: ${proposal.actionItems.length}`,
            `keyDecisionsOrPoints: ${proposal.chronologicalSections.length}`,
            `bookmarkCitations: ${citations.length} (${citations.map(citation => citation.bookmarkId).join(", ") || "none"})`,
            `elapsedMs: ${Math.round(performance.now() - startedAt)}`,
            "persistenceMutation: false",
        ]);
    } catch (error) {
        const diagnostic = normalizeKimiDiagnostic(error, config);
        report([
            "status: FAIL",
            "provider: Kimi / Moonshot",
            `endpoint: ${safeBaseUrl(config.baseUrl)}`,
            `model: ${config.model}`,
            `actualLiveRequest: ${adapter.providerRequestAttempted}`,
            `failureClass: ${classifyKimiFailure(error, diagnostic)}`,
            `elapsedMs: ${Math.round(performance.now() - startedAt)}`,
            `errorClass: ${diagnostic.errorClass}`,
            ...(diagnostic.httpStatus === undefined
                ? []
                : [`httpStatus: ${diagnostic.httpStatus}`]),
            ...(diagnostic.providerErrorType === undefined
                ? []
                : [`providerErrorType: ${diagnostic.providerErrorType}`]),
            ...(diagnostic.providerErrorCode === undefined
                ? []
                : [`providerErrorCode: ${diagnostic.providerErrorCode}`]),
            ...(diagnostic.providerErrorMessage === undefined
                ? []
                : [`providerErrorMessage: ${diagnostic.providerErrorMessage}`]),
            `requestUrl: ${diagnostic.requestUrl}`,
            `responsePhase: ${diagnostic.responsePhase}`,
            "no retry was attempted by the smoke script",
            "persistenceMutation: false",
        ]);
        process.exitCode = 1;
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    await run();
}

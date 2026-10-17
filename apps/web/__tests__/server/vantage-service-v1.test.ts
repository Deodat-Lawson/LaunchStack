import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const mockLoad = jest.fn(),
    mockSave = jest.fn();
jest.mock("@launchstack/pipelines/vantage", () => ({
    generationSnapshot: (...args: unknown[]) => mockLoad(...args),
    saveGeneration: (...args: unknown[]) => mockSave(...args),
    reportPeriod: () => ({ weekStart: "2026-10-12" }),
    VantageError: class extends Error {
        readonly status: number;
        readonly code: string;
        constructor(message: string, status: number, code: string) {
            super(message);
            this.status = status;
            this.code = code;
        }
    },
}));
jest.mock("~/lib/models", () => ({ resolveConfiguredChatModel: jest.fn() }));
import { prepareWeekV1, validateGenerationResult } from "~/server/vantage/service-v1";
import type { GenerationInput, GenerationResult } from "@launchstack/pipelines/vantage";
const examples = JSON.parse(
    readFileSync(
        resolve(__dirname, "../../../../docs/design/examples/weekly-decision-agenda-v1.json"),
        "utf8"
    )
).internal;
let input: GenerationInput, result: GenerationResult;
beforeEach(() => {
    jest.clearAllMocks();
    input = structuredClone(examples.input);
    result = structuredClone(examples.success);
    mockLoad.mockResolvedValue({ input, expectedReportFingerprint: "report-1" });
    mockSave.mockResolvedValue({ id: "saved" });
});
it("validates the frozen normal and fallback examples", () => {
    expect(validateGenerationResult(input, result).execution.mode).toBe("ai");
    expect(validateGenerationResult(input, examples.fallback).execution.mode).toBe("rules");
    expect(validateGenerationResult(examples.emptyInput, examples.empty).execution.outcome).toBe(
        "empty"
    );
    expect(
        validateGenerationResult(examples.enrichmentInput, examples.enrichment).enhancements
    ).toHaveLength(1);
});
it("rejects a result belonging to a different run before mockSave", async () => {
    result.runId = "other";
    await expect(
        prepareWeekV1({ companyId: 42n, userId: "u" }, { generate: async () => result })
    ).rejects.toMatchObject({ code: "generation_failed" });
    expect(mockSave).not.toHaveBeenCalled();
});
it("reconstructs source labels and marks unknown citations unsupported", () => {
    result.draft.topics[0]!.facts[0]!.refs = [{ ref: "ev:unknown", label: "invented", date: null }];
    const validated = validateGenerationResult(input, result);
    expect(validated.draft.topics[0]!.facts[0]).toMatchObject({ refs: [], unsupported: true });
});
it("rejects an enhancement targeting a topic not supplied for review", () => {
    result.enhancements = structuredClone(examples.enrichment.enhancements);
    expect(() => validateGenerationResult(input, result)).toThrow("Enhancement");
});
it("revalidates access before saving and keeps its input immutable", async () => {
    const revalidate = jest.fn().mockResolvedValue(undefined);
    await prepareWeekV1(
        { companyId: 42n, userId: "u" },
        {
            generate: async supplied => {
                supplied.data.currentEvidence = [];
                return result;
            },
            revalidate,
        }
    );
    expect(revalidate).toHaveBeenCalled();
    expect(input.data.currentEvidence).toHaveLength(1);
    expect(mockSave).toHaveBeenCalledTimes(1);
});
it("preserves state when access is revoked", async () => {
    await expect(
        prepareWeekV1(
            { companyId: 42n, userId: "u" },
            {
                generate: async () => result,
                revalidate: async () => {
                    throw new Error("revoked");
                },
            }
        )
    ).rejects.toMatchObject({ code: "generation_failed" });
    expect(mockSave).not.toHaveBeenCalled();
});
it("does not fabricate success when B has not connected the generation port", async () => {
    await expect(prepareWeekV1({ companyId: 42n, userId: "u" })).rejects.toMatchObject({
        status: 503,
        code: "generation_unavailable",
    });
    expect(mockSave).not.toHaveBeenCalled();
});

function metricChange(): GenerationResult["signals"]["metricChanges"][number] {
    const definition = input.data.metricDefinitions[0]!;
    const pick = (o: GenerationInput["data"]["currentObservations"][number]) => ({
        observationId: o.id,
        value: o.value,
        periodStart: o.periodStart,
        periodEnd: o.periodEnd,
    });
    return {
        metricId: definition.id,
        key: definition.key,
        name: definition.name,
        unit: definition.unit,
        definition: definition.definition,
        latest: pick(input.data.currentObservations[0]!),
        previous: pick(input.data.comparisonObservations[0]!),
        delta: 20,
        pct: 0.2,
        direction: "up",
        notable: true,
    };
}

it("accepts source-matching current and comparable observations", () => {
    result.signals.metricChanges = [metricChange()];
    expect(validateGenerationResult(input, result).signals.metricChanges).toHaveLength(1);
});

it.each([
    "recentEvidenceIds",
    "overdueCommitmentIds",
    "dueThisWeekCommitmentIds",
    "resolvedCommitmentIds",
] as const)("rejects a signal outside the supplied %s collection before saving", async field => {
    result.signals[field] = ["foreign-or-out-of-period"];
    await expect(
        prepareWeekV1({ companyId: 42n, userId: "u" }, { generate: async () => result })
    ).rejects.toMatchObject({ code: "generation_failed" });
    expect(mockSave).not.toHaveBeenCalled();
});

it("rejects malformed metric signals instead of trusting unknown objects", () => {
    result.signals.metricChanges = [null as never];
    expect(() => validateGenerationResult(input, result)).toThrow("invalid structured data");
});

it("rejects a prior-period observation presented as current", () => {
    const change = metricChange();
    change.latest = change.previous!;
    result.signals.metricChanges = [change];
    expect(() => validateGenerationResult(input, result)).toThrow("supplied data");
});

it("rejects a current observation presented as comparison context", () => {
    const change = metricChange();
    change.previous = change.latest;
    result.signals.metricChanges = [change];
    expect(() => validateGenerationResult(input, result)).toThrow("supplied data");
});

it("rejects fabricated metric values even when the observation ID exists", () => {
    const change = metricChange();
    change.latest.value = 9999;
    result.signals.metricChanges = [change];
    expect(() => validateGenerationResult(input, result)).toThrow("supplied data");
});

it("rejects conflicts containing foreign observations", () => {
    const change = metricChange();
    result.signals.metricConflicts = [
        {
            metricId: change.metricId,
            key: change.key,
            name: change.name,
            a: { ...change.latest, source: input.data.currentObservations[0]!.source },
            b: { ...change.latest, observationId: "foreign", source: null },
        },
    ];
    expect(() => validateGenerationResult(input, result)).toThrow("supplied data");
});

it("rejects claiming that a supplied current metric has no data", () => {
    const definition = input.data.metricDefinitions[0]!;
    result.signals.metricsWithoutData = [
        { metricId: definition.id, key: definition.key, name: definition.name },
    ];
    expect(() => validateGenerationResult(input, result)).toThrow("supplied data");
});

it("rejects inflated counts and repeated evidence IDs", () => {
    result.signals.newEvidence[0]!.count = 20;
    expect(() => validateGenerationResult(input, result)).toThrow("supplied data");
    result.signals.newEvidence[0]!.count = 1;
    result.signals.recentEvidenceIds.push(result.signals.recentEvidenceIds[0]!);
    expect(() => validateGenerationResult(input, result)).toThrow("supplied data");
});

it("strips uncontracted signal fields before persistence", () => {
    const raw = structuredClone(result);
    Object.assign(raw.signals, { unrelatedPrivatePayload: "must not be stored" });
    expect(validateGenerationResult(input, raw).signals).not.toHaveProperty(
        "unrelatedPrivatePayload"
    );
});

it.each([
    { fallbackReason: "timeout" },
    { attempts: 0 },
    { modelId: null },
    { durationMs: 45001 },
    { promptVersion: "" },
])("rejects contradictory or out-of-budget AI execution metadata: %p", patch => {
    Object.assign(result.execution, patch);
    expect(() => validateGenerationResult(input, result)).toThrow();
});

it("accepts explicit rules without presenting them as provider failure", () => {
    input.generationMode = "rules";
    result = structuredClone(examples.fallback);
    result.execution.fallbackReason = null;
    result.execution.attempts = 0;
    result.draft.modelMetadata = { mode: "rules" };
    expect(validateGenerationResult(input, result).execution.mode).toBe("rules");
});

it("rejects implicit rules success without a fallback reason", () => {
    result = structuredClone(examples.fallback);
    result.execution.fallbackReason = null;
    expect(() => validateGenerationResult(input, result)).toThrow("metadata");
});

it("accepts no-model fallback only without provider attempts", () => {
    result = structuredClone(examples.fallback);
    result.execution.fallbackReason = "no-model";
    result.execution.attempts = 0;
    expect(validateGenerationResult(input, result).execution.mode).toBe("rules");
    result.execution.attempts = 1;
    expect(() => validateGenerationResult(input, result)).toThrow("metadata");
});

it("does not label an empty-input response as a provider failure", () => {
    const empty = structuredClone(examples.empty);
    empty.execution.fallbackReason = "no-model";
    expect(() => validateGenerationResult(examples.emptyInput, empty)).toThrow("metadata");
});

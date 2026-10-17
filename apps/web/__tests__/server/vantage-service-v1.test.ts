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

import { describe, expect, it, vi } from "vitest";
import semantic from "../../../../fixtures/vantage-pipeline-edge-cases/semantic-cases.json";
import { prepareLivePilotContext } from "../evaluation-live/pilot-context";
import type { JosephSemanticCase } from "../evaluation-integration/joseph-adapter";
import { normalizeGenerationV2 } from "../validate-generation-v2";
import {
    buildFinanceMilestoneCompound,
    evaluateFinanceMilestoneReport,
    runFinanceMilestoneGeneration,
} from "./finance-milestone-v1";

/** Component-only synthetic fixture. Real DB/auth/persistence acceptance belongs to the host suite. */
async function fixture() {
    const scenario = semantic.cases.find(item => item.id === "conflicting-metrics")!;
    const context = await prepareLivePilotContext(scenario as JosephSemanticCase);
    const finance = context.prepared.documents.find(
        document => document.originalId === "finance"
    )!.source;
    const sales = context.prepared.documents.find(
        document => document.originalId === "sales"
    )!.source;
    return { envelope: context.envelope, sourceRefs: { finance, sales } };
}

describe("Finance milestone replay component (synthetic envelope only)", () => {
    it("runs the corrected compound through real V2 normalization with one injected call", async () => {
        const input = await fixture();
        const result = await runFinanceMilestoneGeneration(input);
        expect(result.outcome, JSON.stringify(result)).toBe("v2-first-pass");
        expect(result.trace.invocations).toBe(1);
        expect(result.trace.transport).toBe("deterministic-injected-no-provider");
        expect(result.output).not.toBeNull();
        expect(
            evaluateFinanceMilestoneReport(result.output!.report, input.sourceRefs)
        ).toMatchObject({ passed: true, modelJudgeUsed: false });
        expect(result.trace.compound.native.topics).toEqual([]);
    });
    it("runs with external fetch disabled", async () => {
        const deniedFetch = vi.fn(() => {
            throw new Error("External network forbidden in milestone replay");
        });
        vi.stubGlobal("fetch", deniedFetch);
        try {
            const result = await runFinanceMilestoneGeneration(await fixture());
            expect(result.outcome).toBe("v2-first-pass");
            expect(deniedFetch).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });
    it("rejects a source version absent from the frozen envelope before invocation", async () => {
        const input = await fixture();
        input.sourceRefs.finance = { ...input.sourceRefs.finance, version: "unregistered-version" };
        expect(() => buildFinanceMilestoneCompound(input.envelope, input.sourceRefs)).toThrow();
    });
    it("rejects swapped financial source bindings", async () => {
        const input = await fixture();
        expect(() =>
            buildFinanceMilestoneCompound(input.envelope, {
                finance: input.sourceRefs.sales,
                sales: input.sourceRefs.finance,
            })
        ).toThrow("milestone source text");
    });
    it("keeps semantic omission distinct from structurally valid normalization", async () => {
        const input = await fixture();
        const pair = buildFinanceMilestoneCompound(input.envelope, input.sourceRefs, "omission");
        const normalized = normalizeGenerationV2(pair, input.envelope);
        const manual = evaluateFinanceMilestoneReport(normalized.report, input.sourceRefs);
        expect(manual.passed).toBe(false);
        expect(manual.issues).toContain(
            "finance: exact amount and qualifications missing from cited facts"
        );
    });
    it("flags unsupported arithmetic even when both exact source facts remain cited", async () => {
        const input = await fixture();
        const report = normalizeGenerationV2(
            buildFinanceMilestoneCompound(input.envelope, input.sourceRefs),
            input.envelope
        ).report;
        report.summary = "Verified revenue is USD 30,000.";
        expect(evaluateFinanceMilestoneReport(report, input.sourceRefs).issues).toContain(
            "unsupported arithmetic across differing revenue definitions"
        );
    });
    it("fails malformed replay once without repair or provider calls", async () => {
        const result = await runFinanceMilestoneGeneration({
            ...(await fixture()),
            variant: "malformed",
        });
        expect(result.outcome).toBe("failed");
        expect(result.output).toBeNull();
        expect(result.trace.invocations).toBe(1);
        expect(result.attempts).toHaveLength(1);
        expect(result.attempts[0]?.stage).toBe("output-schema");
    });
});

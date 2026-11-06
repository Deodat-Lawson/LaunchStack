/** @jest-environment node */
import { randomBytes } from "node:crypto";
import { configureSecretBox } from "@launchstack/store/crypto";
jest.mock("~/lib/require-workspace-context", () => ({ requireWorkspaceContext: jest.fn() }));
jest.mock("~/lib/models", () => ({ resolveConfiguredChatModel: jest.fn() }));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
import { DEMO_METADATA_KEY, openPayload, sealPayload } from "~/server/vantage/demo-service";
import type { DemoReport } from "~/app/employer/tools/vantage/demo-contract";
import { normalizeGenerationV2 } from "../../../../pipelines/src/vantage/validate-generation-v2";
import type { ContextGenerationEnvelopeV0 } from "../../../../pipelines/src/vantage/context-v0/ports";
import c02 from "../../../../fixtures/vantage-generation-v2/C02.compound.json";
import c02Input from "../../../../fixtures/vantage-generation-v2/C02.input.json";
import c05 from "../../../../fixtures/vantage-generation-v2/C05.compound.json";
import c05Input from "../../../../fixtures/vantage-generation-v2/C05.input.json";
import orbit from "../../../../fixtures/vantage-generation-v2/V2-04.compound.json";
import orbitInput from "../../../../fixtures/vantage-generation-v2/V2-04.input.json";
import captured from "~/app/dev/vantage-action-sample/captured-sample.json";

const ref = { kind: "doc" as const, id: "workspace-document/16", version: "16" };
const topic = {
    id: "topic",
    title: "Compare reports",
    facts: [{ text: "QA sampled three.", refs: [ref] }],
    conflicts: [],
    whyItMatters: "Samples may differ.",
    decisionQuestion: "Which accounts overlap?",
    proposedNextStep: "Compare the account lists.",
    unknowns: ["Overlap"],
    rationale: "Comparison needed.",
    status: "suggested" as const,
};
const report: DemoReport = {
    id: "report",
    weekStart: "2026-10-26",
    generatedAt: "2026-11-01T00:00:00Z",
    version: 1,
    summary: "QA reported three accounts.",
    topics: [topic],
    execution: {
        mode: "replay",
        modelId: "fixture",
        promptVersion: "fixture",
        attempts: 1,
        durationMs: 0,
        fallbackReason: null,
    },
    diagnostics: {
        sources: [],
        contextFingerprint: "fixture",
        persisted: true,
        historicalHumanDecisions: 0,
    },
};
const saved = (value: DemoReport) => ({
    schemaVersion: "vantage-context-demo/v1" as const,
    version: 1,
    active: {
        actorId: "actor",
        companyId: "1",
        report: value,
        window: {} as never,
        sources: [],
        nativeInputFingerprint: "fixture",
    },
    history: [],
});
const row = (value: ReturnType<typeof sealPayload>, companyId = 1n) =>
    ({ id: "report", companyId, modelMetadata: { [DEMO_METADATA_KEY]: value } }) as Parameters<
        typeof openPayload
    >[0];

beforeAll(() => configureSecretBox({ key: randomBytes(32).toString("base64") }));
afterAll(() => configureSecretBox({ key: undefined }));

test("legacy and additive report fields survive the encrypted payload and JSON DTO boundary", () => {
    const v2: DemoReport = {
        ...report,
        headline: "Deletion reports differ.",
        brief: "Compare samples before a decision.",
        keyFigures: [{ label: "QA sample", value: "3", tone: "neutral", refs: [ref] }],
        topics: [
            {
                ...topic,
                whyNow: "The reports differ.",
                recommendation: {
                    call: "Compare the lists.",
                    confidence: "medium",
                    because: "Samples may differ.",
                    refs: [ref],
                    wouldChangeIf: "The lists match.",
                },
            },
        ],
    };
    for (const value of [report, v2]) {
        const decoded = openPayload(row(sealPayload(saved(value))));
        expect(JSON.parse(JSON.stringify(decoded?.active.report))).toEqual(value);
    }
});
test("rejects malformed additive fields and mismatched workspace or envelope version", () => {
    expect(() => sealPayload(saved({ ...report, headline: "" }))).toThrow();
    const envelope = sealPayload(saved(report));
    expect(() => openPayload(row(envelope, 2n))).toThrow();
    expect(() => openPayload(row({ ...envelope, version: 2 }))).toThrow();
});

test.each([
    ["C02", c02, c02Input],
    ["C05", c05, c05Input],
    ["V2-04", orbit, orbitInput],
])(
    "%s normalized golden survives encrypted storage and DTO serialization",
    (_name, compound, input) => {
        const normalized = normalizeGenerationV2(
            compound,
            input.envelope as unknown as ContextGenerationEnvelopeV0
        ).report;
        const value: DemoReport = {
            ...report,
            ...normalized,
            topics: normalized.topics.map((t, i) => ({
                ...t,
                id: String(i),
                status: "suggested" as const,
            })),
        };
        const decoded = openPayload(row(sealPayload(saved(value))));
        expect(JSON.parse(JSON.stringify(decoded?.active.report))).toEqual(value);
    }
);

test("captured legacy report round trips without adding fields", () => {
    const value = captured.data.state.report as DemoReport;
    const payload = saved(value);
    const envelope = sealPayload(payload);
    const actual = openPayload({ ...row(envelope), id: value.id } as Parameters<
        typeof openPayload
    >[0]);
    expect(JSON.parse(JSON.stringify(actual?.active.report))).toEqual(value);
    expect(actual?.active.report.headline).toBeUndefined();
});

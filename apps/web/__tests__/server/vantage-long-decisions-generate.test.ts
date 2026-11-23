/** @jest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    validateSpec,
    genericPrompt,
    assembleVersion,
    repetition,
    publicManifest,
    sha256,
    runCanaryThenPool,
    type LongDocument,
    type LongSpec,
} from "../../scripts/vantage-long-decisions-generate-core";
import { createBenchmarkMeter } from "../../scripts/vantage-benchmark-meter";
import type { BenchmarkMeterSnapshot } from "../../scripts/vantage-benchmark-meter";
import {
    validateVersionLabels,
    corpusValidationSummary,
    generationProjection,
    sectionTarget,
    fitSectionParagraphs,
    validateNoHttpRecovery,
    generationProfile,
    proseSpecificity,
    validateDenseSection,
    renderAdministrativeEntries,
} from "../../scripts/vantage-long-decisions-generate-core";

it("prices the v2 corpus with a globally bounded retry allowance below its separate cap", () => {
    const frozen = validateSpec(
        JSON.parse(
            readFileSync(
                resolve(
                    process.cwd(),
                    "../../fixtures/vantage-benchmarks/long-decisions/spec-v2.json"
                ),
                "utf8"
            )
        )
    );
    expect(frozen.documents).toHaveLength(150);
    const versionCount = frozen.documents.flatMap(item => item.versions).length;
    const profile = generationProfile(frozen);
    const projection = generationProjection(frozen, "gpt-6-luna", { input: 0.3, output: 0.9 });
    expect(profile).toMatchObject({
        limitUsd: 5,
        maxOutputTokens: 2400,
        retryLimit: 350,
        concurrency: 5,
    });
    expect(projection.maximumRequests).toBe(versionCount * 5 + profile.retryLimit!);
    expect(projection.worstCaseUsd).toBeLessThan(5);
    expect(generationProfile(spec()).limitUsd).toBe(3);
});

it("keeps dense prompts limited to neutral fields and independently invented administrative facts", () => {
    const prompt = genericPrompt({
        opaqueId: "opaque",
        title: "Neutral memorandum",
        kind: "runbook",
        brief: "Neighboring office activities.",
        section: 1,
        targetBytes: 6000,
        attempt: 0,
        dense: true,
    });
    expect(prompt.system).toContain("JSON array of exactly 15");
    expect(prompt.system).toContain("Invent all facts independently");
    expect(JSON.parse(prompt.user)).not.toHaveProperty("dense");
    expect(JSON.stringify(prompt)).not.toContain(anchor.text);
});
it("renders provider-created dated administrative tuples into coherent varied dense prose", () => {
    const entries = Array.from({ length: 15 }, (_, i) => [
        `2026-10-${String((i % 5) + 1).padStart(2, "0")}`,
        i % 2 ? "Nolan Bell" : "Amira Cross",
        i % 2 ? "retained" : "approved",
        "the separate records cupboard arrangement after the stores coordinator reconciled the local inventory",
        String(i + 7),
        "folders",
        "the clerk kept the sealed inventory together while a colleague checked the cabinet allocation",
        "2026-10-08",
        "the coordinator kept the maintenance note beside the stock record for the next routine handover",
    ]);
    const raw = JSON.stringify(entries);
    const rendered = renderAdministrativeEntries(raw, "2026-10-10T12:00:00Z");
    expect(validateDenseSection(rendered).share).toBeGreaterThanOrEqual(0.85);
    expect(proseSpecificity(rendered).share).toBeLessThanOrEqual(0.9);
    expect(renderAdministrativeEntries("```json\n" + raw + "\n```", "2026-10-10")).toBe(rendered);
    expect(proseSpecificity(rendered).quantitiesWithUnits).toBeGreaterThanOrEqual(15);
    expect(JSON.stringify(entries)).toBe(raw);
    expect(() => renderAdministrativeEntries(raw, "2026-10-03")).toThrow("administration_invalid");
    entries[0]![8] =
        "the clerk invented 20 other quantities to increase the numerical sentence count";
    expect(() => renderAdministrativeEntries(JSON.stringify(entries), "2026-10-10")).toThrow(
        "administration_invalid"
    );
});

it("counts genuine ISO dates and quantities while excluding record identifier digits and headings", () => {
    const data = proseSpecificity(
        "# Heading 345\nOn 2026-10-05, Amira Cross approved 12 chairs.\n\nA 10-day inspection window was retained by Nolan Bell.\n\nRecord PF-8 refers to the same internal form.\n\nThe 2026-02-30 appointment was a transcription error."
    );
    expect(data).toMatchObject({
        sentences: 4,
        numericSentences: 2,
        dateSentences: 1,
        numericOrDateSentences: 2,
        distinctDates: 1,
        quantities: 2,
    });
});

it("requires varied dates, quantities, names, decisions and distributed density after paragraph fitting", () => {
    const dense =
        Array.from(
            { length: 30 },
            (_, i) =>
                `On 2026-10-${String((i % 25) + 1).padStart(2, "0")}, ${i % 2 ? "Nolan Bell" : "Amira Cross"} ${i % 2 ? "retained" : "approved"} ${i + 5} storage trays for a distinct local team.`
        ).join("\n\n") +
        "\n\nThe handover preserves the buyer's administrative discretion.\n\nStaff may request clarification through the usual office channel.\n\nThe separate local procedure continues to apply.";
    expect(validateDenseSection(dense).share).toBeCloseTo(30 / 33);
    expect(() =>
        validateDenseSection(dense.replaceAll(/2026-10-\d\d/g, "the meeting day"))
    ).toThrow("density_invalid");
    expect(() => validateDenseSection(dense.replaceAll(/\d+/g, "several"))).toThrow(
        "density_invalid"
    );
});

const anchor = {
    id: "D01_V01_E01",
    role: "evidence" as const,
    marker: "[[ANCHOR_D01_V01_E01]]",
    text: "A locally inserted synthetic policy statement describes the revised dispatch approval requirement and the accountable review owner, with enough context for a grounded decision in this fixture alone.",
    positionFraction: 0.55,
};
const foreign = {
    ...anchor,
    id: "D02_V01_E01",
    marker: "[[ANCHOR_D02_V01_E01]]",
    text: "This separate exact synthetic policy sentence belongs exclusively to another version and must never leak into a generated body.",
};
const document: LongDocument = {
    id: "D01",
    kind: "policy_review",
    title: "Synthetic operations review",
    brief: "Describe qualitative coordination practices and procedural handoffs.",
    targetBytes: 30000,
    visibility: "actor_readable",
    versions: [{ id: "D01_V01", publishedAt: "2026-09-10T00:00:00Z", anchors: [anchor] }],
};
function sections() {
    return Array.from({ length: 5 }, (_, section) => {
        const paragraphs = [];
        for (let i = 0; i < 36; i++)
            paragraphs.push(
                `Synthetic section ${section} observation ${i} describes an independent operational handoff, its review responsibilities, its procedural exception, and the corresponding maintenance follow-up.`
            );
        return paragraphs.join("\n\n");
    });
}
const spec = (): LongSpec => ({
    schemaVersion: "long-decisions/spec-v1",
    company: { id: "synthetic", name: "Synthetic", fictional: true, domain: "operations" },
    design: {},
    weeks: [{ id: "w3", weekStart: "2026-09-21", cutoff: "2026-09-28T00:00:00Z" }],
    actors: [],
    fixedSources: [
        {
            anchorId: anchor.id,
            documentId: document.id,
            versionId: document.versions[0]!.id,
            purpose: "architecture",
            required: true,
            scope: "anchor_text_only",
            sameAcrossArms: true,
        },
    ],
    documents: [document],
    cases: [{ id: "C01", split: "dev", question: "Which process needs review?" }],
    groups: [{ id: "G01", split: "dev", size: 1, weekId: "w3", caseIds: ["C01"] }],
});

it("accepts the frozen checked-in spec without provider access", () => {
    const value = validateSpec(
        JSON.parse(
            readFileSync(
                resolve(
                    process.cwd(),
                    "../../fixtures/vantage-benchmarks/long-decisions/spec.json"
                ),
                "utf8"
            )
        )
    );
    expect(value.documents).toHaveLength(50);
    expect(value.documents.flatMap(d => d.versions)).toHaveLength(62);
});
it("sends only the narrow generic DTO, with opaque IDs and no cases, positions, marker or exact anchor text", () => {
    const prompt = genericPrompt({
        opaqueId: sha256("D01_V01").slice(0, 16),
        kind: document.kind,
        title: document.title,
        brief: document.brief,
        targetBytes: 6000,
        section: 0,
        attempt: 0,
    });
    const serialized = JSON.stringify(prompt);
    for (const secret of [
        anchor.text,
        anchor.marker,
        "D01_V01",
        spec().cases[0]!.question,
        "positionFraction",
        "caseId",
        "distractors",
    ])
        expect(serialized).not.toContain(secret);
    expect(Object.keys(JSON.parse(prompt.user)).sort()).toEqual(
        [
            "focus",
            "genericBrief",
            "instruction",
            "kind",
            "title",
            "layoutId",
            "section",
            "targetUtf8Bytes",
        ].sort()
    );
});
it("assembles exact-once grounded blocks at interior UTF16 offsets and removes every layout marker", () => {
    const result = assembleVersion(document, document.versions[0]!, sections(), [anchor, foreign]);
    expect(result.bytes).toBeGreaterThanOrEqual(25000);
    expect(result.bytes).toBeLessThanOrEqual(35000);
    expect(result.text).not.toContain("[[ANCHOR_");
    const span = result.anchors[0]!;
    expect(result.text.slice(span.start, span.end)).toBe(anchor.text);
    expect(span.fraction).toBeGreaterThanOrEqual(0.3);
    expect(span.end / result.text.length).toBeLessThanOrEqual(0.8);
    expect(result.text.split(anchor.text)).toHaveLength(2);
    expect(assembleVersion(document, document.versions[0]!, sections(), [anchor, foreign])).toEqual(
        result
    );
});
it("fails on cross-version leakage and repeated sentence filler", () => {
    const leaked = sections();
    leaked[0] += "\n\n" + foreign.text;
    expect(() =>
        assembleVersion(document, document.versions[0]!, leaked, [anchor, foreign])
    ).toThrow("long_generation_prose_anchor_leak");
    const filler = Array(150)
        .fill("A repeated synthetic sentence contributes no new operational information at all.")
        .join("\n\n");
    expect(repetition(filler).repeatedSentenceRate).toBeGreaterThan(0.9);
    expect(() =>
        assembleVersion(document, document.versions[0]!, Array(5).fill(filler), [anchor])
    ).toThrow("long_generation_document_invalid");
});
it("exports no private labels and minimally expands a short fixed scope to 200 UTF16 characters", () => {
    const assembled = assembleVersion(document, document.versions[0]!, sections(), [anchor]);
    const output = publicManifest(
        spec(),
        "a".repeat(64),
        new Map([[document.versions[0]!.id, assembled]])
    );
    const fixed = output.fixedSources[0]!;
    expect(fixed.textEnd - fixed.textStart).toBeGreaterThanOrEqual(200);
    expect(assembled.text.slice(fixed.textStart, fixed.textEnd)).toContain(anchor.text);
    expect(fixed.textSha256).toBe(sha256(assembled.text.slice(fixed.textStart, fixed.textEnd)));
    expect(fixed).not.toHaveProperty("anchorId");
    const json = JSON.stringify(output);
    for (const secret of [
        anchor.text,
        anchor.marker,
        document.brief,
        "evidence",
        "distractors",
        "positionFraction",
    ])
        expect(json).not.toContain(secret);
    expect(output.groups[0]!.topics[0]).toEqual({
        caseId: "C01",
        question: spec().cases[0]!.question,
    });
});
it("finishes the canary before at most six parallel version tasks", async () => {
    let active = 0,
        peak = 0,
        canaryDone = false;
    await runCanaryThenPool(
        Array.from({ length: 15 }, (_, i) => i),
        async i => {
            if (i) expect(canaryDone).toBe(true);
            active++;
            peak = Math.max(peak, active);
            await new Promise(resolve => setTimeout(resolve, 1));
            active--;
            if (!i) canaryDone = true;
        },
        { concurrency: 6, stop: jest.fn() }
    );
    expect(peak).toBe(6);
});
it("stops new dispatch after a worker failure and awaits every already-started task", async () => {
    const started: number[] = [],
        finished: number[] = [],
        stop = jest.fn();
    await expect(
        runCanaryThenPool(
            [0, 1, 2, 3, 4, 5],
            async i => {
                started.push(i);
                if (i === 1) throw Error("synthetic_failure");
                await Promise.resolve();
                finished.push(i);
            },
            { concurrency: 2, stop }
        )
    ).rejects.toThrow("synthetic_failure");
    expect(started).toEqual([0, 1, 2]);
    expect(finished).toEqual([0, 2]);
    expect(stop).toHaveBeenCalledTimes(1);
});
it("rejects a reservation over $3 before any network dispatch", async () => {
    const send = jest.fn(),
        meter = createBenchmarkMeter({
            limitUsd: 3,
            modelId: "gpt-6-luna",
            endpointUrl: "https://fixture.openai.azure.com/openai/v1/chat/completions",
            pricingSource: "synthetic",
            pricingScope: "synthetic inflated conservative prices",
            promptUsdPerToken: 1,
            cachedPromptUsdPerToken: 1,
            cacheWriteUsdPerToken: 1,
            completionUsdPerToken: 1,
            contextTokens: 32000,
            maxOutputTokens: 4000,
            timeoutMs: 1000,
            persist: async () => {},
        });
    await expect(
        meter.wrapFetch(send)("https://fixture.openai.azure.com/openai/v1/chat/completions", {
            method: "POST",
            body: JSON.stringify({
                model: "gpt-6-luna",
                messages: [{ role: "user", content: "Generic synthetic brief" }],
                max_completion_tokens: 4000,
            }),
        })
    ).rejects.toThrow("benchmark_meter_projected_budget_exceeded");
    expect(send).not.toHaveBeenCalled();
});

it("positions anchors by UTF8 bytes while preserving exact UTF16 source offsets", () => {
    const prose = sections();
    prose[0] = "界".repeat(600) + "\n\n" + prose[0];
    const result = assembleVersion(document, document.versions[0]!, prose, [anchor]);
    const span = result.anchors[0]!;
    expect(span.byteStart).toBe(Buffer.byteLength(result.text.slice(0, span.start)));
    expect(span.byteStart).not.toBe(span.start);
    expect(span.fraction).toBe(span.byteStart / result.bytes);
    expect(Math.abs(span.fraction - anchor.positionFraction)).toBeLessThan(0.04);
});
it("checks individual exact sentences and normalized question/answer wording beyond whole blocks", () => {
    const local = spec(),
        first = "The synthetic controller requires independent review before release.",
        second = "Its evidence is retained for the dispatch coordinator.";
    local.documents[0] = {
        ...document,
        versions: [
            { ...document.versions[0]!, anchors: [{ ...anchor, text: first + " " + second }] },
        ],
    };
    expect(() =>
        validateVersionLabels(local, "D01_V01", first + " " + second + " " + first)
    ).toThrow("long_generation_sentence_label_leak");
    expect(() =>
        validateVersionLabels(local, "OTHER", first.toUpperCase().replaceAll(" ", " - "))
    ).toThrow("long_generation_sentence_label_leak");
    expect(() =>
        validateVersionLabels(
            local,
            "D01_V01",
            first + " " + second + " WHICH PROCESS NEEDS REVIEW!"
        )
    ).toThrow("long_generation_question_leak");
});
it("checks global sentence reuse and emits numeric-only corpus validation", () => {
    const local = spec(),
        first = assembleVersion(document, document.versions[0]!, sections(), [anchor]);
    const summary = corpusValidationSummary(local, new Map([["D01_V01", first]]));
    expect(summary.anchorPositionUnit).toBe("UTF-8 bytes");
    expect(summary.labelLeakFailures).toBe(0);
    expect(JSON.stringify(summary)).not.toContain(anchor.text);
    const other = {
        ...document,
        id: "D02",
        versions: [{ ...document.versions[0]!, id: "D02_V01", anchors: [] }],
    };
    local.documents.push(other);
    const second = assembleVersion(other, other.versions[0]!, sections(), [anchor]);
    expect(() =>
        corpusValidationSummary(
            local,
            new Map([
                ["D01_V01", first],
                ["D02_V01", second],
            ])
        )
    ).toThrow("long_generation_global_repetition_invalid");
});
it("bounds every retry's objective projection below $3 and adapts the final section to prior byte lengths", () => {
    const frozen = validateSpec(
        JSON.parse(
            readFileSync(
                resolve(
                    process.cwd(),
                    "../../fixtures/vantage-benchmarks/long-decisions/spec.json"
                ),
                "utf8"
            )
        )
    );
    const projection = generationProjection(frozen, "gpt-6-luna", { input: 0.3, output: 0.9 });
    expect(projection.maximumRequests).toBe(620);
    expect(projection.worstCaseUsd).toBeLessThan(3);
    const initial = sectionTarget(document, document.versions[0]!);
    expect(
        sectionTarget(document, document.versions[0]!, Array(4).fill("a".repeat(initial + 400)))
    ).toBeLessThan(initial);
    expect(
        sectionTarget(document, document.versions[0]!, Array(4).fill("a".repeat(initial - 400)))
    ).toBeGreaterThan(initial);
});

it("fits a long charged response by removing whole trailing paragraphs without cutting sentences or mutating the original", () => {
    const original = sections()[0]! + "\n\n" + sections()[1]!;
    const saved = original,
        target = 5950;
    const fitted = fitSectionParagraphs(original, target);
    expect(Buffer.byteLength(fitted)).toBeGreaterThanOrEqual(target * 0.85);
    expect(Buffer.byteLength(fitted)).toBeLessThanOrEqual(target * 1.15);
    expect(original).toBe(saved);
    expect(original.startsWith(fitted + "\n\n")).toBe(true);
    expect(fitted.endsWith("follow-up.")).toBe(true);
    expect(fitSectionParagraphs(original, target)).toBe(fitted);
});
it("fails short responses and indivisible oversized paragraphs rather than padding or cutting", () => {
    const short = "A short complete synthetic paragraph supplies too little substantive text.";
    expect(() => fitSectionParagraphs(short, 5950)).toThrow("long_generation_section_invalid");
    expect(() =>
        fitSectionParagraphs(
            sections()[0]!.replaceAll("\n\n", " ") + " " + sections()[1]!.replaceAll("\n\n", " "),
            5950
        )
    ).toThrow("long_generation_section_invalid");
});

const noHttpLedger = (): BenchmarkMeterSnapshot => ({
    limitUsd: 3,
    settledListRateUsd: 0,
    reservedUsd: 0.03,
    projectedTotalUsd: 0.03,
    billingBasis: "Azure list rates applied to native usage; invoice billing unverified",
    pricingSource: "synthetic",
    pricingScope: "synthetic",
    hold: "usage_unresolved",
    records: [
        {
            id: "unknown-1",
            model: "gpt-6-luna",
            status: "unknown",
            inputTokenCeiling: 3000,
            outputTokenCeiling: 4000,
            projectedUsd: 0.03,
            route: "digest",
            failure: "usage_unresolved",
        },
    ],
});
const interrupted = () => [
    {
        file: "D02_V01.s0.a0.json.started",
        promptSha256: "a".repeat(64),
        expectedPromptSha256: "a".repeat(64),
    },
];
it("acknowledges exactly prompt-bound noHTTP attempts while retaining every reserve and record", () => {
    const ledger = noHttpLedger(),
        original = JSON.stringify(ledger);
    const receipt = validateNoHttpRecovery(ledger, interrupted());
    expect(receipt.unknownRecordIds).toEqual(["unknown-1"]);
    expect(receipt.attempts).toEqual([
        { file: interrupted()[0]!.file, promptSha256: "a".repeat(64) },
    ]);
    expect(JSON.stringify(ledger)).toBe(original);
});
it.each(["count", "prompt", "http", "settled", "route", "already_acknowledged", "wrong_hold"])(
    "denies unsafe recovery: %s",
    kind => {
        const ledger = noHttpLedger(),
            attempts = interrupted();
        if (kind === "count")
            attempts.push({ ...attempts[0]!, file: "D03_V01.s0.a0.json.started" });
        if (kind === "prompt") attempts[0]!.expectedPromptSha256 = "b".repeat(64);
        if (kind === "http") ledger.records[0]!.httpStatus = 500;
        if (kind === "settled") ledger.records[0]!.settledListRateUsd = 0.001;
        if (kind === "route") ledger.records[0]!.route = "exploration";
        if (kind === "already_acknowledged")
            ledger.records[0]!.continuedAfterGenerationNoHttp = true;
        if (kind === "wrong_hold") ledger.hold = "provider_error";
        expect(() => validateNoHttpRecovery(ledger, attempts)).toThrow(
            "long_generation_recovery_denied"
        );
    }
);
it("limits recovery pool to two and lets the other in-flight request settle after a sibling failure", async () => {
    const settled: number[] = [],
        started: number[] = [];
    await expect(
        runCanaryThenPool(
            [0, 1, 2, 3],
            async id => {
                started.push(id);
                if (id === 1) throw Error("synthetic_no_http");
                await Promise.resolve();
                settled.push(id);
            },
            { concurrency: 2, stop: () => {} }
        )
    ).rejects.toThrow("synthetic_no_http");
    expect(started).toEqual([0, 1, 2]);
    expect(settled).toEqual([0, 2]);
});

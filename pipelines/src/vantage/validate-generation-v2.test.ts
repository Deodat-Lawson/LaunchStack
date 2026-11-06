import policyCapture from "../../../fixtures/vantage-phase-a-repair/policy-date-capture.json";
import orbit from "../../../fixtures/vantage-generation-v2/V2-04.compound.json";
import orbitInput from "../../../fixtures/vantage-generation-v2/V2-04.input.json";
import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/vantage-generation-v2/C05.input.json";
import c02 from "../../../fixtures/vantage-generation-v2/C02.compound.json";
import c02Input from "../../../fixtures/vantage-generation-v2/C02.input.json";
import golden from "../../../fixtures/vantage-generation-v2/C05.compound.json";
import { normalizeGenerationV2, numericClaimsV2 } from "./validate-generation-v2";
import type { ContextGenerationEnvelopeV0 } from "./context-v0/ports";
const envelope = fixture.envelope as unknown as ContextGenerationEnvelopeV0;
const pair = () => structuredClone(golden);
describe("decision contextual V2 validation", () => {
    it("normalizes Orbit", () => {
        expect(
            normalizeGenerationV2(
                orbit,
                orbitInput.envelope as unknown as ContextGenerationEnvelopeV0
            ).report.topics
        ).toHaveLength(1);
    });
    it("rejects numeric support from an excluded ref", () => {
        const p = pair();
        p.experimental.topics[0]!.facts[0]!.refs.push("obs:D06@v1");
        p.experimental.topics[0]!.facts[0]!.text += " The older stock estimate covers 125 cups.";
        p.experimental.topics[0]!.recommendation.refs = ["doc:D03@v1"];
        p.experimental.topics[0]!.recommendation.call = "Check the 125 cups.";
        expect(() => normalizeGenerationV2(p, envelope)).toThrow(/ungrounded/);
    });
    it("normalizes a complete corrected golden", () => {
        expect(normalizeGenerationV2(pair(), envelope).report.headline).toBe(
            golden.experimental.headline
        );
    });
    it("normalizes C02", () => {
        expect(
            normalizeGenerationV2(c02, c02Input.envelope as unknown as ContextGenerationEnvelopeV0)
                .report.topics
        ).toHaveLength(1);
    });
    it("rejects event-state promotion in headline", () => {
        const e = structuredClone(envelope);
        const p = pair();
        const source = e.evidenceSnapshot.entries.find(x => x.source.id === "D03")!;
        source.excerpt +=
            " The customer requested moving the synthetic pilot start from November 20 to November 27.";
        p.experimental.topics[0]!.facts.push({
            text: "The customer requested moving the synthetic pilot start from November 20 to November 27.",
            refs: ["doc:D03@v1"],
        });
        p.experimental.headline =
            "The customer moved the synthetic pilot start from November 20 to November 27.";
        expect(() => normalizeGenerationV2(p, e)).toThrow(/event-state-promotion/);
    });
    it("rejects ungrounded numbers", () => {
        const p = pair();
        p.experimental.headline = "The order needs 987 cups.";
        expect(() => normalizeGenerationV2(p, envelope)).toThrow(/ungrounded/);
    });
    it("normalizes dates and equivalent quantities without identifier leakage", () => {
        expect(
            numericClaimsV2("Nov 7, 2026 and 1,200 and three and run-17 and D03", "2026")
        ).toEqual(["date:2026-11-07", "number:1200", "number:3"]);
        expect(numericClaimsV2("2026-11-07", "2026")).toEqual(["date:2026-11-07"]);
    });
    it("does not use date components as quantities", () => {
        const p = pair();
        p.experimental.headline = "There are 2026 cups.";
        expect(() => normalizeGenerationV2(p, envelope)).toThrow(/ungrounded/);
    });
    it("rejects recommendation refs outside topic", () => {
        const p = pair();
        p.experimental.topics[0]!.recommendation.refs = ["doc:D02@v1"];
        expect(() => normalizeGenerationV2(p, envelope)).toThrow();
    });
    it("rejects more than three contextual topics", () => {
        const p = pair();
        p.experimental.topics = Array(4).fill(p.experimental.topics[0]);
        expect(() => normalizeGenerationV2(p, envelope)).toThrow();
    });
    it("rejects owner assignment", () => {
        const p = pair();
        Object.assign(p.experimental.topics[0]!, { proposedOwner: "invented" });
        expect(() => normalizeGenerationV2(p, envelope)).toThrow();
    });
    it("verifies difference derivation and rejects incorrect arithmetic", () => {
        const p = pair();
        Object.assign(p.experimental, {
            keyFigures: [
                {
                    label: "Old estimate gap",
                    value: "75 cups",
                    tone: "neutral",
                    refs: ["doc:D03@v1", "obs:D06@v1"],
                    derivation: {
                        op: "difference",
                        inputs: [
                            { value: 200, ref: "doc:D03@v1" },
                            { value: 125, ref: "obs:D06@v1" },
                        ],
                    },
                },
            ],
        });
        expect(normalizeGenerationV2(p, envelope).report.keyFigures).toHaveLength(1);
        (p.experimental.keyFigures as { value: string }[])[0]!.value = "74 cups";
        expect(() => normalizeGenerationV2(p, envelope)).toThrow(/arithmetic|ungrounded/);
    });
    it("rejects division by zero and mismatched input provenance", () => {
        const p = pair();
        Object.assign(p.experimental, {
            keyFigures: [
                {
                    label: "Ratio",
                    value: "0",
                    tone: "neutral",
                    refs: ["doc:D03@v1", "obs:D06@v1"],
                    derivation: {
                        op: "ratio",
                        inputs: [
                            { value: 200, ref: "obs:D06@v1" },
                            { value: 0, ref: "doc:D03@v1" },
                        ],
                    },
                },
            ],
        });
        expect(() => normalizeGenerationV2(p, envelope)).toThrow(/derivation/);
    });
});

describe("V2 source-date attribution from the captured mandatory-policy response", () => {
    const capturedEnvelope = () =>
        structuredClone(policyCapture.envelope) as unknown as ContextGenerationEnvelopeV0;
    const capturedPair = () => structuredClone(policyCapture.compound);
    const releaseRef =
        "doc:joseph-semantic/negation-and-old-mandatory-policy/release-update@synthetic-v1";
    const policyRef =
        "doc:joseph-semantic/negation-and-old-mandatory-policy/january-policy@synthetic-v1";

    it("accepts the exact captured source-date attribution without regrading the old Pilot", () => {
        const original = capturedPair();
        const normalized = normalizeGenerationV2(original, capturedEnvelope());
        expect(normalized.report.brief).toBe(policyCapture.compound.experimental.brief);
        expect(original).toEqual(policyCapture.compound);
    });

    it("does not use a cited source date as an execution date", () => {
        const p = capturedPair();
        p.experimental.brief = "The candidate shipped on October 18.";
        expect(() => normalizeGenerationV2(p, capturedEnvelope())).toThrow(
            /ungrounded date:2026-10-18/
        );
    });

    it("does not launder an event date repeated beside a valid source-date attribution", () => {
        const p = capturedPair();
        p.experimental.brief = "The October 18 release update reports deployment on October 18.";
        expect(() => normalizeGenerationV2(p, capturedEnvelope())).toThrow(
            /ungrounded date:2026-10-18/
        );
    });

    it("does not treat the source date as publication or policy-validity evidence", () => {
        for (const brief of [
            "The policy became valid on October 18.",
            "The release update was published on October 18.",
        ]) {
            const p = capturedPair();
            p.experimental.brief = brief;
            expect(() => normalizeGenerationV2(p, capturedEnvelope())).toThrow(
                /ungrounded date:2026-10-18/
            );
        }
    });

    it("requires an explicit source-date attribution in a cited fact as well as the brief", () => {
        const p = capturedPair();
        p.experimental.topics[0]!.facts[0]!.text =
            "The candidate is not approved and the rollback owner is unassigned.";
        expect(() => normalizeGenerationV2(p, capturedEnvelope())).toThrow(
            /brief: ungrounded date:2026-10-18/
        );
    });

    it("does not borrow metadata from an uncited source", () => {
        const p = capturedPair();
        p.experimental.topics[0]!.facts[0]!.refs = [policyRef];
        expect(() => normalizeGenerationV2(p, capturedEnvelope())).toThrow(
            /brief: ungrounded date:2026-10-18/
        );
    });

    it("rejects stale versions rather than resolving a date through logical IDs", () => {
        const p = capturedPair();
        p.experimental.topics[0]!.facts[0]!.refs = [
            releaseRef.replace("synthetic-v1", "synthetic-v0"),
        ];
        expect(() => normalizeGenerationV2(p, capturedEnvelope())).toThrow(/unregistered/);
    });

    it("does not borrow a future, invalid or mismatched-hash registry date", () => {
        for (const change of ["future", "invalid", "hash"] as const) {
            const e = capturedEnvelope();
            const source = e.manifest.sourceRegistry.find(s =>
                s.source.id.endsWith("/release-update")
            )!;
            if (change === "future") source.sourceDate = "2026-10-20T00:00:00Z";
            if (change === "invalid") source.sourceDate = "2026-02-30T00:00:00Z";
            if (change === "hash")
                Object.assign(source, { contentHash: "not-the-frozen-content-hash" });
            expect(() => normalizeGenerationV2(capturedPair(), e)).toThrow(
                /brief: ungrounded date:2026-10-18/
            );
        }
    });

    it("does not use registry-only metadata missing from the supplied snapshot", () => {
        const e = capturedEnvelope();
        e.evidenceSnapshot = {
            ...e.evidenceSnapshot,
            entries: e.evidenceSnapshot.entries.filter(
                s => !s.source.id.endsWith("/release-update")
            ),
        };
        expect(() => normalizeGenerationV2(capturedPair(), e)).toThrow();
    });

    it("does not substitute ACL-check or retrieval availability timestamps for the source date", () => {
        const e = capturedEnvelope();
        const source = e.manifest.sourceRegistry.find(s =>
            s.source.id.endsWith("/release-update")
        )!;
        source.sourceDate = "2026-10-17T00:00:00Z";
        source.checkedAt = "2026-10-18T12:00:00Z";
        const snapshot = e.evidenceSnapshot.entries.find(s =>
            s.source.id.endsWith("/release-update")
        )!;
        Object.assign(snapshot, {
            provenance: { ...snapshot.provenance, retrievedAt: "2026-10-18T12:00:00Z" },
        });
        expect(() => normalizeGenerationV2(capturedPair(), e)).toThrow(
            /brief: ungrounded date:2026-10-18/
        );
    });

    it("uses the exact timestamp cutoff, not just the source calendar day", () => {
        const e = capturedEnvelope();
        e.manifest.sourceRegistry.find(s => s.source.id.endsWith("/release-update"))!.sourceDate =
            "2026-10-18T18:00:00Z";
        e.evidenceSnapshot = { ...e.evidenceSnapshot, asOf: "2026-10-18T12:00:00Z" };
        expect(() => normalizeGenerationV2(capturedPair(), e)).toThrow(
            /brief: ungrounded date:2026-10-18/
        );
    });

    it("respects each report/snapshot cutoff independently", () => {
        for (const field of ["manifest", "input", "snapshot"] as const) {
            const e = capturedEnvelope();
            if (field === "manifest") e.manifest.reportWindow.asOf = "2026-10-17T12:00:00Z";
            if (field === "input") e.v1Input.reportPeriod.asOf = "2026-10-17T12:00:00Z";
            if (field === "snapshot")
                e.evidenceSnapshot = { ...e.evidenceSnapshot, asOf: "2026-10-17T12:00:00Z" };
            expect(() => normalizeGenerationV2(capturedPair(), e)).toThrow(
                /brief: ungrounded date:2026-10-18/
            );
        }
    });

    it("does not read a date from revoked or hash-mismatched frozen metadata", () => {
        for (const field of ["access", "hash", "acl"] as const) {
            const e = capturedEnvelope();
            if (field === "access")
                e.manifest.sourceRegistry.find(s =>
                    s.source.id.endsWith("/release-update")
                )!.access = "revoked";
            const frozen = e.freeze.sources.find(s => s.ref.id.endsWith("/release-update"))!;
            if (field === "hash") Object.assign(frozen, { contentHash: "stale-content-hash" });
            if (field === "acl") Object.assign(frozen, { aclDigest: "stale-acl" });
            expect(() => normalizeGenerationV2(capturedPair(), e)).toThrow(
                /brief: ungrounded date:2026-10-18/
            );
        }
    });

    it("can attribute an older source date without deciding that the policy is currently valid", () => {
        const p = capturedPair();
        p.experimental.topics[0]!.facts[1]!.text =
            "The policy dated January 15 says not to ship without a rollback owner.";
        p.experimental.brief =
            "The January 15 policy states an owner requirement; its applicability is unconfirmed.";
        expect(normalizeGenerationV2(p, capturedEnvelope()).report.brief).toBe(
            p.experimental.brief
        );
    });

    it("keeps the old policy and original uncertainty without inferring validity or approval", () => {
        const normalized = normalizeGenerationV2(capturedPair(), capturedEnvelope());
        expect(normalized.report.topics[0]!.facts[1]!.refs).toEqual([
            {
                kind: "doc",
                id: "joseph-semantic/negation-and-old-mandatory-policy/january-policy",
                version: "synthetic-v1",
            },
        ]);
        expect(normalized.report.summary).toContain("current applicability is unconfirmed");
        expect(normalized.report.topics[0]!.proposedOwner).toBeNull();
    });
});

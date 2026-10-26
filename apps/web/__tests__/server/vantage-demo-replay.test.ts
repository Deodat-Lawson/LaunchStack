/** @jest-environment node */
import { createHash } from "node:crypto";
import {
    contextSourceKeyV0,
    type ContextGenerationEnvelopeV0,
    type TrustedContextSourceV0,
} from "@launchstack/pipelines/vantage/context-v0";
import fixture from "../../test-fixtures/vantage-context/rich-replay.json";
import {
    bindDemoReplayReport,
    replayCompanyFingerprint,
} from "~/server/vantage/experiments/demo-replay";

function setup() {
    const actor = {
        principalRef: "synthetic-actor",
        companyId: "999",
        aclDigest: "current-acl",
        audience: { kind: "actor", principalRef: "synthetic-actor" },
    };
    const records = fixture.sourceBindings.map((binding, index) => ({
        source: {
            kind: binding.kind,
            id:
                binding.kind === "company"
                    ? "company-metadata/999"
                    : `workspace-document/${900 + index}`,
            version: `current-version-${index}`,
        },
        companyId: actor.companyId,
        access: "allowed",
        aclDigest: actor.aclDigest,
        audience: actor.audience,
        checkedAt: "2026-10-26T23:59:00Z",
        sourceDate: "2026-10-16T16:00:00Z",
        excerpt: binding.recordedExcerpt,
        content: binding.recordedExcerpt,
        contentHash: createHash("sha256").update(binding.recordedExcerpt).digest("hex"),
        provenance: {
            connector: "synthetic-workspace-document",
            locator: `vantage-sophia-synthetic/current-fixture/${binding.fixtureKey}`,
        },
    })) as TrustedContextSourceV0[];
    const envelope = {
        v1Input: {
            reportPeriod: { weekStart: fixture.weekStart },
            data: {
                currentEvidence: fixture.recordedNativeEvidence,
                currentObservations: [],
                comparisonObservations: [],
                resolvedCommitments: [],
                carryForwardCommitments: [],
            },
        },
        manifest: { actor, roleIds: fixture.recordedRoleIds, sourceRegistry: records },
        evidenceSnapshot: { entries: records },
        freeze: { sources: records.map(record => ({ ref: record.source })) },
    } as unknown as ContextGenerationEnvelopeV0;
    return { records, envelope };
}
describe("recorded synthetic context replay", () => {
    it("preserves actual recorded prose and binds citations to exact current registered versions", () => {
        const { records, envelope } = setup();
        const report = bindDemoReplayReport(envelope, records, "current-fixture");
        expect(report.summary).toBe(fixture.report.summary);
        expect(report.topics.map(topic => topic.title)).toEqual(
            fixture.report.topics.map(topic => topic.title)
        );
        const refs = report.topics.flatMap(topic =>
            [...topic.facts, ...topic.conflicts].flatMap(fact => fact.refs)
        );
        expect(refs.some(ref => ref.kind === "company")).toBe(true);
        expect(
            refs.every(ref =>
                records.some(
                    record => contextSourceKeyV0(record.source) === contextSourceKeyV0(ref)
                )
            )
        ).toBe(true);
        expect(JSON.stringify(refs)).not.toContain("company-metadata/2037");
        expect(report.topics.every(topic => topic.proposedOwner === null)).toBe(true);
    });
    it.each([
        "revoked",
        "foreign",
        "acl",
        "missing",
        "version",
        "body",
        "roles",
        "week",
        "new-evidence",
    ])("rejects changed or unavailable %s without producing a replay", change => {
        const { records, envelope } = setup();
        if (change === "revoked") records[1]!.access = "revoked";
        if (change === "foreign") records[1]!.companyId = "foreign";
        if (change === "acl") records[1]!.aclDigest = "old-acl";
        if (change === "missing") records.splice(1, 1);
        if (change === "version")
            envelope.evidenceSnapshot.entries = envelope.evidenceSnapshot.entries.map(
                (entry, index) =>
                    index === 1
                        ? { ...entry, source: { ...entry.source, version: "stale-version" } }
                        : entry
            );
        if (change === "body") records[1]!.excerpt = "A different claim.";
        if (change === "roles") envelope.manifest.roleIds = ["privacy"];
        if (change === "week") envelope.v1Input.reportPeriod.weekStart = "2026-10-05";
        if (change === "new-evidence")
            envelope.v1Input.data.currentEvidence = [
                ...envelope.v1Input.data.currentEvidence,
                {
                    ...envelope.v1Input.data.currentEvidence[0]!,
                    body: "New contradicting evidence.",
                },
            ];
        expect(() => bindDemoReplayReport(envelope, records, "current-fixture")).toThrow();
    });
    it("does not treat company source provenance IDs as portable facts or fabricate review state", () => {
        const body = JSON.parse(fixture.sourceBindings[0]!.recordedExcerpt);
        const original = replayCompanyFingerprint(JSON.stringify(body));
        body.companyId = "another-isolated-fixture";
        for (const fact of body.facts) fact.sources = [];
        expect(replayCompanyFingerprint(JSON.stringify(body))).toBe(original);
        body.facts[0].value = "Different company";
        expect(replayCompanyFingerprint(JSON.stringify(body))).not.toBe(original);
        body.reviewState = "reviewed";
        expect(() => replayCompanyFingerprint(JSON.stringify(body))).toThrow();
    });
});

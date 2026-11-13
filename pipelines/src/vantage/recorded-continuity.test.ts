import { describe, expect, it } from "vitest";
import {
    createRecordedContinuity,
    type ContinuityActor,
    type RecordedContinuityRow,
} from "./recorded-continuity";
const observedAt = "2026-11-13T12:00:00.000Z";
function setup(
    options: {
        now?: Date;
        limits?: { maxObservations?: number; maxRecordBytes?: number; maxAggregateBytes?: number };
    } = {}
) {
    let actor: ContinuityActor = { companyId: "1", userId: "founder" };
    let sourceAllowed = true;
    let reportAllowed = true;
    const row: RecordedContinuityRow = {
        kind: "action_reported_status",
        id: "action-1",
        companyId: "1",
        ownerId: "founder",
        shared: false,
        reportId: "report-1",
        contentVersion: 2,
        recordCreatorUserId: "founder",
        authorUserId: null,
        recordedAt: "2026-11-12T12:00:00.000Z",
        sources: [{ id: "doc-1", contentVersion: "3", contentHash: "source-hash" }],
        content: {
            title: "Call customer",
            decision: null,
            status: "done",
            outcome: "Owner reports customer called",
            resolvedAt: "2026-11-12T12:00:00.000Z",
            owner: "Founder",
            dueOn: "2026-11-12",
            test: "Ask about renewal",
        },
    };
    const continuity = createRecordedContinuity(
        {
            currentActor: async () => actor,
            readRecord: async () => row,
            authorizeReport: async () => reportAllowed,
            authorizeSource: async () => sourceAllowed,
            now: () => options.now ?? new Date(observedAt),
        },
        options.limits
    );
    return {
        row,
        continuity,
        capture: () => continuity.capture(row.kind, row.id),
        setActor: (value: ContinuityActor) => {
            actor = value;
        },
        revokeSource: () => {
            sourceAllowed = false;
        },
        revokeReport: () => {
            reportAllowed = false;
        },
    };
}

describe("recorded continuity offline prototype", () => {
    it("captures frozen current status with version, hash and provenance", async () => {
        const fixture = setup();
        const observation = await fixture.capture();
        expect(observation.contentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(Object.isFrozen(observation.record.sources[0])).toBe(true);
        expect(observation.record).toMatchObject({ contentVersion: 2, authorUserId: null });
        expect(observation.executionVerification).toBe("unknown");
        expect(
            await fixture.continuity.read(observation.id, observation.contentHash, observedAt)
        ).toEqual({ state: "observed_record", observation });
    });
    it("preserves captured done status when reopen clears resolvedAt", async () => {
        const fixture = setup();
        const observation = await fixture.capture();
        fixture.row.content.status = "open";
        fixture.row.content.resolvedAt = null;
        fixture.row.contentVersion = 3;
        const frozen = await fixture.continuity.read(
            observation.id,
            observation.contentHash,
            observedAt
        );
        if (frozen.state !== "observed_record") throw new Error("missing capture");
        expect(frozen.observation.record.content.status).toBe("done");
        const reopened = await fixture.capture();
        expect(reopened.record.content.status).toBe("open");
        expect(reopened.contentHash).not.toBe(observation.contentHash);
    });
    it("returns unknown before capture even if resolvedAt precedes cutoff", async () => {
        const fixture = setup();
        const observation = await fixture.capture();
        expect(
            await fixture.continuity.read(
                observation.id,
                observation.contentHash,
                "2026-11-12T18:00:00Z"
            )
        ).toEqual({ state: "unknown_historical_state" });
    });
    it("retains human decision authors with unknown execution verification", async () => {
        const fixture = setup();
        fixture.row.kind = "human_recorded_decision";
        fixture.row.authorUserId = "founder";
        fixture.row.content.decision = "Proceed with renewal calls";
        fixture.row.content.status = null;
        const observation = await fixture.capture();
        expect(observation.record.kind).toBe("human_recorded_decision");
        expect(observation.record.authorUserId).toBe("founder");
        expect(observation.executionVerification).toBe("unknown");
    });
    it("denies revoked source access for current and historical reads and captures", async () => {
        const fixture = setup();
        const observation = await fixture.capture();
        fixture.revokeSource();
        for (const cutoff of [observedAt, "2026-11-01T00:00:00Z"])
            await expect(
                fixture.continuity.read(observation.id, observation.contentHash, cutoff)
            ).rejects.toThrow("continuity_access_denied");
        await expect(fixture.capture()).rejects.toThrow("continuity_access_denied");
    });
    it("denies revoked report access", async () => {
        const fixture = setup();
        const observation = await fixture.capture();
        fixture.revokeReport();
        await expect(
            fixture.continuity.read(observation.id, observation.contentHash, observedAt)
        ).rejects.toThrow("continuity_access_denied");
    });
    it("isolates companies for shared rows", async () => {
        const fixture = setup();
        fixture.row.shared = true;
        const observation = await fixture.capture();
        fixture.setActor({ companyId: "2", userId: "founder" });
        await expect(fixture.capture()).rejects.toThrow("continuity_access_denied");
        await expect(
            fixture.continuity.read(observation.id, observation.contentHash, observedAt)
        ).rejects.toThrow("continuity_access_denied");
    });
    it("enforces private ownership and permits authorized shared reads", async () => {
        const fixture = setup();
        fixture.setActor({ companyId: "1", userId: "colleague" });
        await expect(fixture.capture()).rejects.toThrow("continuity_access_denied");
        fixture.row.shared = true;
        const observation = await fixture.capture();
        expect(
            (await fixture.continuity.read(observation.id, observation.contentHash, observedAt))
                .state
        ).toBe("observed_record");
        fixture.row.shared = false;
        await expect(
            fixture.continuity.read(observation.id, observation.contentHash, observedAt)
        ).rejects.toThrow("continuity_access_denied");
    });
    it("revalidates original lineage after current row sources change", async () => {
        const fixture = setup();
        const observation = await fixture.capture();
        fixture.row.sources = [];
        fixture.row.contentVersion = 3;
        fixture.revokeSource();
        await expect(
            fixture.continuity.read(observation.id, observation.contentHash, observedAt)
        ).rejects.toThrow("continuity_access_denied");
    });
    it("rejects invalid versions and cutoffs", async () => {
        const fixture = setup();
        const observation = await fixture.capture();
        await expect(
            fixture.continuity.read(observation.id, observation.contentHash, "invalid")
        ).rejects.toThrow("continuity_invalid_cutoff");
        fixture.row.contentVersion = 0;
        await expect(fixture.capture()).rejects.toThrow("continuity_invalid_record");
    });
    it("rejects forged hash and replaced identity", async () => {
        const fixture = setup();
        const observation = await fixture.capture();
        await expect(
            fixture.continuity.read(observation.id, "0".repeat(64), observedAt)
        ).rejects.toThrow("continuity_capture_mismatch");
        fixture.row.reportId = "replacement";
        await expect(
            fixture.continuity.read(observation.id, observation.contentHash, observedAt)
        ).rejects.toThrow("continuity_record_unavailable");
    });
    it.each(["2026-02-30T12:00:00Z", "2025-02-29T12:00:00Z", "2026-11-12T12:00:00"])(
        "rejects invalid recorded timestamp %s",
        async recordedAt => {
            const fixture = setup();
            fixture.row.recordedAt = recordedAt;
            await expect(fixture.capture()).rejects.toThrow("continuity_invalid_record");
        }
    );
    it.each(["2026-02-30T12:00:00Z", "2025-02-29T12:00:00Z", "2026-11-13T12:00:00"])(
        "rejects invalid cutoff %s",
        async cutoff => {
            const fixture = setup();
            const observation = await fixture.capture();
            await expect(
                fixture.continuity.read(observation.id, observation.contentHash, cutoff)
            ).rejects.toThrow("continuity_invalid_cutoff");
        }
    );
    it("accepts valid leap days and explicit offsets", async () => {
        const fixture = setup();
        fixture.row.recordedAt = "2024-02-29T23:30:00.123+05:30";
        const observation = await fixture.capture();
        expect(
            (
                await fixture.continuity.read(
                    observation.id,
                    observation.contentHash,
                    "2026-11-13T07:00:00-05:00"
                )
            ).state
        ).toBe("observed_record");
    });
    it("rejects invalid injected Date with a stable validation error", async () => {
        await expect(setup({ now: new Date(NaN) }).capture()).rejects.toThrow(
            "continuity_invalid_clock"
        );
    });
    it("enforces count across concurrent captures and preserves existing captures", async () => {
        const fixture = setup({ limits: { maxObservations: 1 } });
        const results = await Promise.allSettled([fixture.capture(), fixture.capture()]);
        expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
        const first = results.find(result => result.status === "fulfilled");
        if (!first || first.status !== "fulfilled") throw new Error("missing capture");
        await expect(fixture.capture()).rejects.toThrow("continuity_quota_exhausted");
        expect(
            (await fixture.continuity.read(first.value.id, first.value.contentHash, observedAt))
                .state
        ).toBe("observed_record");
    });
    it("enforces UTF-8 record bytes and permits capture after oversize rejection", async () => {
        const fixture = setup({ limits: { maxRecordBytes: 2000 } });
        fixture.row.content.title = "界".repeat(1000);
        await expect(fixture.capture()).rejects.toThrow("continuity_quota_exhausted");
        fixture.row.content.title = "small";
        await expect(fixture.capture()).resolves.toMatchObject({
            executionVerification: "unknown",
        });
    });
    it("enforces aggregate envelope bytes and preserves history after exhaustion", async () => {
        const reference = await setup().capture();
        const bytes = Buffer.byteLength(JSON.stringify(reference), "utf8");
        const fixture = setup({ limits: { maxAggregateBytes: bytes } });
        const observation = await fixture.capture();
        await expect(fixture.capture()).rejects.toThrow("continuity_quota_exhausted");
        expect(
            (await fixture.continuity.read(observation.id, observation.contentHash, observedAt))
                .state
        ).toBe("observed_record");
        await expect(setup({ limits: { maxAggregateBytes: bytes - 1 } }).capture()).rejects.toThrow(
            "continuity_quota_exhausted"
        );
    });
});

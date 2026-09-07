import { sql } from "drizzle-orm";

import {
    CallNotesWorkItemError,
    createPostgresCallNotesWorkItems,
    type CallNotesWorkItemClaim,
} from "@launchstack/features/call-notes";

import {
    createCallNotesTestDatabase,
    type CallNotesTestDatabase,
    type CallNotesTestSession,
} from "./testDb";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;

const NOW = new Date("2026-08-23T10:00:00.000Z");

async function insertCompany(db: CallNotesTestDatabase["db"]): Promise<void> {
    await db.execute(sql`
        INSERT INTO "pdr_ai_v2_company" ("name", "numberOfEmployees")
        VALUES ('Call Notes Work Items', '2')
    `);
}

function deterministicSources() {
    let sequence = 0;
    return {
        clock: { now: () => new Date(NOW) },
        ids: {
            next(prefix: string) {
                sequence += 1;
                return `${prefix}-test-${sequence}`;
            },
        },
    };
}

function expectClaim(value: CallNotesWorkItemClaim | null): CallNotesWorkItemClaim {
    if (!value) throw new Error("Expected a claimed work item");
    return value;
}

describeIfDatabase("Call Notes durable work items", () => {
    it("serializes concurrent claims, reclaims expired leases, and fences stale workers", async () => {
        const testDb = await createCallNotesTestDatabase();
        let sessionB: CallNotesTestSession | undefined;

        try {
            const session = await testDb.createSession();
            sessionB = session;
            await insertCompany(testDb.db);
            const sources = deterministicSources();
            const workA = createPostgresCallNotesWorkItems(testDb.db, {
                ...sources,
                leaseMs: 1_000,
            });
            const workB = createPostgresCallNotesWorkItems(session.db, {
                ...sources,
                leaseMs: 1_000,
            });

            const enqueueInput = {
                companyId: "1",
                kind: "capture_event" as const,
                idempotencyKey: "capture-event-1",
                payload: { eventId: "event-1" },
            };
            const firstEnqueue = await workA.enqueue(enqueueInput);
            const replayedEnqueue = await workB.enqueue({
                ...enqueueInput,
                payload: { eventId: "different-payload-must-not-replace" },
            });
            expect(replayedEnqueue.id).toBe(firstEnqueue.id);
            expect(replayedEnqueue.payload).toEqual({ eventId: "event-1" });
            expect(replayedEnqueue.attempts).toBe(0);

            const secondEnqueue = await workA.enqueue({
                ...enqueueInput,
                idempotencyKey: "capture-event-2",
                payload: { eventId: "event-2" },
            });
            expect(secondEnqueue.id).not.toBe(firstEnqueue.id);
            const duplicateReceipt = await workA.enqueue({
                ...enqueueInput,
                idempotencyKey: "capture-event-duplicate",
                payload: { eventId: "event-duplicate" },
            });
            const [duplicateClaimA, duplicateClaimB] = await Promise.all([
                workA.claimById(duplicateReceipt.id, "duplicate-worker-a", {
                    companyId: "1",
                    kind: "capture_event",
                    leaseMs: 1_000,
                    now: NOW,
                }),
                workB.claimById(duplicateReceipt.id, "duplicate-worker-b", {
                    companyId: "1",
                    kind: "capture_event",
                    leaseMs: 1_000,
                    now: NOW,
                }),
            ]);
            const duplicateClaims = [duplicateClaimA, duplicateClaimB].filter(
                (claim): claim is CallNotesWorkItemClaim => claim !== null
            );
            expect(duplicateClaims).toHaveLength(1);
            const completedDuplicate = await workA.complete(
                duplicateClaims[0]!.id,
                duplicateClaims[0]!.leaseToken
            );
            expect(completedDuplicate.status).toBe("completed");

            const [claimAResult, claimBResult] = await Promise.all([
                workA.claim("worker-a", {
                    companyId: "1",
                    kind: "capture_event",
                    leaseMs: 1_000,
                    now: NOW,
                }),
                workB.claim("worker-b", {
                    companyId: "1",
                    kind: "capture_event",
                    leaseMs: 1_000,
                    now: NOW,
                }),
            ]);
            const claimA = expectClaim(claimAResult);
            const claimB = expectClaim(claimBResult);
            expect(claimA.id).not.toBe(claimB.id);
            expect(claimA.leaseOwner).not.toBe(claimB.leaseOwner);
            expect(claimA.leaseToken).not.toBe(claimB.leaseToken);
            expect(claimA.attempts).toBe(1);
            expect(claimB.attempts).toBe(1);

            const completedA = await workA.complete(claimA.id, claimA.leaseToken);
            expect(completedA.status).toBe("completed");
            expect(completedA.completedAt).toBeInstanceOf(Date);
            expect(completedA.leaseToken).toBeNull();

            const expiredAt = new Date(NOW.getTime() + 1_001);
            const reclaimed = expectClaim(
                await workA.claim("worker-c", {
                    companyId: "1",
                    kind: "capture_event",
                    leaseMs: 2_000,
                    now: expiredAt,
                })
            );
            expect(reclaimed.id).toBe(claimB.id);
            expect(reclaimed.attempts).toBe(2);
            expect(reclaimed.leaseOwner).toBe("worker-c");
            expect(reclaimed.leaseToken).not.toBe(claimB.leaseToken);
            expect(reclaimed.leaseExpiresAt.getTime()).toBe(expiredAt.getTime() + 2_000);

            await expect(workB.complete(claimB.id, claimB.leaseToken)).rejects.toMatchObject({
                code: "stale_token",
            });
            await expect(
                workB.fail(claimB.id, claimB.leaseToken, {
                    code: "late-worker",
                    message: "old lease must not mutate the successor's work",
                })
            ).rejects.toMatchObject({ code: "stale_token" });

            const completedReclaimed = await workA.complete(reclaimed.id, reclaimed.leaseToken);
            expect(completedReclaimed.status).toBe("completed");
            expect(await workA.claim("worker-d", { companyId: "1" })).toBeNull();
        } finally {
            if (sessionB) await sessionB.close();
            await testDb.close();
        }
    });

    it("returns null when no eligible item remains and rejects unknown fencing targets", async () => {
        const testDb = await createCallNotesTestDatabase();
        try {
            await insertCompany(testDb.db);
            const sources = deterministicSources();
            const work = createPostgresCallNotesWorkItems(testDb.db, sources);
            expect(await work.claim("worker-empty", { companyId: "1" })).toBeNull();
            await expect(work.complete("missing-work-item", "missing-token")).rejects.toMatchObject(
                {
                    code: "not_found",
                }
            );
            await expect(
                work.enqueue({
                    companyId: "not-a-number",
                    kind: "start",
                    idempotencyKey: "bad-company",
                    payload: {},
                })
            ).rejects.toBeInstanceOf(CallNotesWorkItemError);
        } finally {
            await testDb.close();
        }
    });
});

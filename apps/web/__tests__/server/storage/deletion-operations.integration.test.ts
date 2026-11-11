import { asc, eq, sql } from "drizzle-orm";
import type { DbClient } from "@launchstack/store/client";
import { company, eventOutbox } from "@launchstack/store/schema";
import { eventIds } from "@launchstack/orchestration/pipeline-events";

import { storageDeletionItems, storageDeletionRequests } from "~/server/db/schema/storage";
import {
    getStorageDeletionSummary,
    listStorageDeletionRequests,
    requeueStorageDeletionRequest,
    showStorageDeletionRequest,
    waiveStorageDeletionItem,
} from "~/server/storage/deletion/admin";
import { planObjectDeletion } from "~/server/storage/deletion/plan";
import { recomputeDeletionRequestStatus } from "~/server/storage/deletion/status";
import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../../founderWeeklyReview/testDb";

let mockActiveDb: DbClient;
jest.mock("~/server/engine", () => ({ getEngine: () => ({ db: mockActiveDb }) }));
jest.mock("~/env", () => ({ env: { server: {}, client: {} } }));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

describeDb("storage deletion operations (integration)", () => {
    jest.setTimeout(120_000);
    let test: FounderWeeklyReviewTestDatabase;
    let companyId: bigint;
    let audit: jest.SpyInstance;
    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;
    });
    beforeEach(async () => {
        await test.db.execute(
            sql`TRUNCATE ${company}, ${storageDeletionRequests} RESTART IDENTITY CASCADE`
        );
        const [tenant] = await test.db
            .insert(company)
            .values({ name: "Deletion ops", numberOfEmployees: "1" })
            .returning();
        companyId = BigInt(tenant!.id);
        audit = jest.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => audit.mockRestore());
    afterAll(async () => test?.close());

    async function plan(count = 1) {
        const id = await test.db.transaction(tx =>
            planObjectDeletion(tx, {
                companyId,
                urls: Array.from({ length: count }, (_, n) => `/api/files/${n + 100}`),
                requestedBy: "test:user",
                reason: "test",
                traceId: "deletion-ops-test",
            })
        );
        return id!;
    }
    const items = (requestId: number) =>
        test.db
            .select()
            .from(storageDeletionItems)
            .where(eq(storageDeletionItems.requestId, requestId))
            .orderBy(asc(storageDeletionItems.id));
    const event = async (requestId: number) =>
        (
            await test.db
                .select()
                .from(eventOutbox)
                .where(eq(eventOutbox.eventId, eventIds.storageDeletionRequested(requestId)))
        )[0]!;
    async function block(requestId: number) {
        await test.db
            .update(storageDeletionItems)
            .set({
                state: "blocked",
                attempts: 7,
                errorCode: "storage_unconfigured",
                lastError: "credentials",
            })
            .where(eq(storageDeletionItems.requestId, requestId));
        await test.db
            .update(storageDeletionRequests)
            .set({ status: "blocked" })
            .where(eq(storageDeletionRequests.id, requestId));
    }

    it.each(["dead", "processed"] as const)(
        "requeues blocked items and revives a %s event atomically",
        async status => {
            const id = await plan(2);
            await block(id);
            const [blocked, terminal] = await items(id);
            await test.db
                .update(storageDeletionItems)
                .set({ state: "deleted", attempts: 2 })
                .where(eq(storageDeletionItems.id, terminal!.id));
            await test.db
                .update(eventOutbox)
                .set({
                    status,
                    attemptCount: 12,
                    lastError: "dead",
                    claimedAt: new Date(),
                    processedAt: new Date(),
                    availableAt: new Date(Date.now() + 60_000),
                })
                .where(eq(eventOutbox.eventId, eventIds.storageDeletionRequested(id)));
            const result = await requeueStorageDeletionRequest(test.db, id, {
                actor: " operator ",
                note: " credentials repaired ",
            });
            expect(result.changedItemIds).toEqual([blocked!.id]);
            expect(await showStorageDeletionRequest(test.db, id)).toMatchObject({
                request: { status: "pending", completedAt: null },
            });
            expect(await items(id)).toEqual([
                expect.objectContaining({
                    id: blocked!.id,
                    state: "pending",
                    attempts: 0,
                    errorCode: null,
                    lastError: null,
                    requeuedBy: "operator",
                    requeueNote: "credentials repaired",
                    requeuedAt: expect.any(Date),
                    resolvedBy: null,
                    resolutionNote: null,
                    resolvedAt: null,
                }),
                expect.objectContaining({
                    id: terminal!.id,
                    state: "deleted",
                    attempts: 2,
                    requeuedBy: null,
                    requeueNote: null,
                    requeuedAt: null,
                }),
            ]);
            expect(await event(id)).toMatchObject({
                status: "pending",
                attemptCount: 0,
                lastError: null,
                claimedAt: null,
            });
            expect(audit).toHaveBeenCalledWith(expect.stringContaining('"action":"requeue"'));
            expect(audit).toHaveBeenCalledWith(expect.stringContaining('"actor":"operator"'));
        }
    );

    it("resets blocked items under a pending delivery and preserves repeated requeue audit", async () => {
        const id = await plan();
        await block(id);
        await test.db
            .update(eventOutbox)
            .set({ attemptCount: 4, lastError: "retry scheduled" })
            .where(eq(eventOutbox.eventId, eventIds.storageDeletionRequested(id)));
        const pendingEvent = await event(id);
        await requeueStorageDeletionRequest(test.db, id, {
            actor: "operator",
            note: "fixed credentials",
        });
        const [requeued] = await items(id);
        expect(requeued).toMatchObject({
            state: "pending",
            attempts: 0,
            requeuedBy: "operator",
            requeueNote: "fixed credentials",
            requeuedAt: expect.any(Date),
        });
        expect(await event(id)).toEqual(pendingEvent);
        await test.db
            .update(storageDeletionItems)
            .set({ attempts: 3, lastError: "retry", errorCode: "transient" })
            .where(eq(storageDeletionItems.requestId, id));
        expect(
            (await requeueStorageDeletionRequest(test.db, id, { actor: "other", note: "repeat" }))
                .changedItemIds
        ).toEqual([]);
        expect((await items(id))[0]).toMatchObject({
            state: "pending",
            attempts: 3,
            lastError: "retry",
            errorCode: "transient",
            requeuedBy: requeued!.requeuedBy,
            requeueNote: requeued!.requeueNote,
            requeuedAt: requeued!.requeuedAt,
        });
        expect(await event(id)).toEqual(pendingEvent);
    });

    it.each(["blocked", "pending"] as const)(
        "refuses requeue without mutation when a delivery is in flight and items are %s",
        async state => {
            const id = await plan();
            await block(id);
            if (state === "pending") {
                await test.db
                    .update(storageDeletionItems)
                    .set({ state })
                    .where(eq(storageDeletionItems.requestId, id));
                await test.db
                    .update(storageDeletionRequests)
                    .set({ status: "pending" })
                    .where(eq(storageDeletionRequests.id, id));
            }
            await test.db
                .update(eventOutbox)
                .set({ status: "processing", attemptCount: 4, claimedAt: new Date() })
                .where(eq(eventOutbox.eventId, eventIds.storageDeletionRequested(id)));
            const before = await showStorageDeletionRequest(test.db, id);
            const delivery = await event(id);
            await expect(
                requeueStorageDeletionRequest(test.db, id, { actor: "operator" })
            ).rejects.toThrow("delivery in flight, retry shortly");
            expect(await showStorageDeletionRequest(test.db, id)).toEqual(before);
            expect(await event(id)).toEqual(delivery);
            expect(audit).not.toHaveBeenCalled();
        }
    );

    it("surfaces a dead delivery with a pending request as blocked and resets its stranded pending items", async () => {
        const id = await plan(2);
        const [pending, terminal] = await items(id);
        await test.db
            .update(storageDeletionItems)
            .set({ attempts: 8, errorCode: "transient", lastError: "retry exhausted" })
            .where(eq(storageDeletionItems.id, pending!.id));
        await test.db
            .update(storageDeletionItems)
            .set({ state: "retained", attempts: 2 })
            .where(eq(storageDeletionItems.id, terminal!.id));
        await test.db
            .update(eventOutbox)
            .set({ status: "dead", attemptCount: 12 })
            .where(eq(eventOutbox.eventId, eventIds.storageDeletionRequested(id)));
        expect(await getStorageDeletionSummary(test.db)).toMatchObject({
            requestsByStatus: { blocked: 1, pending: 0 },
            deadOutboxEvents: 1,
        });
        expect(await listStorageDeletionRequests(test.db, { status: "pending" })).toEqual([]);
        expect(await listStorageDeletionRequests(test.db, { status: "blocked" })).toEqual([
            expect.objectContaining({
                request: expect.objectContaining({ id, status: "pending" }),
                operationalStatus: "blocked",
                outboxStatus: "dead",
            }),
        ]);
        expect(
            await requeueStorageDeletionRequest(test.db, id, { actor: "operator" })
        ).toMatchObject({
            changedItemIds: [pending!.id],
            revivedDeadEvent: true,
        });
        expect(await items(id)).toEqual([
            expect.objectContaining({
                state: "pending",
                attempts: 0,
                errorCode: null,
                lastError: null,
            }),
            expect.objectContaining({ state: "retained", attempts: 2 }),
        ]);
        expect(await event(id)).toMatchObject({ status: "pending", attemptCount: 0 });
        expect((await showStorageDeletionRequest(test.db, id)).operationalStatus).toBe("pending");
    });

    it("rolls back item resets when outbox revival fails and emits no audit", async () => {
        const id = await plan();
        await block(id);
        await test.db
            .execute(sql`CREATE FUNCTION reject_deletion_requeue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'revival rejected'; END $$;
            CREATE TRIGGER reject_deletion_requeue BEFORE INSERT OR UPDATE ON ${eventOutbox} FOR EACH ROW EXECUTE FUNCTION reject_deletion_requeue();`);
        try {
            await expect(
                requeueStorageDeletionRequest(test.db, id, { actor: "operator" })
            ).rejects.toMatchObject({
                cause: expect.objectContaining({ message: "revival rejected" }),
            });
            expect((await items(id))[0]).toMatchObject({ state: "blocked", attempts: 7 });
            expect((await showStorageDeletionRequest(test.db, id)).request.status).toBe("blocked");
            expect(audit).not.toHaveBeenCalled();
        } finally {
            await test.db.execute(
                sql`DROP TRIGGER reject_deletion_requeue ON ${eventOutbox}; DROP FUNCTION reject_deletion_requeue();`
            );
        }
    });

    it("waives the final blocked item, records resolution, and completes its request", async () => {
        const id = await plan();
        await block(id);
        const [item] = await items(id);
        await waiveStorageDeletionItem(test.db, item!.id, {
            actor: "operator",
            note: "Accepted retained bytes",
        });
        expect((await items(id))[0]).toMatchObject({
            state: "waived",
            resolvedBy: "operator",
            resolutionNote: "Accepted retained bytes",
            resolvedAt: expect.any(Date),
        });
        expect((await showStorageDeletionRequest(test.db, id)).request).toMatchObject({
            status: "completed",
            completedAt: expect.any(Date),
        });
        await expect(
            waiveStorageDeletionItem(test.db, item!.id, { actor: "other", note: "new" })
        ).rejects.toThrow("completed");
        await expect(
            requeueStorageDeletionRequest(test.db, id, { actor: "operator" })
        ).rejects.toThrow("completed");
        expect((await items(id))[0]!.resolvedBy).toBe("operator");
    });

    it.each(["dead", "pending", "processing", "processed"] as const)(
        "completing a waiver clears only a dead outbox delivery (%s)",
        async status => {
            const id = await plan();
            await block(id);
            const [item] = await items(id);
            await test.db
                .update(eventOutbox)
                .set({ status, lastError: "delivery failed" })
                .where(eq(eventOutbox.eventId, eventIds.storageDeletionRequested(id)));
            const before = await event(id);
            await waiveStorageDeletionItem(test.db, item!.id, {
                actor: " operator ",
                note: "Accepted retained bytes",
            });
            expect((await items(id))[0]).toMatchObject({ state: "waived", resolvedBy: "operator" });
            if (status === "dead") {
                expect(await event(id)).toMatchObject({
                    status: "processed",
                    processedAt: expect.any(Date),
                    lastError: null,
                    attemptCount: before.attemptCount,
                });
                expect(await getStorageDeletionSummary(test.db)).toMatchObject({
                    deadOutboxEvents: 0,
                    requestsByStatus: { pending: 0, completed: 1, blocked: 0 },
                    itemsByState: { pending: 0, waived: 1 },
                });
                expect(await listStorageDeletionRequests(test.db, { status: "pending" })).toEqual(
                    []
                );
            } else {
                expect(await event(id)).toEqual(before);
            }
        }
    );

    it("waives null-ref quarantine and preserves resolution on repeat while request remains blocked", async () => {
        const id = await plan(2);
        await block(id);
        const [item] = await items(id);
        await test.db
            .update(storageDeletionItems)
            .set({ state: "quarantined", adapter: null, storageLocationId: null, objectKey: null })
            .where(eq(storageDeletionItems.id, item!.id));
        await waiveStorageDeletionItem(test.db, item!.id, {
            actor: "operator",
            note: "Ambiguous legacy bytes",
        });
        const resolved = (await items(id))[0]!;
        expect(
            (
                await waiveStorageDeletionItem(test.db, item!.id, {
                    actor: "other",
                    note: "replacement",
                })
            ).changedItemIds
        ).toEqual([]);
        expect((await items(id))[0]).toEqual(resolved);
        expect((await showStorageDeletionRequest(test.db, id)).request.status).toBe("blocked");
    });

    it("requires actor/note and refuses waiving a live pending item", async () => {
        const id = await plan();
        const [item] = await items(id);
        await expect(requeueStorageDeletionRequest(test.db, id, { actor: " " })).rejects.toThrow(
            "actor"
        );
        await expect(
            requeueStorageDeletionRequest(test.db, id, { actor: "a".repeat(257) })
        ).rejects.toThrow("actor");
        await expect(
            waiveStorageDeletionItem(test.db, item!.id, { actor: " ", note: "accepted" })
        ).rejects.toThrow("actor");
        await expect(
            waiveStorageDeletionItem(test.db, item!.id, {
                actor: "a".repeat(257),
                note: "accepted",
            })
        ).rejects.toThrow("actor");
        await expect(
            waiveStorageDeletionItem(test.db, item!.id, { actor: "operator", note: " " })
        ).rejects.toThrow("note");
        await expect(
            waiveStorageDeletionItem(test.db, item!.id, { actor: "operator", note: "accepted" })
        ).rejects.toThrow("blocked or quarantined");
        expect(audit).not.toHaveBeenCalled();
    });

    it("summarizes backlog and lists filtered requests with item breakdown", async () => {
        const blockedId = await plan(2);
        await block(blockedId);
        const [quarantine] = await items(blockedId);
        await test.db
            .update(storageDeletionItems)
            .set({ state: "quarantined" })
            .where(eq(storageDeletionItems.id, quarantine!.id));
        await test.db
            .update(eventOutbox)
            .set({ status: "dead" })
            .where(eq(eventOutbox.eventId, eventIds.storageDeletionRequested(blockedId)));
        const pendingId = await plan();
        await test.db
            .update(storageDeletionItems)
            .set({ createdAt: new Date(Date.now() - 120_000) })
            .where(eq(storageDeletionItems.requestId, pendingId));
        expect(await getStorageDeletionSummary(test.db)).toMatchObject({
            requestsByStatus: { blocked: 1, pending: 1, completed: 0 },
            itemsByState: { blocked: 1, quarantined: 1, pending: 1, waived: 0 },
            blockedItems: 1,
            quarantinedItems: 1,
            deadOutboxEvents: 1,
        });
        expect(
            (await getStorageDeletionSummary(test.db)).oldestPendingAgeSeconds
        ).toBeGreaterThanOrEqual(120);
        const rows = await listStorageDeletionRequests(test.db, {
            status: "blocked",
            companyId,
            limit: 1,
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            request: { id: blockedId },
            itemsByState: { blocked: 1, quarantined: 1 },
        });
        expect(
            await listStorageDeletionRequests(test.db, {
                status: "pending",
                companyId: companyId + 1n,
                limit: 10,
            })
        ).toEqual([]);
        await expect(showStorageDeletionRequest(test.db, 999_999)).rejects.toThrow("not found");
    });

    it("shared status recomputation treats waived as terminal success and rejects missing requests", async () => {
        const id = await plan();
        await test.db
            .update(storageDeletionItems)
            .set({ state: "waived" })
            .where(eq(storageDeletionItems.requestId, id));
        expect(await test.db.transaction(tx => recomputeDeletionRequestStatus(tx, id))).toEqual({
            states: ["waived"],
            previousStatus: "pending",
            status: "completed",
        });
        await expect(
            test.db.transaction(tx => recomputeDeletionRequestStatus(tx, 999_999))
        ).rejects.toThrow("not found");
    });
});

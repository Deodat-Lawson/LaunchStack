/**
 * The Processing queue routes against a real Postgres: who sees which job
 * (ADR-014 — the access predicate is SQL, so a fake database cannot test it),
 * and who may Retry a failed one (Retry itself is POST /api/documents/[id]/retry).
 *
 * Gated like the other integration suites: runs on a throwaway database
 * migrated with both ledgers when LAUNCHSTACK_TEST_DATABASE_URL (or
 * DATABASE_URL) points at a local server.
 */

import type { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
    category,
    company,
    document,
    documentVersions,
    eventOutbox,
    ocrJobs,
} from "@launchstack/store/schema";
import type { DbClient } from "@launchstack/store/client";
import { builtinRolePermissions } from "~/lib/authz/permissions";
import { resolveDocumentScope } from "~/lib/authz/scope";
import type { DocumentScope } from "~/lib/authz/scope-types";
import type { ProcessingQueueItem, ProcessingQueueResponse } from "~/lib/processing-queue/types";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import {
    connectorConnections,
    folderGrants,
    folderSettings,
    gmailSyncState,
    googleDriveSyncState,
    userCompanyMemberships,
    users,
} from "~/server/db/schema";
import { applyDocumentCreationDefaults } from "~/server/workspace/ownership";
import { GET as queueRoute } from "~/app/api/documents/processing-queue/route";

import { createFounderWeeklyReviewTestDatabase } from "../../founderWeeklyReview/testDb";

let mockActiveDb: DbClient | null = null;
jest.mock("~/server/db", () => ({
    get db() {
        if (!mockActiveDb) throw new Error("test database not ready");
        return mockActiveDb;
    },
}));
const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<NextResponse>) =>
        handler(),
}));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

type Person = "ada" | "bea" | "vic";
const ROLES: Record<Person, string> = { ada: "owner", bea: "member", vic: "viewer" };

describeDb("processing queue routes (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;
    const pk = {} as Record<Person, bigint>;

    function ctx(name: Person): WorkspaceContext {
        const role = ROLES[name];
        const permissions = builtinRolePermissions(role)!;
        let scope: Promise<DocumentScope> | null = null;
        return {
            authUserId: `auth_${name}`,
            userPk: pk[name],
            companyId,
            role,
            status: "active",
            permissions,
            can: p => permissions.has(p),
            documentScope: () =>
                (scope ??= resolveDocumentScope({
                    companyId,
                    userPk: pk[name],
                    role,
                    permissions,
                })),
        };
    }

    function as(name: Person) {
        mockRequireWorkspaceContext.mockImplementation(() => ({ success: true, data: ctx(name) }));
    }

    async function queue(name: Person) {
        as(name);
        const res = await queueRoute(
            new Request("http://localhost/api/documents/processing-queue")
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        return (await res.json()) as ProcessingQueueResponse;
    }

    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
    const FAILURE_MARKER = {
        error: "processing_failed",
        errorMessage: "pipeline event dead: [s3] fetch failed",
        failedAt: "2026-10-17T00:00:00.000Z",
    };

    /** A document (+ its first version) added by `by`, with ADR-014's defaults. */
    async function addDocument(
        title: string,
        folder: string,
        by: Person,
        ocrMetadata: Record<string, unknown> | null = null
    ): Promise<{ id: number; versionId: number }> {
        const [doc] = await test.db
            .insert(document)
            .values({
                companyId,
                title,
                category: folder,
                url: `https://files.test/${encodeURIComponent(title)}`,
                mimeType: "application/pdf",
                ocrMetadata,
            })
            .returning({ id: document.id });
        const [version] = await test.db
            .insert(documentVersions)
            .values({
                documentId: BigInt(doc!.id),
                versionNumber: 1,
                url: `https://files.test/${encodeURIComponent(title)}`,
                mimeType: "application/pdf",
                uploadedBy: `auth_${by}`,
                ocrMetadata,
            })
            .returning({ id: documentVersions.id });
        await test.db
            .update(document)
            .set({ currentVersionId: BigInt(version!.id) })
            .where(eq(document.id, doc!.id));
        await applyDocumentCreationDefaults(
            test.db,
            { companyId, userPk: pk[by], authUserId: `auth_${by}` },
            [{ id: doc!.id, category: folder }]
        );
        return { id: doc!.id, versionId: version!.id };
    }

    async function addJob(
        id: string,
        doc: { id: number; versionId: number } | null,
        by: Person,
        fields: Partial<typeof ocrJobs.$inferInsert> = {}
    ): Promise<string> {
        await test.db.insert(ocrJobs).values({
            id,
            companyId,
            documentId: doc ? BigInt(doc.id) : null,
            versionId: doc ? BigInt(doc.versionId) : null,
            userId: `auth_${by}`,
            status: "processing",
            documentUrl: "https://files.test/x",
            documentName: `${id}.pdf`,
            ...fields,
        });
        return id;
    }

    async function addEvent(
        type: "source.version.created" | "evidence.version.extracted",
        jobId: string,
        fields: Partial<typeof eventOutbox.$inferInsert> = {}
    ): Promise<void> {
        await test.db.insert(eventOutbox).values({
            eventId: `${type}:${jobId}`,
            eventType: type,
            schemaVersion: 1,
            companyId: Number(companyId),
            payload: {},
            traceId: jobId,
            ...fields,
        });
    }

    const jobIds = (q: ProcessingQueueResponse) => q.items.map(i => i.jobId);
    const item = (q: ProcessingQueueResponse, jobId: string): ProcessingQueueItem =>
        q.items.find(i => i.jobId === jobId)!;

    // Ada's loose file: private to her (ADR-014); failed while reading.
    const ADA_PRIVATE = "job-ada-private";
    // Bea's file in the workspace-wide Team folder; failed while indexing.
    const TEAM_FAILED = "job-team-failed";
    // In the Deal room, where Bea may only view.
    const DEAL_FAILED = "job-deal-failed";
    const RUNNING = "job-running";
    const RECENT_DONE = "job-recent-done";
    const OLD_DONE = "job-old-done";
    const NO_DOCUMENT = "job-no-document";
    const NO_EVENTS = "job-failed-no-events";
    let teamDoc: { id: number; versionId: number };
    let adaDoc: { id: number; versionId: number };

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;

        const [co] = await test.db
            .insert(company)
            .values({ name: "Acme", numberOfEmployees: "20" })
            .returning();
        companyId = BigInt(co!.id);
        for (const name of Object.keys(ROLES) as Person[]) {
            const [u] = await test.db
                .insert(users)
                .values({
                    name: name.toUpperCase(),
                    email: `${name}@acme.test`,
                    userId: `auth_${name}`,
                    companyId,
                })
                .returning();
            pk[name] = BigInt(u!.id);
            await test.db
                .insert(userCompanyMemberships)
                .values({ userId: pk[name], companyId, role: ROLES[name], status: "active" });
        }

        // Folders: Team is workspace-wide; the Deal room is Ada's, Bea views it.
        await test.db.insert(category).values({ name: "Team", companyId });
        const [deal] = await test.db
            .insert(category)
            .values({ name: "Deal room", companyId })
            .returning();
        await test.db.insert(folderSettings).values({
            categoryId: BigInt(deal!.id),
            companyId,
            visibility: "restricted",
            updatedBy: "auth_ada",
        });
        for (const [who, level] of [
            ["ada", "manage"],
            ["bea", "view"],
        ] as const) {
            await test.db.insert(folderGrants).values({
                companyId,
                categoryId: BigInt(deal!.id),
                principalType: "user",
                principalId: pk[who].toString(),
                level,
                grantedBy: "auth_ada",
            });
        }

        adaDoc = await addDocument("Ada private", "Unfiled", "ada", FAILURE_MARKER);
        await addJob(ADA_PRIVATE, adaDoc, "ada", {
            status: "failed",
            errorMessage: "pipeline event dead: [s3] fetch failed",
            completedAt: minutesAgo(30),
        });
        await addEvent("source.version.created", ADA_PRIVATE, {
            status: "dead",
            attemptCount: 8,
            lastError: "[s3] fetch failed",
        });

        teamDoc = await addDocument("Team plan", "Team", "bea", {
            ...FAILURE_MARKER,
            totalPages: 3,
        });
        await addJob(TEAM_FAILED, teamDoc, "bea", {
            status: "failed",
            errorMessage: "pipeline event dead: 402 Insufficient credits",
            completedAt: minutesAgo(10),
            // What the stages recorded before embedding gave up.
            progress: {
                stage: "embedding",
                done: 2,
                total: 7,
                updatedAt: minutesAgo(11).toISOString(),
            },
        });
        await addEvent("source.version.created", TEAM_FAILED, {
            status: "processed",
            processedAt: minutesAgo(12),
        });
        await addEvent("evidence.version.extracted", TEAM_FAILED, {
            status: "dead",
            attemptCount: 8,
            lastError: "402 Insufficient credits",
            claimedAt: minutesAgo(11),
        });

        const dealDoc = await addDocument("Term sheet", "Deal room", "ada");
        await addJob(DEAL_FAILED, dealDoc, "ada", { status: "failed", completedAt: minutesAgo(5) });
        await addEvent("source.version.created", DEAL_FAILED, { status: "dead", attemptCount: 8 });

        const runningDoc = await addDocument("Big scan", "Team", "bea");
        await addJob(RUNNING, runningDoc, "bea", { status: "processing" });
        await addEvent("source.version.created", RUNNING, {
            status: "pending",
            attemptCount: 2,
            lastError: "Document converter /convert timed out after 120000ms",
            availableAt: new Date(Date.now() + 60_000),
        });

        const doneDoc = await addDocument("Done today", "Team", "bea");
        await addJob(RECENT_DONE, doneDoc, "bea", {
            status: "completed",
            completedAt: minutesAgo(60),
        });

        const oldDoc = await addDocument("Done last week", "Team", "bea");
        await addJob(OLD_DONE, oldDoc, "bea", {
            status: "completed",
            createdAt: minutesAgo(60 * 24 * 7),
            completedAt: minutesAgo(60 * 24 * 7),
            updatedAt: minutesAgo(60 * 24 * 7),
        });

        await addJob(NO_DOCUMENT, null, "bea", { status: "queued" });

        const noEventsDoc = await addDocument("Orphan", "Team", "bea");
        await addJob(NO_EVENTS, noEventsDoc, "bea", {
            status: "failed",
            completedAt: minutesAgo(1),
        });

        // Bea's own Gmail, mid-sync; the workspace's Drive, synced a minute ago.
        const [gmail] = await test.db
            .insert(connectorConnections)
            .values({
                companyId,
                provider: "gmail",
                providerAccountId: "bea-sub",
                providerAccountEmail: "bea@gmail.test",
                scopes: "gmail.readonly",
                ownerUserId: pk.bea,
            })
            .returning({ id: connectorConnections.id });
        await test.db.insert(gmailSyncState).values({
            connectionId: gmail!.id,
            lastSyncStatus: "running",
            syncLockedAt: minutesAgo(1),
        });
        const [drive] = await test.db
            .insert(connectorConnections)
            .values({
                companyId,
                provider: "google-drive",
                providerAccountId: "ops-sub",
                providerAccountEmail: "ops@acme.test",
                scopes: "drive.file",
            })
            .returning({ id: connectorConnections.id });
        await test.db.insert(googleDriveSyncState).values({
            connectionId: drive!.id,
            lastSyncStatus: "ok",
            lastSyncAt: minutesAgo(1),
            lastSyncReport: { discovered: 4, stored: 2, skipped: 0, unchanged: 2, failed: 0 },
        });
    });

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    describe("GET /api/documents/processing-queue", () => {
        it("lists only jobs on files the caller may see — never someone else's private file", async () => {
            const ada = await queue("ada");
            expect(jobIds(ada)).toEqual(
                expect.arrayContaining([
                    ADA_PRIVATE,
                    TEAM_FAILED,
                    DEAL_FAILED,
                    RUNNING,
                    RECENT_DONE,
                    NO_EVENTS,
                ])
            );

            const bea = await queue("bea");
            expect(jobIds(bea)).not.toContain(ADA_PRIVATE);
            expect(jobIds(bea)).toEqual(
                expect.arrayContaining([TEAM_FAILED, DEAL_FAILED, RUNNING, RECENT_DONE])
            );
            for (const q of [ada, bea]) {
                // Finished more than a day ago, or with no document: not listed.
                expect(jobIds(q)).not.toContain(OLD_DONE);
                expect(jobIds(q)).not.toContain(NO_DOCUMENT);
            }
        });

        it("works out each job's stage and says who may retry", async () => {
            const bea = await queue("bea");
            expect(item(bea, TEAM_FAILED)).toMatchObject({
                state: "failed",
                stage: "indexing",
                name: "Team plan",
                folder: "Team",
                mine: true,
                canRetry: true,
                error: "pipeline event dead: 402 Insufficient credits",
            });
            expect(item(bea, RUNNING)).toMatchObject({
                state: "retrying",
                stage: "reading",
                attempt: 2,
            });
            expect(item(bea, RUNNING).error).toMatch(/timed out|timeout/i);
            expect(item(bea, RUNNING).nextAttemptAt).not.toBeNull();
            expect(item(bea, RECENT_DONE).state).toBe("done");
            // She can see the Deal room's file but only view it.
            expect(item(bea, DEAL_FAILED)).toMatchObject({ state: "failed", canRetry: false });

            const ada = await queue("ada");
            expect(item(ada, ADA_PRIVATE)).toMatchObject({
                state: "failed",
                stage: "reading",
                folder: "",
                canRetry: true,
            });
            expect(item(ada, TEAM_FAILED)).toMatchObject({ mine: false, canRetry: true });

            const vic = await queue("vic");
            expect(item(vic, TEAM_FAILED).canRetry).toBe(false);
            expect(vic.summary.failed).toBeGreaterThanOrEqual(2);
        });

        it("summarises by state and stamps the server's clock", async () => {
            const ada = await queue("ada");
            const counted = ada.items.reduce<Record<string, number>>((acc, i) => {
                acc[i.state] = (acc[i.state] ?? 0) + 1;
                return acc;
            }, {});
            expect(ada.summary).toEqual({
                running: counted.running ?? 0,
                waiting: counted.waiting ?? 0,
                retrying: counted.retrying ?? 0,
                failed: counted.failed ?? 0,
                done: counted.done ?? 0,
            });
            expect(Math.abs(Date.parse(ada.serverTime) - Date.now())).toBeLessThan(60_000);
        });

        it("shows a member their own Gmail sync, and Drive only to who manages connectors", async () => {
            const bea = await queue("bea");
            expect(bea.connectors).toEqual([
                expect.objectContaining({
                    provider: "gmail",
                    account: "bea@gmail.test",
                    status: "running",
                }),
            ]);
            const ada = await queue("ada");
            expect(ada.connectors).toEqual([
                expect.objectContaining({
                    provider: "google-drive",
                    status: "ok",
                    report: { discovered: 4, stored: 2, unchanged: 2, skipped: 0, failed: 0 },
                }),
            ]);
        });
    });
});

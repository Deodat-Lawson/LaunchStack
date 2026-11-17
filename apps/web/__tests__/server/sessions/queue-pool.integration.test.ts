import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray, sql } from "drizzle-orm";
import type { DbClient } from "@launchstack/store/client";
import * as coreSchema from "@launchstack/store/schema";
import * as featuresSchema from "@launchstack/pipelines/schema";
import { company, fileUploads } from "@launchstack/store/schema";

import type { ChatQueueItem } from "~/lib/chat-turns";
import { workspaceSessionMessages, workspaceSessions } from "~/server/db/schema/workspace-sessions";
import { changeQueue } from "~/server/sessions/repository";
import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../../founderWeeklyReview/testDb";

let mockActiveDb: DbClient | undefined;
jest.mock("~/server/engine", () => ({
    getEngine: () => {
        if (!mockActiveDb) throw new Error("test database not ready");
        return { db: mockActiveDb };
    },
}));
jest.mock("~/env", () => ({
    env: { server: { NEXT_PUBLIC_STORAGE_PROVIDER: "database" }, client: {} },
}));

const describeDb = process.env.LAUNCHSTACK_TEST_DATABASE_URL ? describe : describe.skip;

function queueItem(id: string, url: string): ChatQueueItem {
    return {
        id,
        send: {
            text: "See this attachment",
            refs: [],
            attachments: [
                {
                    id: `attachment-${id}`,
                    name: "owned.png",
                    mimeType: "image/png",
                    kind: "image",
                    size: 5,
                    url,
                },
            ],
            webSearch: false,
            thinking: false,
            agentKey: null,
        },
    };
}

async function failFast<T>(work: Promise<T>): Promise<T> {
    // Real-I/O deadlock deadline, not a synchronization sleep: fake time cannot
    // detect starvation in postgres.js's connection pool.
    // The project's TypeScript lib predates Promise.withResolvers.
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
            () => reject(new Error("queue authorization exhausted the two-connection pool")),
            5_000
        );
    });
    try {
        return await Promise.race([work, deadline]);
    } finally {
        clearTimeout(timer);
    }
}

describeDb("session queue authorization with a saturated pool (integration)", () => {
    jest.setTimeout(120_000);
    let database: FounderWeeklyReviewTestDatabase | undefined;

    beforeAll(async () => {
        database = await createFounderWeeklyReviewTestDatabase();
    });

    afterAll(async () => {
        await database?.close();
    });

    it.each(["replace", "claim"] as const)(
        "%s authorizes attachments on the transaction connection",
        async operation => {
            if (!database) throw new Error("test database not ready");
            const url = new URL(process.env.LAUNCHSTACK_TEST_DATABASE_URL!);
            url.pathname = `/${database.databaseName}`;
            const client = postgres(url.toString(), { max: 2 });
            const poolDb = drizzle(client, { schema: { ...coreSchema, ...featuresSchema } });
            mockActiveDb = poolDb;

            let releaseConnections!: () => void;
            const bothConnectionsAcquired = new Promise<void>(resolve => {
                releaseConnections = resolve;
            });
            const backendPids = new Set<number>();
            const originalTransaction = poolDb.transaction.bind(poolDb);
            poolDb.transaction = (callback, config) =>
                originalTransaction(async tx => {
                    const rows = await tx.execute<{ pid: number }>(
                        sql`SELECT pg_backend_pid() AS pid`
                    );
                    backendPids.add(rows[0]!.pid);
                    // Both BEGINs own distinct pool connections before either repository
                    // callback can authorize. A global-db lookup now needs an unavailable
                    // third connection; the real transaction-scoped lookup does not.
                    if (backendPids.size === 2) releaseConnections();
                    await bothConnectionsAcquired;
                    return callback(tx);
                }, config);

            try {
                const [tenant] = await database.db
                    .insert(company)
                    .values({ name: `Queue pool ${operation}`, numberOfEmployees: "1" })
                    .returning({ id: company.id });
                const owner = { companyId: BigInt(tenant!.id), userId: "queue-pool-owner" };
                const uploads = await database.db
                    .insert(fileUploads)
                    .values(
                        [0, 1].map(index => ({
                            companyId: owner.companyId,
                            userId: owner.userId,
                            filename: `owned-${index}.png`,
                            mimeType: "image/png",
                            fileSize: 5,
                            fileData: "aGVsbG8=",
                        }))
                    )
                    .returning({ id: fileUploads.id });
                expect(uploads).toHaveLength(2);
                const fixtures = uploads.map(upload => {
                    const sessionId = randomUUID();
                    const canonicalUrl = `/api/files/${upload.id}`;
                    return {
                        sessionId,
                        canonicalUrl,
                        item: queueItem(sessionId, `${canonicalUrl}?download=1`),
                    };
                });
                await database.db.insert(workspaceSessions).values(
                    fixtures.map(fixture => ({
                        id: fixture.sessionId,
                        companyId: owner.companyId,
                        userId: owner.userId,
                        title: "Queue pool regression",
                        queuedMessages: operation === "claim" ? [fixture.item] : [],
                        queueRevision: 0,
                    }))
                );

                const results = await failFast(
                    Promise.all(
                        fixtures.map(fixture =>
                            changeQueue(
                                owner,
                                fixture.sessionId,
                                0,
                                operation === "claim"
                                    ? { claimId: fixture.item.id }
                                    : { items: [fixture.item] }
                            )
                        )
                    )
                );
                expect(backendPids.size).toBe(2);
                const sessions = await database.db
                    .select()
                    .from(workspaceSessions)
                    .where(
                        inArray(
                            workspaceSessions.id,
                            fixtures.map(fixture => fixture.sessionId)
                        )
                    );
                expect(sessions).toHaveLength(2);
                for (const [index, fixture] of fixtures.entries()) {
                    const expectedItem = queueItem(fixture.item.id, fixture.canonicalUrl);
                    const expectedItems = operation === "claim" ? [] : [expectedItem];
                    expect(results[index]).toMatchObject({ items: expectedItems, revision: 1 });
                    expect(results[index]?.conflict).toBeUndefined();
                    expect(
                        sessions.find(session => session.id === fixture.sessionId)
                    ).toMatchObject({
                        queuedMessages: expectedItems,
                        queueRevision: 1,
                        messageCount: operation === "claim" ? 1 : 0,
                    });
                    if (operation === "claim") {
                        expect(results[index]?.claimed).toEqual(expectedItem);
                        const [message] = await database.db
                            .select()
                            .from(workspaceSessionMessages)
                            .where(eq(workspaceSessionMessages.sessionId, fixture.sessionId));
                        expect(message).toMatchObject({
                            seq: 0,
                            role: "user",
                            attachments: expectedItem.send.attachments,
                            metadata: { send: expectedItem.send, intent: "queued" },
                        });
                        expect(results[index]?.claimedMessage).toMatchObject({
                            attachments: expectedItem.send.attachments,
                            metadata: { send: expectedItem.send },
                        });
                    }
                }
            } finally {
                // Release even a partially reached barrier, then forcibly close active
                // transactions and queued global lookups on the regression's failure path.
                releaseConnections();
                await client.end({ timeout: 0 });
                mockActiveDb = undefined;
            }
        }
    );
});

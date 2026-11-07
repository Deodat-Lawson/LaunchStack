/**
 * Per-user Notion connections against a real Postgres.
 *
 * - The migration hands each existing Notion connection to the member who
 *   made it, drops the ones nobody owns (no granter, or a granter who has
 *   already left), keeps a suspended member's (their sync only pauses),
 *   leaves workspace connections alone, and narrows the one-per-member index
 *   to Gmail.
 * - A member owns what they connect, may connect several Notion workspaces,
 *   and converges on their own row when re-authorizing.
 * - A Notion grant another member owns is refused, not taken over.
 * - The Notion panel and Ask starters count only the caller's own Notion
 *   connections, and nothing company-scoped can borrow a Notion token.
 * - Gmail's upsert still finds its narrowed index (one mailbox per member).
 * - A row an older build stored without an owner is adopted; two members
 *   racing for one new grant cannot both win.
 * - A member who leaves takes their Notion and Gmail connections with them:
 *   deleted in the same transaction, audited, and revoked after it.
 *
 * Gated like the other integration suites: runs only when
 * LAUNCHSTACK_TEST_DATABASE_URL (or DATABASE_URL) points at a local server.
 */
import { randomBytes } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { company } from "@launchstack/store/schema";
import type { DbClient } from "@launchstack/store/client";
import { configureSecretBox } from "@launchstack/store/crypto";

import { createFounderWeeklyReviewTestDatabase } from "../../founderWeeklyReview/testDb";

let mockActiveDb: DbClient | null = null;
jest.mock("~/server/db", () => ({
    get db() {
        if (!mockActiveDb) throw new Error("test database not ready");
        return mockActiveDb;
    },
}));
// The engine only registers the secret-box key here; the suite sets one itself.
jest.mock("~/server/engine", () => ({ getEngine: () => undefined }));
const mockRevoke = jest.fn(async () => true);
jest.mock("~/server/services/connectors/revoke", () => ({
    revokeConnectionTokens: (...args: unknown[]) => mockRevoke(...(args as [])),
}));
jest.mock("~/env", () => ({
    env: {
        server: {
            NOTION_OAUTH_CLIENT_ID: "notion-id",
            NOTION_OAUTH_CLIENT_SECRET: "notion-secret",
            EMBEDDING_SECRETS_KEY: "set-by-the-suite",
        },
        client: {},
    },
}));

const MIGRATION = "20261107191703_notion_per_user_connections";

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

type Person = "ada" | "ben" | "cy";

async function seedWorkspace(db: DbClient, people: readonly Person[]) {
    const { users, userCompanyMemberships } = await import("~/server/db/schema");
    const [co] = await db
        .insert(company)
        .values({ name: "Acme", numberOfEmployees: "5" })
        .returning();
    const companyId = BigInt(co!.id);
    const pk = {} as Record<Person, bigint>;
    for (const name of people) {
        const [u] = await db
            .insert(users)
            .values({ name, email: `${name}@acme.test`, userId: `auth_${name}`, companyId })
            .returning();
        pk[name] = BigInt(u!.id);
        await db.insert(userCompanyMemberships).values({
            userId: pk[name],
            companyId,
            role: "member",
            status: "active",
        });
    }
    return { companyId, pk };
}

function grant(botId: string, workspaceName: string, accessToken = `token-${botId}`) {
    return {
        providerAccountId: botId,
        displayName: workspaceName,
        scopes: "",
        accessToken,
        accessTokenExpiresAt: null,
        refreshToken: `refresh-${botId}`,
    };
}

beforeAll(() => {
    configureSecretBox({ key: randomBytes(32).toString("base64") });
});

describeDb("Notion per-user migration (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase({ holdBack: [MIGRATION] });
    });

    afterAll(async () => {
        await test?.close();
    });

    it("gives existing Notion connections to whoever made them and narrows the index to Gmail", async () => {
        const { connectorConnections, users, userCompanyMemberships } = await import(
            "~/server/db/schema"
        );
        const { companyId, pk } = await seedWorkspace(test.db, ["ada", "ben", "cy"]);
        // Cy is suspended, not gone: still a member, so their Notion stays.
        await test.db
            .update(userCompanyMemberships)
            .set({ status: "suspended" })
            .where(
                and(
                    eq(userCompanyMemberships.companyId, companyId),
                    eq(userCompanyMemberships.userId, pk.cy)
                )
            );
        // Someone who connected Notion and then left: a user row, no membership.
        const [gone] = await test.db
            .insert(users)
            .values({ name: "gone", email: "gone@acme.test", userId: "auth_gone", companyId })
            .returning();
        const base = { companyId, scopes: "", status: "active", encryptionKeyVersion: 1 };
        await test.db.insert(connectorConnections).values([
            // The old shape: workspace rows, attributed but unowned.
            { ...base, provider: "notion", providerAccountId: "bot-a1", grantedByUserId: pk.ada },
            { ...base, provider: "notion", providerAccountId: "bot-a2", grantedByUserId: pk.ada },
            { ...base, provider: "notion", providerAccountId: "bot-gone", grantedByUserId: null },
            {
                ...base,
                provider: "notion",
                providerAccountId: "bot-left",
                grantedByUserId: BigInt(gone!.id),
            },
            { ...base, provider: "notion", providerAccountId: "bot-cy", grantedByUserId: pk.cy },
            { ...base, provider: "slack", providerAccountId: "T1", grantedByUserId: pk.ben },
        ]);

        await test.applyMigration(MIGRATION);

        const rows = await test.db
            .select({
                provider: connectorConnections.provider,
                account: connectorConnections.providerAccountId,
                owner: connectorConnections.ownerUserId,
            })
            .from(connectorConnections)
            .where(eq(connectorConnections.companyId, companyId));
        const byAccount = new Map(rows.map(row => [row.account, row]));
        // Two Notion rows for one member: impossible under the old index.
        expect(byAccount.get("bot-a1")?.owner).toBe(pk.ada);
        expect(byAccount.get("bot-a2")?.owner).toBe(pk.ada);
        expect(byAccount.has("bot-gone")).toBe(false);
        expect(byAccount.has("bot-left")).toBe(false);
        expect(byAccount.get("bot-cy")?.owner).toBe(pk.cy);
        expect(byAccount.get("T1")?.owner).toBeNull();

        const [index] = await test.db.execute<{ indexdef: string }>(
            sql`select indexdef from pg_indexes where indexname = 'connector_connections_company_provider_owner_unique'`
        );
        expect(index?.indexdef).toContain("'gmail'");
    });
});

describeDb("Notion per-user connections (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;
    let pk: Record<Person, bigint>;

    async function contextFor(name: Person) {
        const { buildWorkspaceContext } = await import("~/lib/require-workspace-context");
        const { builtinRolePermissions } = await import("~/lib/authz/permissions");
        return buildWorkspaceContext({
            authUserId: `auth_${name}`,
            userPk: pk[name],
            companyId,
            role: "member",
            status: "active",
            permissions: builtinRolePermissions("member")!,
        });
    }

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;
        ({ companyId, pk } = await seedWorkspace(test.db, ["ada", "ben", "cy"]));
    });

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    it("lets a member own several Notion workspaces and re-authorize onto the same row", async () => {
        const { upsertConnection, listConnectionsForOwner } = await import(
            "~/server/services/connectors/connection-store"
        );
        const first = await upsertConnection({
            companyId,
            provider: "notion",
            grantedByUserId: pk.ada,
            ownerUserId: pk.ada,
            grant: grant("bot-ada-1", "Acme HQ"),
        });
        const second = await upsertConnection({
            companyId,
            provider: "notion",
            grantedByUserId: pk.ada,
            ownerUserId: pk.ada,
            grant: grant("bot-ada-2", "Ada's notes"),
        });
        const again = await upsertConnection({
            companyId,
            provider: "notion",
            grantedByUserId: pk.ada,
            ownerUserId: pk.ada,
            grant: grant("bot-ada-1", "Acme HQ", "a-newer-token"),
        });

        expect(first.ownerUserId).toBe(pk.ada);
        expect(second.id).not.toBe(first.id);
        expect(again.id).toBe(first.id);
        const adas = await listConnectionsForOwner(companyId, "notion", pk.ada);
        expect(adas.map(row => row.providerAccountId)).toEqual(["bot-ada-1", "bot-ada-2"]);
    });

    it("refuses a Notion grant another member owns instead of taking it over", async () => {
        const { ConnectorAccountClaimedError, upsertConnection, listConnectionsForOwner } =
            await import("~/server/services/connectors/connection-store");

        await expect(
            upsertConnection({
                companyId,
                provider: "notion",
                grantedByUserId: pk.ben,
                ownerUserId: pk.ben,
                grant: grant("bot-ada-1", "Acme HQ"),
            })
        ).rejects.toBeInstanceOf(ConnectorAccountClaimedError);

        const adas = await listConnectionsForOwner(companyId, "notion", pk.ada);
        expect(adas.find(row => row.providerAccountId === "bot-ada-1")?.ownerUserId).toBe(pk.ada);
        expect(await listConnectionsForOwner(companyId, "notion", pk.ben)).toEqual([]);
    });

    it("insists a Notion row has an owner and a workspace row has none", async () => {
        const { upsertConnection } = await import("~/server/services/connectors/connection-store");

        await expect(
            upsertConnection({
                companyId,
                provider: "notion",
                grantedByUserId: pk.ada,
                grant: grant("bot-unowned", "Nobody's"),
            })
        ).rejects.toThrow(/needs owner/);
        await expect(
            upsertConnection({
                companyId,
                provider: "slack",
                grantedByUserId: pk.ada,
                ownerUserId: pk.ada,
                grant: grant("T-owned", "Acme Slack"),
            })
        ).rejects.toThrow(/takes no owner/);
    });

    it("shows each member only their own Notion connections", async () => {
        const { upsertConnection } = await import("~/server/services/connectors/connection-store");
        const { loadNotionStatus } = await import("~/server/services/connectors/notion/status");
        await upsertConnection({
            companyId,
            provider: "notion",
            grantedByUserId: pk.ben,
            ownerUserId: pk.ben,
            grant: grant("bot-ben", "Acme HQ"),
        });

        const adas = await loadNotionStatus(await contextFor("ada"));
        const bens = await loadNotionStatus(await contextFor("ben"));
        const cys = await loadNotionStatus(await contextFor("cy"));

        expect(adas.configured).toBe(true);
        expect(adas.connections.map(row => row.workspaceName)).toEqual(["Acme HQ", "Ada's notes"]);
        expect(bens.connections.map(row => row.workspaceName)).toEqual(["Acme HQ"]);
        expect(bens.connections[0]?.connectionId).not.toBe(adas.connections[0]?.connectionId);
        expect(cys.connections).toEqual([]);
    });

    it("counts a member's Notion in their own Ask starters only", async () => {
        const { buildWorkspaceBrief } = await import("~/server/ask-starters/brief");
        const { SCOPE_EVERYTHING } = await import("~/lib/authz/scope-types");

        const adas = await buildWorkspaceBrief(companyId, SCOPE_EVERYTHING, pk.ada);
        const cys = await buildWorkspaceBrief(companyId, SCOPE_EVERYTHING, pk.cy);
        const nobodys = await buildWorkspaceBrief(companyId, SCOPE_EVERYTHING);

        expect(adas.connections).toContain("notion");
        expect(cys.connections).not.toContain("notion");
        expect(nobodys.connections).not.toContain("notion");
    });

    it("never lends a Notion token to company-scoped code", async () => {
        const { getCompanyAccessToken } = await import(
            "~/server/services/connectors/connection-store"
        );
        expect(await getCompanyAccessToken(companyId, "notion")).toBeNull();
    });

    it("still keeps one Gmail connection per member under the narrowed index", async () => {
        const { connectorConnections } = await import("~/server/db/schema");
        const { upsertGmailConnection } = await import(
            "~/server/services/connectors/gmail/connections"
        );
        const params = {
            companyId,
            ownerUserId: pk.cy,
            providerAccountEmail: "cy@acme.test",
            refreshToken: "refresh",
            scopes: "gmail.readonly",
        };

        const first = await upsertGmailConnection({ ...params, providerAccountId: "sub-1" });
        const switched = await upsertGmailConnection({ ...params, providerAccountId: "sub-2" });

        expect(switched.connection.id).toBe(first.connection.id);
        expect(switched.mailboxChanged).toBe(true);
        const rows = await test.db
            .select({ id: connectorConnections.id })
            .from(connectorConnections)
            .where(
                and(
                    eq(connectorConnections.companyId, companyId),
                    eq(connectorConnections.provider, "gmail")
                )
            );
        expect(rows).toHaveLength(1);
    });
    it("adopts a Notion row an older build stored without an owner", async () => {
        const { connectorConnections } = await import("~/server/db/schema");
        const { upsertConnection } = await import("~/server/services/connectors/connection-store");
        const [legacy] = await test.db
            .insert(connectorConnections)
            .values({
                companyId,
                provider: "notion",
                providerAccountId: "bot-legacy",
                grantedByUserId: pk.ben,
                scopes: "",
                status: "active",
                encryptionKeyVersion: 1,
            })
            .returning();

        const adopted = await upsertConnection({
            companyId,
            provider: "notion",
            grantedByUserId: pk.ben,
            ownerUserId: pk.ben,
            grant: grant("bot-legacy", "Legacy"),
        });

        expect(adopted.id).toBe(legacy!.id);
        expect(adopted.ownerUserId).toBe(pk.ben);
    });

    it("lets exactly one of two members racing for one new grant win", async () => {
        const { ConnectorAccountClaimedError, upsertConnection } = await import(
            "~/server/services/connectors/connection-store"
        );
        const race = (who: Person) =>
            upsertConnection({
                companyId,
                provider: "notion",
                grantedByUserId: pk[who],
                ownerUserId: pk[who],
                grant: grant("bot-contested", "Contested", `token-${who}`),
            });

        const results = await Promise.allSettled([race("ada"), race("ben")]);

        const won = results.filter(r => r.status === "fulfilled");
        const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        expect(won).toHaveLength(1);
        expect(lost).toHaveLength(1);
        expect(lost[0]?.reason).toBeInstanceOf(ConnectorAccountClaimedError);
        const winner = (won[0] as PromiseFulfilledResult<{ ownerUserId: bigint | null }>).value;
        const { connectorConnections } = await import("~/server/db/schema");
        const [row] = await test.db
            .select({ owner: connectorConnections.ownerUserId })
            .from(connectorConnections)
            .where(
                and(
                    eq(connectorConnections.companyId, companyId),
                    eq(connectorConnections.providerAccountId, "bot-contested")
                )
            );
        expect(row?.owner).toBe(winner.ownerUserId);
    });

    it("takes a leaving member's Notion and Gmail with them, audited and revoked", async () => {
        const { connectorConnections, workspaceAuditEvents } = await import("~/server/db/schema");
        const { upsertConnection } = await import("~/server/services/connectors/connection-store");
        const { leaveWorkspace } = await import("~/server/workspace/members");
        const { upsertGmailConnection } = await import(
            "~/server/services/connectors/gmail/connections"
        );
        await upsertConnection({
            companyId,
            provider: "notion",
            grantedByUserId: pk.cy,
            ownerUserId: pk.cy,
            grant: grant("bot-cy", "Cy's notes"),
        });
        await upsertGmailConnection({
            companyId,
            ownerUserId: pk.cy,
            providerAccountId: "sub-cy",
            providerAccountEmail: "cy@acme.test",
            refreshToken: "refresh",
            scopes: "gmail.readonly",
        });
        mockRevoke.mockClear();
        const { listConnectionsForOwner } = await import(
            "~/server/services/connectors/connection-store"
        );
        const adasBefore = (await listConnectionsForOwner(companyId, "notion", pk.ada)).length;

        await leaveWorkspace(await contextFor("cy"));

        const cysRows = await test.db
            .select({ id: connectorConnections.id })
            .from(connectorConnections)
            .where(
                and(
                    eq(connectorConnections.companyId, companyId),
                    eq(connectorConnections.ownerUserId, pk.cy)
                )
            );
        expect(cysRows).toEqual([]);
        const audits = await test.db
            .select({
                targetId: workspaceAuditEvents.targetId,
                detail: workspaceAuditEvents.detail,
            })
            .from(workspaceAuditEvents)
            .where(
                and(
                    eq(workspaceAuditEvents.companyId, companyId),
                    eq(workspaceAuditEvents.action, "connector.disconnected")
                )
            );
        expect(audits.map(a => a.targetId).sort()).toEqual(["gmail", "notion"]);
        expect(
            audits.every(a => (a.detail as { reason?: string }).reason === "member-departed")
        ).toBe(true);
        expect(mockRevoke.mock.calls.map(call => (call as unknown[])[0]).sort()).toEqual([
            "gmail",
            "notion",
        ]);
        // Nobody else's connections went with them.
        expect((await listConnectionsForOwner(companyId, "notion", pk.ada)).length).toBe(
            adasBefore
        );
    });
});

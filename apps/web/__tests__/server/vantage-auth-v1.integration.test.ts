/** @jest-environment node */
/**
 * Real auth-context/member/role SELECTs against isolated PostgreSQL. Only the
 * session identity, next/headers cookie store, and real DB wiring are injected.
 * This does not verify cookie signatures, session issuance or browser login.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { configureDatabase, createDb, type Db, type DbClient } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";
import { userCompanyMemberships, users, workspaceRoles } from "~/server/db/schema";

let mockRealDb: DbClient;
let mockCookieValue: string | undefined;
const mockSession = jest.fn<Promise<{ user: { id: string } } | null>, []>();
jest.mock("~/server/db", () => ({
    get db() {
        return mockRealDb;
    },
}));
jest.mock("~/server/auth", () => ({ getServerSession: () => mockSession() }));
jest.mock("next/headers", () => ({
    cookies: async () => ({
        get: (key: string) =>
            key === "pdr_active_company" && mockCookieValue
                ? { value: mockCookieValue }
                : undefined,
    }),
}));

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { canUseVantage } from "~/server/vantage/access";

const url = process.env.VANTAGE_TL_TEST_DATABASE_URL;
if (url) {
    const target = new URL(url);
    if (
        !(
            ["localhost", "127.0.0.1"].includes(target.hostname) &&
            target.port === "55434" &&
            target.pathname === "/vantage_tl_contract_v1" &&
            ["postgres:", "postgresql:"].includes(target.protocol)
        )
    ) {
        throw new Error(
            "TL auth tests require the explicitly named disposable localhost database."
        );
    }
}
const databaseSuite = url ? describe : describe.skip;
const savedEnv = { ...process.env };
type Actor =
    | "operator"
    | "excluded"
    | "no-membership"
    | "viewer"
    | "pending"
    | "suspended"
    | "custom";

databaseSuite(
    "Vantage real workspace/membership/role authorization (session and cookie doubles)",
    () => {
        jest.setTimeout(30000);
        let database: Db;
        let A: bigint, B: bigint;
        let createdCompanies: number[] = [];
        const ids = {} as Record<Actor, { pk: bigint; auth: string }>;
        const actors: Actor[] = [
            "operator",
            "excluded",
            "no-membership",
            "viewer",
            "pending",
            "suspended",
            "custom",
        ];
        function signIn(actor: Actor) {
            mockSession.mockResolvedValue({ user: { id: ids[actor].auth } });
        }
        beforeAll(() => {
            database = createDb({ url: url!, maxConnections: 3 });
            mockRealDb = database.db;
            configureDatabase(database.db);
        });
        beforeEach(async () => {
            jest.clearAllMocks();
            mockCookieValue = undefined;
            const made = await database.db
                .insert(company)
                .values([
                    { name: `TL auth A ${randomUUID()}`, numberOfEmployees: "1" },
                    { name: `TL auth B ${randomUUID()}`, numberOfEmployees: "1" },
                ])
                .returning({ id: company.id });
            createdCompanies = made.map(c => c.id);
            [A, B] = createdCompanies.map(BigInt) as [bigint, bigint];
            for (const actor of actors) {
                const auth = `tl-auth-${actor}-${randomUUID()}`;
                const [row] = await database.db
                    .insert(users)
                    .values({
                        userId: auth,
                        name: `Synthetic ${actor}`,
                        email: `${auth}@example.invalid`,
                        companyId: A,
                        role: "owner",
                        status: "active",
                    })
                    .returning({ id: users.id });
                ids[actor] = { pk: BigInt(row!.id), auth };
            }
            await database.db.insert(userCompanyMemberships).values([
                { userId: ids.operator.pk, companyId: A, role: "member", status: "active" },
                { userId: ids.operator.pk, companyId: B, role: "member", status: "active" },
                { userId: ids.excluded.pk, companyId: A, role: "owner", status: "active" },
                { userId: ids.viewer.pk, companyId: A, role: "viewer", status: "active" },
                { userId: ids.pending.pk, companyId: A, role: "member", status: "pending" },
                { userId: ids.suspended.pk, companyId: A, role: "member", status: "suspended" },
                { userId: ids.custom.pk, companyId: A, role: "pilot-custom", status: "active" },
                { userId: ids.custom.pk, companyId: B, role: "pilot-custom", status: "active" },
            ]);
            await database.db.insert(workspaceRoles).values([
                {
                    companyId: A,
                    slug: "pilot-custom",
                    name: "Synthetic pilot editor",
                    permissions: ["documents.read", "documents.edit"],
                    createdBy: ids.operator.auth,
                },
                {
                    companyId: B,
                    slug: "pilot-custom",
                    name: "Synthetic pilot viewer",
                    permissions: ["documents.read"],
                    createdBy: ids.operator.auth,
                },
            ]);
            process.env.DATABASE_URL = url;
            process.env.VANTAGE_TEST_DATABASE_URL = url;
            process.env.VANTAGE_TEST_MODE = "true";
            process.env.VANTAGE_TEST_COMPANY_ID = A.toString();
            process.env.VANTAGE_TEST_USER_IDS = actors
                .filter(a => a !== "excluded")
                .map(a => ids[a].auth)
                .join(",");
            signIn("operator");
        });
        afterEach(async () => {
            if (createdCompanies.length)
                await database.db.delete(company).where(inArray(company.id, createdCompanies));
            createdCompanies = [];
            process.env = { ...savedEnv };
            mockCookieValue = undefined;
        });
        afterAll(async () => {
            await database?.close();
        });

        it("admits an active permitted member using membership role instead of legacy global owner", async () => {
            const result = await requireWorkspaceContext();
            expect(result.success).toBe(true);
            if (!result.success) throw new Error("Expected a real active workspace context");
            expect(result.data).toMatchObject({
                companyId: A,
                authUserId: ids.operator.auth,
                role: "member",
                status: "active",
            });
            expect(result.data.can("documents.read")).toBe(true);
            expect(result.data.can("documents.edit")).toBe(true);
            expect(result.data.can("workspace.transfer")).toBe(false);
            expect(canUseVantage(result.data)).toBe(true);
        });
        it("excludes a workspace owner who is outside the configured operator allowlist", async () => {
            signIn("excluded");
            const result = await requireWorkspaceContext();
            expect(result.success).toBe(true);
            if (!result.success) throw new Error("Expected the owner workspace context");
            expect(result.data.role).toBe("owner");
            expect(canUseVantage(result.data)).toBe(false);
        });
        it("returns 401 for a missing session and a session identity without a product user", async () => {
            for (const session of [null, { user: { id: `missing-${randomUUID()}` } }]) {
                mockSession.mockResolvedValue(session);
                const result = await requireWorkspaceContext();
                expect(result.success).toBe(false);
                if (result.success) throw new Error("Unexpected authenticated workspace");
                expect(result.response.status).toBe(401);
            }
        });
        it.each(["pending", "suspended"] as const)(
            "rejects a %s membership despite configured operator status",
            async actor => {
                signIn(actor);
                const result = await requireWorkspaceContext();
                expect(result.success).toBe(false);
                if (result.success) throw new Error("Inactive membership was admitted");
                expect(result.response.status).toBe(403);
            }
        );
        it("rejects an unrecognized persisted membership status instead of treating it as active", async () => {
            await database.db
                .update(userCompanyMemberships)
                .set({ status: "unknown" })
                .where(
                    and(
                        eq(userCompanyMemberships.userId, ids.operator.pk),
                        eq(userCompanyMemberships.companyId, A)
                    )
                );
            const result = await requireWorkspaceContext();
            expect(result.success).toBe(false);
            if (result.success) throw new Error("Unknown membership status was admitted");
            expect(result.response.status).toBe(403);
        });

        it("rejects a user with a legacy company/owner role but no membership", async () => {
            signIn("no-membership");
            const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
            try {
                const result = await requireWorkspaceContext();
                expect(result.success).toBe(false);
                if (result.success) throw new Error("Missing membership was admitted");
                expect(result.response.status).toBe(403);
            } finally {
                log.mockRestore();
            }
        });
        it("resolves a second real membership from the cookie but denies it outside the configured pilot workspace", async () => {
            mockCookieValue = B.toString();
            const result = await requireWorkspaceContext();
            expect(result.success).toBe(true);
            if (!result.success) throw new Error("Expected the second membership");
            expect(result.data.companyId).toBe(B);
            expect(canUseVantage(result.data)).toBe(false);
            mockCookieValue = A.toString();
            const back = await requireWorkspaceContext();
            if (!back.success) throw new Error("Expected default membership");
            expect(back.data.companyId).toBe(A);
            expect(canUseVantage(back.data)).toBe(true);
        });
        it("does not let an unowned cookie company select identity", async () => {
            mockCookieValue = "999999999";
            const result = await requireWorkspaceContext();
            if (!result.success) throw new Error("Expected safe default fallback");
            expect(result.data.companyId).toBe(A);
            expect(canUseVantage(result.data)).toBe(true);
        });
        it("requires edit permission even for an allowlisted viewer", async () => {
            signIn("viewer");
            const result = await requireWorkspaceContext();
            if (!result.success) throw new Error("Expected viewer membership context");
            expect(result.data.can("documents.read")).toBe(true);
            expect(result.data.can("documents.edit")).toBe(false);
            expect(canUseVantage(result.data)).toBe(false);
        });
        it("resolves the same custom role slug only within its own company", async () => {
            signIn("custom");
            const local = await requireWorkspaceContext();
            if (!local.success) throw new Error("Expected local custom role context");
            expect(local.data.role).toBe("pilot-custom");
            expect(canUseVantage(local.data)).toBe(true);
            mockCookieValue = B.toString();
            process.env.VANTAGE_TEST_COMPANY_ID = B.toString();
            const other = await requireWorkspaceContext();
            if (!other.success) throw new Error("Expected other custom role context");
            expect(other.data.companyId).toBe(B);
            expect(other.data.can("documents.read")).toBe(true);
            expect(other.data.can("documents.edit")).toBe(false);
            expect(canUseVantage(other.data)).toBe(false);
        });
        it("requires read permission as well as edit for a custom role", async () => {
            await database.db
                .update(workspaceRoles)
                .set({ permissions: ["documents.edit"] })
                .where(
                    and(eq(workspaceRoles.companyId, A), eq(workspaceRoles.slug, "pilot-custom"))
                );
            signIn("custom");
            const result = await requireWorkspaceContext();
            if (!result.success) throw new Error("Expected custom membership context");
            expect(result.data.can("documents.edit")).toBe(true);
            expect(result.data.can("documents.read")).toBe(false);
            expect(canUseVantage(result.data)).toBe(false);
        });
        it("fails closed for an unknown custom membership role", async () => {
            await database.db
                .update(userCompanyMemberships)
                .set({ role: "missing-pilot-role" })
                .where(
                    and(
                        eq(userCompanyMemberships.userId, ids.custom.pk),
                        eq(userCompanyMemberships.companyId, A)
                    )
                );
            signIn("custom");
            const result = await requireWorkspaceContext();
            if (!result.success) throw new Error("Expected identity with no resolved permissions");
            expect(result.data.permissions.size).toBe(0);
            expect(canUseVantage(result.data)).toBe(false);
        });
    }
);

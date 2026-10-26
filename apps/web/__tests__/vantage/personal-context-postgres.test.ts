/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createDb, type Db } from "@launchstack/store/client";
import { company, document, documentVersions, documentSections } from "@launchstack/store/schema";
import {
    userCompanyMemberships,
    users,
    documentSettings,
    documentGrants,
    vantageDocumentStars,
} from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import {
    loadPersonalContext,
    savePersonalRoles,
    setPersonalStar,
    createDatabasePersonalContextProviderV0,
} from "~/server/vantage/personal-context";
import { createPostgresPersonalContextStoreV0 } from "~/server/vantage/personal-context-store";

jest.mock("~/server/db", () => ({ db: {} }));
const url = process.env.JOSEPH_CONTEXT_TEST_DATABASE_URL;
const describeDatabase = url ? describe : describe.skip;
describeDatabase("personal context with real PostgreSQL", () => {
    let connection: Db;
    let ctx: WorkspaceContext;
    let other: WorkspaceContext;
    let docId: string;
    let versionId: number;
    const companies: number[] = [];
    beforeAll(async () => {
        const parsed = new URL(url!);
        if (
            parsed.hostname !== "127.0.0.1" ||
            parsed.port !== "55439" ||
            parsed.pathname !== "/joseph_context_test"
        )
            throw new Error("Use only the isolated Joseph test database.");
        connection = createDb({ url: url! });
        const rows = await connection.client`select current_database() as name`;
        expect(rows[0]?.name).toBe("joseph_context_test");
    });
    async function member(companyId: bigint, title = "Founder + Engineering") {
        const authUserId = `context-test-${randomUUID()}`;
        const [user] = await connection.db
            .insert(users)
            .values({
                name: "Context test",
                email: `${authUserId}@example.test`,
                userId: authUserId,
                companyId,
                title,
            })
            .returning();
        await connection.db
            .insert(userCompanyMemberships)
            .values({ userId: BigInt(user!.id), companyId, role: "member", status: "active" });
        return {
            userPk: BigInt(user!.id),
            companyId,
            authUserId,
            role: "member",
            status: "active",
        } as WorkspaceContext;
    }
    beforeEach(async () => {
        const [workspace] = await connection.db
            .insert(company)
            .values({
                name: "Joseph context integration test",
                slug: `ctx-${randomUUID()}`,
                numberOfEmployees: "2",
            })
            .returning();
        companies.push(workspace!.id);
        ctx = await member(BigInt(workspace!.id));
        other = await member(ctx.companyId);
        const [doc] = await connection.db
            .insert(document)
            .values({
                companyId: ctx.companyId,
                title: "Old engineering constraints",
                category: "",
                url: "https://example.test/synthetic.txt",
            })
            .returning();
        docId = String(doc!.id);
        const [version] = await connection.db
            .insert(documentVersions)
            .values({
                documentId: BigInt(docId),
                versionNumber: 1,
                url: "https://example.test/synthetic.txt",
                mimeType: "text/plain",
                createdAt: new Date("2026-01-01T00:00:00Z"),
            })
            .returning();
        versionId = version!.id;
        await connection.db
            .update(document)
            .set({ currentVersionId: BigInt(versionId) })
            .where(eq(document.id, Number(docId)));
        await connection.db.insert(documentSections).values({
            documentId: BigInt(docId),
            versionId: BigInt(versionId),
            content: "Every release needs a rollback plan.",
            pageNumber: 1,
            lineStart: 0,
        });
    });
    afterAll(async () => {
        if (connection) {
            for (const id of companies)
                await connection.db.delete(company).where(eq(company.id, id));
            await connection.close();
        }
    });
    it("uses profile suggestions, persists multiple roles and primary without changing permissions", async () => {
        const initial = await loadPersonalContext(ctx, connection.db);
        expect(initial.roles.roleIds).toEqual(["founder", "engineering"]);
        expect(initial.roles.userConfirmed).toBe(false);
        await savePersonalRoles(
            ctx,
            {
                roleIds: ["founder", "engineering"],
                primaryRoleId: "engineering",
                expectedRevision: 0,
            },
            connection.db
        );
        const restarted = createDb({ url: url! });
        try {
            const saved = await loadPersonalContext(ctx, restarted.db);
            expect(saved.roles.roleIds).toEqual(["engineering", "founder"]);
            expect(saved.roles.userConfirmed).toBe(true);
            expect(saved.state.revision).toBe(1);
            const [row] = await restarted.db
                .select()
                .from(userCompanyMemberships)
                .where(eq(userCompanyMemberships.userId, ctx.userPk));
            expect(row?.role).toBe("member");
        } finally {
            await restarted.close();
        }
    });
    it("prefers workspace title and preserves an explicitly empty confirmed role selection", async () => {
        await connection.db
            .update(userCompanyMemberships)
            .set({ profileTitle: "Product" })
            .where(eq(userCompanyMemberships.userId, ctx.userPk));
        expect((await loadPersonalContext(ctx, connection.db)).roles.roleIds).toEqual(["product"]);
        await savePersonalRoles(ctx, { roleIds: [], expectedRevision: 0 }, connection.db);
        const view = await loadPersonalContext(ctx, connection.db);
        expect(view.roles.roleIds).toEqual([]);
        expect(view.roles.userConfirmed).toBe(true);
    });
    it("allows exactly one racing write and retains its complete state", async () => {
        const outcomes = await Promise.allSettled([
            savePersonalRoles(ctx, { roleIds: ["founder"], expectedRevision: 0 }, connection.db),
            setPersonalStar(ctx, docId, { starred: true, expectedRevision: 0 }, connection.db),
        ]);
        expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
        const failed = outcomes.find(result => result.status === "rejected")!;
        expect(failed.reason.status).toBe(409);
        expect((await loadPersonalContext(ctx, connection.db)).state.revision).toBe(1);
    });
    it("includes old stars with exact version text and isolates another user's choices", async () => {
        await setPersonalStar(ctx, docId, { starred: true, expectedRevision: 0 }, connection.db);
        const view = await loadPersonalContext(ctx, connection.db);
        expect(view.snapshot?.sources[0]?.source.version).toBe(String(versionId));
        expect(view.snapshot?.sources[0]?.excerpt).toBe("Every release needs a rollback plan.");
        expect(view.snapshot?.sources[0]?.sourceDate).toBe("2026-01-01T00:00:00.000Z");
        expect((await loadPersonalContext(other, connection.db)).state.stars).toHaveLength(0);
        await expect(loadPersonalContext(ctx, connection.db, 0)).rejects.toMatchObject({
            status: 409,
        });
    });
    it("reads new exact-version text instead of stale starred content", async () => {
        await setPersonalStar(ctx, docId, { starred: true, expectedRevision: 0 }, connection.db);
        const [version] = await connection.db
            .insert(documentVersions)
            .values({
                documentId: BigInt(docId),
                versionNumber: 2,
                url: "https://example.test/new.txt",
                mimeType: "text/plain",
                createdAt: new Date("2026-02-01T00:00:00Z"),
            })
            .returning();
        await connection.db.insert(documentSections).values({
            documentId: BigInt(docId),
            versionId: BigInt(version!.id),
            content: "Updated release policy.",
        });
        await connection.db
            .update(document)
            .set({ currentVersionId: BigInt(version!.id) })
            .where(eq(document.id, Number(docId)));
        expect((await loadPersonalContext(ctx, connection.db)).snapshot?.sources[0]?.excerpt).toBe(
            "Updated release policy."
        );
    });
    it("hides revoked source titles/text, blocks the snapshot and permits removal", async () => {
        await setPersonalStar(ctx, docId, { starred: true, expectedRevision: 0 }, connection.db);
        await connection.db.insert(documentSettings).values({
            documentId: BigInt(docId),
            companyId: ctx.companyId,
            restricted: true,
            updatedBy: other.authUserId,
        });
        const view = await loadPersonalContext(ctx, connection.db);
        expect(view.ready).toBe(false);
        expect(view.snapshot).toBeNull();
        expect(view.documents).toEqual([]);
        expect(JSON.stringify(view)).not.toContain("rollback plan");
        expect(JSON.stringify(view)).not.toContain("Old engineering constraints");
        await setPersonalStar(ctx, docId, { starred: false, expectedRevision: 1 }, connection.db);
        expect((await loadPersonalContext(ctx, connection.db)).ready).toBe(true);
    });
    it("respects explicit document grants", async () => {
        await connection.db.insert(documentSettings).values({
            documentId: BigInt(docId),
            companyId: ctx.companyId,
            restricted: true,
            updatedBy: other.authUserId,
        });
        await expect(
            setPersonalStar(ctx, docId, { starred: true, expectedRevision: 0 }, connection.db)
        ).rejects.toMatchObject({ status: 404 });
        await connection.db.insert(documentGrants).values({
            companyId: ctx.companyId,
            documentId: BigInt(docId),
            principalType: "user",
            principalId: String(ctx.userPk),
            level: "view",
            grantedBy: other.authUserId,
        });
        await setPersonalStar(ctx, docId, { starred: true, expectedRevision: 0 }, connection.db);
        expect((await loadPersonalContext(ctx, connection.db)).ready).toBe(true);
    });
    it("retains missing-source diagnostics after document deletion", async () => {
        await setPersonalStar(ctx, docId, { starred: true, expectedRevision: 0 }, connection.db);
        await connection.db.delete(document).where(eq(document.id, Number(docId)));
        const view = await loadPersonalContext(ctx, connection.db);
        expect(view.state.stars).toHaveLength(1);
        expect(view.snapshot).toBeNull();
        await setPersonalStar(ctx, docId, { starred: false, expectedRevision: 1 }, connection.db);
        expect((await loadPersonalContext(ctx, connection.db)).state.stars).toHaveLength(0);
    });
    it("does not silently use unversioned chunks or truncate oversized context", async () => {
        await connection.db
            .update(documentSections)
            .set({ versionId: null })
            .where(eq(documentSections.documentId, BigInt(docId)));
        await setPersonalStar(ctx, docId, { starred: true, expectedRevision: 0 }, connection.db);
        expect((await loadPersonalContext(ctx, connection.db)).snapshot).toBeNull();
        await connection.db
            .update(documentSections)
            .set({ versionId: BigInt(versionId), content: "x".repeat(64001) })
            .where(eq(documentSections.documentId, BigInt(docId)));
        expect((await loadPersonalContext(ctx, connection.db)).snapshot).toBeNull();
    });
    it("rejects cross-workspace star additions without writing", async () => {
        const [workspace] = await connection.db
            .insert(company)
            .values({ name: "Other test", numberOfEmployees: "1" })
            .returning();
        companies.push(workspace!.id);
        const outsider = await member(BigInt(workspace!.id));
        await expect(
            setPersonalStar(outsider, docId, { starred: true, expectedRevision: 0 }, connection.db)
        ).rejects.toMatchObject({ status: 404 });
        expect((await loadPersonalContext(outsider, connection.db)).state.revision).toBe(0);
    });
    it("rechecks suspended membership for reads and writes", async () => {
        await connection.db
            .update(userCompanyMemberships)
            .set({ status: "suspended" })
            .where(eq(userCompanyMemberships.userId, ctx.userPk));
        await expect(loadPersonalContext(ctx, connection.db)).rejects.toMatchObject({
            status: 403,
        });
        await expect(
            savePersonalRoles(ctx, { roleIds: ["founder"], expectedRevision: 0 }, connection.db)
        ).rejects.toMatchObject({ status: 403 });
    });
    it("validates actor and ACL again inside store compare-and-swap", async () => {
        const view = await loadPersonalContext(ctx, connection.db);
        const store = createPostgresPersonalContextStoreV0(ctx, connection.db);
        const actor = view.snapshot!.actor;
        await expect(
            store.read({ ...actor, principalRef: other.authUserId })
        ).rejects.toMatchObject({ status: 403 });
        const next = {
            ...view.state,
            revision: 1,
            stars: [
                {
                    documentId: docId,
                    lastKnownRef: { kind: "doc" as const, id: docId, version: String(versionId) },
                    starredAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ],
        };
        await connection.db.insert(documentSettings).values({
            documentId: BigInt(docId),
            companyId: ctx.companyId,
            restricted: true,
            updatedBy: other.authUserId,
        });
        await expect(store.compareAndSwap(actor, 0, next)).rejects.toMatchObject({ status: 409 });
        expect((await store.read(actor)).revision).toBe(0);
    });
    it("binds the shared provider to saved database roles and exact historical star versions", async () => {
        await setPersonalStar(ctx, docId, { starred: true, expectedRevision: 0 }, connection.db);
        const provider = createDatabasePersonalContextProviderV0(
            ctx,
            {
                requiredSources: async () => ({
                    companyArchitecture: null,
                    workspaceMandatoryDocuments: [],
                }),
                readSource: async () => ({ status: "missing" }),
            },
            connection.db
        );
        const input = {
            companyId: String(ctx.companyId),
            principalRef: ctx.authUserId,
            reportWindow: {
                startInclusive: "2026-01-01",
                endExclusive: new Date().toISOString(),
                asOf: new Date().toISOString(),
            },
            budgets: {
                maxSources: 100,
                maxExcerptChars: 64000,
                maxTokens: 16000,
                maxQueries: 0,
                timeoutMs: 10000,
            },
        };
        const roles = await provider.resolveBusinessRoles(input);
        await expect(
            provider.prepareRequiredContext({ ...input, roleContext: roles })
        ).rejects.toMatchObject({
            diagnostics: {
                sources: expect.arrayContaining([
                    expect.objectContaining({ lane: "star", status: "used" }),
                    expect.objectContaining({ lane: "company", status: "missing" }),
                ]),
            },
        });
    });
    it("cascades personal selections on membership deletion", async () => {
        await setPersonalStar(ctx, docId, { starred: true, expectedRevision: 0 }, connection.db);
        await connection.db
            .delete(userCompanyMemberships)
            .where(
                and(
                    eq(userCompanyMemberships.userId, ctx.userPk),
                    eq(userCompanyMemberships.companyId, ctx.companyId)
                )
            );
        expect(
            await connection.db
                .select()
                .from(vantageDocumentStars)
                .where(eq(vantageDocumentStars.userId, ctx.userPk))
        ).toEqual([]);
    });
});

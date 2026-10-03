/**
 * `resolveDocumentScope` and `scopedDocumentWhere` against a real Postgres,
 * migrated with both ledgers — the migration that created the access tables
 * is exercised on the way in.
 *
 * Gated like the founder-weekly-review suites: runs only when
 * LAUNCHSTACK_TEST_DATABASE_URL (or DATABASE_URL) points at a local server.
 */
import { and, eq } from "drizzle-orm";

import { callNotesCalls } from "@launchstack/pipelines/schema";
import {
    documentScopeSql,
    scopeAllowsDocument as retrievalAllowsDocument,
} from "@launchstack/retrieval/algorithms/scope";
import { category, company, document } from "@launchstack/store/schema";
import type { DbClient } from "@launchstack/store/client";
import { builtinRolePermissions } from "~/lib/authz/permissions";
import { resolveDocumentScope, scopedDocumentWhere } from "~/lib/authz/scope";
import { SCOPE_EVERYTHING, scopeAllowsDocument } from "~/lib/authz/scope-types";
import { callNoteDocumentReference, isCallNoteDocument } from "~/lib/call-note-document";
import {
    documentNotes,
    documentSettings,
    documentGrants,
    userCompanyMemberships,
} from "~/server/db/schema";
import { listVisibleFolders } from "~/server/folders";

import { createFounderWeeklyReviewTestDatabase } from "../founderWeeklyReview/testDb";

// The resolver reads the app's shared client; point it at the throwaway
// database for the duration of the suite.
let mockActiveDb: DbClient | null = null;
jest.mock("~/server/db", () => ({
    get db() {
        if (!mockActiveDb) throw new Error("test database not ready");
        return mockActiveDb;
    },
}));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

describeDb("resolveDocumentScope (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let ids: {
        companyId: bigint;
        owner: bigint;
        member: bigint;
        financeMember: bigint;
        groupMember: bigint;
        guest: bigint;
        viewer: bigint;
        finance: bigint;
        general: bigint;
        docGeneral: number;
        docFinance: number;
        docBoardDeck: number;
        financeGroup: bigint;
    };

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;

        const {
            users,
            userCompanyMemberships,
            workspaceGroups,
            workspaceGroupMembers,
            folderSettings,
            folderGrants,
            documentSettings,
            documentGrants,
        } = await import("~/server/db/schema");

        const [co] = await test.db
            .insert(company)
            .values({ name: "Acme", numberOfEmployees: "20" })
            .returning();
        const companyId = BigInt(co!.id);

        const mkUser = async (name: string) => {
            const [u] = await test.db
                .insert(users)
                .values({
                    name,
                    email: `${name}@acme.test`,
                    userId: `auth_${name}`,
                    companyId,
                })
                .returning();
            return BigInt(u!.id);
        };
        const owner = await mkUser("owner");
        const member = await mkUser("member");
        const financeMember = await mkUser("finance");
        const groupMember = await mkUser("grouped");
        const guest = await mkUser("guest");
        const viewer = await mkUser("viewer");

        await test.db.insert(userCompanyMemberships).values([
            { userId: owner, companyId, role: "owner", status: "active" },
            { userId: member, companyId, role: "member", status: "active" },
            { userId: financeMember, companyId, role: "member", status: "active" },
            { userId: groupMember, companyId, role: "member", status: "active" },
            { userId: guest, companyId, role: "guest", status: "active" },
            { userId: viewer, companyId, role: "viewer", status: "active" },
        ]);

        const [finance] = await test.db
            .insert(category)
            .values({ name: "Finance", companyId })
            .returning();
        const [general] = await test.db
            .insert(category)
            .values({ name: "General", companyId })
            .returning();

        const mkDoc = async (title: string, cat: string) => {
            const [d] = await test.db
                .insert(document)
                .values({ companyId, url: `local://${title}`, category: cat, title })
                .returning();
            return d!.id;
        };
        const docGeneral = await mkDoc("Handbook", "General");
        const docFinance = await mkDoc("Ledger", "Finance");
        const docBoardDeck = await mkDoc("Board deck", "General");
        // Folders are paths: Reports is only implied by its document, Secret is
        // a stored subfolder that is restricted on its own with no grants.
        await mkDoc("Budget", "Finance/Reports");
        const [secret] = await test.db
            .insert(category)
            .values({ name: "Finance/Secret", companyId })
            .returning();
        await mkDoc("Plan", "Finance/Secret");

        const [grp] = await test.db
            .insert(workspaceGroups)
            .values({
                companyId,
                name: "Finance team",
                slug: "finance-team",
                createdBy: "auth_owner",
            })
            .returning();
        const financeGroup = BigInt(grp!.id);
        await test.db
            .insert(workspaceGroupMembers)
            .values({ groupId: financeGroup, userId: groupMember, addedBy: "auth_owner" });

        await test.db.insert(folderSettings).values([
            {
                categoryId: BigInt(finance!.id),
                companyId,
                visibility: "restricted",
                updatedBy: "auth_owner",
            },
            {
                categoryId: BigInt(secret!.id),
                companyId,
                visibility: "restricted",
                updatedBy: "auth_owner",
            },
        ]);
        await test.db.insert(folderGrants).values([
            {
                companyId,
                categoryId: BigInt(finance!.id),
                principalType: "user",
                principalId: financeMember.toString(),
                level: "view",
                grantedBy: "auth_owner",
            },
            {
                companyId,
                categoryId: BigInt(finance!.id),
                principalType: "group",
                principalId: financeGroup.toString(),
                level: "edit",
                grantedBy: "auth_owner",
            },
            {
                companyId,
                categoryId: BigInt(finance!.id),
                principalType: "role",
                principalId: "guest",
                level: "view",
                grantedBy: "auth_owner",
            },
        ]);

        // The board deck sits in the shared General folder but is restricted to
        // the viewer alone.
        await test.db.insert(documentSettings).values({
            documentId: BigInt(docBoardDeck),
            companyId,
            restricted: true,
            updatedBy: "auth_owner",
        });
        await test.db.insert(documentGrants).values({
            companyId,
            documentId: BigInt(docBoardDeck),
            principalType: "user",
            principalId: viewer.toString(),
            level: "view",
            grantedBy: "auth_owner",
        });

        ids = {
            companyId,
            owner,
            member,
            financeMember,
            groupMember,
            guest,
            viewer,
            finance: BigInt(finance!.id),
            general: BigInt(general!.id),
            docGeneral,
            docFinance,
            docBoardDeck,
            financeGroup,
        };
    });

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    async function scopeFor(userPk: bigint, role: string) {
        const { resolveDocumentScope } = await import("~/lib/authz/scope");
        const { builtinRolePermissions } = await import("~/lib/authz/permissions");
        return resolveDocumentScope({
            companyId: ids.companyId,
            userPk,
            role,
            permissions: builtinRolePermissions(role)!,
        });
    }

    async function visibleTitles(userPk: bigint, role: string) {
        const { scopedDocumentWhere } = await import("~/lib/authz/scope");
        const scope = await scopeFor(userPk, role);
        const rows = await test.db
            .select({ title: document.title })
            .from(document)
            .where(scopedDocumentWhere(ids.companyId, scope));
        return rows.map(r => r.title).sort();
    }

    it("gives an owner everything without touching the grant tables", async () => {
        const scope = await scopeFor(ids.owner, "owner");
        expect(scope.kind).toBe("everything");
        expect(await visibleTitles(ids.owner, "owner")).toEqual([
            "Board deck",
            "Budget",
            "Handbook",
            "Ledger",
            "Plan",
        ]);
    });

    it("hides the restricted folder, its subfolders, and the restricted document from a plain member", async () => {
        const scope = await scopeFor(ids.member, "member");
        expect(scope).toEqual({
            kind: "except",
            deniedCategories: ["Finance", "Finance/Secret"],
            allowedCategories: [],
            deniedDocumentIds: [ids.docBoardDeck],
            allowedDocumentIds: [],
        });
        expect(await visibleTitles(ids.member, "member")).toEqual(["Handbook"]);
    });

    it("opens the folder and its implied subfolders through a user grant, but not a restricted subfolder", async () => {
        expect(await visibleTitles(ids.financeMember, "member")).toEqual([
            "Budget",
            "Handbook",
            "Ledger",
        ]);
    });

    it("opens the folder through a group grant", async () => {
        expect(await visibleTitles(ids.groupMember, "member")).toEqual([
            "Budget",
            "Handbook",
            "Ledger",
        ]);
    });

    it("re-allows a restricted document through an explicit document grant", async () => {
        const scope = await scopeFor(ids.viewer, "viewer");
        expect(scope).toEqual({
            kind: "except",
            deniedCategories: ["Finance", "Finance/Secret"],
            allowedCategories: [],
            deniedDocumentIds: [],
            allowedDocumentIds: [ids.docBoardDeck],
        });
        expect(await visibleTitles(ids.viewer, "viewer")).toEqual(["Board deck", "Handbook"]);
    });

    it("confines a guest to the folders granted to their role", async () => {
        const scope = await scopeFor(ids.guest, "guest");
        expect(scope).toEqual({
            kind: "only",
            allowedCategories: ["Finance"],
            deniedCategories: ["Finance/Secret"],
            deniedDocumentIds: [ids.docBoardDeck],
            allowedDocumentIds: [],
        });
        expect(await visibleTitles(ids.guest, "guest")).toEqual(["Budget", "Ledger"]);
    });

    it("gives a person without documents.read nothing at all", async () => {
        const { resolveDocumentScope } = await import("~/lib/authz/scope");
        const { scopedDocumentWhere } = await import("~/lib/authz/scope");
        const scope = await resolveDocumentScope({
            companyId: ids.companyId,
            userPk: ids.member,
            role: "custom-no-read",
            permissions: new Set(),
        });
        expect(scope.kind).toBe("only");
        const rows = await test.db
            .select({ id: document.id })
            .from(document)
            .where(scopedDocumentWhere(ids.companyId, scope));
        expect(rows).toEqual([]);
    });

    it("collapses to everything once the workspace has nothing restricted", async () => {
        const { folderSettings, documentSettings } = await import("~/server/db/schema");
        await test.db.delete(folderSettings).where(eq(folderSettings.companyId, ids.companyId));
        await test.db.delete(documentSettings).where(eq(documentSettings.companyId, ids.companyId));

        const scope = await scopeFor(ids.member, "member");
        expect(scope.kind).toBe("everything");
        expect(await visibleTitles(ids.member, "member")).toEqual([
            "Board deck",
            "Budget",
            "Handbook",
            "Ledger",
            "Plan",
        ]);
    });

    describe("Call Note document eligibility", () => {
        const ineligibleKinds = [
            "private",
            "deleted",
            "active",
            "finalizing",
            "failed",
            "wrong-note-owner",
            "wrong-note-company",
            "unversioned",
        ] as const;
        const kinds = [...ineligibleKinds, "eligible"] as const;
        type CallNoteKind = (typeof kinds)[number];
        let companyId: bigint;
        let callNoteDocuments: Record<CallNoteKind, number>;
        let ordinaryDocumentId: number;

        beforeAll(async () => {
            const [co] = await test.db
                .insert(company)
                .values({ name: "Call Notes workspace", numberOfEmployees: "3" })
                .returning();
            companyId = BigInt(co!.id);
            await test.db.insert(userCompanyMemberships).values(
                (["owner", "member", "guest"] as const).map(role => ({
                    userId: ids[role],
                    companyId,
                    role,
                    status: "active" as const,
                }))
            );
            await test.db.insert(category).values({ companyId, name: "Calls" });

            const documentIds: [CallNoteKind, number][] = [];
            for (const kind of kinds) {
                const callId = `scope-${kind}-call`;
                const [doc] = await test.db
                    .insert(document)
                    .values({
                        companyId,
                        title: `Call Note ${kind}`,
                        url: `local://call-note-${kind}.md`,
                        category: "Calls",
                        ocrMetadata:
                            kind === "deleted"
                                ? { callNote: { callId } }
                                : { error: "processing_failed" },
                    })
                    .returning({ id: document.id });
                documentIds.push([kind, doc!.id]);
                if (kind !== "deleted") {
                    const [note] = await test.db
                        .insert(documentNotes)
                        .values({
                            userId: kind === "wrong-note-owner" ? "auth_member" : "auth_owner",
                            companyId:
                                kind === "wrong-note-company"
                                    ? ids.companyId.toString()
                                    : companyId.toString(),
                            title: `Call Note ${kind}`,
                            contentMarkdown: `# Call ${kind}`,
                        })
                        .returning({ id: documentNotes.id });
                    await test.db.insert(callNotesCalls).values({
                        id: callId,
                        companyId,
                        source: "local_audio",
                        sourceOccurrenceKey: callId,
                        title: `Call ${kind}`,
                        status:
                            kind === "active" || kind === "finalizing" || kind === "failed"
                                ? kind
                                : "completed",
                        documentNoteId: note!.id,
                        noteOwnerUserId: "auth_owner",
                        currentNoteRevision: kind === "unversioned" ? 0 : 1,
                        noteVisibility: kind === "private" ? "private" : "company",
                        indexedDocumentId: BigInt(doc!.id),
                    });
                }
            }
            callNoteDocuments = Object.fromEntries(documentIds) as Record<CallNoteKind, number>;

            // Even an explicit document grant cannot restore an ineligible Call Note.
            await test.db.insert(documentSettings).values(
                kinds.map(kind => ({
                    documentId: BigInt(callNoteDocuments[kind]),
                    companyId,
                    restricted: true,
                    updatedBy: "auth_owner",
                }))
            );
            await test.db.insert(documentGrants).values(
                kinds.flatMap(kind =>
                    ["member", "guest"].map(role => ({
                        documentId: BigInt(callNoteDocuments[kind]),
                        companyId,
                        principalType: "role" as const,
                        principalId: role,
                        level: "view" as const,
                        grantedBy: "auth_owner",
                    }))
                )
            );
            const [ordinary] = await test.db
                .insert(document)
                .values({
                    companyId,
                    title: "Ordinary document",
                    url: "local://ordinary.md",
                    category: "General",
                    ocrMetadata: { confidence: 0.97 },
                })
                .returning({ id: document.id });
            ordinaryDocumentId = ordinary!.id;
        });

        async function callNoteScope(role: "owner" | "member" | "guest") {
            return resolveDocumentScope({
                companyId,
                userPk: ids[role],
                role,
                permissions: builtinRolePermissions(role)!,
            });
        }

        it("keeps everything scope for a manager in a workspace without Call Note documents", async () => {
            expect(await scopeFor(ids.owner, "owner")).toBe(SCOPE_EVERYTHING);
        });

        it.each(["owner", "member", "guest"] as const)(
            "denies ineligible Call Notes for %s even after metadata is lost, despite explicit grants",
            async role => {
                const scope = await callNoteScope(role);
                expect(scope.kind).toBe(role === "guest" ? "only" : "except");
                if (scope.kind === "everything") throw new Error("Call Notes must be gated");
                const deniedIds = ineligibleKinds.map(kind => callNoteDocuments[kind]);
                expect([...scope.deniedDocumentIds].sort((a, b) => a - b)).toEqual(
                    [...deniedIds].sort((a, b) => a - b)
                );
                for (const id of deniedIds) {
                    expect(scope.allowedDocumentIds).not.toContain(id);
                    expect(scopeAllowsDocument(scope, { id, category: "Calls" })).toBe(false);
                    expect(retrievalAllowsDocument(scope, { id, category: "Calls" })).toBe(false);
                }
                expect(
                    scopeAllowsDocument(scope, {
                        id: callNoteDocuments.eligible,
                        category: "Calls",
                    })
                ).toBe(true);
                const expectedIds =
                    role === "guest"
                        ? [callNoteDocuments.eligible]
                        : [callNoteDocuments.eligible, ordinaryDocumentId];
                const visible = await test.db
                    .select({ id: document.id })
                    .from(document)
                    .where(scopedDocumentWhere(companyId, scope))
                    .orderBy(document.id);
                expect(visible.map(row => row.id)).toEqual(expectedIds);
                const retrievable = await test.db
                    .select({ id: document.id })
                    .from(document)
                    .where(and(eq(document.companyId, companyId), documentScopeSql(scope)))
                    .orderBy(document.id);
                expect(retrievable.map(row => row.id)).toEqual(expectedIds);
            }
        );

        it("classifies indexed Call copies without a marker and leaves ordinary documents alone", async () => {
            const rows = await test.db
                .select({
                    id: document.id,
                    ocrMetadata: document.ocrMetadata,
                    indexedCallNote: callNoteDocumentReference(document, callNotesCalls),
                })
                .from(document)
                .where(eq(document.companyId, companyId));
            const classifiedIds = rows.filter(isCallNoteDocument).map(row => row.id);
            expect(classifiedIds.sort((a, b) => a - b)).toEqual(
                Object.values(callNoteDocuments).sort((a, b) => a - b)
            );
            expect(classifiedIds).not.toContain(ordinaryDocumentId);
        });

        it.each(["owner", "member"] as const)(
            "excludes ineligible Call Notes from visible folder document counts for %s",
            async role => {
                const folders = await listVisibleFolders(companyId, await callNoteScope(role));
                expect(folders.find(folder => folder.path === "Calls")?.documentCount).toBe(1);
            }
        );

        it.each(["owner", "member"] as const)(
            "denies a formerly eligible Call Note after its canonical note is deleted for %s",
            async role => {
                const [co] = await test.db
                    .insert(company)
                    .values({ name: `Deleted canonical note (${role})`, numberOfEmployees: "1" })
                    .returning();
                const deletedNoteCompanyId = BigInt(co!.id);
                const [note] = await test.db
                    .insert(documentNotes)
                    .values({
                        userId: "auth_owner",
                        companyId: deletedNoteCompanyId.toString(),
                        contentMarkdown: "# Completed call",
                    })
                    .returning({ id: documentNotes.id });
                const [doc] = await test.db
                    .insert(document)
                    .values({
                        companyId: deletedNoteCompanyId,
                        title: "Published Call Note",
                        url: `local://deleted-canonical-${role}.md`,
                        category: "Calls",
                    })
                    .returning({ id: document.id });
                await test.db.insert(callNotesCalls).values({
                    id: `deleted-canonical-${role}`,
                    companyId: deletedNoteCompanyId,
                    source: "local_audio",
                    sourceOccurrenceKey: `deleted-canonical-${role}`,
                    title: "Completed call",
                    status: "completed",
                    documentNoteId: note!.id,
                    noteOwnerUserId: "auth_owner",
                    currentNoteRevision: 1,
                    noteVisibility: "company",
                    indexedDocumentId: BigInt(doc!.id),
                });
                const subject = {
                    companyId: deletedNoteCompanyId,
                    userPk: ids[role],
                    role,
                    permissions: builtinRolePermissions(role)!,
                };
                expect(
                    scopeAllowsDocument(await resolveDocumentScope(subject), {
                        id: doc!.id,
                        category: "Calls",
                    })
                ).toBe(true);

                await test.db.delete(documentNotes).where(eq(documentNotes.id, note!.id));

                const scope = await resolveDocumentScope(subject);
                expect(scopeAllowsDocument(scope, { id: doc!.id, category: "Calls" })).toBe(false);
                expect(retrievalAllowsDocument(scope, { id: doc!.id, category: "Calls" })).toBe(
                    false
                );
                const visible = await test.db
                    .select({ id: document.id })
                    .from(document)
                    .where(scopedDocumentWhere(deletedNoteCompanyId, scope));
                expect(visible).toEqual([]);
            }
        );

        it("denies an orphaned Call Note when no folder or document restrictions exist", async () => {
            const [co] = await test.db
                .insert(company)
                .values({ name: "Unrestricted Call Notes", numberOfEmployees: "1" })
                .returning();
            const unrestrictedCompanyId = BigInt(co!.id);
            const [doc] = await test.db
                .insert(document)
                .values({
                    companyId: unrestrictedCompanyId,
                    title: "Deleted Call Note",
                    url: "local://deleted-call-note.md",
                    category: "Calls",
                    ocrMetadata: { callNote: { callId: "no-longer-present" } },
                })
                .returning({ id: document.id });
            const scope = await resolveDocumentScope({
                companyId: unrestrictedCompanyId,
                userPk: ids.member,
                role: "member",
                permissions: builtinRolePermissions("member")!,
            });
            expect(scope).toEqual({
                kind: "except",
                deniedCategories: [],
                deniedDocumentIds: [doc!.id],
                allowedDocumentIds: [],
            });
            const visible = await test.db
                .select({ id: document.id })
                .from(document)
                .where(scopedDocumentWhere(unrestrictedCompanyId, scope));
            expect(visible).toEqual([]);
        });
    });
});

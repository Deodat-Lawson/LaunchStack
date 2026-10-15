/**
 * Mindmap drafts follow ADR-014 — the routes, against a real Postgres.
 *
 * A draft is seen by whoever can open its folder, and an Unfiled draft only by
 * whoever made it; a draft the caller cannot see is a 404 on every verb. A move
 * takes edit access to the destination and never shows the draft to someone
 * new unless only its mover could see it, and renaming or deleting a folder
 * takes its drafts along without publishing them.
 *
 * The visibility rule is a SQL predicate, so a fake database cannot test it:
 * this runs on a throwaway database migrated with both ledgers, gated like the
 * other integration suites (LAUNCHSTACK_TEST_DATABASE_URL or DATABASE_URL
 * pointing at a local server).
 */

import type { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { category, company } from "@launchstack/store/schema";
import type { DbClient } from "@launchstack/store/client";
import { builtinRolePermissions } from "~/lib/authz/permissions";
import { resolveDocumentScope } from "~/lib/authz/scope";
import type { DocumentScope } from "~/lib/authz/scope-types";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import {
    folderGrants,
    folderSettings,
    mindmaps,
    userCompanyMemberships,
    users,
} from "~/server/db/schema";
import { GET as listRoute, POST as createRoute } from "~/app/api/mindmaps/route";
import {
    DELETE as deleteRoute,
    GET as getRoute,
    PATCH as patchRoute,
} from "~/app/api/mindmaps/[id]/route";
import { GET as revisionsRoute } from "~/app/api/mindmaps/[id]/revisions/route";
import { GET as thumbnailRoute } from "~/app/api/mindmaps/[id]/thumbnail/route";
import { POST as duplicateRoute } from "~/app/api/mindmaps/[id]/duplicate/route";
import { DELETE as deleteFolderRoute, PATCH as renameFolderRoute } from "~/app/api/folders/route";

import { createFounderWeeklyReviewTestDatabase } from "../founderWeeklyReview/testDb";

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
        .requireActual("../helpers/mock-require-workspace-context")
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

type Person = "ada" | "bea" | "cy" | "vic";
const ROLES: Record<Person, string> = {
    ada: "owner",
    bea: "member",
    cy: "member",
    vic: "viewer",
};

const THUMBNAIL = "data:image/png;base64,iVBORw0KGgo=";

describeDb("mindmap drafts follow their folder (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;
    const pk = {} as Record<Person, bigint>;

    /** A fresh context each call: the scope is memoised per request, as in the app. */
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

    const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
    const url = (path: string) => `http://localhost${path}`;
    function json(method: string, path: string, body?: unknown): Request {
        return new Request(url(path), {
            method,
            headers: { "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    }

    async function listIds(name: Person, query = "scope=active") {
        as(name);
        const res = await listRoute(new Request(url(`/api/mindmaps?${query}`)));
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            mindmaps: { id: number; access?: { audience: string; canEdit: boolean } }[];
            folders: string[];
        };
        return { ids: body.mindmaps.map(m => m.id), maps: body.mindmaps, folders: body.folders };
    }

    async function open(name: Person, id: number) {
        as(name);
        const res = await getRoute(new Request(url(`/api/mindmaps/${id}`)), params(id));
        return {
            status: res.status,
            body: (await res.json()) as {
                mindmap?: {
                    folder: string;
                    access?: { audience: string; canEdit: boolean; canDelete: boolean };
                };
            },
        };
    }

    async function patch(name: Person, id: number, body: Record<string, unknown>) {
        as(name);
        const res = await patchRoute(json("PATCH", `/api/mindmaps/${id}`, body), params(id));
        return {
            status: res.status,
            body: (await res.json()) as {
                error?: string;
                mindmap?: { title: string; folder: string };
                move?: { access: string };
            },
        };
    }

    async function draft(title: string, folder: string, by: Person = "ada"): Promise<number> {
        const [row] = await test.db
            .insert(mindmaps)
            .values({
                companyId,
                createdByUserId: `auth_${by}`,
                title,
                folder,
                doc: { title, pages: [] },
                thumbnail: THUMBNAIL,
                searchText: `${title} needle`,
            })
            .returning({ id: mindmaps.id });
        return row!.id;
    }

    async function folderOf(id: number): Promise<string> {
        const [row] = await test.db
            .select({ folder: mindmaps.folder })
            .from(mindmaps)
            .where(eq(mindmaps.id, id));
        return row!.folder;
    }

    async function makeFolder(
        name: string,
        grants: { who: Person; level: "view" | "edit" | "manage" }[] | null
    ): Promise<void> {
        const [row] = await test.db.insert(category).values({ name, companyId }).returning();
        if (grants === null) return; // workspace-wide
        const categoryId = BigInt(row!.id);
        await test.db.insert(folderSettings).values({
            categoryId,
            companyId,
            visibility: "restricted",
            updatedBy: "auth_ada",
        });
        for (const g of grants) {
            await test.db.insert(folderGrants).values({
                companyId,
                categoryId,
                principalType: "user",
                principalId: pk[g.who].toString(),
                level: g.level,
                grantedBy: "auth_ada",
            });
        }
    }

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
    });

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    describe("who sees a draft", () => {
        let inPrivate: number;
        let inTeam: number;
        let loose: number;
        let inShared: number;

        beforeAll(async () => {
            await makeFolder("Ada only", [{ who: "ada", level: "manage" }]);
            await makeFolder("Team", null);
            await makeFolder("Deal room", [
                { who: "ada", level: "manage" },
                { who: "bea", level: "edit" },
            ]);
            inPrivate = await draft("Board plan", "Ada only");
            inTeam = await draft("Roadmap", "Team");
            loose = await draft("Scratch", "Unfiled");
            inShared = await draft("Term sheet", "Deal room");
        });

        it("lists a member only the drafts in folders they can open — never Unfiled ones", async () => {
            const bea = await listIds("bea");
            expect(bea.ids).toEqual(expect.arrayContaining([inTeam, inShared]));
            expect(bea.ids).not.toContain(inPrivate);
            expect(bea.ids).not.toContain(loose);
            // A folder they cannot open is never named, not even through a draft.
            expect(bea.folders).not.toContain("Ada only");

            const cy = await listIds("cy");
            expect(cy.ids).toContain(inTeam);
            expect(cy.ids).not.toContain(inShared);

            // Search reads the same rows: a hidden draft's text matches nothing.
            const search = await listIds("bea", "scope=active&q=needle");
            expect(search.ids).not.toContain(inPrivate);
            expect(search.ids).not.toContain(loose);
        });

        it("lists every one of their own drafts to the person who made them", async () => {
            const ada = await listIds("ada");
            expect(ada.ids).toEqual(expect.arrayContaining([inPrivate, inTeam, loose, inShared]));
            const looseRow = ada.maps.find(m => m.id === loose);
            expect(looseRow?.access).toMatchObject({ audience: "private", canEdit: true });
            expect(ada.maps.find(m => m.id === inTeam)?.access?.audience).toBe("workspace");
        });

        it("answers 404 when a member opens, edits, trashes or peeks at a draft they can't see", async () => {
            for (const id of [inPrivate, loose]) {
                expect((await open("bea", id)).status).toBe(404);
                expect((await patch("bea", id, { title: "Mine now" })).status).toBe(404);

                as("bea");
                const del = await deleteRoute(json("DELETE", `/api/mindmaps/${id}`), params(id));
                expect(del.status).toBe(404);
                const thumb = await thumbnailRoute(
                    new Request(url(`/api/mindmaps/${id}/thumbnail`)),
                    params(id)
                );
                expect(thumb.status).toBe(404);
                const history = await revisionsRoute(
                    new Request(url(`/api/mindmaps/${id}/revisions`)),
                    params(id)
                );
                expect(history.status).toBe(404);
                const copy = await duplicateRoute(
                    json("POST", `/api/mindmaps/${id}/duplicate`),
                    params(id)
                );
                expect(copy.status).toBe(404);
            }
            const [row] = await test.db
                .select({ title: mindmaps.title, deletedAt: mindmaps.deletedAt })
                .from(mindmaps)
                .where(eq(mindmaps.id, inPrivate));
            expect(row).toEqual({ title: "Board plan", deletedAt: null });
        });

        it("lets a member open and edit a draft in a workspace folder", async () => {
            const opened = await open("bea", inTeam);
            expect(opened.status).toBe(200);
            expect(opened.body.mindmap?.access).toMatchObject({
                audience: "workspace",
                canEdit: true,
                canDelete: false,
            });
            const saved = await patch("bea", inTeam, { title: "Roadmap v2" });
            expect(saved.status).toBe(200);
            expect(saved.body.mindmap?.title).toBe("Roadmap v2");
        });

        it("keeps an Unfiled draft to its creator", async () => {
            expect((await open("ada", loose)).status).toBe(200);
            for (const who of ["bea", "cy", "vic"] as const) {
                expect((await open(who, loose)).status).toBe(404);
            }
        });

        it("opens a draft to a Viewer without letting them change it", async () => {
            const opened = await open("vic", inTeam);
            expect(opened.status).toBe(200);
            expect(opened.body.mindmap?.access?.canEdit).toBe(false);
            const saved = await patch("vic", inTeam, { title: "Viewer was here" });
            expect(saved.status).toBe(403);
        });

        it("trashes a draft only for its creator, or for edit plus documents.delete", async () => {
            as("bea");
            const byMember = await deleteRoute(
                json("DELETE", `/api/mindmaps/${inShared}`),
                params(inShared)
            );
            expect(byMember.status).toBe(403);
            as("ada");
            const byCreator = await deleteRoute(
                json("DELETE", `/api/mindmaps/${inShared}`),
                params(inShared)
            );
            expect(byCreator.status).toBe(200);
            await test.db
                .update(mindmaps)
                .set({ deletedAt: null })
                .where(eq(mindmaps.id, inShared));
        });
    });

    describe("moving a draft", () => {
        beforeAll(async () => {
            await makeFolder("Bea only", [{ who: "bea", level: "manage" }]);
            await makeFolder("Ops", null);
            await makeFolder("War room", [
                { who: "ada", level: "manage" },
                { who: "bea", level: "edit" },
            ]);
        });

        it("needs edit access to the destination", async () => {
            const id = await draft("Ops plan", "Ops");
            const res = await patch("bea", id, { folder: "Ada only" });
            expect(res.status).toBe(403);
            expect(await folderOf(id)).toBe("Ops");
        });

        it("files someone's own private draft anywhere they can edit (Drive's rule)", async () => {
            const id = await draft("My sketch", "Unfiled", "bea");
            const res = await patch("bea", id, { folder: "Ops" });
            expect(res.status).toBe(200);
            expect(res.body.move).toMatchObject({ access: "inherits_folder" });
            expect((await open("cy", id)).status).toBe(200);

            const fromPrivate = await draft("Bea's notes", "Bea only", "bea");
            expect((await patch("bea", fromPrivate, { folder: "Ops" })).status).toBe(200);
        });

        it("refuses a move that would show a shared draft to people who can't see it now", async () => {
            const id = await draft("Pricing", "War room");
            for (const who of ["bea", "ada"] as const) {
                const res = await patch(who, id, { folder: "Ops" });
                expect(res.status).toBe(409);
            }
            expect(await folderOf(id)).toBe("War room");
            expect((await open("cy", id)).status).toBe(404);
        });

        it("allows a move that narrows who can see it", async () => {
            const id = await draft("Narrowing", "Ops");
            const res = await patch("ada", id, { folder: "War room" });
            expect(res.status).toBe(200);
            expect((await open("cy", id)).status).toBe(404);
        });

        it("sends a draft to Unfiled only for its creator", async () => {
            const id = await draft("Loose end", "War room");
            const byMember = await patch("bea", id, { folder: "Unfiled" });
            expect(byMember.status).toBe(403);
            const byCreator = await patch("ada", id, { folder: "Unfiled" });
            expect(byCreator.status).toBe(200);
            expect(byCreator.body.move).toMatchObject({ access: "made_private" });
            expect((await open("bea", id)).status).toBe(404);
        });

        it("claims a folder path that did not exist, private to whoever filed there", async () => {
            as("bea");
            const res = await createRoute(
                json("POST", "/api/mindmaps", { title: "Brand new", folder: "Bea fresh" })
            );
            expect(res.status).toBe(201);
            const { mindmap } = (await res.json()) as { mindmap: { id: number } };
            expect((await open("ada", mindmap.id)).status).toBe(404);
            const [row] = await test.db
                .select({ visibility: folderSettings.visibility })
                .from(folderSettings)
                .innerJoin(category, eq(category.id, folderSettings.categoryId))
                .where(and(eq(category.companyId, companyId), eq(category.name, "Bea fresh")));
            expect(row?.visibility).toBe("restricted");
        });

        it("refuses to create a draft in a folder the caller can't add to", async () => {
            as("bea");
            const res = await createRoute(
                json("POST", "/api/mindmaps", { title: "Sneaky", folder: "Ada only" })
            );
            expect(res.status).toBe(403);
        });
    });

    describe("renaming and deleting a folder", () => {
        it("takes its drafts along on a rename", async () => {
            await makeFolder("Q4", [
                { who: "ada", level: "manage" },
                { who: "bea", level: "view" },
            ]);
            const id = await draft("Q4 map", "Q4");
            as("ada");
            const res = await renameFolderRoute(
                json("PATCH", "/api/folders", { path: "Q4", newPath: "Q4 2026" })
            );
            expect(res.status).toBe(200);
            expect(await folderOf(id)).toBe("Q4 2026");
            expect((await open("bea", id)).status).toBe(200);
            expect((await open("cy", id)).status).toBe(404);
        });

        it("never publishes a draft by deleting the folder that kept it private", async () => {
            await makeFolder("Open", null);
            await makeFolder("Open/Secret", [{ who: "ada", level: "manage" }]);
            await makeFolder("Open/Inner", null);
            const governed = await draft("Secret map", "Open/Secret");
            const inherits = await draft("Inner map", "Open/Inner");

            // Its documents would move up into Open, which everyone can open;
            // the draft had nothing of its own to keep it private there.
            as("ada");
            expect(
                (await deleteFolderRoute(json("DELETE", "/api/folders", { path: "Open/Secret" })))
                    .status
            ).toBe(200);
            expect(await folderOf(governed)).toBe("Unfiled");
            expect((await open("bea", governed)).status).toBe(404);
            expect((await open("ada", governed)).status).toBe(200);

            // Nothing restricted it from inside the deleted folder: it moves up.
            expect(
                (await deleteFolderRoute(json("DELETE", "/api/folders", { path: "Open/Inner" })))
                    .status
            ).toBe(200);
            expect(await folderOf(inherits)).toBe("Open");
        });
    });
});

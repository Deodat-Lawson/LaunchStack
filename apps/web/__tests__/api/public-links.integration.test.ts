/**
 * Public links (ADR-016), end to end against a real Postgres: who may make,
 * change and turn off a file's link, what the public routes give an anonymous
 * caller, and every way a link stops working (turned off, expired, the
 * workspace switch, the file deleted).
 *
 * Gated like the other integration suites (LAUNCHSTACK_TEST_DATABASE_URL or
 * DATABASE_URL pointing at a local server); it runs on a throwaway database
 * migrated with both ledgers.
 */

import type { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
    company,
    document,
    documentContextChunks,
    documentVersions,
    fileUploads,
} from "@launchstack/store/schema";
import type { DbClient } from "@launchstack/store/client";
import { builtinRolePermissions } from "~/lib/authz/permissions";
import { resolveDocumentScope } from "~/lib/authz/scope";
import type { DocumentScope } from "~/lib/authz/scope-types";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { PUBLIC_LINKS_SETTING } from "~/lib/settings/registry";
import {
    documentGrants,
    documentPublicLinks,
    documentSettings,
    mindmapRevisions,
    mindmaps,
    settingsValues,
    userCompanyMemberships,
    users,
    workspaceActivity,
    workspaceAuditEvents,
} from "~/server/db/schema";
import {
    DELETE as revokeRoute,
    GET as stateRoute,
    PATCH as updateRoute,
    POST as createRoute,
} from "~/app/api/workspace/documents/[documentId]/public-link/route";
import { GET as metaRoute } from "~/app/api/s/[token]/route";
import { GET as contentRoute } from "~/app/api/s/[token]/content/route";
import { GET as textRoute } from "~/app/api/s/[token]/text/route";
import { GET as markdownRoute } from "~/app/api/s/[token]/markdown/route";
import { GET as mindmapRoute } from "~/app/api/s/[token]/mindmap/route";

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

type Person = "ada" | "bea" | "vic";
const ROLES: Record<Person, string> = { ada: "owner", bea: "member", vic: "viewer" };

interface LinkState {
    link: {
        url: string;
        markdownUrl: string;
        allowDownload: boolean;
        expiresAt: string | null;
    } | null;
    canManage: boolean;
    enabled: boolean;
}

const MARKDOWN = "# Launch notes\n\nThe Harbor release ships on 14 December.\n";

describeDb("public links (integration)", () => {
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

    const url = (path: string) => `http://localhost${path}`;
    const idParams = (id: number) => ({ params: Promise.resolve({ documentId: String(id) }) });
    const tokenParams = (token: string) => ({ params: Promise.resolve({ token }) });
    function json(method: string, path: string, body?: unknown): Request {
        return new Request(url(path), {
            method,
            headers: { "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    }
    const tokenOf = (state: LinkState) => state.link!.url.split("/s/")[1]!;

    async function call(
        who: Person,
        route: (r: Request, p: ReturnType<typeof idParams>) => Promise<Response>,
        method: string,
        id: number,
        body?: unknown
    ): Promise<{ status: number; body: LinkState & { error?: string; code?: string } }> {
        as(who);
        const res = await route(
            json(method, `/api/workspace/documents/${id}/public-link`, body),
            idParams(id)
        );
        return { status: res.status, body: (await res.json()) as LinkState & { error?: string } };
    }

    async function publicGet(
        route: (r: Request, p: ReturnType<typeof tokenParams>) => Promise<Response>,
        token: string,
        path = "",
        init?: RequestInit
    ): Promise<Response> {
        mockRequireWorkspaceContext.mockImplementation(() => {
            throw new Error("a public route must never ask for a session");
        });
        return route(new Request(url(`/api/s/${token}${path}`), init), tokenParams(token));
    }

    /** A file held in the database, its document, and (optionally) indexed text. */
    async function addFile(input: {
        title: string;
        mimeType: string;
        body: string;
        folder?: string;
        owner?: Person;
        chunks?: string[];
    }): Promise<number> {
        const [file] = await test.db
            .insert(fileUploads)
            .values({
                userId: `auth_${input.owner ?? "ada"}`,
                filename: input.title,
                mimeType: input.mimeType,
                fileData: Buffer.from(input.body).toString("base64"),
                fileSize: Buffer.byteLength(input.body),
                storageProvider: "database",
                companyId,
            })
            .returning({ id: fileUploads.id });
        const [doc] = await test.db
            .insert(document)
            .values({
                url: `/api/files/${file!.id}`,
                category: input.folder ?? "Unfiled",
                title: input.title,
                companyId,
                mimeType: input.mimeType,
            })
            .returning({ id: document.id });
        const documentId = Number(doc!.id);
        // Private to the uploader, as a new loose file is (ADR-014).
        await test.db.insert(documentSettings).values({
            documentId: BigInt(documentId),
            companyId,
            restricted: true,
            updatedBy: `auth_${input.owner ?? "ada"}`,
        });
        await test.db.insert(documentGrants).values({
            companyId,
            documentId: BigInt(documentId),
            principalType: "user",
            principalId: pk[input.owner ?? "ada"].toString(),
            level: "manage",
            grantedBy: `auth_${input.owner ?? "ada"}`,
        });
        if (input.chunks) {
            const [version] = await test.db
                .insert(documentVersions)
                .values({
                    documentId: BigInt(documentId),
                    versionNumber: 1,
                    url: `/api/files/${file!.id}`,
                    mimeType: input.mimeType,
                })
                .returning({ id: documentVersions.id });
            await test.db
                .update(document)
                .set({ currentVersionId: BigInt(version!.id) })
                .where(eq(document.id, documentId));
            for (const [i, content] of input.chunks.entries()) {
                await test.db.insert(documentContextChunks).values({
                    documentId: BigInt(documentId),
                    versionId: BigInt(version!.id),
                    content,
                    pageNumber: i + 1,
                });
            }
        }
        return documentId;
    }

    async function setSwitch(on: boolean) {
        await test.db.delete(settingsValues).where(eq(settingsValues.key, PUBLIC_LINKS_SETTING));
        if (!on) {
            await test.db.insert(settingsValues).values({
                companyId,
                scopeType: "workspace",
                scopeId: "",
                key: PUBLIC_LINKS_SETTING,
                value: false,
                updatedBy: "auth_ada",
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

    it("lets the file's manager make a link, and hands back the same one on a second click", async () => {
        const id = await addFile({
            title: "Launch notes.md",
            mimeType: "text/markdown",
            body: MARKDOWN,
        });

        const before = await call("ada", stateRoute, "GET", id);
        expect(before.status).toBe(200);
        expect(before.body).toMatchObject({ link: null, canManage: true, enabled: true });

        const made = await call("ada", createRoute, "POST", id);
        expect(made.status).toBe(200);
        expect(made.body.link).toMatchObject({ allowDownload: true, expiresAt: null });
        const token = tokenOf(made.body);
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(made.body.link!.markdownUrl).toBe(`${made.body.link!.url}.md`);

        const again = await call("ada", createRoute, "POST", id);
        expect(tokenOf(again.body)).toBe(token);

        const audit = await test.db
            .select({ action: workspaceAuditEvents.action })
            .from(workspaceAuditEvents)
            .where(eq(workspaceAuditEvents.targetId, String(id)));
        expect(audit.map(a => a.action)).toEqual(["document.public_link_created"]);
        const feed = await test.db
            .select({ verb: workspaceActivity.verb, detail: workspaceActivity.detail })
            .from(workspaceActivity)
            .where(eq(workspaceActivity.targetId, String(id)));
        expect(feed).toEqual([{ verb: "shared", detail: { publicLink: true } }]);
    });

    it("refuses anyone who cannot manage the file, and hides a private file entirely", async () => {
        const id = await addFile({ title: "Plan.md", mimeType: "text/markdown", body: MARKDOWN });
        // Bea cannot even open Ada's private file: same answer as a missing one.
        const hidden = await call("bea", createRoute, "POST", id);
        expect(hidden.status).toBe(404);

        // Opened to Bea at view: she sees the state, may not change it.
        await test.db.insert(documentGrants).values({
            companyId,
            documentId: BigInt(id),
            principalType: "user",
            principalId: pk.bea.toString(),
            level: "view",
            grantedBy: "auth_ada",
        });
        const seen = await call("bea", stateRoute, "GET", id);
        expect(seen.status).toBe(200);
        expect(seen.body).toMatchObject({ link: null, canManage: false });
        expect((await call("bea", createRoute, "POST", id)).status).toBe(403);

        const made = await call("ada", createRoute, "POST", id);
        expect((await call("bea", updateRoute, "PATCH", id, { allowDownload: false })).status).toBe(
            403
        );
        expect((await call("bea", revokeRoute, "DELETE", id)).status).toBe(403);
        // …and the link still works.
        expect((await publicGet(metaRoute, tokenOf(made.body))).status).toBe(200);
    });

    it("rejects an expiry other than never, 7 or 30 days", async () => {
        const id = await addFile({ title: "X.md", mimeType: "text/markdown", body: MARKDOWN });
        expect((await call("ada", createRoute, "POST", id, { expiresInDays: 3 })).status).toBe(400);
        expect((await call("ada", createRoute, "POST", id, { surprise: true })).status).toBe(400);
    });

    it("shows an anonymous caller the file and nothing about where it lives", async () => {
        const id = await addFile({
            title: "Board notes.md",
            mimeType: "text/markdown",
            body: MARKDOWN,
            folder: "Finance/Board",
        });
        const token = tokenOf((await call("ada", createRoute, "POST", id)).body);

        const meta = await publicGet(metaRoute, token);
        expect(meta.status).toBe(200);
        expect(meta.headers.get("x-robots-tag")).toContain("noindex");
        expect(meta.headers.get("referrer-policy")).toBe("no-referrer");
        expect(meta.headers.get("cache-control")).toContain("no-store");
        const body = (await meta.json()) as Record<string, unknown>;
        expect(body).toMatchObject({
            title: "Board notes.md",
            displayType: "markdown",
            workspaceName: "Acme",
            allowDownload: true,
            contentUrl: `/api/s/${token}/content`,
            downloadUrl: `/api/s/${token}/content?download=1`,
            markdownUrl: `/s/${token}.md`,
        });
        const serialised = JSON.stringify(body);
        expect(serialised).not.toContain("Finance");
        expect(serialised).not.toContain("/api/files/");
        expect(serialised).not.toContain(String(id) + ",");
        expect(body).not.toHaveProperty("category");
        expect(body).not.toHaveProperty("id");

        const bytes = await publicGet(contentRoute, token, "/content");
        expect(bytes.status).toBe(200);
        expect(await bytes.text()).toBe(MARKDOWN);
        expect(bytes.headers.get("content-disposition")).toMatch(/^inline;/);

        const download = await publicGet(contentRoute, token, "/content?download=1");
        expect(download.status).toBe(200);
        expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);

        const ranged = await publicGet(contentRoute, token, "/content", {
            headers: { Range: "bytes=0-13" },
        });
        expect(ranged.status).toBe(206);
        expect(await ranged.text()).toBe("# Launch notes");
    });

    it("gives an agent Markdown: the file's text for a text file, the indexed text otherwise", async () => {
        const md = await addFile({ title: "Notes.md", mimeType: "text/markdown", body: MARKDOWN });
        const mdToken = tokenOf((await call("ada", createRoute, "POST", md)).body);
        const res = await publicGet(markdownRoute, mdToken, "/markdown");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
        const text = await res.text();
        expect(text.startsWith("# Notes.md\n")).toBe(true);
        expect(text).toContain("Shared from Acme");
        expect(text).toContain("The Harbor release ships on 14 December.");

        const pdf = await addFile({
            title: "Plan.pdf",
            mimeType: "application/pdf",
            body: "%PDF-1.4 not really",
            chunks: [
                "Plan.pdf › Pricing\n\nSeats cost 24 dollars.",
                "Plan.pdf › Owners\n\nPriya owns it.",
            ],
        });
        const pdfToken = tokenOf((await call("ada", createRoute, "POST", pdf)).body);
        const json = (await (await publicGet(textRoute, pdfToken, "/text")).json()) as {
            markdown: string;
            available: boolean;
        };
        expect(json.available).toBe(true);
        expect(json.markdown).toBe(
            "# Pricing\n\nSeats cost 24 dollars.\n\n# Owners\n\nPriya owns it."
        );

        const empty = await addFile({
            title: "Scan.pdf",
            mimeType: "application/pdf",
            body: "%PDF",
        });
        const emptyToken = tokenOf((await call("ada", createRoute, "POST", empty)).body);
        const none = await (await publicGet(markdownRoute, emptyToken, "/markdown")).text();
        expect(none).toContain("no readable text yet");
    });

    it("turns downloads off without stopping viewing", async () => {
        const id = await addFile({ title: "Deck.md", mimeType: "text/markdown", body: MARKDOWN });
        const token = tokenOf((await call("ada", createRoute, "POST", id)).body);
        const changed = await call("ada", updateRoute, "PATCH", id, { allowDownload: false });
        expect(changed.body.link!.allowDownload).toBe(false);
        expect(tokenOf(changed.body)).toBe(token);

        const meta = (await (await publicGet(metaRoute, token)).json()) as Record<string, unknown>;
        expect(meta).toMatchObject({ allowDownload: false, downloadUrl: null });
        expect((await publicGet(contentRoute, token, "/content?download=1")).status).toBe(403);
        expect((await publicGet(contentRoute, token, "/content")).status).toBe(200);
    });

    it("stops a link the moment it is turned off, and never brings that URL back", async () => {
        const id = await addFile({ title: "Old.md", mimeType: "text/markdown", body: MARKDOWN });
        const token = tokenOf((await call("ada", createRoute, "POST", id)).body);
        const off = await call("ada", revokeRoute, "DELETE", id);
        expect(off.status).toBe(200);
        expect(off.body.link).toBeNull();

        for (const [route, path] of [
            [metaRoute, ""],
            [contentRoute, "/content"],
            [markdownRoute, "/markdown"],
        ] as const) {
            const res = await publicGet(route, token, path);
            expect(res.status).toBe(404);
            expect(res.headers.get("x-robots-tag")).toContain("noindex");
        }

        const fresh = await call("ada", createRoute, "POST", id);
        expect(tokenOf(fresh.body)).not.toBe(token);
        expect((await publicGet(metaRoute, token)).status).toBe(404);
        expect((await publicGet(metaRoute, tokenOf(fresh.body))).status).toBe(200);
        const feed = await test.db
            .select({ verb: workspaceActivity.verb })
            .from(workspaceActivity)
            .where(eq(workspaceActivity.targetId, String(id)));
        expect(feed.map(f => f.verb)).toEqual(["shared", "unshared", "shared"]);
    });

    it("lets a link run out, and a new one replace an expired one", async () => {
        const id = await addFile({ title: "Brief.md", mimeType: "text/markdown", body: MARKDOWN });
        const made = await call("ada", createRoute, "POST", id, { expiresInDays: 7 });
        const expiresAt = new Date(made.body.link!.expiresAt!).getTime();
        expect(Math.round((expiresAt - Date.now()) / 86_400_000)).toBe(7);
        const token = tokenOf(made.body);

        await test.db
            .update(documentPublicLinks)
            .set({ expiresAt: new Date(Date.now() - 1000) })
            .where(eq(documentPublicLinks.token, token));
        expect((await publicGet(metaRoute, token)).status).toBe(404);
        expect((await call("ada", stateRoute, "GET", id)).body.link).toBeNull();

        const replaced = await call("ada", createRoute, "POST", id);
        expect(replaced.status).toBe(200);
        expect(tokenOf(replaced.body)).not.toBe(token);
    });

    it("obeys the workspace switch: off stops every link and refuses new ones; on brings them back", async () => {
        const id = await addFile({ title: "Switch.md", mimeType: "text/markdown", body: MARKDOWN });
        const other = await addFile({
            title: "Other.md",
            mimeType: "text/markdown",
            body: MARKDOWN,
        });
        const token = tokenOf((await call("ada", createRoute, "POST", id)).body);

        await setSwitch(false);
        try {
            expect((await publicGet(metaRoute, token)).status).toBe(404);
            expect((await publicGet(contentRoute, token, "/content")).status).toBe(404);
            const refused = await call("ada", createRoute, "POST", other);
            expect(refused.status).toBe(403);
            expect(refused.body.code).toBe("public_links_off");
            expect((await call("ada", stateRoute, "GET", id)).body.enabled).toBe(false);
        } finally {
            await setSwitch(true);
        }
        expect((await publicGet(metaRoute, token)).status).toBe(200);
    });

    it("dies with its file, and ignores tokens that were never issued", async () => {
        const id = await addFile({ title: "Gone.md", mimeType: "text/markdown", body: MARKDOWN });
        const token = tokenOf((await call("ada", createRoute, "POST", id)).body);
        await test.db.delete(document).where(eq(document.id, id));
        expect((await publicGet(metaRoute, token)).status).toBe(404);
        const rows = await test.db
            .select()
            .from(documentPublicLinks)
            .where(eq(documentPublicLinks.token, token));
        expect(rows).toHaveLength(0);

        for (const bogus of ["nope", "A".repeat(43), "../../etc/passwd", "x".repeat(200)]) {
            expect((await publicGet(metaRoute, bogus)).status).toBe(404);
        }
    });

    it("shows a mindmap as published, never the edits made since", async () => {
        const published = {
            title: "Plan",
            pages: [{ id: "p", name: "Page 1", nodes: [{ id: "a" }] }],
        };
        const [map] = await test.db
            .insert(mindmaps)
            .values({
                companyId,
                createdByUserId: "auth_ada",
                title: "Plan",
                folder: "Unfiled",
                doc: published,
                revision: 3,
            })
            .returning({ id: mindmaps.id });
        const id = await addFile({ title: "Plan", mimeType: "text/markdown", body: "# Plan\n" });
        await test.db
            .update(document)
            .set({ ocrMetadata: { kind: "mindmap", mindmapId: map!.id, revision: 3 } })
            .where(eq(document.id, id));
        const token = tokenOf((await call("ada", createRoute, "POST", id)).body);
        const read = async () => {
            const res = await publicGet(mindmapRoute, token, "/mindmap");
            return {
                status: res.status,
                body: (await res.json()) as { mindmap?: { doc: unknown; id: number } },
            };
        };

        // Nothing saved since publishing: the map is the published revision.
        const live = await read();
        expect(live.status).toBe(200);
        expect(live.body.mindmap).toMatchObject({ id: 0, doc: published });

        // Edited since: never shown; the viewer falls back to the published outline.
        await test.db
            .update(mindmaps)
            .set({ revision: 4, doc: { title: "Plan", pages: [], secret: "unpublished" } })
            .where(eq(mindmaps.id, map!.id));
        expect((await read()).status).toBe(404);

        // …unless history kept the published revision.
        await test.db.insert(mindmapRevisions).values({
            mindmapId: map!.id,
            revision: 3,
            doc: published,
            nodeCount: 1,
        });
        const kept = await read();
        expect(kept.status).toBe(200);
        expect(JSON.stringify(kept.body)).not.toContain("unpublished");
    });

    it("gives an agent a recording's transcript, timed, from the recording's own link", async () => {
        const recording = await addFile({
            title: "Standup.m4a",
            mimeType: "audio/mp4",
            body: "not really audio",
            folder: "Meetings",
        });
        const transcript = await addFile({
            title: "Standup.m4a (Transcription)",
            mimeType: "text/plain",
            body: "Good morning. We ship the importer fix today.",
            folder: "Meetings",
        });
        await test.db
            .update(document)
            .set({
                ocrMetadata: {
                    source: "transcription",
                    audioDocumentId: recording,
                    segments: [
                        { start: 0, end: 3, text: "Good morning." },
                        { start: 65, end: 70, text: "We ship the importer fix today." },
                    ],
                },
            })
            .where(eq(document.id, transcript));

        const token = tokenOf((await call("ada", createRoute, "POST", recording)).body);
        const text = await (await publicGet(markdownRoute, token, "/markdown")).text();
        expect(text).toContain("[0:00] Good morning.");
        expect(text).toContain("[1:05] We ship the importer fix today.");

        // A transcript in another folder is not this recording's to give.
        await test.db
            .update(document)
            .set({ category: "Elsewhere" })
            .where(eq(document.id, transcript));
        const none = await (await publicGet(markdownRoute, token, "/markdown")).text();
        expect(none).toContain("no readable text yet");
    });
});

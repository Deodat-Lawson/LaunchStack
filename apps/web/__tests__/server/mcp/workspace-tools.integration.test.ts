/**
 * The MCP read tools against a real Postgres: two people in one workspace,
 * one of whom has a private document. The other must not find it through
 * search, read it through fetch (and must get the same answer as for an id
 * that does not exist), or see it counted in list_sources. Ask's source
 * tools share the same queries and are held to the same rules, with files
 * imported from Google Drive among them.
 *
 * Scope is a SQL predicate, so only a real database tests it. Gated like the
 * other integration suites: runs when LAUNCHSTACK_TEST_DATABASE_URL (or
 * DATABASE_URL) points at a local server, on a throwaway migrated database.
 * Retrieval is the real ensemble; the query embedder is a stand-in, so the
 * lexical leg does the ranking and nothing leaves the machine.
 */
import { eq } from "drizzle-orm";

import {
    company,
    document,
    documentContextChunks,
    documentVersions,
} from "@launchstack/store/schema";
import { configureDatabase, type DbClient } from "@launchstack/store/client";
import { builtinRolePermissions } from "~/lib/authz/permissions";
import { resolveDocumentScope } from "~/lib/authz/scope";
import type { DocumentScope } from "~/lib/authz/scope-types";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import {
    documentGrants,
    documentSettings,
    userCompanyMemberships,
    users,
} from "~/server/db/schema";
import type { McpPrincipal } from "~/server/mcp/principal";
import type { McpTool, McpToolOutcome } from "~/server/mcp/protocol";
import { fetchTool } from "~/server/mcp/tools/fetch";
import { listSourcesTool } from "~/server/mcp/tools/list-sources";
import { searchTool } from "~/server/mcp/tools/search";
import { documentNotFound } from "~/server/mcp/tools/shared";
import { createSourceTools, loadSourcesOverview } from "~/server/chat-source-tools";
import { connectorConnections, googleDriveSyncState } from "~/server/db/schema/connectors";
import { findSourcesByTitle, summarizeReadableSources } from "~/server/workspace-sources";

import { createFounderWeeklyReviewTestDatabase } from "../../founderWeeklyReview/testDb";

let mockActiveDb: DbClient | null = null;
jest.mock("~/server/db", () => ({
    get db() {
        if (!mockActiveDb) throw new Error("test database not ready");
        return mockActiveDb;
    },
}));
// A deterministic stand-in for the company's embedder: no network, and a
// vector of the stored width so the vector leg's SQL runs (and finds nothing).
jest.mock("~/lib/models", () => ({
    getEmbeddings: () => ({
        embedQuery: async () => Array.from({ length: 1536 }, () => 0.001),
        embedDocuments: async (texts: string[]) =>
            texts.map(() => Array.from({ length: 1536 }, () => 0.001)),
    }),
}));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

type Person = "ada" | "bea";
const ROLES: Record<Person, string> = { ada: "owner", bea: "member" };
const ORIGIN = "http://localhost:3031";

describeDb("MCP read tools respect the person's document scope (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;
    const pk = {} as Record<Person, bigint>;
    const ids = { plan: 0, diary: 0, hiring: 0 };

    function principal(name: Person): McpPrincipal {
        const role = ROLES[name];
        const permissions = builtinRolePermissions(role)!;
        let scope: Promise<DocumentScope> | null = null;
        const ctx: WorkspaceContext = {
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
        return {
            ctx,
            scopes: new Set(["launchstack:read"]),
            credential: { kind: "key", keyId: 1 },
            label: `${name}'s key`,
            family: "other",
            rateLimitKey: `mcp:${name}`,
        };
    }

    async function call(tool: McpTool, name: Person, args: unknown) {
        return tool.call(args, { principal: principal(name), origin: ORIGIN });
    }

    function ok(outcome: McpToolOutcome) {
        if (!outcome.ok) throw new Error(`expected success, got: ${outcome.message}`);
        return outcome.structured;
    }

    async function addDocument(
        title: string,
        folder: string,
        chunks: string[],
        connector?: string
    ): Promise<number> {
        const [doc] = await test.db
            .insert(document)
            .values({
                companyId,
                url: `local://${title}`,
                category: folder,
                title,
                ...(connector ? { ocrMetadata: { connector, sourceId: title } } : {}),
            })
            .returning({ id: document.id });
        const [version] = await test.db
            .insert(documentVersions)
            .values({
                documentId: BigInt(doc!.id),
                versionNumber: 1,
                url: `local://${title}`,
                mimeType: "text/markdown",
            })
            .returning({ id: documentVersions.id });
        await test.db
            .update(document)
            .set({ currentVersionId: BigInt(version!.id) })
            .where(eq(document.id, doc!.id));
        for (const [index, content] of chunks.entries()) {
            await test.db.insert(documentContextChunks).values({
                documentId: BigInt(doc!.id),
                versionId: BigInt(version!.id),
                content,
                pageNumber: index + 1,
                charCount: content.length,
            });
        }
        return doc!.id;
    }

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;
        configureDatabase(test.db);

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

        ids.plan = await addDocument("Zebra launch plan", "Team", [
            "The zebra launch happens in March.",
            "Pricing for the zebra tier starts at ten dollars.",
        ]);
        ids.diary = await addDocument("Ada's zebra diary", "Team", [
            "Private zebra thoughts: we may cancel the launch.",
        ]);
        ids.hiring = await addDocument("Hiring notes", "Unfiled", [
            "We are hiring two engineers this quarter.",
        ]);

        await makePrivateToAda(ids.diary);
    });

    // Private to Ada: restricted, with a grant to her alone. Owners do not
    // read past a restriction by role (ADR-014).
    async function makePrivateToAda(documentId: number) {
        await test.db.insert(documentSettings).values({
            documentId: BigInt(documentId),
            companyId,
            restricted: true,
            updatedBy: "auth_ada",
        });
        await test.db.insert(documentGrants).values({
            companyId,
            documentId: BigInt(documentId),
            principalType: "user",
            principalId: pk.ada.toString(),
            level: "manage",
            grantedBy: "auth_ada",
        });
    }

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    describe("search", () => {
        it("finds the private document for its owner", async () => {
            const { results } = ok(await call(searchTool, "ada", { query: "zebra" })) as {
                results: { id: string; title: string }[];
            };
            expect(results.map(r => r.id).sort()).toEqual(
                [String(ids.plan), String(ids.diary)].sort()
            );
        });

        it("never shows it to a colleague: not as a result, not in a snippet", async () => {
            const outcome = await call(searchTool, "bea", { query: "zebra cancel launch" });
            const { results } = ok(outcome) as {
                results: { id: string; url: string; text: string; folder?: string }[];
            };
            expect(results.map(r => r.id)).toEqual([String(ids.plan)]);
            expect(results[0]).toMatchObject({
                url: `${ORIGIN}/employer/documents?source=d${ids.plan}`,
                folder: "Team",
            });
            expect(results[0]?.text).toContain("zebra");
            const text = outcome.ok ? outcome.text : "";
            expect(text).not.toContain("Private zebra");
            expect(text).not.toContain("diary");
        });

        it("narrows to a folder and answers no match with an empty list", async () => {
            const inUnfiled = ok(
                await call(searchTool, "ada", { query: "zebra", folder: "Unfiled" })
            ) as { results: unknown[] };
            expect(inUnfiled.results).toEqual([]);
            const nothing = ok(await call(searchTool, "bea", { query: "xylophone" }));
            expect(nothing).toEqual({ results: [] });
        });
    });

    describe("fetch", () => {
        it("reads a readable document's current text in order", async () => {
            const doc = ok(await call(fetchTool, "bea", { id: String(ids.plan) }));
            expect(doc).toMatchObject({
                id: String(ids.plan),
                title: "Zebra launch plan",
                text: "The zebra launch happens in March.\n\nPricing for the zebra tier starts at ten dollars.",
                url: `${ORIGIN}/employer/documents?source=d${ids.plan}`,
                metadata: { folder: "Team", truncated: false, indexed: true },
            });
        });

        it("reads the private document for its owner", async () => {
            const doc = ok(await call(fetchTool, "ada", { id: `d${ids.diary}` }));
            expect(doc).toMatchObject({
                text: "Private zebra thoughts: we may cancel the launch.",
            });
        });

        it("answers a colleague's private id exactly as it answers an id that does not exist", async () => {
            const unreadable = await call(fetchTool, "bea", { id: String(ids.diary) });
            const missing = await call(fetchTool, "bea", { id: "987654321" });
            expect(unreadable).toEqual({ ok: false, message: documentNotFound(String(ids.diary)) });
            expect(missing).toEqual({ ok: false, message: documentNotFound("987654321") });
        });
    });

    describe("list_sources", () => {
        type Listing = {
            folders: { path: string; documentCount: number }[];
            documents: { id: string; folder: string }[];
            nextCursor?: string;
        };

        it("counts only the documents each person can open", async () => {
            const ada = ok(await call(listSourcesTool, "ada", {})) as Listing;
            const bea = ok(await call(listSourcesTool, "bea", {})) as Listing;
            expect(ada.folders).toEqual([
                { path: "Team", documentCount: 2 },
                { path: "Unfiled", documentCount: 1 },
            ]);
            expect(bea.folders).toEqual([
                { path: "Team", documentCount: 1 },
                { path: "Unfiled", documentCount: 1 },
            ]);
            expect(bea.documents.map(d => d.id)).not.toContain(String(ids.diary));
            expect(ada.documents.map(d => d.id)).toContain(String(ids.diary));
        });

        it("pages newest first without repeating or skipping a document", async () => {
            const seen: string[] = [];
            let cursor: string | undefined;
            for (let page = 0; page < 5; page += 1) {
                const listing = ok(
                    await call(listSourcesTool, "ada", { limit: 1, ...(cursor ? { cursor } : {}) })
                ) as Listing;
                seen.push(...listing.documents.map(d => d.id));
                cursor = listing.nextCursor;
                if (!cursor) break;
            }
            // Created in this order, never updated: newest first is the reverse.
            expect(seen).toEqual([ids.hiring, ids.diary, ids.plan].map(String));
        });

        it("lists one folder and its subfolders", async () => {
            const team = ok(await call(listSourcesTool, "bea", { folder: "Team" })) as Listing;
            expect(team.folders).toEqual([{ path: "Team", documentCount: 1 }]);
            expect(team.documents.map(d => d.id)).toEqual([String(ids.plan)]);
        });
    });

    // Last, so its Drive files don't change what the MCP cases above count.
    describe("Ask's source tools", () => {
        const drive = { resume: 0, salaries: 0 };
        const signal = new AbortController().signal;

        function toolsFor(name: Person) {
            const session = createSourceTools(principal(name).ctx);
            const byName = Object.fromEntries(session.tools.map(tool => [tool.name, tool]));
            return { session, ...byName } as typeof byName & { session: typeof session };
        }

        beforeAll(async () => {
            drive.resume = await addDocument(
                "Jane Doe resume",
                "Interest form/Resumes",
                ["Jane Doe. Software engineer: Python, distributed systems."],
                "google-drive"
            );
            drive.salaries = await addDocument(
                "Salary bands",
                "Interest form/Resumes",
                ["Confidential salary bands for the zebra team."],
                "google-drive"
            );
            await makePrivateToAda(drive.salaries);

            const [conn] = await test.db
                .insert(connectorConnections)
                .values({
                    companyId,
                    provider: "google-drive",
                    providerAccountId: "sub-ada",
                    providerAccountEmail: "ada@acme.test",
                    grantedByUserId: pk.ada,
                    scopes: "https://www.googleapis.com/auth/drive.readonly",
                })
                .returning({ id: connectorConnections.id });
            await test.db.insert(googleDriveSyncState).values({
                connectionId: conn!.id,
                lastSyncAt: new Date("2026-10-17T23:48:32Z"),
                lastSyncStatus: "ok",
            });
            // Ada's mailbox is hers alone.
            await test.db.insert(connectorConnections).values({
                companyId,
                provider: "gmail",
                providerAccountId: "sub-ada-mail",
                providerAccountEmail: "ada@acme.test",
                grantedByUserId: pk.ada,
                ownerUserId: pk.ada,
                scopes: "https://www.googleapis.com/auth/gmail.readonly",
            });
        });

        it("lists what came from Google Drive, and only what the person can open", async () => {
            const bea = await toolsFor("bea").list_sources!.run({ from: "google-drive" }, signal);
            expect(bea).toContain("1 source in 1 folder.");
            expect(bea).toContain(
                `"Jane Doe resume" (d${drive.resume}) — in Interest form/Resumes, from Google Drive`
            );
            expect(bea).not.toContain("Salary");

            const ada = await toolsFor("ada").list_sources!.run({ from: "google-drive" }, signal);
            expect(ada).toContain("2 sources in 1 folder.");
            expect(ada).toContain("Salary bands");

            const here = await toolsFor("bea").list_sources!.run({ from: "added-here" }, signal);
            expect(here).toContain("Zebra launch plan");
            expect(here).not.toContain("Jane Doe");
        });

        it("counts sources by origin from the readable set", async () => {
            expect(await summarizeReadableSources(principal("bea").ctx)).toEqual({
                total: 3,
                byOrigin: [
                    { from: null, count: 2 },
                    { from: "google-drive", count: 1 },
                ],
            });
            expect((await summarizeReadableSources(principal("ada").ctx)).total).toBe(5);
        });

        it("tells each person about the connections they may see", async () => {
            const bea = await loadSourcesOverview(principal("bea").ctx);
            expect(bea.connected).toEqual([
                {
                    provider: "google-drive",
                    status: "active",
                    lastSyncAt: new Date("2026-10-17T23:48:32Z"),
                },
            ]);
            const ada = await loadSourcesOverview(principal("ada").ctx);
            expect(ada.connected.map(app => app.provider)).toEqual(["google-drive", "gmail"]);
        });

        it("never searches or reads a private Drive file for a colleague", async () => {
            const bea = toolsFor("bea");
            const found = await bea.search_sources!.run({ query: "salary bands zebra" }, signal);
            expect(found).not.toContain("Confidential");
            expect(bea.session.passages.map(p => p.metadata?.documentId)).not.toContain(
                drive.salaries
            );
            await expect(
                bea.read_source!.run({ id: `d${drive.salaries}` }, signal)
            ).rejects.toThrow(
                `No source "d${drive.salaries}" is among the sources the person can open.`
            );

            const ada = toolsFor("ada");
            expect(await ada.read_source!.run({ id: `d${drive.salaries}` }, signal)).toContain(
                "Confidential salary bands"
            );
        });

        it("finds a source by the words of its title, and never a private one for a colleague", async () => {
            const bea = await findSourcesByTitle(
                principal("bea").ctx,
                "what's in Jane Doe's resume?"
            );
            expect(bea.map(doc => doc.id)).toEqual([drive.resume]);
            expect(bea[0]).toMatchObject({ title: "Jane Doe resume", from: "google-drive" });

            expect(await findSourcesByTitle(principal("bea").ctx, "salary bands")).toEqual([]);
            expect(
                (await findSourcesByTitle(principal("ada").ctx, "salary bands")).map(doc => doc.id)
            ).toEqual([drive.salaries]);
            // One shared word is not enough when the query has more; wildcards are literal.
            expect(await findSourcesByTitle(principal("ada").ctx, "zebra budget")).toEqual([]);
            expect(await findSourcesByTitle(principal("ada").ctx, "% _")).toEqual([]);
            // A one-word query needs one.
            expect(
                (await findSourcesByTitle(principal("ada").ctx, "zebra"))
                    .map(doc => doc.title)
                    .sort()
            ).toEqual(["Ada's zebra diary", "Zebra launch plan"]);
        });

        it("finds a Drive file's text and keeps the passage for citations", async () => {
            const bea = toolsFor("bea");
            const found = await bea.search_sources!.run({ query: "Python engineer" }, signal);
            expect(found).toContain(`"Jane Doe resume" (d${drive.resume})`);
            expect(found).toContain("Software engineer: Python");
            expect(bea.session.passages.map(p => p.metadata)).toContainEqual(
                expect.objectContaining({
                    documentId: drive.resume,
                    documentTitle: "Jane Doe resume",
                })
            );
        });
    });
});

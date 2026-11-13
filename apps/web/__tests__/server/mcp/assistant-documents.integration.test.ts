/**
 * Staging and filing for add_document / start_upload against a real Postgres:
 * who can use a staged draft or upload, that it files once, expiry and the
 * sweep, the one-time upload link, which folders a person is offered and may
 * file into, that a duplicate check never reveals a document the person
 * cannot open, and that a version takes the newest file's kind.
 *
 * Access rules are SQL, so only a real database tests them. Storage and the
 * ingestion pipeline (OCR, embeddings, events) are stand-ins; the document
 * rows, grants, folder rows and ADR-014 defaults are the real code. Gated like
 * the other integration suites (LAUNCHSTACK_TEST_DATABASE_URL on a local server).
 */
import { and, eq } from "drizzle-orm";

import { company, document, documentVersions } from "@launchstack/store/schema";
import { configureDatabase, type DbClient } from "@launchstack/store/client";
import { builtinRolePermissions } from "~/lib/authz/permissions";
import { resolveDocumentScope } from "~/lib/authz/scope";
import type { DocumentScope } from "~/lib/authz/scope-types";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import {
    AssistantDocumentError,
    fileStagedDocument,
    findSameTitle,
    listFolderChoices,
    resolveDestination,
    whoCanSeeFolder,
} from "~/server/assistant-documents";
import {
    documentGrants,
    documentSettings,
    mcpStagedFiles,
    userCompanyMemberships,
    users,
} from "~/server/db/schema";
import {
    MAX_STAGED_BYTES,
    StagingError,
    claimStagedFile,
    createUploadSlot,
    loadStagedFile,
    readBodyWithLimit,
    receiveUpload,
    stageDraft,
    sweepExpiredStagedFiles,
    type StagingOwner,
} from "~/server/mcp/staging";
import { createFolderAs } from "~/server/workspace/folder-actions";

import { createFounderWeeklyReviewTestDatabase } from "../../founderWeeklyReview/testDb";

let mockActiveDb: DbClient | null = null;
jest.mock("~/server/db", () => ({
    get db() {
        if (!mockActiveDb) throw new Error("test database not ready");
        return mockActiveDb;
    },
}));

/** Object storage: an in-memory map, so a deleted file can be checked. */
const mockStored = new Map<string, Buffer>();
let mockFileCounter = 0;
jest.mock("~/lib/storage", () => ({
    uploadFile: jest.fn(async (input: { filename: string; data: Buffer }) => {
        const url = `mem://${++mockFileCounter}/${input.filename}`;
        mockStored.set(url, Buffer.from(input.data));
        return { url, pathname: input.filename, provider: "s3" };
    }),
    deleteFile: jest.fn(async (url: string) => {
        mockStored.delete(url);
    }),
}));

/** Ingestion: the document row and its first version, nothing downstream. */
jest.mock("~/server/services/document-upload", () => {
    const { document: doc, documentVersions: versions } = jest.requireActual(
        "@launchstack/store/schema"
    );
    const { eq: equal } = jest.requireActual("drizzle-orm");
    class UploadRefusedError extends Error {}
    return {
        UploadRefusedError,
        toAbsoluteUrl: (url: string) => url,
        processDocumentUpload: jest.fn(
            async (params: {
                user: { companyId: bigint };
                documentName: string;
                rawDocumentUrl: string;
                category: string;
                mimeType: string;
                ocrMetadata?: Record<string, unknown>;
            }) => {
                const db = mockActiveDb!;
                const [row] = await db
                    .insert(doc)
                    .values({
                        companyId: params.user.companyId,
                        url: params.rawDocumentUrl,
                        category: params.category,
                        title: params.documentName,
                        ocrMetadata: params.ocrMetadata ?? null,
                    })
                    .returning();
                const [version] = await db
                    .insert(versions)
                    .values({
                        documentId: BigInt(row.id),
                        versionNumber: 1,
                        url: params.rawDocumentUrl,
                        mimeType: params.mimeType,
                    })
                    .returning();
                await db
                    .update(doc)
                    .set({ currentVersionId: BigInt(version.id) })
                    .where(equal(doc.id, row.id));
                const uploaded = {
                    id: row.id,
                    title: row.title,
                    url: row.url,
                    category: row.category,
                };
                return {
                    jobId: "",
                    eventIds: [],
                    storageType: "s3",
                    document: uploaded,
                    createdDocuments: [uploaded],
                    resolvedDocumentUrl: row.url,
                };
            }
        ),
    };
});

jest.mock("~/server/services/document-creation", () => {
    const { documentVersions: versions } = jest.requireActual("@launchstack/store/schema");
    return {
        createDocumentVersionLifecycle: jest.fn(
            async (input: { documentId: number; url: string; mimeType: string }) => {
                const db = mockActiveDb!;
                const existing = await db.$count(
                    versions,
                    jest
                        .requireActual("drizzle-orm")
                        .eq(versions.documentId, BigInt(input.documentId))
                );
                await db.insert(versions).values({
                    documentId: BigInt(input.documentId),
                    versionNumber: existing + 1,
                    url: input.url,
                    mimeType: input.mimeType,
                });
            }
        ),
    };
});
jest.mock("~/server/services/internal-file-ref", () => ({
    authorizeInternalFileRef: jest.fn(async () => null),
}));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("@launchstack/conversion/ocr/config", () => ({
    getOcrConfig: () => ({ defaultProvider: "none", appPublicUrl: null }),
}));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

type Person = "ada" | "bea";
const ROLES: Record<Person, string> = { ada: "owner", bea: "member" };
const ORIGIN = "http://localhost:3031";

function streamOf(...chunks: Buffer[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
            controller.close();
        },
    });
}

describeDb("assistant documents: staging and filing (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;
    let otherCompanyId: bigint;
    const pk = {} as Record<Person, bigint>;
    const ids = { plan: 0, secret: 0 };

    function ctxOf(name: Person, inCompany = companyId): WorkspaceContext {
        const role = ROLES[name];
        const permissions = builtinRolePermissions(role)!;
        let scope: Promise<DocumentScope> | null = null;
        return {
            authUserId: `auth_${name}`,
            userPk: pk[name],
            companyId: inCompany,
            role,
            status: "active",
            permissions,
            can: p => permissions.has(p),
            documentScope: () =>
                (scope ??= resolveDocumentScope({
                    companyId: inCompany,
                    userPk: pk[name],
                    role,
                    permissions,
                })),
        };
    }

    function owner(name: Person, inCompany = companyId): StagingOwner {
        return { authUserId: `auth_${name}`, userPk: pk[name], companyId: inCompany };
    }

    async function draft(
        name: Person,
        text = "# Plan\n\nBody",
        details: Record<string, unknown> = {}
    ) {
        return stageDraft(owner(name), {
            data: Buffer.from(text, "utf8"),
            filename: "Plan.md",
            mimeType: "text/markdown",
            details,
        });
    }

    async function addDocument(
        title: string,
        folder: string,
        ocrMetadata?: Record<string, unknown>
    ) {
        const [doc] = await test.db
            .insert(document)
            .values({
                companyId,
                url: `local://${title}`,
                category: folder,
                title,
                ...(ocrMetadata ? { ocrMetadata } : {}),
            })
            .returning({ id: document.id });
        return doc!.id;
    }

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;
        configureDatabase(test.db);

        const [co, other] = await test.db
            .insert(company)
            .values([
                { name: "Acme", numberOfEmployees: "20" },
                { name: "Other", numberOfEmployees: "5" },
            ])
            .returning();
        companyId = BigInt(co!.id);
        otherCompanyId = BigInt(other!.id);

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

        // "Team" exists only through its documents: the whole workspace's.
        ids.plan = await addDocument("Plan", "Team");
        ids.secret = await addDocument("Secret plan", "Team");
        await test.db.insert(documentSettings).values({
            documentId: BigInt(ids.secret),
            companyId,
            restricted: true,
            updatedBy: "auth_ada",
        });
        await test.db.insert(documentGrants).values({
            documentId: BigInt(ids.secret),
            companyId,
            principalType: "user",
            principalId: String(pk.ada),
            level: "manage",
            grantedBy: "auth_ada",
        });
        // A top-level folder Ada creates is private to her (ADR-014).
        await createFolderAs(ctxOf("ada"), "Board pack");
    });

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    describe("staged drafts and uploads", () => {
        it("are private to the person and the workspace that staged them", async () => {
            const row = await draft("ada");
            await expect(loadStagedFile(owner("ada"), row.id)).resolves.toMatchObject({
                id: row.id,
            });
            await expect(loadStagedFile(owner("bea"), row.id)).rejects.toMatchObject({
                code: "not_found",
            });
            await expect(
                loadStagedFile(owner("ada", otherCompanyId), row.id)
            ).rejects.toMatchObject({
                code: "not_found",
            });
        });

        it("file once, however many calls race for them", async () => {
            const row = await draft("ada");
            const claims = await Promise.all([
                claimStagedFile(row.id),
                claimStagedFile(row.id),
                claimStagedFile(row.id),
            ]);
            expect(claims.filter(Boolean)).toHaveLength(1);
            await expect(loadStagedFile(owner("ada"), row.id)).rejects.toMatchObject({
                code: "used",
            });
        });

        it("expire, and the sweep deletes unfiled bytes but never a filed document's", async () => {
            const stale = await draft("ada");
            const filed = await draft("ada");
            await claimStagedFile(filed.id);
            const past = new Date(Date.now() - 1000);
            await test.db
                .update(mcpStagedFiles)
                .set({ expiresAt: past })
                .where(eq(mcpStagedFiles.id, stale.id));
            await test.db
                .update(mcpStagedFiles)
                .set({ expiresAt: past })
                .where(eq(mcpStagedFiles.id, filed.id));
            await expect(loadStagedFile(owner("ada"), stale.id)).rejects.toMatchObject({
                code: "expired",
            });

            expect(await sweepExpiredStagedFiles()).toBeGreaterThanOrEqual(2);
            expect(mockStored.has(stale.storageUrl!)).toBe(false);
            expect(mockStored.has(filed.storageUrl!)).toBe(true);
            const left = await test.db
                .select()
                .from(mcpStagedFiles)
                .where(eq(mcpStagedFiles.id, stale.id));
            expect(left).toHaveLength(0);
        });

        it("take an upload's bytes once through its link, and only within the window", async () => {
            const slot = await createUploadSlot(owner("ada"), {
                filename: "deck.pdf",
                mimeType: "application/pdf",
                details: {},
            });
            const row = await test.db
                .select()
                .from(mcpStagedFiles)
                .where(eq(mcpStagedFiles.id, slot.id));
            expect(row[0]!.uploadTokenHash).not.toContain(slot.token);
            await expect(loadStagedFile(owner("ada"), slot.id)).rejects.toThrow(
                /not received its file/
            );

            const received = await receiveUpload(
                slot.token,
                streamOf(Buffer.from("%PDF-1.7 a"), Buffer.from("bc")),
                null
            );
            expect(received).toEqual({ id: slot.id, filename: "deck.pdf", sizeBytes: 12 });
            const ready = await loadStagedFile(owner("ada"), slot.id);
            expect(mockStored.get(ready.storageUrl!)?.toString()).toBe("%PDF-1.7 abc");

            await expect(
                receiveUpload(slot.token, streamOf(Buffer.from("again")), null)
            ).rejects.toMatchObject({
                code: "gone",
            });

            const late = await createUploadSlot(owner("ada"), {
                filename: "late.pdf",
                mimeType: "application/pdf",
                details: {},
            });
            await test.db
                .update(mcpStagedFiles)
                .set({ uploadExpiresAt: new Date(Date.now() - 1000) })
                .where(eq(mcpStagedFiles.id, late.id));
            await expect(
                receiveUpload(late.token, streamOf(Buffer.from("x")), null)
            ).rejects.toMatchObject({
                code: "gone",
            });
        });

        it("refuse an oversized or empty upload, and the link dies with it", async () => {
            const big = await createUploadSlot(owner("ada"), {
                filename: "big.pdf",
                mimeType: "application/pdf",
                details: {},
            });
            await expect(
                receiveUpload(big.token, streamOf(Buffer.from("x")), MAX_STAGED_BYTES + 1)
            ).rejects.toMatchObject({
                code: "too_large",
            });
            const empty = await createUploadSlot(owner("ada"), {
                filename: "e.pdf",
                mimeType: "application/pdf",
                details: {},
            });
            await expect(receiveUpload(empty.token, streamOf(), 0)).rejects.toMatchObject({
                code: "empty",
            });
            await expect(
                receiveUpload(empty.token, streamOf(Buffer.from("x")), null)
            ).rejects.toMatchObject({
                code: "gone",
            });
        });

        it("cap a body that streams past the limit without a declared length", async () => {
            await expect(
                readBodyWithLimit(streamOf(Buffer.alloc(6), Buffer.alloc(6)), 10)
            ).rejects.toBeInstanceOf(StagingError);
            await expect(
                readBodyWithLimit(streamOf(Buffer.alloc(4), Buffer.alloc(6)), 10)
            ).resolves.toHaveLength(10);
        });
    });

    describe("where a document may go", () => {
        it("offers Unfiled first, then the folders the person can add to, with who can see them", async () => {
            const forBea = await listFolderChoices(ctxOf("bea"));
            expect(forBea[0]).toMatchObject({ path: "Unfiled", whoCanSee: "only you" });
            expect(forBea).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        path: "Team",
                        whoCanSee: "everyone in the workspace",
                    }),
                ])
            );
            expect(forBea.map(choice => choice.path)).not.toContain("Board pack");
            const forAda = await listFolderChoices(ctxOf("ada"));
            expect(forAda).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ path: "Board pack", whoCanSee: "only you" }),
                ])
            );
        });

        it("answers a folder the person cannot see like any unknown name, never as forbidden", async () => {
            const made = await resolveDestination(ctxOf("bea"), "Board pack");
            expect(made.created).toBe(true);
            expect(made.path).not.toBe("Board pack");
            expect(await whoCanSeeFolder(ctxOf("bea"), made.path)).toBe("only you");
        });

        it("makes a new top-level folder private, while a subfolder follows its parent", async () => {
            const top = await resolveDestination(ctxOf("bea"), "Bea research");
            expect(top).toEqual({ path: "Bea research", created: true });
            expect(await whoCanSeeFolder(ctxOf("bea"), "Bea research")).toBe("only you");
            const nested = await resolveDestination(ctxOf("bea"), "Team/Bea notes");
            expect(nested.created).toBe(true);
            expect(await whoCanSeeFolder(ctxOf("bea"), nested.path)).toBe(
                "everyone in the workspace"
            );
        });

        it("refuses a folder path that is not valid", async () => {
            await expect(resolveDestination(ctxOf("bea"), "Unfiled/inside")).rejects.toBeInstanceOf(
                AssistantDocumentError
            );
        });

        it("never names a same-title document the person cannot open", async () => {
            expect(await findSameTitle(ctxOf("bea"), "Team", "secret PLAN")).toEqual([]);
            expect(await findSameTitle(ctxOf("ada"), "Team", "secret PLAN")).toEqual([
                { id: ids.secret, title: "Secret plan", isArtifact: false },
            ]);
        });
    });

    describe("filing", () => {
        it("files a draft into the folder with the artifact marker, and only once", async () => {
            const row = await draft("bea", "<html><title>Calc</title></html>");
            const filed = await fileStagedDocument(ctxOf("bea"), ORIGIN, {
                staged: row,
                title: "Calc",
                folder: "Team",
                ingestMimeType: "text/html",
                artifact: { type: "html", sourceUrl: null },
                fromLabel: "Codex",
                metadata: { addedFrom: { origin: "chatgpt" } },
            });
            expect(filed).toMatchObject({
                status: "created",
                folder: "Team",
                whoCanSee: "everyone in the workspace",
            });
            const [doc] = await test.db
                .select()
                .from(document)
                .where(eq(document.id, filed.documentId));
            expect(doc!.ocrMetadata).toMatchObject({
                kind: "claude-artifact",
                artifactType: "html",
                addedFrom: { origin: "chatgpt" },
            });
            await expect(
                fileStagedDocument(ctxOf("bea"), ORIGIN, {
                    staged: row,
                    title: "Calc",
                    folder: "Team",
                    ingestMimeType: "text/html",
                    artifact: null,
                    fromLabel: "Codex",
                    metadata: {},
                })
            ).rejects.toMatchObject({ code: "used" });
        });

        it("adds a version only to a document the person can edit, and refuses others as not found", async () => {
            const row = await draft("bea");
            await expect(
                fileStagedDocument(ctxOf("bea"), ORIGIN, {
                    staged: row,
                    title: "x",
                    folder: "",
                    ingestMimeType: "text/markdown",
                    artifact: null,
                    fromLabel: "Codex",
                    documentId: ids.secret,
                    metadata: {},
                })
            ).rejects.toMatchObject({ code: "not_found" });
            // The refused draft can be filed again (released, not burned).
            await expect(loadStagedFile(owner("bea"), row.id)).resolves.toMatchObject({
                status: "ready",
            });
        });

        it("gives a version the newest file's kind and keeps the name unless a title was given", async () => {
            const artifactId = await addDocument("Pricing calculator", "Team", {
                kind: "claude-artifact",
                artifactType: "html",
                sourceUrl: null,
                importedAt: "2026-11-01T00:00:00.000Z",
                connector: "kept",
            });
            const markdown = await draft("ada", "# A different heading");
            const asDoc = await fileStagedDocument(ctxOf("ada"), ORIGIN, {
                staged: markdown,
                title: "A different heading",
                folder: "",
                ingestMimeType: "text/markdown",
                artifact: null,
                fromLabel: "Codex",
                documentId: artifactId,
                renameOnVersion: false,
                metadata: { addedFrom: { origin: "chatgpt" } },
            });
            expect(asDoc).toMatchObject({ status: "version_added", title: "Pricing calculator" });
            let [doc] = await test.db.select().from(document).where(eq(document.id, artifactId));
            expect(doc!.title).toBe("Pricing calculator");
            expect(doc!.ocrMetadata).not.toHaveProperty("kind");
            expect(doc!.ocrMetadata).not.toHaveProperty("artifactType");
            expect(doc!.ocrMetadata).toMatchObject({
                connector: "kept",
                addedFrom: { origin: "chatgpt" },
            });

            const html = await draft("ada", "<svg/>");
            await fileStagedDocument(ctxOf("ada"), ORIGIN, {
                staged: html,
                title: "Pricing calculator v3",
                folder: "",
                ingestMimeType: "text/plain",
                artifact: { type: "svg", sourceUrl: null },
                fromLabel: "Codex",
                documentId: artifactId,
                renameOnVersion: true,
                metadata: {},
            });
            [doc] = await test.db.select().from(document).where(eq(document.id, artifactId));
            expect(doc!.title).toBe("Pricing calculator v3");
            expect(doc!.ocrMetadata).toMatchObject({
                kind: "claude-artifact",
                artifactType: "svg",
            });
            const versions = await test.db
                .select()
                .from(documentVersions)
                .where(and(eq(documentVersions.documentId, BigInt(artifactId))));
            expect(versions).toHaveLength(2);
        });
    });
});

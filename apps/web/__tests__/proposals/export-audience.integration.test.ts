/**
 * Export is publication, not just another read by the writer. Scope, grants,
 * application persistence and same-day convergence use real migrated Postgres.
 * Only storage/ingestion is a sink: no network or processing jobs are started.
 */
import { and, eq } from "drizzle-orm";

import { createDocumentLifecycle } from "@launchstack/orchestration";
import {
    addSection,
    createApplication,
    getApplication,
    updateApplication,
    updateSection,
} from "@launchstack/pipelines/proposals/db";
import { makeApplicationCreationKey } from "@launchstack/pipelines/proposals";
import type { ApplicationRecord, Evidence } from "@launchstack/pipelines/proposals/types";
import { category, company, document, type Document } from "@launchstack/store/schema";
import { configureDatabase, type DbClient } from "@launchstack/store/client";

import { builtinRolePermissions } from "~/lib/authz/permissions";
import { resolveDocumentScope } from "~/lib/authz/scope";
import { scopeAllowsCategory, scopeAllowsDocument } from "~/lib/authz/scope-types";
import { uploadFile } from "~/lib/storage";
import {
    documentGrants,
    documentSettings,
    folderGrants,
    folderSettings,
    userCompanyMemberships,
    users,
    workspaceGroupMembers,
    workspaceGroups,
} from "~/server/db/schema";
import {
    exportApplication,
    ProposalsError,
    renderProposalMarkdown,
} from "~/server/proposals/service";
import { processDocumentUpload } from "~/server/services/document-upload";

import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../founderWeeklyReview/testDb";

let mockActiveDb: DbClient | null = null;
jest.mock("~/server/db", () => ({
    get db() {
        if (!mockActiveDb) throw new Error("test database not ready");
        return mockActiveDb;
    },
}));
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn() }));
jest.mock("~/server/services/document-upload", () => ({ processDocumentUpload: jest.fn() }));
jest.mock("~/server/proposals/executor", () => ({ startProposalRun: jest.fn() }));
// resolveMemberContext is real; this path never reads a browser session.
jest.mock("~/server/auth", () => ({ getServerSession: jest.fn() }));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

const ROLES = { writer: "member", reader: "viewer", guest: "guest" } as const;
type Person = keyof typeof ROLES;
interface Grant {
    principalType: string;
    principalId: string;
}
const PRIVATE_QUOTE = "Our confidential reserve is 470000 dollars.";
const ORIGIN = "http://localhost:3031/api/proposals/export";

describeDb("proposal export audience (integration)", () => {
    // Database creation and real migration SQL need a larger Jest deadline;
    // this does not insert a sleep or replace Postgres's own scheduling.
    jest.setTimeout(120_000);

    let test: FounderWeeklyReviewTestDatabase;
    let companyId: bigint;
    let sequence = 0;
    const userPks = {} as Record<Person, bigint>;
    const ctx = () => ({ companyId, userId: `auth_writer_${sequence}` });
    const userGrants = (...people: Person[]): Grant[] =>
        people.map(person => ({ principalType: "user", principalId: userPks[person].toString() }));
    const scopeFor = (person: Person) =>
        resolveDocumentScope({
            companyId,
            userPk: userPks[person],
            role: ROLES[person],
            permissions: builtinRolePermissions(ROLES[person])!,
        });

    async function addPerson(person: Person) {
        const [user] = await test.db
            .insert(users)
            .values({
                userId: `auth_${person}_${sequence}`,
                name: person,
                email: `${person}-${sequence}@export-audience.test`,
                companyId,
            })
            .returning();
        userPks[person] = BigInt(user!.id);
        await test.db.insert(userCompanyMemberships).values({
            userId: userPks[person],
            companyId,
            role: ROLES[person],
            status: "active",
        });
    }

    async function folder(path: string) {
        const [existing] = await test.db
            .select()
            .from(category)
            .where(and(eq(category.companyId, companyId), eq(category.name, path)));
        if (existing) return existing;
        const [created] = await test.db
            .insert(category)
            .values({ companyId, name: path })
            .returning();
        return created!;
    }

    async function grantFolder(path: string, grants: readonly Grant[]) {
        const target = await folder(path);
        if (grants.length)
            await test.db.insert(folderGrants).values(
                grants.map(grant => ({
                    ...grant,
                    companyId,
                    categoryId: BigInt(target.id),
                    level: "view",
                    grantedBy: "auth_writer",
                }))
            );
    }

    async function restrictFolder(path: string, grants: readonly Grant[]) {
        const target = await folder(path);
        await test.db.insert(folderSettings).values({
            companyId,
            categoryId: BigInt(target.id),
            visibility: "restricted",
            updatedBy: "auth_writer",
        });
        await grantFolder(path, grants);
    }

    async function source(path = "Research", tenant = companyId) {
        const [created] = await test.db
            .insert(document)
            .values({
                companyId: tenant,
                title: "Confidential reserves",
                category: path,
                url: "local://confidential-reserves.md",
                ocrProcessed: true,
            })
            .returning();
        return created!;
    }

    async function grantDocument(target: Document, grants: readonly Grant[]) {
        if (grants.length)
            await test.db.insert(documentGrants).values(
                grants.map(grant => ({
                    ...grant,
                    companyId,
                    documentId: BigInt(target.id),
                    level: "view",
                    grantedBy: "auth_writer",
                }))
            );
    }

    async function restrictDocument(target: Document, grants: readonly Grant[]) {
        await test.db.insert(documentSettings).values({
            companyId,
            documentId: BigInt(target.id),
            restricted: true,
            updatedBy: "auth_writer",
        });
        await grantDocument(target, grants);
    }

    function evidence(documentId: number | null, n = 1): Evidence {
        return {
            n,
            documentId,
            title: "Confidential reserves",
            page: 1,
            quote: PRIVATE_QUOTE,
            url: null,
        };
    }

    async function draftApplication(items: Evidence[], cites = [1]) {
        const application = await createApplication({
            companyId,
            createdByUserId: ctx().userId,
            title: "Reserve-backed community programme",
            funder: null,
            opportunityId: null,
            deadline: null,
            requestText: null,
            requestUrl: null,
            requestDocumentId: null,
        });
        const section = await addSection(companyId, application.id, {
            key: "capacity",
            question: "What financial capacity supports delivery?",
            guidance: null,
            wordLimit: null,
            required: true,
        });
        await updateSection(companyId, section.id, {
            status: "approved",
            draft: "Our reserve supports delivery [E1].",
            draftMeta: { cites, gaps: [], libraryItemIds: [], evidence: items },
        });
        return application;
    }

    async function expectDenied(application: ApplicationRecord) {
        const before = await getApplication(application.id, companyId);
        const outcome = await exportApplication(ctx(), application.id, ORIGIN).then(
            () => ({ status: 200 }),
            (error: unknown) => {
                if (!(error instanceof ProposalsError)) throw error;
                return { status: error.status };
            }
        );
        const saved = await getApplication(application.id, companyId);
        expect({
            ...outcome,
            storageUploads: jest.mocked(uploadFile).mock.calls.length,
            ingestionUploads: jest.mocked(processDocumentUpload).mock.calls.length,
            exportedDocumentId: saved?.exportedDocumentId,
        }).toEqual({
            status: 403,
            storageUploads: 0,
            ingestionUploads: 0,
            exportedDocumentId: before!.exportedDocumentId,
        });
    }

    async function expectAllowed(application: ApplicationRecord) {
        const exported = await exportApplication(ctx(), application.id, ORIGIN);
        expect(uploadFile).toHaveBeenCalledTimes(1);
        expect(processDocumentUpload).toHaveBeenCalledTimes(1);
        expect(exported.exportedDocumentId).not.toBeNull();
        expect((await getApplication(application.id, companyId))?.exportedDocumentId).toBe(
            exported.exportedDocumentId
        );
        return exported;
    }

    async function existingExport(application: ApplicationRecord, path = "Proposals") {
        return createDocumentLifecycle({
            companyId,
            userId: "auth_writer",
            title: "Earlier same-day export",
            category: path,
            url: "local://earlier-export.md",
            creationKey: makeApplicationCreationKey(application.id, new Date()),
            mimeType: "text/markdown",
            ocrProcessed: true,
        });
    }

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;
        configureDatabase(test.db);
        jest.mocked(uploadFile).mockResolvedValue({
            url: "/api/files/export-sink",
            pathname: "export-sink.md",
            provider: "database",
        });
        jest.mocked(processDocumentUpload).mockImplementation(async params => {
            // Keep the real creation-key convergence and saved source/version;
            // omit processing so nothing is enqueued or sent to an engine.
            const lifecycle = await createDocumentLifecycle({
                companyId: params.user.companyId,
                userId: params.user.userId,
                title: params.documentName,
                category: params.category ?? "",
                url: params.rawDocumentUrl,
                creationKey: params.creationKey!,
                mimeType: params.mimeType,
                ocrProcessed: true,
            });
            const uploaded = {
                id: lifecycle.document.id,
                title: lifecycle.document.title,
                category: lifecycle.document.category,
                url: lifecycle.document.url,
            };
            return {
                jobId: "export-sink",
                eventIds: [],
                storageType: "database",
                document: uploaded,
                createdDocuments: lifecycle.created ? [uploaded] : [],
                resolvedDocumentUrl: params.rawDocumentUrl,
            };
        });
    });

    beforeEach(async () => {
        jest.clearAllMocks();
        sequence += 1;
        const [workspace] = await test.db
            .insert(company)
            .values({ name: `Export audience ${sequence}`, numberOfEmployees: "2" })
            .returning();
        companyId = BigInt(workspace!.id);
        await addPerson("writer");
        await addPerson("reader");
        await folder("Research");
        await folder("Proposals");
    });

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    it.each([
        {
            audience: "another workspace reader cannot read the citation",
            readers: ["writer"] as Person[],
            readerCanRead: false,
        },
        {
            audience: "all current workspace members are explicitly granted the citation",
            readers: ["writer", "reader"] as Person[],
            readerCanRead: true,
        },
    ])(
        "refuses publication into workspace-visible Proposals before any side effect when $audience",
        async ({ readers, readerCanRead }) => {
            const cited = await source();
            await restrictDocument(cited, userGrants(...readers));
            const [writerScope, readerScope] = await Promise.all([
                scopeFor("writer"),
                scopeFor("reader"),
            ]);
            expect(scopeAllowsDocument(writerScope, cited)).toBe(true);
            expect(scopeAllowsDocument(readerScope, cited)).toBe(readerCanRead);
            expect(scopeAllowsCategory(readerScope, "Proposals")).toBe(true);
            const application = await draftApplication([evidence(cited.id)]);
            const rendered = await renderProposalMarkdown(ctx(), application.id);
            expect(rendered.markdown).toContain(PRIVATE_QUOTE);
            expect(rendered.markdown).toContain("Sources: [E1]");
            await expectDenied(application);
        }
    );

    it.each([
        { label: "identical", readers: ["writer", "reader"] as Person[] },
        { label: "narrower", readers: ["writer"] as Person[] },
    ])("allows a restricted destination with a $label audience", async ({ readers }) => {
        const cited = await source();
        await restrictDocument(cited, userGrants("writer", "reader"));
        await restrictFolder("Proposals", userGrants(...readers));
        const application = await draftApplication([evidence(cited.id)]);
        await expectAllowed(application);
    });

    it("requires the writer to read the Source even when the destination's audience is narrower", async () => {
        const cited = await source();
        await restrictDocument(cited, userGrants("reader"));
        await restrictFolder("Proposals", userGrants("writer"));
        expect(scopeAllowsDocument(await scopeFor("writer"), cited)).toBe(false);
        await expectDenied(await draftApplication([evidence(cited.id)]));
    });

    it("requires the writer to be able to reach the export destination", async () => {
        const cited = await source();
        await restrictFolder("Proposals", userGrants("reader"));
        await expectDenied(await draftApplication([evidence(cited.id)]));
    });

    it("allows equal inherited folder restrictions without a per-document grant", async () => {
        const cited = await source("Research/Nested");
        await restrictFolder("Research", userGrants("writer"));
        await restrictFolder("Proposals", userGrants("writer"));
        await expectAllowed(await draftApplication([evidence(cited.id)]));
    });

    it("does not carry an ancestor grant past a nearer restricted folder", async () => {
        const cited = await source("Research/Closed");
        await restrictFolder("Research", userGrants("writer", "reader"));
        await restrictFolder("Research/Closed", userGrants("writer"));
        await restrictFolder("Proposals", userGrants("writer", "reader"));
        expect(scopeAllowsDocument(await scopeFor("reader"), cited)).toBe(false);
        await expectDenied(await draftApplication([evidence(cited.id)]));
    });

    it("allows a nearer granted restricted subfolder to carve out a denied ancestor", async () => {
        const cited = await source("Research/Shared");
        await restrictFolder("Research", userGrants("writer"));
        await restrictFolder("Research/Shared", userGrants("writer", "reader"));
        await restrictFolder("Proposals", userGrants("writer", "reader"));
        expect(scopeAllowsDocument(await scopeFor("reader"), cited)).toBe(true);
        await expectAllowed(await draftApplication([evidence(cited.id)]));
    });

    it("includes reach-in grants on inheriting source folders", async () => {
        const cited = await source("Research/Shared");
        await restrictFolder("Research", userGrants("writer"));
        await grantFolder("Research/Shared", userGrants("reader"));
        await restrictFolder("Proposals", userGrants("writer", "reader"));
        expect(scopeAllowsDocument(await scopeFor("reader"), cited)).toBe(true);
        await expectAllowed(await draftApplication([evidence(cited.id)]));
    });

    it("does not treat folder grants as access through an explicit document restriction", async () => {
        const cited = await source();
        await restrictFolder("Research", userGrants("writer", "reader"));
        await restrictDocument(cited, userGrants("writer"));
        await restrictFolder("Proposals", userGrants("writer", "reader"));
        expect(scopeAllowsDocument(await scopeFor("reader"), cited)).toBe(false);
        await expectDenied(await draftApplication([evidence(cited.id)]));
    });

    it("includes a source document's reach-in grants when proving the audience", async () => {
        const cited = await source();
        await restrictFolder("Research", userGrants("writer"));
        await grantDocument(cited, userGrants("reader"));
        await restrictFolder("Proposals", userGrants("writer", "reader"));
        expect(scopeAllowsDocument(await scopeFor("reader"), cited)).toBe(true);
        await expectAllowed(await draftApplication([evidence(cited.id)]));
    });

    it("normalizes role aliases instead of comparing raw grant spellings", async () => {
        const cited = await source();
        await restrictDocument(cited, [{ principalType: "role", principalId: "editor" }]);
        await restrictFolder("Proposals", [{ principalType: "role", principalId: "member" }]);
        await expectAllowed(await draftApplication([evidence(cited.id)]));
    });

    it("allows the same group policy without expanding it to today's members", async () => {
        const [group] = await test.db
            .insert(workspaceGroups)
            .values({ companyId, name: "Writers", slug: "writers", createdBy: "auth_writer" })
            .returning();
        await test.db.insert(workspaceGroupMembers).values({
            groupId: BigInt(group!.id),
            userId: userPks.writer,
            addedBy: "auth_writer",
        });
        const grants = [{ principalType: "group", principalId: String(group!.id) }];
        const cited = await source();
        await restrictDocument(cited, grants);
        await restrictFolder("Proposals", grants);
        await expectAllowed(await draftApplication([evidence(cited.id)]));
    });

    it("does not infer durable user-to-group containment from current membership", async () => {
        const [group] = await test.db
            .insert(workspaceGroups)
            .values({ companyId, name: "Writers", slug: "writers", createdBy: "auth_writer" })
            .returning();
        await test.db.insert(workspaceGroupMembers).values({
            groupId: BigInt(group!.id),
            userId: userPks.writer,
            addedBy: "auth_writer",
        });
        const cited = await source();
        await restrictDocument(cited, [{ principalType: "group", principalId: String(group!.id) }]);
        await restrictFolder("Proposals", userGrants("writer"));
        expect(scopeAllowsDocument(await scopeFor("writer"), cited)).toBe(true);
        await expectDenied(await draftApplication([evidence(cited.id)]));
    });

    it("does not mistake workspace visibility for guest access to an otherwise unrestricted Source", async () => {
        await addPerson("guest");
        const cited = await source();
        await grantFolder("Proposals", userGrants("guest"));
        const guestScope = await scopeFor("guest");
        expect(scopeAllowsDocument(guestScope, cited)).toBe(false);
        expect(scopeAllowsCategory(guestScope, "Proposals")).toBe(true);
        await expectDenied(await draftApplication([evidence(cited.id)]));
    });

    it("allows matching explicit guest policies", async () => {
        await addPerson("guest");
        const cited = await source();
        const grants = [...userGrants("writer"), { principalType: "role", principalId: "guest" }];
        await restrictDocument(cited, grants);
        await restrictFolder("Proposals", grants);
        expect(scopeAllowsDocument(await scopeFor("guest"), cited)).toBe(true);
        await expectAllowed(await draftApplication([evidence(cited.id)]));
    });

    it.each(["missing", "null", "foreign"] as const)(
        "denies %s cited document provenance before uploading",
        async provenance => {
            let documentId: number | null = null;
            if (provenance === "missing") documentId = 987654321;
            if (provenance === "foreign") {
                const [other] = await test.db
                    .insert(company)
                    .values({ name: "Other tenant", numberOfEmployees: "1" })
                    .returning();
                documentId = (await source("Research", BigInt(other!.id))).id;
            }
            await expectDenied(await draftApplication([evidence(documentId)]));
        }
    );

    it("checks every cited Source, not just one whose audience matches", async () => {
        const readable = await source();
        const privateSource = await source();
        await restrictDocument(readable, userGrants("writer", "reader"));
        await restrictDocument(privateSource, userGrants("writer"));
        await restrictFolder("Proposals", userGrants("writer", "reader"));
        await expectDenied(
            await draftApplication([evidence(readable.id), evidence(privateSource.id, 2)], [1, 2])
        );
    });

    it("ignores uncited metadata, unresolved cite numbers, and citations on unwritten sections just like the renderer", async () => {
        const publicSource = await source();
        const privateSource = await source();
        await restrictDocument(privateSource, userGrants("writer"));
        const application = await draftApplication(
            [
                { ...evidence(publicSource.id), quote: "Our public programme supports delivery." },
                evidence(privateSource.id, 2),
                evidence(null, 3),
                evidence(987654321, 4),
            ],
            [1, 99]
        );
        const blank = await addSection(companyId, application.id, {
            key: "unwritten",
            question: "An unwritten section",
            guidance: null,
            wordLimit: null,
            required: false,
        });
        await updateSection(companyId, blank.id, {
            draft: "   ",
            draftMeta: { cites: [1], gaps: [], libraryItemIds: [], evidence: [evidence(null)] },
        });
        expect((await renderProposalMarkdown(ctx(), application.id)).markdown).not.toContain(
            PRIVATE_QUOTE
        );
        await expectAllowed(application);
    });

    it("checks the actual same-day destination's reach-in readers before upload", async () => {
        const cited = await source();
        await restrictDocument(cited, userGrants("writer"));
        await restrictFolder("Proposals", userGrants("writer"));
        const application = await draftApplication([evidence(cited.id)]);
        const existing = await existingExport(application);
        await grantDocument(existing.document, userGrants("reader"));
        await updateApplication(companyId, application.id, {
            exportedDocumentId: existing.document.id,
        });
        expect(scopeAllowsDocument(await scopeFor("reader"), existing.document)).toBe(true);
        await expectDenied(application);
    });

    it("does not assume a moved same-day export still inherits Proposals restrictions", async () => {
        const cited = await source();
        await restrictDocument(cited, userGrants("writer"));
        await restrictFolder("Proposals", userGrants("writer"));
        const application = await draftApplication([evidence(cited.id)]);
        await existingExport(application, "Shared");
        await expectDenied(application);
    });

    it("uses an existing document's narrower explicit restriction instead of its wider folder default", async () => {
        const cited = await source();
        await restrictDocument(cited, userGrants("writer"));
        const application = await draftApplication([evidence(cited.id)]);
        const existing = await existingExport(application);
        await restrictDocument(existing.document, userGrants("writer"));
        const exported = await expectAllowed(application);
        expect(exported.exportedDocumentId).toBe(existing.document.id);
        const [saved] = await test.db
            .select()
            .from(document)
            .where(eq(document.id, existing.document.id));
        expect(saved).toMatchObject({ category: "Proposals", url: "local://earlier-export.md" });
    });

    it("preserves same-day source convergence for an allowed re-export", async () => {
        const cited = await source();
        await restrictDocument(cited, userGrants("writer"));
        await restrictFolder("Proposals", userGrants("writer"));
        const application = await draftApplication([evidence(cited.id)]);
        const first = await expectAllowed(application);
        jest.clearAllMocks();
        const second = await expectAllowed(application);
        expect(second.exportedDocumentId).toBe(first.exportedDocumentId);
        expect(jest.mocked(processDocumentUpload).mock.calls[0]?.[0].creationKey).toBe(
            makeApplicationCreationKey(application.id, new Date())
        );
    });
});

/**
 * Section approval follows the saved text through the public service and a
 * real migrated Postgres. Reads must reflect both the section status and the
 * application's persisted readiness and section checklist.
 */
import { configureDatabase, type DbClient } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";

import type { ApplicationDetail, SectionDto } from "~/app/employer/tools/proposals/api";
import {
    loadApplication,
    newApplication,
    newSection,
    patchSection,
    type ProposalsCtx,
} from "~/server/proposals/service";

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
// These unused dispatch/storage boundaries otherwise load the job and upload
// runtimes. The service, adapter, pipeline persistence and SQL remain real.
jest.mock("~/server/proposals/executor", () => ({ startProposalRun: jest.fn() }));
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn() }));
jest.mock("~/server/services/document-upload", () => ({
    processDocumentUpload: jest.fn(),
}));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

describeDb("section approval follows the saved answer (integration)", () => {
    jest.setTimeout(120_000);

    const approvedDraft = "We serve 420 children each year.";
    let test: FounderWeeklyReviewTestDatabase;
    let ctx: ProposalsCtx;
    let applicationId: string;
    let section: SectionDto;
    let before: ApplicationDetail;

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;
        configureDatabase(test.db);
        const [workspace] = await test.db
            .insert(company)
            .values({ name: "Section approval regression", numberOfEmployees: "20" })
            .returning();
        ctx = { companyId: BigInt(workspace!.id), userId: "auth_section_approver" };
    });

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    beforeEach(async () => {
        const { application } = await newApplication(ctx, { title: "Literacy grant" });
        applicationId = application.id;
        section = await newSection(ctx, applicationId, {
            question: "What outcomes will you measure and how?",
        });
        await patchSection(ctx, applicationId, section.id, {
            draft: approvedDraft,
            status: "approved",
        });
        before = await loadApplication(ctx, applicationId);
        expect(before.sectionList.find(s => s.id === section.id)).toMatchObject({
            draft: approvedDraft,
            status: "approved",
        });
        expect(before.requirements.find(r => r.sectionKey === section.key)).toMatchObject({
            done: true,
        });
    });

    it.each([
        ["different wording", "We now serve 640 children each year."],
        ["a whitespace-only change", `${approvedDraft} `],
    ])("drops approval for %s and refreshes readiness and the checklist", async (_, draft) => {
        const patched = await patchSection(ctx, applicationId, section.id, { draft });
        const after = await loadApplication(ctx, applicationId);

        expect(patched).toMatchObject({ draft, status: "edited" });
        expect(after.sectionList.find(s => s.id === section.id)).toMatchObject({
            draft,
            status: "edited",
        });
        expect(after.readiness).toBeLessThan(before.readiness);
        expect(after.requirements.find(r => r.sectionKey === section.key)).toMatchObject({
            done: false,
        });
    });

    it("preserves approval when saving the exact same text", async () => {
        await patchSection(ctx, applicationId, section.id, { draft: approvedDraft });
        const after = await loadApplication(ctx, applicationId);

        expect(after.sectionList.find(s => s.id === section.id)).toMatchObject({
            draft: approvedDraft,
            status: "approved",
        });
        expect(after.readiness).toBe(before.readiness);
        expect(after.requirements.find(r => r.sectionKey === section.key)).toMatchObject({
            done: true,
        });
    });

    it.each(["", null, " \n "])("clearing an approved answer to %p empties it", async draft => {
        await patchSection(ctx, applicationId, section.id, { draft });
        const after = await loadApplication(ctx, applicationId);

        expect(after.sectionList.find(s => s.id === section.id)).toMatchObject({
            draft,
            status: "empty",
        });
        expect(after.readiness).toBeLessThan(before.readiness);
        expect(after.requirements.find(r => r.sectionKey === section.key)).toMatchObject({
            done: false,
        });
    });

    it("approves changed text when the Approve request includes draft and status", async () => {
        const draft = "We now serve 640 children each year.";
        await patchSection(ctx, applicationId, section.id, { draft, status: "approved" });
        const after = await loadApplication(ctx, applicationId);

        expect(after.sectionList.find(s => s.id === section.id)).toMatchObject({
            draft,
            status: "approved",
        });
        expect(after.readiness).toBe(before.readiness);
        expect(after.requirements.find(r => r.sectionKey === section.key)).toMatchObject({
            done: true,
        });
    });
});

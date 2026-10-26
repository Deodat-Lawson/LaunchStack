/**
 * Selected-text edit runs against a real database, with a stubbed model: what is charged, what
 * is saved, and what a stale or failed generation leaves behind. A stub proves the run, charge
 * and atomicity rules; it says nothing about the quality of a real model's edit.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import { configureDatabase, createDb, type Db } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";
import {
    CatalogueProgramSchema,
    type AcceleratorApplication,
    type CatalogueProgram,
} from "@launchstack/pipelines/accelerators";
import {
    applyAcceleratorEdit,
    getAcceleratorApplication,
    importCatalogue,
    saveAcceleratorAnswer,
    startAcceleratorApplication,
} from "@launchstack/pipelines/accelerators/db";
import {
    createDefaultPorts,
    executeProposalRun,
    queueProposalRun,
    type ProposalPorts,
    type RunRecord,
} from "@launchstack/pipelines/proposals";
import { getRun } from "@launchstack/pipelines/proposals/db";
import { proposalSections } from "@launchstack/pipelines/proposals/schema";

import { prepareAcceleratorRun } from "~/server/accelerators/run";

import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../founderWeeklyReview/testDb";

const describeDb = process.env.LAUNCHSTACK_TEST_DATABASE_URL ? describe : describe.skip;

const ANSWER = "Prefix 😀 old suffix";
// "old" sits after the emoji, which is two UTF-16 code units wide.
const SELECTION = { start: 10, end: 13, original: "old" };

interface StubModel {
    replacement: string;
    gaps?: string[];
    before?: () => Promise<void>;
    fail?: boolean;
}

describeDb("Selected-text edit runs", () => {
    jest.setTimeout(120_000);
    let fixture: FounderWeeklyReviewTestDatabase;
    let connection: Db;
    let program: CatalogueProgram;
    let application: AcceleratorApplication;
    let sectionId: string;
    let companyId: bigint;
    let otherCompanyId: bigint;
    let debits: number[];
    let access: boolean;

    beforeAll(async () => {
        fixture = await createFounderWeeklyReviewTestDatabase();
        const url = new URL(process.env.LAUNCHSTACK_TEST_DATABASE_URL!);
        url.pathname = `/${fixture.databaseName}`;
        connection = createDb({ url: url.toString(), maxConnections: 8 });
        configureDatabase(connection.db);
        program = CatalogueProgramSchema.parse(
            JSON.parse(
                await readFile(
                    join(
                        __dirname,
                        "../../../../fixtures/accelerators/programs/abovea-startup-accelerator.json"
                    ),
                    "utf8"
                )
            )
        );
        await importCatalogue([program]);
    });

    beforeEach(async () => {
        const rows = await fixture.db
            .insert(company)
            .values([
                { name: "Edit run regression", numberOfEmployees: "1" },
                { name: "Other company", numberOfEmployees: "1" },
            ])
            .returning({ id: company.id });
        companyId = BigInt(rows[0]!.id);
        otherCompanyId = BigInt(rows[1]!.id);
        application = await startAcceleratorApplication(
            companyId,
            "edit-author",
            program.id,
            program.cycles[0]!.id
        );
        sectionId = application.sections.find(item => item.field.fieldType === "long_text")!.id;
        await saveAcceleratorAnswer(companyId, application.id, sectionId, {
            expectedRevision: 0,
            draft: ANSWER,
        });
        debits = [];
        access = true;
    });

    afterAll(async () => {
        await connection?.close();
        await fixture?.close();
    });

    function queue(overrides: { expectedRevision?: number; instruction?: string } = {}) {
        return queueProposalRun({
            companyId,
            userId: "edit-author",
            kind: "accel_edit",
            input: {
                applicationId: application.id,
                acceleratorEdit: {
                    sectionId,
                    expectedRevision: overrides.expectedRevision ?? 1,
                    start: SELECTION.start,
                    end: SELECTION.end,
                    instruction: overrides.instruction ?? "Replace old with new",
                },
            },
        });
    }

    function execute(run: RunRecord, model: StubModel): Promise<RunRecord> {
        const ports: ProposalPorts = createDefaultPorts({
            debitCredits: async ({ amount }) => {
                debits.push(amount);
            },
        });
        ports.retrieve = async () => [];
        ports.structured = (async () => {
            await model.before?.();
            if (model.fail) throw new Error("provider unavailable");
            return {
                result: { replacement: model.replacement, gaps: model.gaps ?? [] },
                modelId: "stub-model",
            };
        }) as ProposalPorts["structured"];
        ports.assertAcceleratorAccess = async () => {
            if (!access) throw new Error("revoked access");
        };
        ports.prepareAcceleratorRun = (ctx, record) => prepareAcceleratorRun(ctx, ports, record);
        return executeProposalRun(
            {
                runId: run.id,
                companyId,
                userId: "edit-author",
                scope: { kind: "everything" },
            },
            ports
        );
    }

    async function savedSection() {
        return (await getAcceleratorApplication(companyId, application.id))!.sections.find(
            item => item.id === sectionId
        )!;
    }

    it("delivers a Suggestion, charges once, and leaves the saved answer untouched", async () => {
        const finished = await execute(await queue(), { replacement: "new" });
        expect(finished).toMatchObject({ status: "completed", creditsUsed: 1_000 });
        expect(debits).toEqual([1_000]);
        expect(finished.result).toEqual({
            kind: "accel_edit",
            applicationId: application.id,
            sectionId,
            suggestion: {
                expectedRevision: 1,
                ...SELECTION,
                replacement: "new",
                gaps: [],
            },
        });
        expect(await savedSection()).toMatchObject({ revision: 1, draft: ANSWER });
    });

    it("keeps the summary to history and status, and reads the same result back from the database", async () => {
        const run = await queue();
        const finished = await execute(run, { replacement: "new" });
        expect(finished.summary).toMatchObject({ headline: "Edit suggested" });
        expect(finished.summary).not.toHaveProperty("suggestion");
        const stored = await getRun(run.id, companyId, { includeAccelerators: true });
        expect(stored?.result).toMatchObject({ kind: "accel_edit", sectionId });
        expect(stored?.result).toEqual(finished.result);
        expect(stored?.summary).toEqual(finished.summary);
    });

    it("has no result before the run completes", async () => {
        const run = await queue();
        expect(run.result).toBeNull();
        expect((await getRun(run.id, companyId, { includeAccelerators: true }))?.result).toBeNull();
    });

    it("applies the delivered Suggestion once, without a second charge", async () => {
        const finished = await execute(await queue(), { replacement: "new" });
        const { suggestion } = finished.result!;
        const apply = {
            expectedRevision: suggestion.expectedRevision,
            start: suggestion.start,
            end: suggestion.end,
            original: suggestion.original,
            replacement: suggestion.replacement,
        };
        await applyAcceleratorEdit(companyId, application.id, sectionId, apply);
        expect(await savedSection()).toMatchObject({
            revision: 2,
            draft: "Prefix 😀 new suffix",
        });
        await expect(
            applyAcceleratorEdit(companyId, application.id, sectionId, apply)
        ).rejects.toMatchObject({ status: 409 });
        expect(debits).toEqual([1_000]);
    });

    it("fails without charge when the answer changed before generation started", async () => {
        const run = await queue();
        await saveAcceleratorAnswer(companyId, application.id, sectionId, {
            expectedRevision: 1,
            draft: "typed after selecting",
        });
        const finished = await execute(run, { replacement: "new" });
        expect(finished).toMatchObject({ status: "failed", creditsUsed: 0 });
        expect(finished.summary).toBeNull();
        expect(finished.result).toBeNull();
        expect(debits).toEqual([]);
        expect(await savedSection()).toMatchObject({ revision: 2, draft: "typed after selecting" });
    });

    it("fails without charge, and keeps newer text, when the answer changes during generation", async () => {
        const run = await queue();
        const finished = await execute(run, {
            replacement: "new",
            before: async () => {
                await saveAcceleratorAnswer(companyId, application.id, sectionId, {
                    expectedRevision: 1,
                    draft: "typed while the model worked",
                });
            },
        });
        expect(finished).toMatchObject({ status: "failed", creditsUsed: 0 });
        expect(finished.error).toMatch(/changed/i);
        expect(debits).toEqual([]);
        expect(await savedSection()).toMatchObject({
            revision: 2,
            draft: "typed while the model worked",
        });
    });

    it("fails without charge when the provider fails", async () => {
        const finished = await execute(await queue(), { replacement: "", fail: true });
        expect(finished).toMatchObject({
            status: "failed",
            creditsUsed: 0,
            error: "provider unavailable",
        });
        expect(debits).toEqual([]);
        expect(await savedSection()).toMatchObject({ revision: 1, draft: ANSWER });
    });

    it("fails without charge when access is revoked before the result is committed", async () => {
        const finished = await execute(await queue(), {
            replacement: "new",
            before: async () => {
                access = false;
            },
        });
        expect(finished).toMatchObject({
            status: "failed",
            creditsUsed: 0,
            error: "revoked access",
        });
        expect(debits).toEqual([]);
    });

    it("refuses a result that would break the Field's limit instead of truncating it", async () => {
        const field = (await savedSection()).field;
        await connection.db
            .update(proposalSections)
            .set({
                formField: {
                    ...field,
                    charLimit: 25,
                    limitConfirmed: true,
                    limitSource: {
                        url: "https://example.test/form",
                        quote: "At most 25 characters",
                    },
                },
            })
            .where(eq(proposalSections.id, sectionId));
        const finished = await execute(await queue(), {
            replacement: "a much longer replacement than the limit allows",
        });
        expect(finished).toMatchObject({ status: "failed", creditsUsed: 0 });
        expect(finished.summary).toBeNull();
        expect(finished.result).toBeNull();
        expect(debits).toEqual([]);
        expect(await savedSection()).toMatchObject({ draft: ANSWER });
    });

    it("fails without charge when the instruction changes nothing and names no gap", async () => {
        const finished = await execute(await queue(), { replacement: "old" });
        expect(finished).toMatchObject({ status: "failed", creditsUsed: 0 });
        expect(finished.error).toMatch(/no change/i);
        expect(debits).toEqual([]);
    });

    it("delivers, and charges for, an unchanged selection that reports a missing fact", async () => {
        const finished = await execute(await queue({ instruction: "Add our revenue" }), {
            replacement: "old",
            gaps: ["Annual revenue"],
        });
        expect(finished).toMatchObject({ status: "completed", creditsUsed: 1_000 });
        expect(finished.result?.suggestion).toMatchObject({
            original: "old",
            replacement: "old",
            gaps: ["Annual revenue"],
        });
        expect(debits).toEqual([1_000]);
    });

    it("refuses another company's Application and keeps the run unreadable to it", async () => {
        await expect(
            queueProposalRun({
                companyId: otherCompanyId,
                userId: "intruder",
                kind: "accel_edit",
                input: {
                    applicationId: application.id,
                    acceleratorEdit: {
                        sectionId,
                        expectedRevision: 1,
                        start: SELECTION.start,
                        end: SELECTION.end,
                        instruction: "Replace old with new",
                    },
                },
            })
        ).rejects.toMatchObject({ status: 404, code: "application_not_found" });
        const run = await queue();
        expect(await getRun(run.id, otherCompanyId, { includeAccelerators: true })).toBeNull();
    });

    it("admits only one live edit per company", async () => {
        const runs = await Promise.allSettled([queue(), queue()]);
        expect(runs.filter(run => run.status === "fulfilled")).toHaveLength(1);
        expect(runs.find(run => run.status === "rejected")).toMatchObject({
            reason: { status: 409, code: "run_in_progress" },
        });
    });
});

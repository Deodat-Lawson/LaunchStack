import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { configureDatabase, createDb, type Db } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";
import {
    CatalogueProgramSchema,
    type AcceleratorApplication,
    type CatalogueProgram,
} from "@launchstack/pipelines/accelerators";
import {
    applyAcceleratorEdit,
    assertAnswerRevision,
    getAcceleratorApplication,
    importCatalogue,
    saveAcceleratorAnswer,
    saveAcceleratorDraft,
    startAcceleratorApplication,
} from "@launchstack/pipelines/accelerators/db";
import {
    createDefaultPorts,
    executeProposalRun,
    queueProposalRun,
} from "@launchstack/pipelines/proposals";
import {
    createApplication,
    findLiveRun,
    replaceSections,
    updateSection,
    getApplication,
    getRun,
    getSection,
    listApplications,
    listRuns,
} from "@launchstack/pipelines/proposals/db";

import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../founderWeeklyReview/testDb";

const describeDb = process.env.LAUNCHSTACK_TEST_DATABASE_URL ? describe : describe.skip;

describeDb("Accelerators persisted company and answer boundaries", () => {
    jest.setTimeout(120_000);
    let fixture: FounderWeeklyReviewTestDatabase;
    let connection: Db;
    let program: CatalogueProgram;
    let application: AcceleratorApplication;
    let companyId: bigint;
    let otherCompanyId: bigint;

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
                { name: "Accelerator regression", numberOfEmployees: "1" },
                { name: "Other company", numberOfEmployees: "1" },
            ])
            .returning({ id: company.id });
        companyId = BigInt(rows[0]!.id);
        otherCompanyId = BigInt(rows[1]!.id);
        application = await startAcceleratorApplication(
            companyId,
            "regression-author",
            program.id,
            program.cycles[0]!.id
        );
    });

    afterAll(async () => {
        await connection?.close();
        await fixture?.close();
    });

    it("shares one Application between eligible colleagues and isolates it from other companies and grants", async () => {
        const starts = await Promise.all([
            startAcceleratorApplication(
                companyId,
                "colleague-one",
                program.id,
                program.cycles[0]!.id
            ),
            startAcceleratorApplication(
                companyId,
                "colleague-two",
                program.id,
                program.cycles[0]!.id
            ),
        ]);
        expect(starts.map(result => result.id)).toEqual([application.id, application.id]);
        expect(await getAcceleratorApplication(otherCompanyId, application.id)).toBeNull();
        expect(await getApplication(application.id, companyId)).toBeNull();
        expect(await listApplications(companyId)).toEqual([]);
        expect(await getSection(companyId, application.sections[0]!.id)).toBeNull();
    });

    it("keeps grant creation and answer saves working alongside an Accelerator Application", async () => {
        const grant = await createApplication({
            companyId,
            createdByUserId: "grant-author",
            title: "Grant regression",
            funder: null,
            opportunityId: null,
            deadline: null,
            requestText: null,
            requestUrl: null,
            requestDocumentId: null,
        });
        const [section] = await replaceSections(companyId, grant.id, [
            {
                key: "overview",
                question: "Describe the project",
                guidance: null,
                wordLimit: 200,
                required: true,
            },
        ]);
        await updateSection(companyId, section!.id, { draft: "Grant answer", status: "edited" });
        expect((await listApplications(companyId)).map(item => item.id)).toEqual([grant.id]);
        expect(await getSection(companyId, section!.id)).toMatchObject({
            draft: "Grant answer",
            status: "edited",
        });
        expect(await getAcceleratorApplication(companyId, grant.id)).toBeNull();
        expect(await getAcceleratorApplication(companyId, application.id)).toMatchObject({
            id: application.id,
        });
    });

    it("admits one concurrent save and preserves the winner after a stale retry", async () => {
        const section = application.sections.find(item => item.field.fieldType === "long_text")!;
        const writes = await Promise.allSettled([
            saveAcceleratorAnswer(companyId, application.id, section.id, {
                expectedRevision: 0,
                draft: "First answer",
            }),
            saveAcceleratorAnswer(companyId, application.id, section.id, {
                expectedRevision: 0,
                draft: "Second answer",
            }),
        ]);
        expect(writes.filter(write => write.status === "fulfilled")).toHaveLength(1);
        const failure = writes.find(write => write.status === "rejected")!;
        expect(failure.reason).toMatchObject({ status: 409, code: "revision_conflict" });
        const winner = writes.find(write => write.status === "fulfilled")!;
        await expect(
            saveAcceleratorAnswer(companyId, application.id, section.id, {
                expectedRevision: 0,
                draft: "Stale retry",
            })
        ).rejects.toMatchObject({ status: 409 });
        const saved = (await getAcceleratorApplication(companyId, application.id))!.sections.find(
            item => item.id === section.id
        )!;
        expect(saved).toMatchObject({ revision: 1, draft: winner.value.draft });
    });

    it("rejects a late AI draft even after newer text was saved and cleared", async () => {
        const section = application.sections.find(item => item.field.fieldType === "long_text")!;
        await saveAcceleratorAnswer(companyId, application.id, section.id, {
            expectedRevision: 0,
            draft: "New typing",
        });
        await saveAcceleratorAnswer(companyId, application.id, section.id, {
            expectedRevision: 1,
            draft: "",
        });
        await expect(
            connection.db.transaction(tx =>
                saveAcceleratorDraft(
                    companyId,
                    application.id,
                    section.id,
                    0,
                    "Late AI answer",
                    { cites: [], gaps: [], evidence: [], libraryItemIds: [] },
                    tx
                )
            )
        ).rejects.toMatchObject({ status: 409 });
        const saved = (await getAcceleratorApplication(companyId, application.id))!.sections.find(
            item => item.id === section.id
        )!;
        expect(saved).toMatchObject({ revision: 2, draft: "" });
    });

    it("applies the selected Unicode range only and rejects reuse of its old revision", async () => {
        const section = application.sections.find(item => item.field.fieldType === "long_text")!;
        await saveAcceleratorAnswer(companyId, application.id, section.id, {
            expectedRevision: 0,
            draft: "Prefix 😀 old suffix",
        });
        const edit = {
            expectedRevision: 1,
            start: 10,
            end: 13,
            original: "old",
            replacement: "new",
        };
        await applyAcceleratorEdit(companyId, application.id, section.id, edit);
        await expect(
            applyAcceleratorEdit(companyId, application.id, section.id, edit)
        ).rejects.toMatchObject({ status: 409 });
        const saved = (await getAcceleratorApplication(companyId, application.id))!.sections.find(
            item => item.id === section.id
        )!;
        expect(saved).toMatchObject({ revision: 2, draft: "Prefix 😀 new suffix" });
    });

    it("rejects an Apply whose original text differs from the saved slice, without saving", async () => {
        const section = application.sections.find(item => item.field.fieldType === "long_text")!;
        await saveAcceleratorAnswer(companyId, application.id, section.id, {
            expectedRevision: 0,
            draft: "Prefix 😀 old suffix",
        });
        await expect(
            applyAcceleratorEdit(companyId, application.id, section.id, {
                expectedRevision: 1,
                start: 10,
                end: 13,
                original: "new",
                replacement: "x",
            })
        ).rejects.toMatchObject({ status: 409, code: "edit_original_mismatch" });
        const saved = (await getAcceleratorApplication(companyId, application.id))!.sections.find(
            item => item.id === section.id
        )!;
        expect(saved).toMatchObject({ revision: 1, draft: "Prefix 😀 old suffix" });
    });

    it("checks a Field's revision under lock for runs that deliver a Suggestion", async () => {
        const section = application.sections.find(item => item.field.fieldType === "long_text")!;
        await connection.db.transaction(tx =>
            assertAnswerRevision(companyId, application.id, section.id, 0, tx)
        );
        await saveAcceleratorAnswer(companyId, application.id, section.id, {
            expectedRevision: 0,
            draft: "changed",
        });
        await expect(
            connection.db.transaction(tx =>
                assertAnswerRevision(companyId, application.id, section.id, 0, tx)
            )
        ).rejects.toMatchObject({ status: 409, code: "revision_conflict" });
    });

    it("makes a concurrent save wait while a Suggestion run holds the Field's lock", async () => {
        const section = application.sections.find(item => item.field.fieldType === "long_text")!;
        let saveSettled = false;
        let save: Promise<unknown> = Promise.resolve();
        await connection.db.transaction(async tx => {
            await assertAnswerRevision(companyId, application.id, section.id, 0, tx);
            save = saveAcceleratorAnswer(companyId, application.id, section.id, {
                expectedRevision: 0,
                draft: "typed during generation",
            }).finally(() => {
                saveSettled = true;
            });
            await new Promise(resolve => setTimeout(resolve, 500));
            expect(saveSettled).toBe(false);
        });
        await save;
        const saved = (await getAcceleratorApplication(companyId, application.id))!.sections.find(
            item => item.id === section.id
        )!;
        expect(saved).toMatchObject({ revision: 1, draft: "typed during generation" });
    });

    it("validates and hides edit runs from grants", async () => {
        const section = application.sections.find(item => item.field.fieldType === "long_text")!;
        const selection = {
            sectionId: section.id,
            expectedRevision: 0,
            start: 0,
            end: 3,
            instruction: "Make it clearer",
        };
        await expect(
            queueProposalRun({
                companyId,
                userId: "regression-author",
                kind: "accel_edit",
                input: { applicationId: application.id },
            })
        ).rejects.toMatchObject({ status: 400, code: "invalid_run_input" });
        await expect(
            queueProposalRun({
                companyId,
                userId: "regression-author",
                kind: "draft",
                input: { acceleratorEdit: selection },
            })
        ).rejects.toMatchObject({ status: 400, code: "invalid_run_input" });
        const run = await queueProposalRun({
            companyId,
            userId: "regression-author",
            kind: "accel_edit",
            input: { applicationId: application.id, acceleratorEdit: selection },
        });
        expect(await getRun(run.id, companyId)).toBeNull();
        expect(await listRuns(companyId)).toEqual([]);
        expect(await findLiveRun(companyId)).toBeNull();
        expect(await findLiveRun(companyId, { includeAccelerators: true })).toMatchObject({
            id: run.id,
        });
    });

    it("serializes simultaneous matching requests and keeps their run hidden from grants", async () => {
        const runs = await Promise.allSettled([
            queueProposalRun({ companyId, userId: "one", kind: "programs", input: {} }),
            queueProposalRun({ companyId, userId: "two", kind: "programs", input: {} }),
        ]);
        expect(runs.filter(run => run.status === "fulfilled")).toHaveLength(1);
        const rejected = runs.find(run => run.status === "rejected")!;
        expect(rejected.reason).toMatchObject({ status: 409, code: "run_in_progress" });
        const started = runs.find(run => run.status === "fulfilled")!;
        expect(await getRun(started.value.id, companyId)).toBeNull();
        expect(await listRuns(companyId)).toEqual([]);
        expect(
            await getRun(started.value.id, otherCompanyId, { includeAccelerators: true })
        ).toBeNull();
    });

    it.each(["revoked access", "credit failure"] as const)(
        "keeps the answer and charge unchanged after %s during finalization",
        async failure => {
            const section = application.sections.find(
                item => item.field.fieldType === "long_text"
            )!;
            const run = await queueProposalRun({
                companyId,
                userId: "regression-author",
                kind: "accel_draft",
                input: {
                    applicationId: application.id,
                    acceleratorDraft: { sectionId: section.id, expectedRevision: 0 },
                },
            });
            let access = true;
            const ports = createDefaultPorts({
                debitCredits: async () => {
                    throw new Error("credit failure");
                },
            });
            ports.assertAcceleratorAccess = async () => {
                if (!access) throw new Error("revoked access");
            };
            ports.prepareAcceleratorRun = async () => {
                if (failure === "revoked access") access = false;
                return {
                    summary: { headline: "Field drafted" },
                    amount: 1500,
                    description: "Draft",
                    commit: tx =>
                        saveAcceleratorDraft(
                            companyId,
                            application.id,
                            section.id,
                            0,
                            "Generated answer",
                            { cites: [], gaps: [], evidence: [], libraryItemIds: [] },
                            tx
                        ),
                };
            };
            const finished = await executeProposalRun(
                {
                    runId: run.id,
                    companyId,
                    userId: "regression-author",
                    scope: { kind: "everything" },
                },
                ports
            );
            expect(finished).toMatchObject({ status: "failed", creditsUsed: 0, error: failure });
            const saved = (await getAcceleratorApplication(
                companyId,
                application.id
            ))!.sections.find(item => item.id === section.id)!;
            expect(saved).toMatchObject({ revision: 0, draft: null });
        }
    );

    it("rejects unconfirmed Forms and keeps saved Application questions unchanged after a Catalogue update", async () => {
        const changed = structuredClone(program);
        changed.cycles[0]!.form.status = "unconfirmed";
        await importCatalogue([changed]);
        await expect(
            startAcceleratorApplication(otherCompanyId, "other", program.id, program.cycles[0]!.id)
        ).rejects.toMatchObject({ status: 409, code: "form_unavailable" });
        const saved = await getAcceleratorApplication(companyId, application.id);
        expect(saved!.formHash).toBe(application.formHash);
        expect(saved!.sections.map(section => section.field)).toEqual(
            application.sections.map(section => section.field)
        );
        await importCatalogue([program]);
    });
});

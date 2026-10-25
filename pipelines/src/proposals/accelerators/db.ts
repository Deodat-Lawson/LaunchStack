import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@launchstack/store/client";

import type { ProposalDebitExecutor } from "../ports";
import {
    proposalApplications,
    proposalSections,
    type ProposalApplicationRow,
    type ProposalSectionRow,
} from "../schema";
import { DraftMetaSchema, type DraftMeta } from "../types";
import { hashValue } from "./hash";
import { acceleratorCompanyMatches, acceleratorPrograms } from "./schema";
import {
    AcceleratorError,
    AnswerPatchSchema,
    ApplyEditSchema,
    CatalogueProgramSchema,
    FitAssessmentSchema,
    FormFieldSchema,
    assertAnswer,
    canStartForm,
    type AcceleratorApplication,
    type AcceleratorSection,
    type AnswerPatch,
    type ApplyEdit,
    type CatalogueProgram,
    type FitAssessment,
    type StoredFit,
} from "./types";

export async function listCatalogue(): Promise<
    { program: CatalogueProgram; contentHash: string }[]
> {
    return getDb()
        .select({
            program: acceleratorPrograms.program,
            contentHash: acceleratorPrograms.contentHash,
        })
        .from(acceleratorPrograms)
        .orderBy(asc(acceleratorPrograms.id));
}

export async function getCatalogueProgram(
    programId: string
): Promise<{ program: CatalogueProgram; contentHash: string } | null> {
    const [row] = await getDb()
        .select({
            program: acceleratorPrograms.program,
            contentHash: acceleratorPrograms.contentHash,
        })
        .from(acceleratorPrograms)
        .where(eq(acceleratorPrograms.id, programId))
        .limit(1);
    return row ?? null;
}

/** Validate the entire batch before opening the one import transaction. No company API calls this. */
export async function importCatalogue(
    records: CatalogueProgram[]
): Promise<{ inserted: number; updated: number; unchanged: number }> {
    const parsed = z.array(CatalogueProgramSchema).parse(records);
    if (new Set(parsed.map(program => program.id)).size !== parsed.length) {
        throw new AcceleratorError(
            "A catalogue import cannot repeat a Program ID",
            400,
            "duplicate_program"
        );
    }
    const values = parsed
        .map(program => ({ id: program.id, program, contentHash: hashValue(program) }))
        .sort((a, b) => a.id.localeCompare(b.id));
    return getDb().transaction(async tx => {
        const counts = { inserted: 0, updated: 0, unchanged: 0 };
        for (const value of values) {
            // The insert serializes competing imports even when the row did not exist at SELECT time.
            const inserted = await tx
                .insert(acceleratorPrograms)
                .values(value)
                .onConflictDoNothing()
                .returning({ id: acceleratorPrograms.id });
            if (inserted.length > 0) {
                counts.inserted++;
                continue;
            }
            const [existing] = await tx
                .select()
                .from(acceleratorPrograms)
                .where(eq(acceleratorPrograms.id, value.id))
                .for("update");
            if (!existing)
                throw new AcceleratorError(
                    "Program changed during import; retry the batch",
                    409,
                    "catalogue_conflict"
                );
            if (existing.contentHash === value.contentHash) {
                counts.unchanged++;
                continue;
            }
            await tx
                .update(acceleratorPrograms)
                .set({
                    program: value.program,
                    contentHash: value.contentHash,
                    updatedAt: new Date(),
                })
                .where(eq(acceleratorPrograms.id, value.id));
            counts.updated++;
        }
        return counts;
    });
}

export async function listCompanyMatches(companyId: bigint): Promise<Record<string, StoredFit>> {
    const rows = await getDb()
        .select()
        .from(acceleratorCompanyMatches)
        .where(eq(acceleratorCompanyMatches.companyId, companyId));
    return Object.fromEntries(
        rows.map(row => [
            row.programId,
            {
                assessment: row.assessment,
                profileHash: row.profileHash,
                programHash: row.programHash,
                checkedAt: row.checkedAt.toISOString(),
            },
        ])
    );
}

export async function saveCompanyMatches(
    companyId: bigint,
    profileHash: string,
    results: { programId: string; programHash: string; assessment: FitAssessment }[],
    executor?: ProposalDebitExecutor
): Promise<void> {
    const parsed = z
        .array(
            z
                .object({
                    programId: z.string().min(1).max(64),
                    programHash: z.string().regex(/^[a-f0-9]{64}$/),
                    assessment: FitAssessmentSchema,
                })
                .strict()
        )
        .parse(results);
    if (!profileHash || new Set(parsed.map(result => result.programId)).size !== parsed.length) {
        throw new AcceleratorError(
            "Match results require a profile hash and unique Program IDs",
            400,
            "invalid_matches"
        );
    }
    const save = async (db: ProposalDebitExecutor): Promise<void> => {
        const checkedAt = new Date();
        for (const result of [...parsed].sort((a, b) => a.programId.localeCompare(b.programId))) {
            await db
                .insert(acceleratorCompanyMatches)
                .values({ companyId, profileHash, checkedAt, ...result })
                .onConflictDoUpdate({
                    target: [
                        acceleratorCompanyMatches.companyId,
                        acceleratorCompanyMatches.programId,
                    ],
                    set: {
                        assessment: result.assessment,
                        profileHash,
                        programHash: result.programHash,
                        checkedAt,
                    },
                });
        }
    };
    if (executor) await save(executor);
    else await getDb().transaction(save);
}

function sectionView(row: ProposalSectionRow): AcceleratorSection {
    if (!row.formField)
        throw new AcceleratorError(
            "Application Field snapshot is missing",
            409,
            "invalid_snapshot"
        );
    return {
        id: row.id,
        key: row.key,
        field: FormFieldSchema.parse(row.formField),
        draft: row.draft,
        revision: row.revision,
        draftMeta: row.draftMeta,
    };
}

function applicationView(
    row: ProposalApplicationRow,
    sections: ProposalSectionRow[]
): AcceleratorApplication {
    if (row.kind !== "accelerator" || !row.programId || !row.cycleId || !row.formHash) {
        throw new AcceleratorError("Application snapshot is missing", 409, "invalid_snapshot");
    }
    return {
        id: row.id,
        title: row.title,
        programId: row.programId,
        cycleId: row.cycleId,
        formHash: row.formHash,
        sections: sections.map(sectionView),
    };
}

async function readApplication(
    db: ProposalDebitExecutor,
    companyId: bigint,
    id: string
): Promise<AcceleratorApplication | null> {
    const [row] = await db
        .select()
        .from(proposalApplications)
        .where(
            and(
                eq(proposalApplications.id, id),
                eq(proposalApplications.companyId, companyId),
                eq(proposalApplications.kind, "accelerator")
            )
        )
        .limit(1);
    if (!row) return null;
    const sections = await db
        .select()
        .from(proposalSections)
        .where(
            and(eq(proposalSections.companyId, companyId), eq(proposalSections.applicationId, id))
        )
        .orderBy(asc(proposalSections.position));
    return applicationView(row, sections);
}

export async function listAcceleratorApplications(
    companyId: bigint
): Promise<AcceleratorApplication[]> {
    const db = getDb();
    const applications = await db
        .select()
        .from(proposalApplications)
        .where(
            and(
                eq(proposalApplications.companyId, companyId),
                eq(proposalApplications.kind, "accelerator")
            )
        )
        .orderBy(desc(proposalApplications.createdAt));
    if (applications.length === 0) return [];
    const sections = await db
        .select()
        .from(proposalSections)
        .where(
            and(
                eq(proposalSections.companyId, companyId),
                inArray(
                    proposalSections.applicationId,
                    applications.map(application => application.id)
                )
            )
        )
        .orderBy(asc(proposalSections.position));
    const byApplication = new Map<string, ProposalSectionRow[]>();
    for (const section of sections) {
        const group = byApplication.get(section.applicationId) ?? [];
        group.push(section);
        byApplication.set(section.applicationId, group);
    }
    return applications.map(application =>
        applicationView(application, byApplication.get(application.id) ?? [])
    );
}

export async function getAcceleratorApplication(
    companyId: bigint,
    id: string
): Promise<AcceleratorApplication | null> {
    return readApplication(getDb(), companyId, id);
}

export async function startAcceleratorApplication(
    companyId: bigint,
    userId: string,
    programId: string,
    cycleId: string
): Promise<AcceleratorApplication> {
    return getDb().transaction(async tx => {
        const [catalogue] = await tx
            .select()
            .from(acceleratorPrograms)
            .where(eq(acceleratorPrograms.id, programId))
            .for("share");
        if (!catalogue) throw new AcceleratorError("Program not found", 404, "program_not_found");
        const program = CatalogueProgramSchema.parse(catalogue.program);
        const cycle = program.cycles.find(candidate => candidate.id === cycleId);
        if (!cycle) throw new AcceleratorError("Cycle not found", 404, "cycle_not_found");
        if (!canStartForm(cycle.form)) {
            throw new AcceleratorError(
                "This Form is not checked, supported, and available",
                409,
                "form_unavailable"
            );
        }
        const id = randomUUID();
        const inserted = await tx
            .insert(proposalApplications)
            .values({
                id,
                companyId,
                kind: "accelerator",
                programId,
                cycleId,
                formHash: hashValue(cycle.form),
                title: `${program.name} — ${cycle.label}`.slice(0, 512),
                funder: program.name,
                requestUrl: cycle.form.sourceUrl,
                ownerUserId: userId,
                createdByUserId: userId,
            })
            .onConflictDoNothing()
            .returning({ id: proposalApplications.id });
        if (inserted.length > 0) {
            await tx.insert(proposalSections).values(
                [...cycle.form.fields]
                    .sort((a, b) => a.position - b.position)
                    .map(field => ({
                        id: randomUUID(),
                        companyId,
                        applicationId: id,
                        position: field.position,
                        key: field.key,
                        question: field.question,
                        guidance: field.guidance,
                        wordLimit: field.wordLimit,
                        required: field.required,
                        formField: field,
                        revision: 0,
                    }))
            );
        }
        const [shared] = await tx
            .select({ id: proposalApplications.id })
            .from(proposalApplications)
            .where(
                and(
                    eq(proposalApplications.companyId, companyId),
                    eq(proposalApplications.kind, "accelerator"),
                    eq(proposalApplications.programId, programId),
                    eq(proposalApplications.cycleId, cycleId)
                )
            )
            .limit(1);
        const application = shared ? await readApplication(tx, companyId, shared.id) : null;
        if (!application)
            throw new AcceleratorError(
                "Application changed during creation; try again",
                409,
                "application_conflict"
            );
        return application;
    });
}

async function readAnswer(
    db: ProposalDebitExecutor,
    companyId: bigint,
    applicationId: string,
    sectionId: string
): Promise<ProposalSectionRow> {
    const [row] = await db
        .select({ section: proposalSections })
        .from(proposalSections)
        .innerJoin(
            proposalApplications,
            and(
                eq(proposalApplications.id, proposalSections.applicationId),
                eq(proposalApplications.companyId, companyId),
                eq(proposalApplications.kind, "accelerator")
            )
        )
        .where(
            and(
                eq(proposalSections.id, sectionId),
                eq(proposalSections.companyId, companyId),
                eq(proposalSections.applicationId, applicationId)
            )
        )
        .limit(1);
    if (!row) throw new AcceleratorError("Application Field not found", 404, "section_not_found");
    return row.section;
}

/** Every answer writer reaches this one atomic revision check. No full-answer bypass exists. */
async function writeAnswer(
    db: ProposalDebitExecutor,
    companyId: bigint,
    applicationId: string,
    sectionId: string,
    patch: AnswerPatch,
    generation?: { meta: DraftMeta }
): Promise<AcceleratorSection> {
    const current = await readAnswer(db, companyId, applicationId, sectionId);
    if (current.revision !== patch.expectedRevision) {
        throw new AcceleratorError(
            "This answer has changed; reload the latest revision",
            409,
            "revision_conflict"
        );
    }
    const field = sectionView(current).field;
    if (generation && current.draft !== null && current.draft !== "") {
        throw new AcceleratorError(
            "AI drafting only fills an unchanged empty Field",
            409,
            "answer_not_empty"
        );
    }
    if (generation && field.fieldType !== "long_text" && field.fieldType !== "short_text") {
        throw new AcceleratorError(
            "AI drafting is available only for prose Fields",
            400,
            "unsupported_draft_type"
        );
    }
    assertAnswer(field, patch.draft);
    const changed = current.draft !== patch.draft;
    const [saved] = await db
        .update(proposalSections)
        .set({
            draft: patch.draft,
            revision: sql`${proposalSections.revision} + 1`,
            status: generation
                ? "drafted"
                : changed
                  ? patch.draft
                      ? "edited"
                      : "empty"
                  : current.status,
            draftMeta: generation ? generation.meta : changed ? null : current.draftMeta,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(proposalSections.id, sectionId),
                eq(proposalSections.companyId, companyId),
                eq(proposalSections.applicationId, applicationId),
                eq(proposalSections.revision, patch.expectedRevision),
                generation
                    ? sql`(${proposalSections.draft} is null or ${proposalSections.draft} = '')`
                    : undefined,
                sql`exists (select 1 from ${proposalApplications} where ${proposalApplications.id} = ${proposalSections.applicationId}
            and ${proposalApplications.companyId} = ${companyId} and ${proposalApplications.kind} = 'accelerator')`
            )
        )
        .returning();
    if (!saved)
        throw new AcceleratorError(
            "This answer has changed; reload the latest revision",
            409,
            "revision_conflict"
        );
    return sectionView(saved);
}

export async function saveAcceleratorAnswer(
    companyId: bigint,
    applicationId: string,
    sectionId: string,
    patch: AnswerPatch,
    executor?: ProposalDebitExecutor
): Promise<AcceleratorSection> {
    const parsed = AnswerPatchSchema.safeParse(patch);
    if (!parsed.success)
        throw new AcceleratorError(parsed.error.message, 400, "invalid_answer_patch");
    return writeAnswer(executor ?? getDb(), companyId, applicationId, sectionId, parsed.data);
}

export async function saveAcceleratorDraft(
    companyId: bigint,
    applicationId: string,
    sectionId: string,
    expectedRevision: number,
    draft: string,
    draftMeta: DraftMeta,
    executor: ProposalDebitExecutor
): Promise<void> {
    const parsed = AnswerPatchSchema.safeParse({ expectedRevision, draft });
    const meta = DraftMetaSchema.safeParse(draftMeta);
    if (!parsed.success || !meta.success || !draft.trim()) {
        throw new AcceleratorError(
            "AI draft or expected revision is invalid",
            400,
            "invalid_draft"
        );
    }
    await writeAnswer(executor, companyId, applicationId, sectionId, parsed.data, {
        meta: meta.data,
    });
}

export async function applyAcceleratorEdit(
    companyId: bigint,
    applicationId: string,
    sectionId: string,
    edit: ApplyEdit
): Promise<AcceleratorSection> {
    const parsed = ApplyEditSchema.safeParse(edit);
    if (!parsed.success)
        throw new AcceleratorError(parsed.error.message, 400, "invalid_edit_range");
    const current = await readAnswer(getDb(), companyId, applicationId, sectionId);
    if (current.revision !== parsed.data.expectedRevision) {
        throw new AcceleratorError(
            "This answer has changed; reload the latest revision",
            409,
            "revision_conflict"
        );
    }
    const original = current.draft ?? "";
    if (parsed.data.end > original.length)
        throw new AcceleratorError(
            "Selection is outside the original answer",
            400,
            "invalid_edit_range"
        );
    const draft =
        original.slice(0, parsed.data.start) +
        parsed.data.replacement +
        original.slice(parsed.data.end);
    return saveAcceleratorAnswer(companyId, applicationId, sectionId, {
        expectedRevision: parsed.data.expectedRevision,
        draft,
    });
}

import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@launchstack/store/client";

import type { ProposalDebitExecutor } from "../ports";
import { hashValue } from "./hash";
import { acceleratorCompanyMatches, acceleratorPrograms } from "./schema";
import {
    AcceleratorError,
    CatalogueProgramSchema,
    FitAssessmentSchema,
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
                rubricVersion: row.rubricVersion,
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

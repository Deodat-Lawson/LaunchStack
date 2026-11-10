import { and, asc, cosineDistance, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@launchstack/store/client";

import type { ProposalDebitExecutor } from "../ports";
import { FitAssessmentV1Schema, type FitAssessmentV1 } from "./fit";
import { hashValue } from "./hash";
import { ProgramIntelligenceSchema, type ProgramIntelligence } from "./intelligence";
import {
    acceleratorApplicationResponses,
    acceleratorCompanyMatches,
    acceleratorPortfolioCompanies,
    acceleratorProgramIntelligence,
    acceleratorPrograms,
} from "./schema";
import type { ApplicationResponse, PastCompany } from "./similar-companies";
import {
    AcceleratorError,
    CatalogueProgramSchema,
    type CatalogueProgram,
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

/** Public program facts only. This does not read or write company fit or tracking. */
export async function listProgramIntelligence(): Promise<
    { dossier: ProgramIntelligence; contentHash: string }[]
> {
    return getDb()
        .select({
            dossier: acceleratorProgramIntelligence.dossier,
            contentHash: acceleratorProgramIntelligence.contentHash,
        })
        .from(acceleratorProgramIntelligence)
        .orderBy(asc(acceleratorProgramIntelligence.programId));
}

export async function importProgramIntelligence(
    records: ProgramIntelligence[]
): Promise<{ inserted: number; updated: number; unchanged: number }> {
    const parsed = z.array(ProgramIntelligenceSchema).parse(records);
    if (new Set(parsed.map(dossier => dossier.programId)).size !== parsed.length) {
        throw new AcceleratorError(
            "A program-intelligence import cannot repeat a Program ID",
            400,
            "duplicate_program"
        );
    }
    const values = parsed
        .map(dossier => ({
            programId: dossier.programId,
            dossier,
            contentHash: hashValue(dossier),
        }))
        .sort((a, b) => a.programId.localeCompare(b.programId));
    return getDb().transaction(async tx => {
        const counts = { inserted: 0, updated: 0, unchanged: 0 };
        for (const value of values) {
            const inserted = await tx
                .insert(acceleratorProgramIntelligence)
                .values(value)
                .onConflictDoNothing()
                .returning({ id: acceleratorProgramIntelligence.programId });
            if (inserted.length > 0) {
                counts.inserted++;
                continue;
            }
            const [existing] = await tx
                .select()
                .from(acceleratorProgramIntelligence)
                .where(eq(acceleratorProgramIntelligence.programId, value.programId))
                .for("update");
            if (!existing) {
                throw new AcceleratorError(
                    "Program intelligence changed during import; retry the batch",
                    409,
                    "catalogue_conflict"
                );
            }
            if (existing.contentHash === value.contentHash) {
                counts.unchanged++;
                continue;
            }
            await tx
                .update(acceleratorProgramIntelligence)
                .set({
                    dossier: value.dossier,
                    contentHash: value.contentHash,
                    updatedAt: new Date(),
                })
                .where(eq(acceleratorProgramIntelligence.programId, value.programId));
            counts.updated++;
        }
        return counts;
    });
}

/** Older rows (pre-fit-v1 single score) read as null rather than failing the page. */
function readAssessment(value: unknown): FitAssessmentV1 | null {
    const parsed = FitAssessmentV1Schema.safeParse(value);
    return parsed.success ? parsed.data : null;
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
                assessment: readAssessment(row.assessment),
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
    results: { programId: string; programHash: string; assessment: FitAssessmentV1 }[],
    executor?: ProposalDebitExecutor
): Promise<void> {
    const parsed = z
        .array(
            z
                .object({
                    programId: z.string().min(1).max(64),
                    programHash: z.string().regex(/^[a-f0-9]{64}$/),
                    assessment: FitAssessmentV1Schema,
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
                .values({
                    companyId,
                    profileHash,
                    checkedAt,
                    rubricVersion: result.assessment.rubricVersion,
                    ...result,
                })
                .onConflictDoUpdate({
                    target: [
                        acceleratorCompanyMatches.companyId,
                        acceleratorCompanyMatches.programId,
                    ],
                    set: {
                        assessment: result.assessment,
                        profileHash,
                        programHash: result.programHash,
                        rubricVersion: result.assessment.rubricVersion,
                        checkedAt,
                    },
                });
        }
    };
    if (executor) await save(executor);
    else await getDb().transaction(save);
}

export interface ImportCounts {
    inserted: number;
    updated: number;
    unchanged: number;
}

const INSERT_CHUNK = 500;

/**
 * Upsert one Supported accelerator's past companies in a single transaction.
 * Companies absent from this collection are kept, like catalogue Programs.
 * Operator command only; no company API calls this.
 */
export async function importPortfolioCompanies(
    programId: string,
    companies: PastCompany[]
): Promise<ImportCounts> {
    if (new Set(companies.map(company => company.id)).size !== companies.length) {
        throw new AcceleratorError(
            "A collection cannot repeat a company",
            400,
            "duplicate_company"
        );
    }
    if (companies.some(company => company.programId !== programId)) {
        throw new AcceleratorError(
            "Every company must belong to the imported Program",
            400,
            "wrong_program"
        );
    }
    return getDb().transaction(async tx => {
        const existing = new Map(
            (
                await tx
                    .select({
                        id: acceleratorPortfolioCompanies.id,
                        contentHash: acceleratorPortfolioCompanies.contentHash,
                    })
                    .from(acceleratorPortfolioCompanies)
                    .where(eq(acceleratorPortfolioCompanies.programId, programId))
                    .for("update")
            ).map(row => [row.id, row.contentHash])
        );
        const counts: ImportCounts = { inserted: 0, updated: 0, unchanged: 0 };
        const fresh = [];
        for (const company of companies) {
            const contentHash = hashValue(company);
            const known = existing.get(company.id);
            if (known === undefined) {
                fresh.push({
                    id: company.id,
                    programId,
                    company,
                    batchStartsOn: company.batchStartsOn,
                    contentHash,
                });
            } else if (known === contentHash) {
                counts.unchanged++;
            } else {
                await tx
                    .update(acceleratorPortfolioCompanies)
                    .set({ company, batchStartsOn: company.batchStartsOn, contentHash })
                    .where(eq(acceleratorPortfolioCompanies.id, company.id));
                counts.updated++;
            }
        }
        for (let start = 0; start < fresh.length; start += INSERT_CHUNK) {
            await tx
                .insert(acceleratorPortfolioCompanies)
                .values(fresh.slice(start, start + INSERT_CHUNK));
        }
        counts.inserted = fresh.length;
        return counts;
    });
}

/** Companies whose stored embedding is missing or was made from different text or model. */
export async function listPortfolioEmbeddingWork(
    programId: string,
    embeddingHashOf: (company: PastCompany) => string
): Promise<{ id: string; company: PastCompany; embeddingHash: string }[]> {
    const rows = await getDb()
        .select({
            id: acceleratorPortfolioCompanies.id,
            company: acceleratorPortfolioCompanies.company,
            embeddingHash: acceleratorPortfolioCompanies.embeddingHash,
        })
        .from(acceleratorPortfolioCompanies)
        .where(eq(acceleratorPortfolioCompanies.programId, programId))
        .orderBy(asc(acceleratorPortfolioCompanies.id));
    return rows
        .map(row => ({ ...row, wanted: embeddingHashOf(row.company) }))
        .filter(row => row.embeddingHash !== row.wanted)
        .map(row => ({ id: row.id, company: row.company, embeddingHash: row.wanted }));
}

export async function savePortfolioEmbeddings(
    rows: { id: string; embedding: number[]; embeddingHash: string }[]
): Promise<void> {
    await getDb().transaction(async tx => {
        for (const row of rows) {
            await tx
                .update(acceleratorPortfolioCompanies)
                .set({ embedding: row.embedding, embeddingHash: row.embeddingHash })
                .where(eq(acceleratorPortfolioCompanies.id, row.id));
        }
    });
}

/** Upsert published applications; a company link that does not resolve is stored as null. */
export async function importApplicationResponses(
    responses: ApplicationResponse[]
): Promise<ImportCounts> {
    if (new Set(responses.map(response => response.id)).size !== responses.length) {
        throw new AcceleratorError(
            "A collection cannot repeat an application",
            400,
            "duplicate_application"
        );
    }
    return getDb().transaction(async tx => {
        const linked = responses.map(response => response.companyId).filter(id => id !== null);
        const known = new Set(
            linked.length === 0
                ? []
                : (
                      await tx
                          .select({ id: acceleratorPortfolioCompanies.id })
                          .from(acceleratorPortfolioCompanies)
                          .where(inArray(acceleratorPortfolioCompanies.id, linked))
                  ).map(row => row.id)
        );
        const counts: ImportCounts = { inserted: 0, updated: 0, unchanged: 0 };
        for (const candidate of responses) {
            const response =
                candidate.companyId && !known.has(candidate.companyId)
                    ? { ...candidate, companyId: null }
                    : candidate;
            const contentHash = hashValue(response);
            const [existing] = await tx
                .select({ contentHash: acceleratorApplicationResponses.contentHash })
                .from(acceleratorApplicationResponses)
                .where(eq(acceleratorApplicationResponses.id, response.id))
                .for("update");
            if (existing?.contentHash === contentHash) {
                counts.unchanged++;
                continue;
            }
            await tx
                .insert(acceleratorApplicationResponses)
                .values({
                    id: response.id,
                    programId: response.programId,
                    companyId: response.companyId,
                    response,
                    contentHash,
                })
                .onConflictDoUpdate({
                    target: acceleratorApplicationResponses.id,
                    set: { companyId: response.companyId, response, contentHash },
                });
            if (existing) counts.updated++;
            else counts.inserted++;
        }
        return counts;
    });
}

export async function countPortfolio(
    programId: string
): Promise<{ companies: number; embedded: number; applications: number }> {
    const [companies] = await getDb()
        .select({
            total: sql<number>`count(*)::int`,
            embedded: sql<number>`count(${acceleratorPortfolioCompanies.embedding})::int`,
        })
        .from(acceleratorPortfolioCompanies)
        .where(eq(acceleratorPortfolioCompanies.programId, programId));
    const [applications] = await getDb()
        .select({ total: sql<number>`count(*)::int` })
        .from(acceleratorApplicationResponses)
        .where(
            and(
                eq(acceleratorApplicationResponses.programId, programId),
                sql`${acceleratorApplicationResponses.companyId} is not null`
            )
        );
    return {
        companies: companies?.total ?? 0,
        embedded: companies?.embedded ?? 0,
        applications: applications?.total ?? 0,
    };
}

/** A Program is Supported only once its past companies are collected and embedded. */
export async function isSupportedAccelerator(programId: string): Promise<boolean> {
    const [row] = await getDb()
        .select({ id: acceleratorPortfolioCompanies.id })
        .from(acceleratorPortfolioCompanies)
        .where(
            and(
                eq(acceleratorPortfolioCompanies.programId, programId),
                isNotNull(acceleratorPortfolioCompanies.embedding)
            )
        )
        .limit(1);
    return row !== undefined;
}

/** Nearest past companies by cosine similarity. */
export async function findSimilarPortfolioCompanies(
    programId: string,
    embedding: number[],
    options: { limit: number }
): Promise<{ company: PastCompany; similarity: number }[]> {
    const distance = cosineDistance(acceleratorPortfolioCompanies.embedding, embedding);
    return getDb()
        .select({
            company: acceleratorPortfolioCompanies.company,
            similarity: sql<number>`1 - (${distance})`,
        })
        .from(acceleratorPortfolioCompanies)
        .where(
            and(
                eq(acceleratorPortfolioCompanies.programId, programId),
                isNotNull(acceleratorPortfolioCompanies.embedding)
            )
        )
        .orderBy(distance)
        .limit(options.limit);
}

export async function listApplicationResponses(programId: string): Promise<ApplicationResponse[]> {
    const rows = await getDb()
        .select({ response: acceleratorApplicationResponses.response })
        .from(acceleratorApplicationResponses)
        .where(eq(acceleratorApplicationResponses.programId, programId))
        .orderBy(asc(acceleratorApplicationResponses.id));
    return rows.map(row => row.response);
}

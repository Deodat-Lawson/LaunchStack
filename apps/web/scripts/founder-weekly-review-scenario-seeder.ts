import { createHash } from "node:crypto";

import type { DbClient } from "@launchstack/core/db";
import {
    company,
    document,
    documentContextChunks,
    documentStructure,
    documentVersions,
} from "@launchstack/core/db/schema";
import { eq, sql } from "drizzle-orm";

import type { FounderWeeklyReviewScenario } from "../test-fixtures/founder-weekly-review/scenarios/contracts";

export interface SeededScenario {
    companyNamesToId: Map<string, bigint>;
    underReviewCompanyId: bigint;
    /** Document ids per company name — what the leakage assertion checks against. */
    documentIdsByCompanyName: Map<string, bigint[]>;
    /** Document titles per company name, for the same purpose. */
    documentTitlesByCompanyName: Map<string, string[]>;
}

export type ScenarioSeederOptions = { deterministicWorkspaceEmbeddings?: boolean };

const workspaceVector = () => Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0));
const contentHash = (content: string) => createHash("sha256").update(content, "utf8").digest("hex");

const structurePath = (section: string, index: number) =>
    `/${section.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section"}-${index + 1}`;

/**
 * Storage URLs derived from a hash, not from the title.
 *
 * `document.url` is varchar(256) while a title may be up to 256 characters on
 * its own, so a `local://${title}` URL overflows the column for titles the
 * scenario contract accepts. Hashing decouples the two: the URL is a fixed 39
 * characters whatever the title is, and stays stable for a given
 * (company, title, version) so a re-seed produces the same rows.
 */
function documentUrl(companyName: string, title: string): string {
    return `local://doc/${contentHash(`${companyName}\u0000${title}`).slice(0, 24)}`;
}

function versionUrl(companyName: string, title: string, versionNumber: number): string {
    return `${documentUrl(companyName, title)}/v${versionNumber}`;
}

/** Seeds business state only; the collector computes evidence from these rows. */
export async function seedScenario(
    db: DbClient,
    scenario: FounderWeeklyReviewScenario,
    options: ScenarioSeederOptions = {}
): Promise<SeededScenario> {
    const companyNamesToId = new Map<string, bigint>();
    const documentIdsByCompanyName = new Map<string, bigint[]>();
    const documentTitlesByCompanyName = new Map<string, string[]>();
    let underReviewCompanyId: bigint | undefined;

    for (const companyEntry of scenario.companies) {
        const [companyRow] = await db
            .insert(company)
            .values({ name: companyEntry.name, numberOfEmployees: "10" })
            .returning();
        const companyId = BigInt(companyRow!.id);
        companyNamesToId.set(companyEntry.name, companyId);
        if (companyEntry.underReview) underReviewCompanyId = companyId;

        const documentIds: bigint[] = [];
        const documentTitles: string[] = [];

        for (const doc of companyEntry.documents) {
            const [documentRow] = await db
                .insert(document)
                .values({
                    companyId,
                    url: documentUrl(companyEntry.name, doc.title),
                    category: doc.category,
                    title: doc.title,
                })
                .returning();
            const documentId = BigInt(documentRow!.id);
            documentIds.push(documentId);
            documentTitles.push(doc.title);

            let latestVersion: { id: bigint; versionNumber: number } | undefined;
            for (const version of doc.versions) {
                const [versionRow] = await db
                    .insert(documentVersions)
                    .values({
                        documentId,
                        versionNumber: version.versionNumber,
                        url: versionUrl(companyEntry.name, doc.title, version.versionNumber),
                        mimeType: "text/plain",
                        uploadedBy: version.uploadedBy ?? "scenario-seed",
                        changelog: version.changelog ?? null,
                        createdAt: new Date(version.timestamp),
                    })
                    .returning();
                const versionId = BigInt(versionRow!.id);
                if (!latestVersion || version.versionNumber > latestVersion.versionNumber) {
                    latestVersion = { id: versionId, versionNumber: version.versionNumber };
                }

                for (const [index, chunk] of version.chunks.entries()) {
                    const [structure] = await db
                        .insert(documentStructure)
                        .values({
                            documentId,
                            versionId,
                            ordering: index + 1,
                            title: chunk.section,
                            path: structurePath(chunk.section, index),
                            startPage: chunk.pageNumber ?? index + 1,
                            endPage: chunk.pageNumber ?? index + 1,
                        })
                        .returning();
                    const values = {
                        documentId,
                        versionId,
                        structureId: BigInt(structure!.id),
                        content: chunk.content,
                        contentHash: contentHash(chunk.content),
                        tokenCount: chunk.content.split(/\s+/).length,
                        charCount: chunk.content.length,
                        pageNumber: chunk.pageNumber ?? index + 1,
                        lineStart: chunk.lineStart ?? 1,
                        lineEnd: chunk.lineEnd ?? chunk.lineStart ?? 1,
                    };
                    await db.insert(documentContextChunks).values(
                        options.deterministicWorkspaceEmbeddings
                            ? {
                                  ...values,
                                  embedding: sql`${JSON.stringify(workspaceVector())}::vector(1536)`,
                              }
                            : values
                    );
                }
            }

            if (latestVersion) {
                await db
                    .update(document)
                    .set({ currentVersionId: latestVersion.id })
                    .where(eq(document.id, documentRow!.id));
            }
        }

        documentIdsByCompanyName.set(companyEntry.name, documentIds);
        documentTitlesByCompanyName.set(companyEntry.name, documentTitles);
    }

    if (!underReviewCompanyId) {
        throw new Error("scenario has no under-review company (expected exactly one).");
    }
    return {
        companyNamesToId,
        underReviewCompanyId,
        documentIdsByCompanyName,
        documentTitlesByCompanyName,
    };
}

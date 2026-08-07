import type { DbClient } from "@launchstack/core/db";
import {
    company,
    document,
    documentContextChunks,
    documentVersions,
} from "@launchstack/core/db/schema";
import { eq } from "drizzle-orm";

import type { FounderWeeklyReviewScenario } from "../test-fixtures/founder-weekly-review/scenarios/contracts";

export interface SeededScenario {
    companyNamesToId: Map<string, bigint>;
    underReviewCompanyId: bigint;
}

// Scenario chunks include a section label for fixture readability. The current
// chunk table has no section column, and this seeder does not generate embeddings.
export async function seedScenario(
    db: DbClient,
    scenario: FounderWeeklyReviewScenario
): Promise<SeededScenario> {
    const companyNamesToId = new Map<string, bigint>();
    let underReviewCompanyId: bigint | undefined;

    for (const companyEntry of scenario.companies) {
        const [companyRow] = await db
            .insert(company)
            .values({ name: companyEntry.name, numberOfEmployees: "10" })
            .returning();
        const companyId = BigInt(companyRow!.id);
        companyNamesToId.set(companyEntry.name, companyId);
        if (companyEntry.underReview) {
            underReviewCompanyId = companyId;
        }

        for (const doc of companyEntry.documents) {
            const [documentRow] = await db
                .insert(document)
                .values({
                    companyId,
                    url: `local://${doc.title}`,
                    category: doc.category,
                    title: doc.title,
                })
                .returning();
            const documentRowId = documentRow!.id;
            const documentId = BigInt(documentRowId);
            let latestVersion: { id: bigint; versionNumber: number } | undefined;

            for (const version of doc.versions) {
                const [versionRow] = await db
                    .insert(documentVersions)
                    .values({
                        documentId,
                        versionNumber: version.versionNumber,
                        url: `local://${doc.title}/v${version.versionNumber}`,
                        mimeType: "text/plain",
                        uploadedBy: version.uploadedBy ?? "seed",
                        changelog: version.changelog ?? null,
                        createdAt: new Date(version.timestamp),
                    })
                    .returning();
                const versionId = BigInt(versionRow!.id);
                if (latestVersion === undefined || version.versionNumber > latestVersion.versionNumber) {
                    latestVersion = { id: versionId, versionNumber: version.versionNumber };
                }

                for (const [index, chunk] of version.chunks.entries()) {
                    await db.insert(documentContextChunks).values({
                        documentId,
                        versionId,
                        content: chunk.content,
                        tokenCount: chunk.content.split(/\s+/).length,
                        charCount: chunk.content.length,
                        pageNumber: chunk.pageNumber ?? index + 1,
                    });
                }
            }

            if (latestVersion !== undefined) {
                await db
                    .update(document)
                    .set({ currentVersionId: latestVersion.id })
                    .where(eq(document.id, documentRowId));
            }
        }
    }

    if (underReviewCompanyId === undefined) {
        throw new Error("scenario has no under-review company (expected exactly one).");
    }

    return { companyNamesToId, underReviewCompanyId };
}

/**
 * Publish the public Program dossier, stable ids, coverage, and open conflicts.
 * Does not score company fit and does not write a database.
 *
 * pnpm --filter @launchstack/web accelerators:publish-intelligence
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
    coverageMarkdown,
    intelligenceManifest,
    loadPublishedCatalogue,
} from "@launchstack/pipelines/accelerators/catalogue";
import { hashValue } from "@launchstack/pipelines/accelerators";

const root = fileURLToPath(new URL("../../../fixtures/accelerators/", import.meta.url));

async function main(): Promise<void> {
    const { dossiers } = loadPublishedCatalogue(root);
    const published = intelligenceManifest(dossiers);
    const byId = new Map(dossiers.map(dossier => [dossier.programId, dossier]));
    const manifest = {
        ...published,
        programs: published.programs.map(program => ({
            ...program,
            contentHash: hashValue(byId.get(program.programId)),
        })),
    };
    const review = dossiers.flatMap(dossier => dossier.review);
    const intelligenceDir = fileURLToPath(
        new URL("../../../fixtures/accelerators/intelligence/", import.meta.url)
    );
    await mkdir(intelligenceDir, { recursive: true });
    await writeFile(
        fileURLToPath(
            new URL("../../../fixtures/accelerators/intelligence/manifest.json", import.meta.url)
        ),
        `${JSON.stringify(manifest, null, 2)}\n`
    );
    await writeFile(
        fileURLToPath(
            new URL("../../../fixtures/accelerators/intelligence/review.json", import.meta.url)
        ),
        `${JSON.stringify({ contract: "program-intelligence/v1", items: review }, null, 2)}\n`
    );
    await writeFile(
        fileURLToPath(new URL("../../../fixtures/accelerators/COVERAGE.md", import.meta.url)),
        coverageMarkdown(dossiers)
    );
    console.log(
        JSON.stringify(
            {
                programs: dossiers.length,
                openReviews: review.length,
                portfolioCompanies: dossiers.reduce(
                    (sum, dossier) => sum + dossier.portfolio.companies.length,
                    0
                ),
            },
            null,
            2
        )
    );
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});

/**
 * Terminal display script for company metadata.
 * Queries the database and pretty-prints the stored metadata JSON.
 *
 * Usage:
 *   npx tsx scripts/show-company-metadata.ts [companyId]
 *
 * Examples:
 *   npx tsx scripts/show-company-metadata.ts           # Show all companies
 *   npx tsx scripts/show-company-metadata.ts 1         # Show metadata for company ID 1
 *
 * Required env vars (reads from .env automatically via dotenv):
 *   DATABASE_URL
 */

import "dotenv/config";

// Skip the full env validation so we don't need Clerk/Inngest keys
process.env.SKIP_ENV_VALIDATION = "true";

import { db } from "~/server/db";
import { companyMetadata } from "~/server/db/schema/company-metadata";
import { company } from "~/server/db/schema/base";
import { eq } from "drizzle-orm";

async function main() {
    const companyIdArg = process.argv[2];

    if (companyIdArg) {
        // Show metadata for a specific company
        const companyId = BigInt(companyIdArg);

        const [result] = await db
            .select({
                id: companyMetadata.id,
                companyId: companyMetadata.companyId,
                companyName: company.name,
                schemaVersion: companyMetadata.schemaVersion,
                metadata: companyMetadata.metadata,
                createdAt: companyMetadata.createdAt,
                updatedAt: companyMetadata.updatedAt,
            })
            .from(companyMetadata)
            .leftJoin(company, eq(companyMetadata.companyId, company.id))
            .where(eq(companyMetadata.companyId, companyId));

        if (!result) {
            console.log(`No metadata found for company ID: ${companyIdArg}`);
            process.exit(0);
        }

        console.log("═══════════════════════════════════════════════════════════════");
        console.log(`  Company: ${result.companyName ?? "Unknown"} (ID: ${result.companyId})`);
        console.log(`  Schema Version: ${result.schemaVersion}`);
        console.log(`  Created: ${result.createdAt?.toISOString()}`);
        console.log(`  Updated: ${result.updatedAt?.toISOString() ?? "Never"}`);
        console.log("═══════════════════════════════════════════════════════════════");
        console.log("\n─── Metadata ───\n");
        console.log(JSON.stringify(result.metadata, null, 2));
    } else {
        // Show all companies with metadata
        const results = await db
            .select({
                id: companyMetadata.id,
                companyId: companyMetadata.companyId,
                companyName: company.name,
                schemaVersion: companyMetadata.schemaVersion,
                metadata: companyMetadata.metadata,
                createdAt: companyMetadata.createdAt,
                updatedAt: companyMetadata.updatedAt,
            })
            .from(companyMetadata)
            .leftJoin(company, eq(companyMetadata.companyId, company.id));

        if (results.length === 0) {
            console.log("No company metadata found in the database.");
            console.log("\nTo generate metadata:");
            console.log("  1. Start the dev server: pnpm dev");
            console.log("  2. Upload documents through the employer flow");
            console.log("  3. Call the extraction API: POST /api/company/metadata/extract");
            process.exit(0);
        }

        console.log(`Found ${results.length} company/companies with metadata:\n`);

        for (const result of results) {
            console.log("═══════════════════════════════════════════════════════════════");
            console.log(`  Company: ${result.companyName ?? "Unknown"} (ID: ${result.companyId})`);
            console.log(`  Schema Version: ${result.schemaVersion}`);
            console.log(`  Created: ${result.createdAt?.toISOString()}`);
            console.log(`  Updated: ${result.updatedAt?.toISOString() ?? "Never"}`);
            console.log("═══════════════════════════════════════════════════════════════");
            console.log("\n─── Metadata ───\n");
            console.log(JSON.stringify(result.metadata, null, 2));
            console.log("\n");
        }
    }
}

main()
    .catch((err) => {
        console.error("Failed to fetch company metadata:", err);
        process.exit(1);
    })
    .finally(() => {
        process.exit(0);
    });

/** Populate only a named, local development workspace with the synthetic Northwind profile. */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";
import dotenv from "dotenv";
import { z } from "zod";

import { configureDatabase, createDb } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";
import { createEmptyMetadata, type MetadataFact } from "@launchstack/pipelines/company-metadata";
import { companyMetadata } from "@launchstack/tools/company-context/schema";

dotenv.config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

async function main(): Promise<void> {
    const workspaceName = process.env.DEV_SEED_WORKSPACE?.trim();
    const databaseUrl = process.env.DATABASE_URL;
    if (!workspaceName || !databaseUrl)
        throw new Error("Set DEV_SEED_WORKSPACE and DATABASE_URL explicitly; run db:seed first.");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)) {
        throw new Error(
            "The synthetic accelerator demo can seed only a loopback development database."
        );
    }
    const database = createDb({ url: databaseUrl, maxConnections: 1 });
    configureDatabase(database.db);
    try {
        const [workspace] = await database.db
            .select({ id: company.id })
            .from(company)
            .where(eq(company.name, workspaceName))
            .limit(1);
        if (!workspace)
            throw new Error(
                "Named workspace not found. Run db:seed with the same DEV_SEED_WORKSPACE first."
            );
        const companyId = BigInt(workspace.id);
        const [existing] = await database.db
            .select({ id: companyMetadata.id })
            .from(companyMetadata)
            .where(eq(companyMetadata.companyId, companyId));
        if (existing) {
            console.log(
                JSON.stringify({
                    workspace: workspaceName,
                    companyId: companyId.toString(),
                    profile: "already present; not overwritten",
                })
            );
            return;
        }
        const fixture = z
            .object({
                name: z.string(),
                summary: z.string(),
                industry: z.string(),
                foundedYear: z.number(),
                headquarters: z.string(),
                size: z.string(),
                website: z.string(),
                products: z.array(z.object({ name: z.string(), description: z.string() })),
            })
            .parse(
                JSON.parse(
                    await readFile(
                        fileURLToPath(
                            new URL(
                                "../../../fixtures/companies/northwind-cold-chain/company.json",
                                import.meta.url
                            )
                        ),
                        "utf8"
                    )
                )
            );
        const now = new Date();
        const fact = <T>(value: T): MetadataFact<T> => ({
            value,
            visibility: "internal",
            usage: "no_outreach",
            confidence: 1,
            priority: "manual_override",
            status: "active",
            last_updated: now.toISOString(),
            sources: [],
        });
        const metadata = createEmptyMetadata(companyId.toString(), now);
        metadata.company = {
            name: fact(fixture.name),
            description: fact(fixture.summary),
            industry: fact(fixture.industry),
            founded_year: fact(fixture.foundedYear),
            headquarters: fact(fixture.headquarters),
            size: fact(fixture.size),
            website: fact(fixture.website),
        };
        metadata.services = fixture.products.map(product => ({
            name: fact(product.name),
            description: fact(product.description),
        }));
        metadata.profile = {
            summary: fact(
                `${fixture.summary} Synthetic local demonstration profile from the repository's Northwind fixture; not a real applicant or a source-verified extraction.`
            ),
            applicant_type: fact("for_profit" as const),
            focus_areas: [fact(fixture.industry)],
            facts: {
                headquarters: { ...fact(fixture.headquarters), label: "Headquarters" },
                company_size: { ...fact(fixture.size), label: "Company size" },
                founded_year: { ...fact(String(fixture.foundedYear)), label: "Founded year" },
                website: { ...fact(fixture.website), label: "Website" },
            },
        };
        metadata.provenance.extraction_model = "accelerators-demo-fixture";
        await database.db
            .insert(companyMetadata)
            .values({ companyId, metadata, schemaVersion: metadata.schema_version, builtAt: now })
            .onConflictDoNothing();
        console.log(
            JSON.stringify({
                workspace: workspaceName,
                companyId: companyId.toString(),
                profile: "synthetic Northwind fixture seeded; run real matching through the app",
            })
        );
    } finally {
        await database.close();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});

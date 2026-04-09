/**
 * Smoke-test for the client prospector pipeline.
 * Calls the real OpenAI + Foursquare APIs — no DB, no auth, no Inngest.
 *
 * Usage:
 *   npx tsx scripts/test-client-prospector.ts
 *
 * Required env vars (reads from .env automatically via dotenv):
 *   OPENAI_API_KEY
 *   FOURSQUARE_SERVICE_KEY
 */

import "dotenv/config";

process.env.SKIP_ENV_VALIDATION = "true";

import { runClientProspector } from "~/lib/tools/client-prospector/index";

async function main() {
    const input = {
        query: "restaurants and cafes that need digital marketing services",
        companyContext:
            "We are a digital marketing agency specializing in social media management and local SEO for small food & beverage businesses.",
        location: { lat: 39.330100443921275, lng: -76.62050697398278 }, // JHU
        radius: 5000,
    };

    console.log("─── Input ───");
    console.log(JSON.stringify(input, null, 2));
    console.log("\nRunning pipeline (resolve → plan → search → score)…\n");

    const output = await runClientProspector(input, {
        onStageChange: (stage) => console.log(`  ⏳ stage: ${stage}`),
    });

    console.log("─── Output ───");
    console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
    console.error("Pipeline failed:", err);
    process.exit(1);
});

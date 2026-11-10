/**
 * Trusted installation operator only. Collects Y Combinator's past accepted
 * companies and published applications into THIS database; nothing is written
 * to the repository.
 *
 * DATABASE_URL=... pnpm --filter @launchstack/web accelerators:collect-yc -- --installation <name> [--skip-embed]
 *
 * Companies come from yc-oss (a public mirror of YC's directory index), so no
 * request goes to ycombinator.com. Applications are fetched from the founders'
 * own pages or collection sites listed in yc-application-sources.ts.
 * Requires the y-combinator catalogue Program to be imported first.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import {
    buildQuestionBank,
    companyEmbeddingText,
    hasBatchStarted,
    hashValue,
    normalizeYcOssCompany,
    prepareApplicationText,
    segmentApplication,
    type ApplicationResponse,
    type PastCompany,
} from "@launchstack/pipelines/accelerators";
import {
    countPortfolio,
    getCatalogueProgram,
    importApplicationResponses,
    importPortfolioCompanies,
    listPortfolioEmbeddingWork,
    savePortfolioEmbeddings,
} from "@launchstack/pipelines/accelerators/db";
import { configureDatabase, createDb } from "@launchstack/store/client";
import { fetchReadable, type ReadablePage } from "@launchstack/tools/web-research";

import { similarCompanyEmbeddings } from "~/server/accelerators/embeddings";

import { YC_APPLICATION_SOURCES } from "./yc-application-sources";

dotenv.config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const PROGRAM_ID = "y-combinator";
const YC_OSS_ALL = "https://yc-oss.github.io/api/companies/all.json";
const PAGE_DELAY_MS = 1_500;
const EMBED_BATCH = 100;
/** Per-minute quotas (e.g. Azure S0) outlast the client's short retries; wait a window and resume. */
const RATE_LIMIT_WAIT_MS = 60_000;
const RATE_LIMIT_WAITS = 10;

function readArgs(): { installation: string; skipEmbed: boolean } {
    const args = process.argv.slice(2).filter(arg => arg !== "--");
    const at = args.indexOf("--installation");
    const installation = at >= 0 ? args[at + 1] : undefined;
    if (!installation) {
        throw new Error("Usage: accelerators:collect-yc -- --installation <name> [--skip-embed]");
    }
    return { installation, skipEmbed: args.includes("--skip-embed") };
}

async function collectCompanies(now: Date): Promise<PastCompany[]> {
    const response = await fetch(YC_OSS_ALL, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`yc-oss returned ${response.status}`);
    const records: unknown = await response.json();
    if (!Array.isArray(records)) throw new Error("yc-oss did not return a company list");
    return records
        .map(record => normalizeYcOssCompany(record, PROGRAM_ID))
        .filter((company): company is PastCompany => company !== null)
        .filter(company => hasBatchStarted(company.batch, now));
}

async function collectApplications(companyIds: Set<string>): Promise<{
    responses: ApplicationResponse[];
    failures: string[];
}> {
    const pages = new Map<string, ReadablePage>();
    const failures: string[] = [];
    for (const source of YC_APPLICATION_SOURCES) {
        if (!source.extract) continue;
        if (new URL(source.url).hostname.endsWith("ycombinator.com")) {
            throw new Error(`${source.url}: YC-hosted applications must stay links only`);
        }
        try {
            const page = await fetchReadable(source.url, {
                maxBytes: 4 * 1024 * 1024,
                timeoutMs: 30_000,
            });
            if (page.status >= 400) failures.push(`${source.companySlug}: HTTP ${page.status}`);
            else pages.set(source.url, page);
        } catch (error) {
            failures.push(
                `${source.companySlug}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
        await sleep(PAGE_DELAY_MS);
    }
    const knownPrompts = buildQuestionBank([...pages.values()].map(page => page.text));

    const responses: ApplicationResponse[] = [];
    for (const source of YC_APPLICATION_SOURCES) {
        const companyId = `${PROGRAM_ID}:${source.companySlug}`;
        if (!companyIds.has(companyId)) {
            failures.push(`${source.companySlug}: not in the collected YC companies`);
            continue;
        }
        let sections: ApplicationResponse["sections"] = null;
        if (source.extract) {
            const page = pages.get(source.url);
            if (!page) continue;
            const text = prepareApplicationText(page.text, source.extract);
            sections =
                text === null
                    ? []
                    : segmentApplication(text, [
                          ...knownPrompts,
                          ...(source.extract.extraPrompts ?? []),
                      ]);
            if (sections.length === 0) {
                failures.push(
                    `${source.companySlug}: the application text was not found on the page`
                );
                continue;
            }
        }
        responses.push({
            id: `${PROGRAM_ID}:${hashValue(source.url).slice(0, 16)}`,
            programId: PROGRAM_ID,
            companyId,
            appliedAs: source.appliedAs ?? null,
            statedBatch: source.statedBatch ?? null,
            provenance: source.provenance,
            sourceUrl: source.url,
            originalUrl: source.originalUrl ?? null,
            note: source.note,
            caveats: source.caveats ?? [],
            sections,
        });
    }
    return { responses, failures };
}

async function embedCompanies(): Promise<number> {
    const embeddings = similarCompanyEmbeddings();
    const work = await listPortfolioEmbeddingWork(PROGRAM_ID, embeddings.hashOf);
    for (let start = 0; start < work.length; start += EMBED_BATCH) {
        const batch = work.slice(start, start + EMBED_BATCH);
        let vectors: number[][] | undefined;
        for (let waits = 0; !vectors; waits++) {
            try {
                vectors = await embeddings.embed(
                    batch.map(row => companyEmbeddingText(row.company))
                );
            } catch (error) {
                if (!String(error).includes("429") || waits >= RATE_LIMIT_WAITS) throw error;
                console.warn(
                    `rate limited; waiting ${RATE_LIMIT_WAIT_MS / 1_000}s before retrying`
                );
                await sleep(RATE_LIMIT_WAIT_MS);
            }
        }
        await savePortfolioEmbeddings(
            batch.map((row, index) => {
                const embedding = vectors[index];
                if (!embedding) throw new Error(`No embedding returned for ${row.id}`);
                return { id: row.id, embedding, embeddingHash: row.embeddingHash };
            })
        );
        console.log(`embedded ${Math.min(start + EMBED_BATCH, work.length)}/${work.length}`);
    }
    return work.length;
}

async function main(): Promise<void> {
    const { installation, skipEmbed } = readArgs();
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL must name the intended installation database");
    const database = createDb({ url, maxConnections: 1 });
    try {
        configureDatabase(database.db);
        if (!(await getCatalogueProgram(PROGRAM_ID))) {
            throw new Error(
                `Import the ${PROGRAM_ID} catalogue Program before collecting its companies`
            );
        }
        const companies = await collectCompanies(new Date());
        const companyResult = await importPortfolioCompanies(PROGRAM_ID, companies);
        console.log(
            JSON.stringify({ installation, companies: companies.length, ...companyResult })
        );

        const { responses, failures } = await collectApplications(
            new Set(companies.map(company => company.id))
        );
        const applicationResult = await importApplicationResponses(responses);
        console.log(
            JSON.stringify({ installation, applications: responses.length, ...applicationResult })
        );
        for (const failure of failures) console.warn(`skipped application — ${failure}`);

        const embedded = skipEmbed ? 0 : await embedCompanies();
        console.log(
            JSON.stringify({ installation, embedded, stored: await countPortfolio(PROGRAM_ID) })
        );
    } finally {
        await database.close();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});

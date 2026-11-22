/** External-cache runner. Input contains only questions and fixture workspace IDs. */
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { sql as statement } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { z } from "zod";
import { configureSecretBox } from "@launchstack/store/crypto";
import { configuredTopicSelectionProviders } from "../src/server/vantage/weekly-review-topic-run";
import type {
    WeeklyReviewDatabase,
    WeeklyReviewQuery,
} from "../src/server/vantage/weekly-review-types";
import {
    assertBenchmarkDatabaseUrl,
    benchmarkFailureCode,
    BenchmarkQuestionSchema,
    type BenchmarkQuestion,
    runBenchmarkRetrieval,
    type BenchmarkArm,
} from "./vantage-benchmark-retrieval";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const fixtureDatabase = "vantage_rag_benchmark_20261121";
const revision = "39071af3f4dd25e59f5c59a6f9b6e8e99cd643b3";
const freeArms = ["baseline", "seeds", "scripted"] as const;
const armSchema = z.enum(["free", ...freeArms, "configured-live-dry-run", "configured-live"]);
const workspace = z.object({
    enterprise: z.string(),
    workspaceId: z.string().regex(/^[1-9]\d*$/),
});
const manifestSchema = z.object({
    databaseUrl: z.string(),
    revision: z.literal(revision),
    week: z.literal("2026-11-09"),
    asOf: z.literal("2026-11-16T00:00:00Z"),
    enterprises: z.array(workspace).length(5),
});
const localJson = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/);
function isWithin(root: string, candidate: string) {
    const offset = relative(root, candidate);
    return !isAbsolute(offset) && offset !== ".." && !offset.startsWith(".." + sep);
}
async function cacheFile(cache: string, leaf: string) {
    const name = localJson.parse(leaf);
    const path = await realpath(resolve(cache, name));
    if (!isWithin(cache, path)) throw new Error("benchmark_cache_file_outside_cache");
    return path;
}
async function validateExternalCache(value: string) {
    const cache = await realpath(value);
    if (isWithin(await realpath(repository), cache))
        throw new Error("benchmark_cache_must_be_external");
    for (let path = cache; path !== dirname(path); path = dirname(path)) {
        try {
            await access(resolve(path, ".git"));
            throw new Error("benchmark_cache_must_be_external");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
    return cache;
}
function verifyLockedCache(cache: string) {
    const check = spawnSync(
        process.execPath,
        [
            resolve(repository, "scripts/dev/vantage-rag-multi-corpus-loader.mjs"),
            "verify",
            cache,
            "--database",
        ],
        { encoding: "utf8", windowsHide: true }
    );
    if (check.error || check.status !== 0) throw new Error("benchmark_corpus_verification_failed");
}
async function run() {
    const { values } = parseArgs({
        options: {
            cache: { type: "string" },
            requests: { type: "string" },
            output: { type: "string" },
            arm: { type: "string", default: "free" },
            "end-to-end": { type: "string", default: "0" },
            "cold-digests": { type: "boolean" },
            "approve-live": { type: "boolean" },
        },
    });
    if (!values.cache || !values.requests || !values.output)
        throw new Error("benchmark_cache_requests_output_required");
    const arm = armSchema.parse(values.arm);
    const executeLive = arm === "configured-live";
    const endToEnd = z.coerce.number().int().min(0).max(2).parse(values["end-to-end"]);
    if (
        executeLive !== Boolean(values["approve-live"]) ||
        (executeLive && (!values["cold-digests"] || endToEnd !== 0))
    )
        throw new Error("configured_live_requires_explicit_approval_cold_cache_and_freeze_only");
    const cache = await validateExternalCache(values.cache);
    const output = resolve(cache, localJson.parse(values.output));
    try {
        await access(output);
        throw new Error("benchmark_output_already_exists");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    verifyLockedCache(cache);
    const manifest = manifestSchema.parse(
        JSON.parse(await readFile(await cacheFile(cache, "corpus-manifest.json"), "utf8"))
    );
    const requests = z
        .array(BenchmarkQuestionSchema)
        .min(1)
        .max(100)
        .parse(JSON.parse(await readFile(await cacheFile(cache, values.requests), "utf8")));
    if ((arm === "configured-live-dry-run" || executeLive) && requests.length !== 20)
        throw new Error("configured_live_uses_only_the_20_case_pilot");
    if (new Set(requests.map(item => item.caseId)).size !== requests.length)
        throw new Error("duplicate_benchmark_case");
    const allowed = new Map(manifest.enterprises.map(item => [item.enterprise, item.workspaceId]));
    if (
        allowed.size !== 5 ||
        new Set(allowed.values()).size !== 5 ||
        requests.some(request => allowed.get(request.enterprise) !== request.workspaceId)
    )
        throw new Error("benchmark_workspace_manifest_mismatch");
    assertBenchmarkDatabaseUrl(manifest.databaseUrl);
    const providers = executeLive ? await configuredTopicSelectionProviders() : undefined;
    configureSecretBox({ key: randomBytes(32).toString("base64") });
    const sql = postgres(manifest.databaseUrl, { max: 16 });
    const db = drizzle(sql);
    const database: WeeklyReviewDatabase = {
        transaction(work) {
            return db.transaction(tx => {
                const query: WeeklyReviewQuery = async (text, args = []) => {
                    const parts = text
                        .split(/(\$\d+)/g)
                        .map(part =>
                            /^\$\d+$/.test(part)
                                ? statement.param(args[Number(part.slice(1)) - 1])
                                : statement.raw(part)
                        );
                    return [
                        ...(await tx.execute(statement.join(parts, statement.raw("")))),
                    ] as Record<string, unknown>[];
                };
                return work(query);
            });
        },
    };
    const arms: readonly BenchmarkArm[] = arm === "free" ? freeArms : [arm];
    try {
        const [identity] = await sql`SELECT current_database() AS database_name`;
        if (identity?.database_name !== fixtureDatabase)
            throw new Error("benchmark_database_identity_changed");
        // Compare workspace IDs against actual fixture policies before making any writes.
        const policyRows =
            await sql`SELECT company_id::text FROM pdr_ai_v2_vantage_weekly_review_policy
            WHERE company_id=ANY(${[...allowed.values()]}::bigint[])`;
        if (policyRows.length !== allowed.size)
            throw new Error("benchmark_fixture_policies_missing");
        if (values["cold-digests"])
            await sql`DELETE FROM pdr_ai_v2_document_version_digests WHERE company_id=ANY(${[...allowed.values()]}::bigint[])`;
        const jobs: {
            index: number;
            request: BenchmarkQuestion;
            arm: BenchmarkArm;
            subject: string;
        }[] = [];
        for (const [index, request] of requests.entries()) {
            for (const currentArm of arms) {
                const subject = randomUUID();
                const email = `benchmark-${subject}@example.test`;
                await sql.begin(async tx => {
                    await tx`INSERT INTO pdr_ai_v2_auth_user(id,name,email,created_at,updated_at)
                        VALUES (${subject},'Benchmark owner',${email},now(),now())`;
                    const [owner] =
                        await tx`INSERT INTO pdr_ai_v2_users(name,email,"userId",company_id,role,status)
                        VALUES ('Benchmark owner',${email},${subject},${request.workspaceId},'employer','active') RETURNING id`;
                    if (!owner) throw new Error("benchmark_owner_insert_failed");
                    await tx`INSERT INTO pdr_ai_v2_user_company_memberships(user_id,company_id,role,status)
                        VALUES (${owner.id},${request.workspaceId},'owner','active')`;
                });
                jobs.push({ index, request, arm: currentArm, subject });
            }
        }
        const results: Awaited<ReturnType<typeof runBenchmarkRetrieval>>[] = [];
        // Serializable transactions can contend across workspaces on shared run tables.
        // Keep the capture schedule serial while retaining production transaction isolation.
        for (const job of jobs) {
            const id = job.request.workspaceId;
            const loadActor = async () => {
                const [row] = await sql`SELECT u."userId" AS subject, m.company_id::text, m.role
                        FROM pdr_ai_v2_users u JOIN pdr_ai_v2_user_company_memberships m ON m.user_id=u.id
                        WHERE u."userId"=${job.subject} AND m.company_id=${id} AND m.status='active' AND u.status='active'`;
                if (!row || row.role !== "owner") throw new Error("benchmark_owner_revoked");
                return {
                    companyId: String(row.company_id),
                    userId: String(row.subject),
                    role: "owner",
                    canRead: true,
                    canMutate: true,
                    canConfigure: true,
                    documentScope: { kind: "everything" as const },
                };
            };
            results.push(
                await runBenchmarkRetrieval({
                    database,
                    databaseUrl: manifest.databaseUrl,
                    loadActor,
                    request: job.request,
                    arm: job.arm,
                    week: manifest.week,
                    asOf: manifest.asOf,
                    endToEnd: job.index < endToEnd,
                    ...(providers ? { providers } : {}),
                })
            );
            if (results.length % 30 === 0)
                console.log("Captured " + results.length + " of " + jobs.length);
        }
        await writeFile(output, JSON.stringify(results) + "\n", { flag: "wx" });
        console.log("Captured " + results.length + " benchmark attempts.");
    } finally {
        await sql.end();
    }
}

run().catch(error => {
    console.error(benchmarkFailureCode(error));
    process.exitCode = 1;
});

// Offline-provider acceptance capture. The caller starts the matching arm's server.
import { createRequire } from "node:module";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { validateDatabaseUrl } from "./vantage-sample-documents.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(resolve(root, "apps/web/package.json"));
const { request } = require("@playwright/test");
const postgres = require("postgres");
const arm = process.argv[2];
if (!["baseline", "seeds", "scripted"].includes(arm))
    throw new Error("Pass baseline, seeds, or scripted");
const database = validateDatabaseUrl(
    process.env.DATABASE_URL ??
        "postgres://vantage_test:vantage_test_only@127.0.0.1:55569/vantage_production_acceptance"
);
const sql = postgres(database, { max: 1 });
const artifacts = resolve(root, "test-output/topic-acceptance");
await mkdir(artifacts, { recursive: true });
try {
    for (const [fixture, companyId] of [
        ["harborlight", "1"],
        ["long", "2"],
    ]) {
        const email = `${fixture}-${arm}-${process.env.VANTAGE_CAPTURE_REVISION ?? "v2"}@example.test`;
        const client = await request.newContext({
            baseURL: "http://127.0.0.1:3199",
            timeout: 240000,
        });
        try {
            let signup = await client.post("/api/auth/sign-up/email", {
                data: { name: "Comparison owner", email, password: "local-fixture-only-20261121" },
            });
            if (!signup.ok())
                signup = await client.post("/api/auth/sign-in/email", {
                    data: { email, password: "local-fixture-only-20261121" },
                });
            if (!signup.ok()) throw new Error(`Signup failed ${signup.status()}`);
            const auth = await sql`SELECT id FROM pdr_ai_v2_auth_user WHERE email=${email}`;
            await sql`INSERT INTO pdr_ai_v2_users(name,email,"userId",company_id,role,status) VALUES ('Comparison owner',${email},${auth[0].id},${companyId},'employer','active') ON CONFLICT DO NOTHING`;
            await sql`INSERT INTO pdr_ai_v2_user_company_memberships(user_id,company_id,role,status) SELECT id,${companyId},'owner','active' FROM pdr_ai_v2_users WHERE email=${email} ON CONFLICT DO NOTHING`;
            const topics = await client.get("/api/vantage/reviews/context/topics");
            const topicData = await topics.json();
            if (!topicData.topics?.length) {
                const release = topicData.documents.find(
                    document => document.title === "Atlas monitored pilot release plan"
                );
                const created = await client.post("/api/vantage/reviews/context/topics", {
                    data: {
                        title: "Atlas release readiness",
                        status: "active",
                        openQuestions: [
                            "What release scope is current at cutoff?",
                            "Who owns rollback?",
                        ],
                        decisionChangers: [],
                        keywords: [],
                        people: [],
                        metrics: [],
                        watches: [release.id],
                    },
                });
                if (!created.ok()) throw new Error(`Topic failed ${await created.text()}`);
            }
            const before = await (
                await client.get("/api/vantage/reviews?weekStart=2026-11-09")
            ).json();
            if (before.activeId)
                throw new Error("Arm owner already has an active report, use saved capture");
            const start = performance.now();
            const state = await client.storageState();
            const cookie = state.cookies
                .filter(item => item.domain === "127.0.0.1")
                .map(item => `${item.name}=${item.value}`)
                .join("; ");
            const generated = await fetch("http://127.0.0.1:3199/api/vantage/reviews", {
                method: "POST",
                headers: {
                    Cookie: cookie,
                    "Content-Type": "application/json",
                    "Idempotency-Key": randomUUID(),
                    Accept: "application/x-ndjson",
                },
                body: JSON.stringify({ weekStart: "2026-11-09", expectedActiveId: null }),
                signal: AbortSignal.timeout(240000),
            });
            const stageTimings = [];
            let raw = "",
                pending = "";
            for await (const chunk of generated.body) {
                const text = new TextDecoder().decode(chunk);
                raw += text;
                pending += text;
                const lines = pending.split("\n");
                pending = lines.pop();
                for (const line of lines) {
                    if (!line.trim()) continue;
                    const event = JSON.parse(line);
                    if (event.type === "stage")
                        stageTimings.push({
                            stage: event.stage,
                            elapsedMs: performance.now() - start,
                        });
                }
            }
            const elapsedMs = performance.now() - start;
            await writeFile(resolve(artifacts, `${fixture}-${arm}-stream.txt`), raw);
            const result = raw
                .trim()
                .split("\n")
                .map(line => JSON.parse(line))
                .find(item => item.type === "result")?.result;
            if (!result?.id) throw new Error(`Generation failed ${raw.slice(-500)}`);
            const report = await (await client.get(`/api/vantage/reviews/${result.id}`)).json();
            await writeFile(
                resolve(artifacts, `${fixture}-${arm}-report.json`),
                JSON.stringify(report, null, 2)
            );
            await writeFile(
                resolve(artifacts, `${fixture}-${arm}-snapshot.json`),
                JSON.stringify(report.evidence.inputSnapshot, null, 2)
            );
            await writeFile(
                resolve(artifacts, `${fixture}-${arm}-timing.json`),
                JSON.stringify({ elapsedMs, stages: stageTimings }, null, 2)
            );
            console.log(fixture, arm, result.id, elapsedMs.toFixed(1));
        } finally {
            await client.dispose();
        }
    }
} finally {
    await sql.end();
}

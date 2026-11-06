/** Real loopback HTTP + PostgreSQL acceptance. No provider or public variant endpoint. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import postgres from "postgres";
import type { DemoReport } from "../src/app/employer/tools/vantage/demo-contract";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const RUNTIME_DIR = resolve(ROOT, "test-output/vantage-finance-m1-20261105");
const APP_URL = "http://localhost:3186";
async function runtimeConfig() {
    const modulePath = pathToFileURL(resolve(ROOT, "scripts/dev/vantage-finance-runtime.mjs")).href;
    const launcher = (await import(modulePath)) as {
        readRuntime(): { databaseUrl: string; loginPassword: string };
        assertDatabaseUrl(url: string): URL;
    };
    const runtime = launcher.readRuntime();
    launcher.assertDatabaseUrl(process.env.DATABASE_URL ?? runtime.databaseUrl);
    assert.equal(
        process.env.DATABASE_URL,
        runtime.databaseUrl,
        "Use the sanitized child environment"
    );
    return runtime;
}

type Json = Record<string, any>;
function sourceFingerprints() {
    return Object.fromEntries(
        [
            "apps/web/src/server/vantage/contextual-host.ts",
            "apps/web/src/server/vantage/contextual-service.ts",
            "pipelines/src/vantage/experiments/finance-milestone-v1.ts",
            "pipelines/src/vantage/experiments/decision-generation-v2.ts",
        ].map(path => [
            path,
            createHash("sha256")
                .update(readFileSync(resolve(ROOT, path)))
                .digest("hex"),
        ])
    );
}
async function nativeSnapshot(sql: ReturnType<typeof postgres>) {
    const names = [
        "pdr_ai_v2_vantage_agendas",
        "pdr_ai_v2_vantage_agenda_topics",
        "pdr_ai_v2_vantage_contract_state",
        "pdr_ai_v2_vantage_commitments",
        "pdr_ai_v2_outbox",
        "pdr_ai_v2_event_outbox",
        "pdr_ai_v2_inngest_outbox",
    ];
    const tables =
        await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ${sql(names)}`;
    const values: Record<string, unknown> = {};
    for (const { table_name } of tables) {
        assert.ok(names.includes(table_name));
        const [row] = await sql.unsafe(
            `SELECT count(*)::int AS count,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM "${table_name}" t`
        );
        values[table_name] = row;
    }
    assert.ok(values.pdr_ai_v2_vantage_agendas && values.pdr_ai_v2_vantage_commitments);
    return values;
}

/** Verifies the encrypted report's persisted human-review audit, independently of UI version. */
export function assertSavedFinanceReviewAudit(
    value: unknown,
    expected: { actor: string; at: string; topicId: string; version: number }
) {
    const saved = value as Json;
    assert.ok(
        Array.isArray(saved.reviews) && saved.reviews.length > 0,
        "Saved human-review audit missing"
    );
    const lastReview = saved.reviews.at(-1) as Json;
    assert.equal(lastReview.actor, expected.actor, "Saved review actor mismatch");
    assert.equal(lastReview.at, expected.at, "Saved review timestamp mismatch");
    assert.equal(lastReview.topicId, expected.topicId, "Saved review topic mismatch");
    assert.equal(lastReview.version, expected.version, "Saved review version mismatch");
}
export async function runFinanceAcceptance() {
    const runtime = await runtimeConfig();
    assert.equal(
        process.env.DATABASE_URL,
        runtime.databaseUrl,
        "Launch with childEnvironment; never inherit general app env"
    );
    const fixture = JSON.parse(
        readFileSync(resolve(RUNTIME_DIR, "finance-fixture.json"), "utf8")
    ) as Json;
    const sql = postgres(runtime.databaseUrl, { max: 1 });
    const trace: Json[] = [];
    const cookies = new Map<string, string>();
    async function request(
        label: string,
        method: string,
        path: string,
        actor?: string,
        body?: unknown
    ) {
        const url = new URL(path, APP_URL);
        assert.equal(url.origin, APP_URL);
        const response = await fetch(url, {
            method,
            redirect: "manual",
            headers: {
                origin: APP_URL,
                ...(body === undefined ? {} : { "content-type": "application/json" }),
                ...(actor && cookies.has(actor) ? { cookie: cookies.get(actor)! } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const raw = await response.text();
        let data: Json;
        try {
            data = JSON.parse(raw);
        } catch {
            data = { nonJsonBody: raw.slice(0, 200) };
        }
        trace.push({
            label,
            method,
            path: url.pathname + url.search,
            status: response.status,
            body: url.pathname.startsWith("/api/auth/")
                ? {
                      user: data.user ? { id: data.user.id, email: data.user.email } : null,
                      error: data.error ?? data.message,
                  }
                : data,
        });
        return { status: response.status, data, response };
    }
    async function signIn(account: Json) {
        const result = await request(
            `sign-in:${account.workspace}:${account.userPk}`,
            "POST",
            "/api/auth/sign-in/email",
            undefined,
            { email: account.email, password: runtime.loginPassword }
        );
        assert.equal(
            result.status,
            200,
            `Real Better Auth sign-in failed: ${JSON.stringify(result.data)}`
        );
        assert.equal(result.data.user?.id, account.id);
        const values = result.response.headers.getSetCookie();
        assert.ok(values.length, "Better Auth did not establish a session cookie");
        cookies.set(account.id, values.map(value => value.split(";")[0]).join("; "));
        // Keep identity evidence, never the token returned by Better Auth.
        trace[trace.length - 1]!.body = {
            user: { id: result.data.user.id, email: result.data.user.email },
            cookieEstablished: true,
        };
    }
    const [owner, peer, outsider] = fixture.accounts as Json[];
    function boundary(result: { status: number; data: Json }, status: number, code: string) {
        assert.equal(result.status, status, `Expected ${code}: ${JSON.stringify(result.data)}`);
        assert.equal(result.data.code, code);
    }
    async function dbState() {
        const reports =
            await sql`SELECT id::text,company_id::text,owner_user_id::text,week_start::text,version,md5(ciphertext) AS ciphertext_hash FROM pdr_ai_v2_vantage_contextual_reports ORDER BY id`;
        const commitments =
            await sql`SELECT count(*)::integer AS count FROM pdr_ai_v2_vantage_commitments`;
        return {
            reports: [...reports],
            commitments: commitments[0]!.count,
            nativeState: await nativeSnapshot(sql),
        };
    }
    const before = await dbState();
    try {
        const unauth = await request("unauthenticated-denied", "GET", "/api/vantage/contextual");
        assert.equal(unauth.status, 401);
        await signIn(owner!);
        await signIn(peer!);
        await signIn(outsider!);
        const arch = await request(
            "architecture-read",
            "GET",
            "/api/vantage/contextual/architecture",
            owner!.id
        );
        assert.equal(arch.status, 200);
        if (arch.data.state === "unreviewed") {
            const review = await request(
                "architecture-human-review",
                "POST",
                "/api/vantage/contextual/architecture",
                owner!.id,
                {
                    expectedRevision: arch.data.revision,
                    expectedProjectionFingerprint: arch.data.projectionFingerprint,
                    state: "unknowns-marked",
                }
            );
            assert.equal(review.status, 200);
        }
        assert.equal(
            (
                await request(
                    "malformed-week-denied",
                    "GET",
                    "/api/vantage/contextual?weekStart=2026-02-30",
                    owner!.id
                )
            ).status,
            400
        );
        assert.equal(
            (
                await request(
                    "malformed-report-id-denied",
                    "GET",
                    "/api/vantage/contextual/reports/not-a-uuid",
                    owner!.id
                )
            ).status,
            400
        );
        let loaded = await request("existing-report", "GET", "/api/vantage/contextual", owner!.id);
        assert.equal(loaded.status, 200);
        if (!loaded.data.report)
            loaded = await request(
                "generate-corrected-replay",
                "POST",
                "/api/vantage/contextual",
                owner!.id,
                {}
            );
        assert.equal(loaded.status, 200);
        const report = loaded.data.report;
        assert.ok(report?.id && report.topics?.length);
        assert.match(JSON.stringify(report), /12,000/);
        assert.match(JSON.stringify(report), /18,000/);
        assert.match(JSON.stringify(report), /refunds not reconciled/);
        assert.match(JSON.stringify(report), /unsigned opportunities/);
        const reportPath = `/api/vantage/contextual/reports/${report.id}`;
        for (const key of ["finance", "sales"] as const) {
            const doc = fixture.docs[key];
            const source = await request(
                `open-${key}`,
                "GET",
                `${reportPath}/source?${new URLSearchParams({ kind: "doc", id: doc.id, version: doc.versionId })}`,
                owner!.id
            );
            assert.equal(source.status, 200);
            assert.ok(JSON.stringify(source.data).includes(doc.text));
        }
        boundary(
            await request("same-company-private-report-denied", "GET", reportPath, peer!.id),
            404,
            "not_found"
        );
        const outsideDenied = await request(
            "cross-company-report-denied",
            "GET",
            reportPath,
            outsider!.id
        );
        assert.equal(outsideDenied.status, 403);
        assert.equal(outsideDenied.data.error, "Vantage access denied.");
        for (const key of ["peer", "outside"] as const) {
            const doc = fixture.docs[key];
            boundary(
                await request(
                    `unregistered-${key}-source-denied`,
                    "GET",
                    `${reportPath}/source?${new URLSearchParams({ kind: "doc", id: doc.id, version: doc.versionId })}`,
                    owner!.id
                ),
                404,
                "not_found"
            );
        }
        const baseVersion = report.version;
        const body = {
            topicId: report.topics[0].id,
            expectedVersion: baseVersion,
            decision: {
                value: "needs-more-evidence",
                text: "Reconcile the two definitions before deciding.",
            },
        };
        const concurrent = await Promise.all([
            request("concurrent-review-a", "PATCH", reportPath, owner!.id, body),
            request("concurrent-review-b", "PATCH", reportPath, owner!.id, body),
        ]);
        assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
        const reloaded = await request("review-reload", "GET", reportPath, owner!.id);
        assert.equal(reloaded.status, 200);
        assert.equal(reloaded.data.report.version, baseVersion + 1);
        const currentVersion = reloaded.data.report.version;
        const decision = reloaded.data.report.topics.find(
            (topic: Json) => topic.id === body.topicId
        ).decision;
        assert.equal(decision.value, body.decision.value);
        assert.equal(decision.text, body.decision.text);
        assert.equal(decision.recordedAt, fixture.domainClock);

        boundary(
            await request("stale-review-denied", "PATCH", reportPath, owner!.id, body),
            409,
            "stale_review"
        );
        const stable = await dbState();
        // Reversible DB fault injection: actual membership/grant/version readers remain authoritative.
        const [grant] =
            await sql`SELECT * FROM pdr_ai_v2_document_grants WHERE document_id=${fixture.docs.finance.id} AND principal_type='user' AND principal_id=${owner!.userPk}`;
        assert.ok(grant, "Expected the isolated owner Finance grant");
        await sql`DELETE FROM pdr_ai_v2_document_grants WHERE document_id=${fixture.docs.finance.id} AND principal_type='user' AND principal_id=${owner!.userPk}`;
        try {
            boundary(
                await request("revoked-source-denied", "GET", reportPath, owner!.id),
                403,
                "source_unavailable"
            );
            boundary(
                await request(
                    "revoked-generation-denied",
                    "POST",
                    "/api/vantage/contextual",
                    owner!.id,
                    {}
                ),
                403,
                "source_unavailable"
            );
        } finally {
            await sql`INSERT INTO pdr_ai_v2_document_grants ${sql(grant)}`;
        }
        const [inventory] =
            await sql`SELECT * FROM pdr_ai_v2_vantage_contextual_inventory WHERE company_id=${fixture.companyId} AND logical_key='finance'`;
        await sql`DELETE FROM pdr_ai_v2_vantage_contextual_inventory WHERE company_id=${fixture.companyId} AND logical_key='finance'`;
        try {
            boundary(
                await request(
                    "missing-required-logical-source-denied",
                    "POST",
                    "/api/vantage/contextual",
                    owner!.id,
                    {}
                ),
                409,
                "native_evidence_bridge_missing"
            );
        } finally {
            await sql`INSERT INTO pdr_ai_v2_vantage_contextual_inventory ${sql(inventory!)}`;
        }
        const [newVersion] =
            await sql`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,ocr_processed,ocr_metadata,created_at,creation_key) VALUES (${fixture.docs.sales.id},2,'local://finance-m1/sales/acceptance-v2','text/plain',true,${sql.json({ text: fixture.docs.sales.text })},'2026-10-17T12:00:00Z',${"acceptance-" + Date.now()}) RETURNING id`;
        await sql`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,char_count,token_count,content_hash,created_at,updated_at) VALUES (${fixture.docs.sales.id},${newVersion!.id},${fixture.docs.sales.text},${fixture.docs.sales.text.length},20,${fixture.docs.sales.hash},'2026-10-17T12:00:00Z','2026-10-17T12:00:00Z')`;
        try {
            boundary(
                await request("stale-exact-source-version-denied", "GET", reportPath, owner!.id),
                409,
                "native_evidence_bridge_invalid"
            );
        } finally {
            await sql`DELETE FROM pdr_ai_v2_document_context_chunks WHERE version_id=${newVersion!.id}`;
            await sql`DELETE FROM pdr_ai_v2_document_versions WHERE id=${newVersion!.id}`;
        }
        const [originalHead] =
            await sql`SELECT current_version_id FROM pdr_ai_v2_document WHERE id=${fixture.docs.sales.id}`;
        const [futureVersion] =
            await sql`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,ocr_processed,ocr_metadata,created_at,creation_key) VALUES (${fixture.docs.sales.id},3,'local://finance-m1/sales/acceptance-after-cutoff','text/plain',true,${sql.json({ text: fixture.docs.sales.text })},'2026-10-20T12:00:00Z',${"acceptance-head-" + Date.now()}) RETURNING id`;
        await sql`UPDATE pdr_ai_v2_document SET current_version_id=${futureVersion!.id} WHERE id=${fixture.docs.sales.id}`;
        try {
            boundary(
                await request(
                    "after-cutoff-current-head-change-denied",
                    "GET",
                    reportPath,
                    owner!.id
                ),
                409,
                "stale_saved_context"
            );
        } finally {
            await sql`UPDATE pdr_ai_v2_document SET current_version_id=${originalHead!.current_version_id} WHERE id=${fixture.docs.sales.id}`;
            await sql`DELETE FROM pdr_ai_v2_document_versions WHERE id=${futureVersion!.id}`;
        }
        const [sourceChunk] =
            await sql`SELECT id,content FROM pdr_ai_v2_document_context_chunks WHERE document_id=${fixture.docs.sales.id} AND version_id=${fixture.docs.sales.versionId} ORDER BY id LIMIT 1`;
        assert.ok(sourceChunk);
        await sql`UPDATE pdr_ai_v2_document_context_chunks SET content=content||' Changed content.' WHERE id=${sourceChunk.id}`;
        try {
            boundary(
                await request("same-version-content-change-denied", "GET", reportPath, owner!.id),
                409,
                "native_evidence_bridge_invalid"
            );
        } finally {
            await sql`UPDATE pdr_ai_v2_document_context_chunks SET content=${sourceChunk.content} WHERE id=${sourceChunk.id}`;
        }
        const afterFaults = await dbState();
        assert.deepEqual(
            afterFaults,
            stable,
            "Faults must preserve saved ciphertext and commitments"
        );
        const final = await request("restored-report-reload", "GET", reportPath, owner!.id);
        assert.equal(final.status, 200);
        assert.equal(final.data.report.version, currentVersion);
        const after = await dbState();
        assert.equal(after.commitments, before.commitments);
        assert.deepEqual(after.nativeState, before.nativeState);
        const { configureSecretBox, decryptSecret } = await import("@launchstack/store/crypto");
        configureSecretBox({ key: process.env.EMBEDDING_SECRETS_KEY });
        const [encrypted] =
            await sql`SELECT ciphertext FROM pdr_ai_v2_vantage_contextual_reports WHERE id=${report.id}::uuid AND company_id=${fixture.companyId} AND owner_user_id=${owner!.userPk}`;
        assert.ok(encrypted);
        const saved = JSON.parse(decryptSecret(encrypted.ciphertext)) as Json;
        assert.equal(saved.owner, owner!.id);
        assertSavedFinanceReviewAudit(saved, {
            actor: owner!.id,
            at: fixture.domainClock,
            topicId: body.topicId,
            version: currentVersion,
        });
        assert.deepEqual(saved.report, final.data.report);
        assert.ok(saved.envelope?.evidenceSnapshot?.entries.length >= 2);
        const evidence = {
            kind: "real-authenticated-http-postgresql",
            implementation: sourceFingerprints(),
            savedReport: saved,
            at: new Date().toISOString(),
            domainClock: fixture.domainClock,
            passed: true,
            before,
            after,
            trace,
            limitations: [
                "Semantic result is deterministic authored replay, not a model Judge.",
                "Direct generation/commit race and invalid carrier controls are in the DB integration suite.",
            ],
        };
        const output = resolve(RUNTIME_DIR, `acceptance-http-${Date.now()}.json`);
        writeFileSync(output, JSON.stringify(evidence, null, 2));
        return { output, checks: trace.length, before, after };
    } catch (error) {
        const output = resolve(RUNTIME_DIR, `acceptance-http-failed-${Date.now()}.json`);
        writeFileSync(
            output,
            JSON.stringify(
                {
                    passed: false,
                    at: new Date().toISOString(),
                    error: {
                        message: error instanceof Error ? error.message : String(error),
                        code: (error as Json).code,
                    },
                    trace,
                    before,
                    after: await dbState(),
                },
                null,
                2
            )
        );
        throw error;
    } finally {
        await sql.end({ timeout: 5 });
    }
}
/** Direct DB tests use a declared synthetic test identity wrapper. Membership, permissions,
 * source reads, ACLs, current-state guards and persistence all query actual PostgreSQL. */
export async function runDirectFinanceChecks() {
    const runtime = await runtimeConfig();
    const fixture = JSON.parse(
        readFileSync(resolve(RUNTIME_DIR, "finance-fixture.json"), "utf8")
    ) as Json;
    const sql = postgres(runtime.databaseUrl, { max: 1 });
    const { createDb, configureDatabase } = await import("@launchstack/store/client");
    const connection = createDb({ url: runtime.databaseUrl, maxConnections: 4 });
    configureDatabase(connection.db);
    const { configureSecretBox } = await import("@launchstack/store/crypto");
    configureSecretBox({ key: process.env.EMBEDDING_SECRETS_KEY });
    const { buildWorkspaceContext } = await import("../src/lib/require-workspace-context");
    const { resolvePermissionsForRole } = await import("../src/lib/authz/resolve");
    const { resolveDocumentScope } = await import("../src/lib/authz/scope");
    const { createContextualHost } = await import("../src/server/vantage/contextual-host");
    const { runFinanceMilestoneGeneration } = await import(
        "../../../pipelines/src/vantage/experiments/finance-milestone-v1"
    );
    const { randomUUID } = await import("node:crypto");
    const owner = fixture.accounts[0];
    const host = createContextualHost({
        database: connection.db,
        now: () => new Date(fixture.domainClock),
        resolveWorkspace: async () => {
            const [row] =
                await sql`SELECT m.user_id::text,m.company_id::text,m.role,m.status,u."userId" AS auth_id FROM pdr_ai_v2_user_company_memberships m JOIN pdr_ai_v2_users u ON u.id=m.user_id WHERE m.user_id=${owner.userPk} AND m.company_id=${owner.companyId}`;
            assert.ok(
                row && row.status === "active" && row.auth_id === owner.id,
                "Actual fixture membership mismatch"
            );
            const permissions = await resolvePermissionsForRole(
                BigInt(row.company_id),
                row.role,
                connection.db
            );
            return {
                success: true as const,
                data: buildWorkspaceContext({
                    authUserId: row.auth_id,
                    userPk: BigInt(row.user_id),
                    companyId: BigInt(row.company_id),
                    role: row.role,
                    status: "active",
                    permissions,
                    resolveScope: subject => resolveDocumentScope(subject, connection.db),
                }),
            };
        },
    });
    const results: Json[] = [];
    const snapshot = async () => [
        ...(await sql`SELECT id::text,version,md5(ciphertext) AS hash FROM pdr_ai_v2_vantage_contextual_reports ORDER BY id`),
    ];
    const before = await snapshot();
    assert.ok(
        before.length > 0,
        "Preservation controls require an actual saved report; run HTTP acceptance first"
    );
    const nativeBefore = await nativeSnapshot(sql);
    try {
        const projectionFingerprint = (await host.architectureState()).projectionFingerprint;
        const [reviewCheckpoint] =
            await sql`SELECT * FROM pdr_ai_v2_vantage_contextual_architecture_review WHERE company_id=${fixture.companyId}`;
        await sql`DELETE FROM pdr_ai_v2_vantage_contextual_architecture_review WHERE company_id=${fixture.companyId}`;
        try {
            assert.equal((await host.architectureState()).revision, 0);
            await assert.rejects(() =>
                host.reviewArchitecture({
                    expectedRevision: 0,
                    expectedProjectionFingerprint: "0".repeat(64),
                    state: "reviewed",
                })
            );
            assert.equal((await host.architectureState()).revision, 0);
            assert.equal(
                (
                    (await host.reviewArchitecture({
                        expectedRevision: 0,
                        expectedProjectionFingerprint: projectionFingerprint,
                        state: "unknowns-marked",
                    })) as Json
                ).revision,
                1
            );
            await assert.rejects(
                () =>
                    host.reviewArchitecture({
                        expectedRevision: 0,
                        expectedProjectionFingerprint: projectionFingerprint,
                        state: "reviewed",
                    }),
                error => {
                    assert.equal((error as Json).code, "stale_architecture_review");
                    return true;
                }
            );
            assert.equal(
                (
                    (await host.reviewArchitecture({
                        expectedRevision: 1,
                        expectedProjectionFingerprint: projectionFingerprint,
                        state: "reviewed",
                    })) as Json
                ).revision,
                2
            );
            await assert.rejects(
                () =>
                    host.reviewArchitecture({
                        expectedRevision: 1,
                        expectedProjectionFingerprint: projectionFingerprint,
                        state: "unknowns-marked",
                    }),
                error => {
                    assert.equal((error as Json).code, "stale_architecture_review");
                    return true;
                }
            );
            results.push({ case: "architecture-review-insert-update-stale-CAS", passed: true });
        } finally {
            await sql`DELETE FROM pdr_ai_v2_vantage_contextual_architecture_review WHERE company_id=${fixture.companyId}`;
            if (reviewCheckpoint)
                await sql`INSERT INTO pdr_ai_v2_vantage_contextual_architecture_review ${sql(reviewCheckpoint)}`;
        }
        const arch = await host.architectureState();
        if (arch.state === "unreviewed")
            await host.reviewArchitecture({
                expectedRevision: arch.revision,
                expectedProjectionFingerprint: arch.projectionFingerprint,
                state: "unknowns-marked",
            });
        const prepared = await host.prepare({ weekStart: "2026-10-12" });
        const replay = await runFinanceMilestoneGeneration({
            envelope: prepared.envelope,
            sourceRefs: prepared.sourceRefs,
            resolvePrimaryRole: () => prepared.roleContext,
        });
        assert.equal(
            replay.outcome,
            "v2-first-pass",
            JSON.stringify({
                outcome: replay.outcome,
                attempts: replay.attempts,
                ...("setup" in replay ? { setup: replay.setup } : {}),
                ...("error" in replay ? { error: replay.error } : {}),
            })
        );
        assert.ok(replay.output);
        const normalized = replay.output.report;
        const candidate = {
            id: randomUUID(),
            weekStart: "2026-10-12",
            generatedAt: fixture.domainClock,
            version: 1,
            ...normalized,
            topics: normalized.topics.map(topic => ({
                ...topic,
                id: randomUUID(),
                status: "suggested",
            })),
            execution: {
                mode: "replay",
                modelId: replay.output.diagnostics.modelId,
                promptVersion: replay.output.diagnostics.promptVersion,
                attempts: replay.output.diagnostics.providerAttempts,
                durationMs: replay.output.diagnostics.durationMs,
                fallbackReason: null,
            },
            diagnostics: {
                sources: prepared.records.map(r => ({
                    source: r.source,
                    title:
                        r.source.kind === "company"
                            ? "Company Architecture"
                            : `Document ${r.source.id}`,
                    contentHash: r.contentHash!,
                })),
                contextFingerprint: prepared.context.manifest.contextFingerprint,
                persisted: true,
                historicalHumanDecisions: 0,
                semanticAssessment: {
                    kind: "deterministic-manual-checklist",
                    passed: true,
                    modelJudgeUsed: false,
                },
            },
        } as unknown as DemoReport;
        const tampered = { ...candidate, summary: "Verified revenue is USD 30,000." };
        await assert.rejects(
            () =>
                host.commit(
                    prepared,
                    replay.output.generated,
                    tampered,
                    replay.trace.validatedCompound
                ),
            error => {
                assert.equal((error as Json).code, "report_content_binding_invalid");
                return true;
            }
        );
        results.push({ case: "tampered-normalized-report-rejected", passed: true });
        const malformed = await runFinanceMilestoneGeneration({
            envelope: prepared.envelope,
            sourceRefs: prepared.sourceRefs,
            variant: "malformed",
        });
        assert.equal(malformed.outcome, "failed");
        assert.equal(malformed.output, null);
        assert.equal(malformed.trace.invocations, 1);
        await assert.rejects(() =>
            host.commit(prepared, replay.output.generated, candidate, malformed.trace.compound)
        );
        results.push({
            case: "invalid-generation-preserves-report",
            passed: true,
            invocations: malformed.trace.invocations,
        });
        const [section] =
            await sql`SELECT id::text,content FROM pdr_ai_v2_document_context_chunks WHERE document_id=${fixture.docs.sales.id} AND version_id=${fixture.docs.sales.versionId} ORDER BY id LIMIT 1`;
        assert.ok(section);
        await sql`UPDATE pdr_ai_v2_document_context_chunks SET content=content||' Changed after freeze.' WHERE id=${section.id}`;
        try {
            await assert.rejects(
                () =>
                    host.commit(
                        prepared,
                        replay.output.generated,
                        candidate,
                        replay.trace.validatedCompound
                    ),
                error => {
                    assert.equal((error as Json).code, "native_evidence_bridge_invalid");
                    return true;
                }
            );
            results.push({ case: "prepare-mutate-source-commit-race-rejected", passed: true });
        } finally {
            await sql`UPDATE pdr_ai_v2_document_context_chunks SET content=${section.content} WHERE id=${section.id}`;
        }
        assert.deepEqual(await snapshot(), before);
        assert.deepEqual(await nativeSnapshot(sql), nativeBefore);
        const evidence = {
            kind: "real-postgresql-host-tests",
            implementation: sourceFingerprints(),
            nativeBefore,
            nativeAfter: await nativeSnapshot(sql),
            identity:
                "Explicit synthetic identity wrapper; actual membership/permissions/document ACL queries; no HTTP auth claim",
            at: new Date().toISOString(),
            passed: true,
            results,
            before,
            after: await snapshot(),
            replay: {
                invocations: replay.trace.invocations,
                validatedCompound: replay.trace.validatedCompound,
                envelope: prepared.envelope,
                diagnostics: replay.output.diagnostics,
            },
        };
        const output = resolve(RUNTIME_DIR, `acceptance-db-${Date.now()}.json`);
        writeFileSync(output, JSON.stringify(evidence, null, 2));
        return { output, checks: results.length };
    } catch (error) {
        const output = resolve(RUNTIME_DIR, `acceptance-db-failed-${Date.now()}.json`);
        writeFileSync(
            output,
            JSON.stringify(
                {
                    passed: false,
                    at: new Date().toISOString(),
                    error: {
                        message: error instanceof Error ? error.message : String(error),
                        code: (error as Json).code,
                    },
                    results,
                    before,
                    after: await snapshot(),
                },
                null,
                2
            )
        );
        throw error;
    } finally {
        await connection.close();
        await sql.end({ timeout: 5 });
    }
}
/** Explicit parent-authorized fixture-only CAS reset; preserves a decrypted checkpoint first. */
export async function resetOwnedFinanceReport(reportId: string, expectedVersion: number) {
    assert.match(reportId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.ok(Number.isSafeInteger(expectedVersion) && expectedVersion > 0);
    const runtime = await runtimeConfig();
    const fixture = JSON.parse(
        readFileSync(resolve(RUNTIME_DIR, "finance-fixture.json"), "utf8")
    ) as Json;
    const owner = fixture.accounts[0];
    const sql = postgres(runtime.databaseUrl, { max: 1 });
    try {
        const [row] =
            await sql`SELECT id::text,company_id::text,owner_user_id::text,week_start::text,version,ciphertext,md5(ciphertext) AS ciphertext_hash FROM pdr_ai_v2_vantage_contextual_reports WHERE id=${reportId}::uuid AND company_id=${fixture.companyId} AND owner_user_id=${owner.userPk} AND week_start='2026-10-12'::date AND version=${expectedVersion}`;
        assert.ok(row, "Exact owned report/version checkpoint target missing");
        const { configureSecretBox, decryptSecret } = await import("@launchstack/store/crypto");
        configureSecretBox({ key: process.env.EMBEDDING_SECRETS_KEY });
        const saved = JSON.parse(decryptSecret(row.ciphertext)) as Json;
        assert.equal(saved.owner, owner.id);
        assert.equal(saved.company, fixture.companyId);
        assert.equal(saved.report.id, reportId);
        assert.equal(saved.report.version, expectedVersion);
        const state = {
            report: {
                id: row.id,
                company: row.company_id,
                owner: row.owner_user_id,
                week: row.week_start,
                version: row.version,
                ciphertextHash: row.ciphertext_hash,
            },
            native: await nativeSnapshot(sql),
        };
        const output = resolve(RUNTIME_DIR, `report-reset-checkpoint-${Date.now()}.json`);
        writeFileSync(
            output,
            JSON.stringify(
                {
                    kind: "explicit-owned-report-fixture-reset-checkpoint",
                    at: new Date().toISOString(),
                    implementation: sourceFingerprints(),
                    saved,
                    state,
                },
                null,
                2
            ),
            { flag: "wx" }
        );
        assert.equal((JSON.parse(readFileSync(output, "utf8")) as Json).saved.report.id, reportId);
        const removed =
            await sql`DELETE FROM pdr_ai_v2_vantage_contextual_reports WHERE id=${reportId}::uuid AND company_id=${fixture.companyId} AND owner_user_id=${owner.userPk} AND week_start='2026-10-12'::date AND version=${expectedVersion} AND md5(ciphertext)=${row.ciphertext_hash} RETURNING id::text`;
        assert.equal(removed.length, 1, "Exact reset CAS failed");
        assert.deepEqual(await nativeSnapshot(sql), state.native);
        return {
            output,
            resetReportId: reportId,
            expectedVersion,
            checkpointSha256: createHash("sha256").update(readFileSync(output)).digest("hex"),
        };
    } finally {
        await sql.end({ timeout: 5 });
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    (process.argv.some(arg => arg.startsWith("--reset-owned-report="))
        ? resetOwnedFinanceReport(
              process.argv.find(arg => arg.startsWith("--reset-owned-report="))!.split("=")[1]!,
              Number(process.argv.find(arg => arg.startsWith("--expected-version="))?.split("=")[1])
          )
        : process.argv.includes("--direct")
          ? runDirectFinanceChecks()
          : runFinanceAcceptance()
    )
        .then(result => {
            console.log(JSON.stringify(result));
            process.exit(0);
        })
        .catch(error => {
            console.error(
                error instanceof Error
                    ? `${error.message} code=${(error as Json).code ?? "unknown"} status=${(error as Json).status ?? "unknown"}`
                    : "Acceptance failed"
            );
            process.exit(1);
        });
}

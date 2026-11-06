/** Real M3 loopback authentication + PostgreSQL preflight. All model HTTP is fake; no live quality claim. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDb, configureDatabase } from "@launchstack/store/client";
import { configureSecretBox, decryptSecret } from "@launchstack/store/crypto";
import { buildWorkspaceContext } from "../src/lib/require-workspace-context";
import { resolvePermissionsForRole } from "../src/lib/authz/resolve";
import { resolveDocumentScope } from "../src/lib/authz/scope";
import { createContextualService } from "../src/server/vantage/contextual-service";
import {
    groundingImplementationHash,
    groundingSourceInventory,
} from "../src/server/vantage/grounding-execution";
import { measureM3WireProjection } from "../../../pipelines/src/vantage/experiments/live-grounding-m3";
import type { GroundingReport } from "../src/server/vantage/grounding-service";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIR = resolve(ROOT, "test-output/vantage-grounding-m3-20261106");
const ORIGIN = "http://localhost:3188";
interface Fixture {
    domainClock: string;
    companyId: string;
    accounts: { id: string; userPk: string; companyId: string; email: string }[];
    docs: Record<string, { id: string; versionId: string; text: string }>;
}
export async function runGroundingPreflight() {
    const launcher = (await import(
        pathToFileURL(resolve(ROOT, "scripts/dev/vantage-grounding-runtime.mjs")).href
    )) as {
        readRuntime(): { databaseUrl: string; loginPassword: string };
        assertDatabaseUrl(url: string): URL;
    };
    const runtime = launcher.readRuntime();
    launcher.assertDatabaseUrl(runtime.databaseUrl);
    assert.equal(process.env.DATABASE_URL, runtime.databaseUrl);
    const connection = createDb({ url: runtime.databaseUrl, maxConnections: 4 }),
        sql = connection.client;
    configureDatabase(connection.db);
    configureSecretBox({ key: process.env.EMBEDDING_SECRETS_KEY });
    const fixture = JSON.parse(
        readFileSync(resolve(DIR, "grounding-fixture.json"), "utf8")
    ) as Fixture;
    const owner = fixture.accounts[0]!,
        peer = fixture.accounts[1]!,
        outside = fixture.accounts[2]!;
    const cookies = new Map<string, string>();
    const trace: unknown[] = [];
    const controls: unknown[] = [];
    async function request(
        label: string,
        method: string,
        path: string,
        actor?: string,
        body?: unknown
    ) {
        const url = new URL(path, ORIGIN);
        assert.equal(url.origin, ORIGIN);
        const response = await fetch(url, {
            method,
            redirect: "manual",
            headers: {
                origin: ORIGIN,
                ...(body === undefined ? {} : { "content-type": "application/json" }),
                ...(actor && cookies.has(actor) ? { cookie: cookies.get(actor)! } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const value = await response.json();
        const set = response.headers.getSetCookie();
        if (actor && set.length) cookies.set(actor, set.map(v => v.split(";")[0]).join("; "));
        trace.push({ label, status: response.status, code: value.code ?? null });
        return { status: response.status, value };
    }
    async function login(account: Fixture["accounts"][number]) {
        const r = await request("login", "POST", "/api/auth/sign-in/email", account.id, {
            email: account.email,
            password: runtime.loginPassword,
        });
        assert.equal(r.status, 200);
        assert.ok(cookies.get(account.id));
    }
    async function native() {
        const names = [
            "pdr_ai_v2_vantage_agendas",
            "pdr_ai_v2_vantage_agenda_topics",
            "pdr_ai_v2_vantage_contract_state",
            "pdr_ai_v2_vantage_commitments",
            "pdr_ai_v2_event_outbox",
        ];
        const result: Record<string, unknown> = {};
        for (const table of names) {
            const [row] = await sql.unsafe(
                `SELECT count(*)::int AS count,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM "${table}" t`
            );
            result[table] = row;
        }
        return result;
    }
    async function saved() {
        return {
            runs: [
                ...(await sql`SELECT id::text,version,md5(ciphertext) AS hash FROM pdr_ai_v2_vantage_grounding_runs ORDER BY id`),
            ],
            active: [
                ...(await sql`SELECT * FROM pdr_ai_v2_vantage_grounding_active ORDER BY owner_user_id,week_start`),
            ],
        };
    }
    const registryPath = process.env.VANTAGE_GROUNDING_M3_OFFLINE_CONFIG;
    assert.ok(registryPath);
    const original = readFileSync(registryPath, "utf8"),
        registry = JSON.parse(original);
    const nativeBefore = await native();
    let baselineReport: GroundingReport | undefined;
    try {
        const initialSaved = await saved(),
            resume = process.argv.includes("--resume");
        if (resume)
            assert.ok(
                initialSaved.runs.length > 0,
                "Resume requires an existing accepted baseline"
            );
        else
            assert.equal(
                initialSaved.runs.length,
                0,
                "Requires a fresh isolated preflight, never reset accepted state"
            );
        assert.equal(
            (await request("unauthenticated", "GET", "/api/vantage/grounding")).status,
            401
        );
        await login(owner);
        await login(peer);
        await login(outside);
        const architecture = await request(
            "architecture",
            "GET",
            "/api/vantage/grounding/architecture",
            owner.id
        );
        assert.equal(architecture.status, 200);
        assert.equal(architecture.value.available, true);
        if (architecture.value.state === "unreviewed") {
            assert.equal(
                (
                    await request(
                        "review architecture",
                        "POST",
                        "/api/vantage/grounding/architecture",
                        owner.id,
                        {
                            expectedRevision: architecture.value.revision,
                            expectedProjectionFingerprint: architecture.value.projectionFingerprint,
                            state: "unknowns-marked",
                        }
                    )
                ).status,
                200
            );
        }
        // Default M1 behavior on this NEW database only; identity wrapper is not HTTP authentication evidence.
        const resolveWorkspace = async () => {
            const [m] =
                await sql`SELECT m.user_id::text,m.company_id::text,m.role,m.status,u."userId" AS auth_id FROM pdr_ai_v2_user_company_memberships m JOIN pdr_ai_v2_users u ON u.id=m.user_id WHERE m.user_id=${owner.userPk} AND m.company_id=${owner.companyId}`;
            assert.ok(m && m.status === "active" && m.auth_id === owner.id);
            return {
                success: true as const,
                data: buildWorkspaceContext({
                    authUserId: m.auth_id,
                    userPk: BigInt(m.user_id),
                    companyId: BigInt(m.company_id),
                    role: m.role,
                    status: "active",
                    permissions: await resolvePermissionsForRole(
                        BigInt(m.company_id),
                        m.role,
                        connection.db
                    ),
                    resolveScope: subject => resolveDocumentScope(subject, connection.db),
                }),
            };
        };
        const legacy = createContextualService({
            database: connection.db,
            resolveWorkspace,
            now: () => new Date(fixture.domainClock),
        });
        const [checkpoint] =
            await sql`SELECT ciphertext FROM pdr_ai_v2_vantage_contextual_reports WHERE company_id=${owner.companyId} AND owner_user_id=${owner.userPk} AND week_start='2026-10-12'::date`;
        const existingLegacy = checkpoint
            ? { report: JSON.parse(decryptSecret(checkpoint.ciphertext)).report }
            : await legacy.load();
        const legacyGenerated = existingLegacy.report
            ? existingLegacy
            : await legacy.generateWeek();
        assert.ok(legacyGenerated.report);
        assert.equal(legacyGenerated.report.execution.mode, "replay");
        assert.equal(legacyGenerated.report.execution.modelId, "offline-finance-milestone-replay");
        const legacyReviewed =
            legacyGenerated.report.version === 1
                ? await legacy.review({
                      reportId: legacyGenerated.report.id,
                      topicId: legacyGenerated.report.topics[0]!.id,
                      expectedVersion: 1,
                      decision: {
                          value: "needs-more-evidence",
                          text: "Synthetic default M1 compatibility review",
                      },
                  })
                : legacyGenerated;
        assert.equal(legacyReviewed.report?.version, 2);
        const [legacyRow] =
            await sql`SELECT ciphertext FROM pdr_ai_v2_vantage_contextual_reports WHERE id=${legacyGenerated.report.id}::uuid`;
        const legacySaved = JSON.parse(decryptSecret(legacyRow!.ciphertext));
        assert.equal(legacySaved.envelope.v1Input.data.currentEvidence.length, 2);
        assert.equal(legacySaved.semanticAssessment.modelJudgeUsed, false);
        assert.equal(legacySaved.reviews.length, 1);
        controls.push({
            case: "default-M1-compatible-on-M3-database",
            passed: true,
            identity: "declared-synthetic-wrapper",
            reportId: legacyGenerated.report.id,
        });
        const preflight = await request(
            "preflight",
            "GET",
            "/api/vantage/grounding/preflight",
            owner.id
        );
        assert.equal(preflight.status, 200);
        assert.equal(preflight.value.liveReady, false);
        assert.equal(preflight.value.externalRequests, 0);
        const baseline = preflight.value.baseline;
        // A stale registry is refused before any request reservation or accepted-state mutation.
        const budgetBefore = [
            ...(await sql`SELECT budget_key,reserved_count FROM pdr_ai_v2_vantage_m3_request_budgets ORDER BY budget_key`),
        ];
        writeFileSync(
            registryPath,
            JSON.stringify({ ...registry, implementationHash: "0".repeat(64) })
        );
        const stale = await request(
            "stale code registry",
            "POST",
            "/api/vantage/grounding",
            owner.id,
            { expectedBaseline: baseline }
        );
        assert.equal(stale.status, 409);
        assert.equal(stale.value.code, "grounding_execution_disabled");
        assert.deepEqual(
            [
                ...(await sql`SELECT budget_key,reserved_count FROM pdr_ai_v2_vantage_m3_request_budgets ORDER BY budget_key`),
            ],
            budgetBefore
        );
        writeFileSync(registryPath, original);
        const generated = await request(
            "accepted offline candidate",
            "POST",
            "/api/vantage/grounding",
            owner.id,
            { expectedBaseline: baseline }
        );
        assert.equal(generated.status, 200, JSON.stringify(generated.value));
        baselineReport = generated.value.report;
        assert.ok(baselineReport);
        assert.equal(baselineReport.execution.mode, "replay");
        assert.equal(baselineReport.grounding.mode, "offline");
        assert.equal(baselineReport.grounding.modelJudgeUsed, false);
        assert.equal(baselineReport.grounding.simulatedJudge, true);
        const reviewed = await request(
            "human review",
            "PATCH",
            `/api/vantage/grounding/reports/${baselineReport.id}`,
            owner.id,
            {
                topicId: baselineReport.topics[0]!.id,
                expectedVersion: 1,
                decision: { value: "needs-more-evidence", text: "Synthetic M3 Human Review" },
            }
        );
        assert.equal(reviewed.status, 200);
        assert.equal(reviewed.value.report.version, 2);
        const reload = await request(
            "reload accepted",
            "GET",
            `/api/vantage/grounding/reports/${baselineReport.id}`,
            owner.id
        );
        assert.equal(reload.status, 200);
        assert.deepEqual(reload.value.report, reviewed.value.report);
        const [row] =
            await sql`SELECT ciphertext FROM pdr_ai_v2_vantage_grounding_runs WHERE id=${baselineReport.id}::uuid`;
        const accepted = JSON.parse(decryptSecret(row!.ciphertext));
        assert.equal(accepted.report.version, 2);
        assert.equal(accepted.reviews.at(-1).actor, owner.id);
        assert.equal(accepted.executionPolicy.admission.mode, "offline");
        assert.equal(accepted.executionPolicy.admission.ledger.reserved, 2);
        const actualTrace = accepted.semanticAssessment.audit.trace;
        assert.equal(actualTrace.actualExternalDispatches, 0);
        assert.equal(actualTrace.injectedDispatches, 2);
        assert.equal(actualTrace.generationAttempts.length, 1);
        assert.equal(actualTrace.generationAttempts[0].issues.length, 0);
        assert.ok(
            actualTrace.generationAttempts[0].promptBytes > 0 &&
                actualTrace.generationAttempts[0].promptBytes <= 23500
        );
        const generationWire = measureM3WireProjection(actualTrace.generation),
            judgeWire = measureM3WireProjection(actualTrace.judge);
        assert.ok(
            generationWire.promptWireBytes > 0 &&
                generationWire.outputTokenProxy > 0 &&
                generationWire.outputTokenProxy <= 2400
        );
        assert.ok(
            judgeWire.promptWireBytes > 0 &&
                judgeWire.outputTokenProxy > 0 &&
                judgeWire.outputTokenProxy <= 4096
        );
        const snap = await saved();
        assert.equal(snap.runs.length, initialSaved.runs.length + 1);
        for (const prior of initialSaved.runs)
            assert.deepEqual(
                snap.runs.find(row => row.id === prior.id),
                prior,
                "Appending a newly admitted candidate preserves every previous ciphertext/version"
            );
        for (const account of [peer, outside]) {
            const denied = await request(
                "other owner denied",
                "GET",
                `/api/vantage/grounding/reports/${baselineReport.id}`,
                account.id
            );
            assert.equal(denied.status, account.id === peer.id ? 404 : 403);
        }
        const current = (
            await request("current preflight", "GET", "/api/vantage/grounding/preflight", owner.id)
        ).value.baseline;
        const duplicate = await request(
            "cap exhausted preserves accepted",
            "POST",
            "/api/vantage/grounding",
            owner.id,
            { expectedBaseline: current }
        );
        assert.equal(duplicate.status, 409);
        assert.equal(duplicate.value.code, "grounding_candidate_withheld");
        assert.deepEqual(await saved(), snap);
        for (const variant of [
            "omission",
            "native-only-source",
            "judge-wrong-id",
            "judge-low-grounding",
            "judge-timeout",
            "generation-429",
            "generation-500",
            "generation-redirect",
            "generation-malformed",
        ]) {
            writeFileSync(
                registryPath,
                JSON.stringify({ ...registry, caseKey: `${registry.caseKey}-${variant}`, variant })
            );
            const withheld = await request(
                `withheld ${variant}`,
                "POST",
                "/api/vantage/grounding",
                owner.id,
                { expectedBaseline: current }
            );
            assert.equal(withheld.status, 409);
            assert.equal(withheld.value.code, "grounding_candidate_withheld");
            assert.deepEqual(await saved(), snap);
            controls.push({ case: variant, acceptedStateUnchanged: true });
        }
        const budgetsSnapshot = async () => [
            ...(await sql`SELECT budget_key,reserved_count FROM pdr_ai_v2_vantage_m3_request_budgets ORDER BY budget_key`),
        ];
        const beforeGuards = await budgetsSnapshot();
        const [version] =
            await sql`SELECT created_at FROM pdr_ai_v2_document_versions WHERE id=${fixture.docs.finance!.versionId} AND document_id=${fixture.docs.finance!.id}`;
        assert.ok(version);
        await sql`UPDATE pdr_ai_v2_document_versions SET created_at=created_at+interval '1 minute' WHERE id=${fixture.docs.finance!.versionId}`;
        try {
            const denied = await request(
                "same-version source metadata changed",
                "GET",
                `/api/vantage/grounding/reports/${baselineReport.id}`,
                owner.id
            );
            assert.equal(denied.status, 409);
            assert.equal(denied.value.code, "stale_saved_context");
            assert.deepEqual(await saved(), snap);
        } finally {
            await sql`UPDATE pdr_ai_v2_document_versions SET created_at=${version.created_at} WHERE id=${fixture.docs.finance!.versionId}`;
        }
        const [grant] =
            await sql`SELECT * FROM pdr_ai_v2_document_grants WHERE document_id=${fixture.docs.finance!.id} AND principal_type='user' AND principal_id=${owner.userPk}`;
        assert.ok(grant);
        await sql`DELETE FROM pdr_ai_v2_document_grants WHERE document_id=${fixture.docs.finance!.id} AND principal_type='user' AND principal_id=${owner.userPk}`;
        try {
            const denied = await request(
                "real source grant revoked",
                "GET",
                `/api/vantage/grounding/reports/${baselineReport.id}`,
                owner.id
            );
            assert.equal(denied.status, 403);
            assert.equal(denied.value.code, "source_unavailable");
            assert.deepEqual(await saved(), snap);
        } finally {
            await sql`INSERT INTO pdr_ai_v2_document_grants ${sql(grant)}`;
        }
        assert.deepEqual(await budgetsSnapshot(), beforeGuards);
        controls.push({
            case: "same-version-source-date-and-real-grant-revocation",
            acceptedStateUnchanged: true,
            reservationsUnchanged: true,
        });
        assert.deepEqual(await native(), nativeBefore);
        const [live] =
            await sql`SELECT approval_state,reserved_count FROM pdr_ai_v2_vantage_m3_request_budgets WHERE budget_key='finance-live-pilot'`;
        assert.ok(live);
        assert.equal(live.approval_state, "unapproved");
        assert.equal(live.reserved_count, 0);
        const artifact = {
            kind: "real-http-pg-offline-fake-provider-preflight",
            liveQualityEvidence: false,
            resume: process.argv.includes("--resume"),
            actualExternalProviderRequests: 0,
            trace,
            controls,
            acceptedReportId: baselineReport.id,
            nativeBefore,
            nativeAfter: await native(),
            currentCode: {
                implementationHash: await groundingImplementationHash(),
                sourceInventory: groundingSourceInventory(),
            },
            actualWire: {
                generation: measureM3WireProjection(
                    accepted.semanticAssessment.audit.trace.generation
                ),
                judge: measureM3WireProjection(accepted.semanticAssessment.audit.trace.judge),
            },
            saved: await saved(),
            budgets: [
                ...(await sql`SELECT budget_key,approval_state,reserved_count,plan_hash FROM pdr_ai_v2_vantage_m3_request_budgets ORDER BY budget_key`),
            ],
        };
        const output = resolve(DIR, `preflight-http-db-${Date.now()}.json`);
        writeFileSync(output, JSON.stringify(artifact, null, 2));
        return { output, checks: trace.length, controls: controls.length };
    } catch (error) {
        writeFileSync(
            resolve(DIR, `preflight-failed-${Date.now()}.json`),
            JSON.stringify(
                {
                    trace,
                    controls,
                    nativeBefore,
                    nativeAfter: await native(),
                    error: error instanceof Error ? error.message : String(error),
                },
                null,
                2
            )
        );
        throw error;
    } finally {
        writeFileSync(registryPath, original);
        await connection.close();
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runGroundingPreflight()
        .then(value => {
            console.log(JSON.stringify(value));
            process.exit(0);
        })
        .catch(error => {
            console.error(error);
            process.exit(1);
        });
}

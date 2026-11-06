/** Real PostgreSQL M2 fault controls. Identity is an explicit synthetic wrapper; HTTP auth is tested separately. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";
import { z } from "zod";
import { createDb, configureDatabase } from "@launchstack/store/client";
import { configureSecretBox, decryptSecret } from "@launchstack/store/crypto";
import { buildWorkspaceContext } from "../src/lib/require-workspace-context";
import { resolvePermissionsForRole } from "../src/lib/authz/resolve";
import { resolveDocumentScope } from "../src/lib/authz/scope";
import {
    createRoleContextualHost,
    type PreparedRoleContextualReport,
} from "../src/server/vantage/role-contextual-host";
import { createRoleContextualService } from "../src/server/vantage/role-contextual-service";
import { ROLE_CONTEXTUAL_POLICY } from "../src/server/vantage/role-contextual-policy";
import { runRoleMilestoneGeneration } from "../../../pipelines/src/vantage/experiments/role-pair-milestone-v1";
import { normalizeGenerationV2 } from "../../../pipelines/src/vantage/validate-generation-v2";
import type { RoleContextualReport } from "../src/app/employer/tools/vantage/role-contextual-contract";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OUTPUT = resolve(ROOT, "test-output/vantage-role-m2-20261106");
interface Fixture {
    domainClock: string;
    companyId: string;
    accounts: { id: string; userPk: string; companyId: string }[];
    docs: Record<string, { id: string; versionId: string; text: string }>;
}
interface Saved {
    owner: string;
    report: RoleContextualReport;
    roleSelection: RoleContextualReport["roleSelection"];
}
function fingerprints() {
    return Object.fromEntries(
        [
            "apps/web/src/server/vantage/role-contextual-host.ts",
            "apps/web/src/server/vantage/role-contextual-service.ts",
            "pipelines/src/vantage/experiments/role-pair-milestone-v1.ts",
            "pipelines/src/vantage/dynamic-retrieval/retrieve.ts",
        ].map(path => [
            path,
            createHash("sha256")
                .update(readFileSync(resolve(ROOT, path)))
                .digest("hex"),
        ])
    );
}
export async function runRoleDbControls() {
    const moduleUrl = pathToFileURL(resolve(ROOT, "scripts/dev/vantage-role-runtime.mjs")).href;
    const launcher = (await import(moduleUrl)) as {
        readRuntime(): { databaseUrl: string };
        assertDatabaseUrl(url: string): URL;
    };
    const runtime = launcher.readRuntime();
    launcher.assertDatabaseUrl(runtime.databaseUrl);
    assert.equal(
        process.env.DATABASE_URL,
        runtime.databaseUrl,
        "Use only the sanitized M2 child environment"
    );
    const sql = postgres(runtime.databaseUrl, { max: 1 }),
        connection = createDb({ url: runtime.databaseUrl, maxConnections: 4 });
    configureDatabase(connection.db);
    configureSecretBox({ key: process.env.EMBEDDING_SECRETS_KEY });
    const fixture = JSON.parse(
            readFileSync(resolve(OUTPUT, "role-fixture.json"), "utf8")
        ) as Fixture,
        owner = fixture.accounts[0]!;
    const resolveWorkspace = async () => {
        const [row] = await sql<
            { user_id: string; company_id: string; role: string; status: string; auth_id: string }[]
        >`SELECT m.user_id::text,m.company_id::text,m.role,m.status,u."userId" AS auth_id FROM pdr_ai_v2_user_company_memberships m JOIN pdr_ai_v2_users u ON u.id=m.user_id WHERE m.user_id=${owner.userPk} AND m.company_id=${owner.companyId}`;
        assert.ok(
            row && row.status === "active" && row.auth_id === owner.id,
            "Actual fixture membership must remain active"
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
    };
    const deps = {
            database: connection.db,
            resolveWorkspace,
            now: () => new Date(fixture.domainClock),
        },
        host = createRoleContextualHost(deps),
        service = createRoleContextualService(deps);
    const results: { case: string; passed: true; expectedCode?: string }[] = [];
    const snapshot = async () => [
        ...(await sql`SELECT id::text,company_id::text,owner_user_id::text,context_key,version,md5(ciphertext) AS ciphertext_hash FROM pdr_ai_v2_vantage_role_contextual_runs ORDER BY id`),
    ];
    async function native() {
        const tables = [
            "pdr_ai_v2_vantage_agendas",
            "pdr_ai_v2_vantage_agenda_topics",
            "pdr_ai_v2_vantage_contract_state",
            "pdr_ai_v2_vantage_commitments",
            "pdr_ai_v2_event_outbox",
        ];
        return Object.fromEntries(
            await Promise.all(
                tables.map(async table => {
                    const [row] = await sql.unsafe(
                        `SELECT count(*)::int AS count,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM "${table}" t`
                    );
                    return [table, row];
                })
            )
        );
    }
    async function rejected(run: () => Promise<unknown>, code: string, status?: number) {
        await assert.rejects(run, error => {
            assert.equal((error as { code?: string }).code, code);
            if (status !== undefined) assert.equal((error as { status?: number }).status, status);
            return true;
        });
    }
    async function select(primaryRoleId: string) {
        const view = await service.personalContext();
        const next = await service.saveRoles({
            expectedRevision: view.state.revision,
            roleIds: [...ROLE_CONTEXTUAL_POLICY.roleIds],
            primaryRoleId,
        });
        assert.equal(next.state.revision, view.state.revision + 1);
        assert.equal(next.roles.primaryRoleId, primaryRoleId);
        assert.deepEqual(
            [...next.roles.roleIds].sort(),
            [...ROLE_CONTEXTUAL_POLICY.roleIds].sort()
        );
    }
    async function generate(prepared: PreparedRoleContextualReport) {
        const result = await runRoleMilestoneGeneration({
            envelope: prepared.envelope,
            sourceRefs: prepared.sourceRefs,
            roleContext: prepared.roleContext,
            ranking: prepared.ranking,
        });
        assert.equal(result.outcome, "v2-first-pass");
        assert.ok(result.output);
        assert.equal(result.trace.invocations, 1);
        return result;
    }
    function candidate(
        prepared: PreparedRoleContextualReport,
        result: Awaited<ReturnType<typeof generate>>,
        raw: unknown = result.trace.validatedCompound
    ): RoleContextualReport {
        assert.ok(result.output);
        const normalized = normalizeGenerationV2(raw, prepared.envelope);
        return {
            id: randomUUID(),
            weekStart: ROLE_CONTEXTUAL_POLICY.weekStart,
            generatedAt: fixture.domainClock,
            version: 1,
            ...normalized.report,
            topics: normalized.report.topics.map(topic => ({
                ...topic,
                id: randomUUID(),
                status: "suggested" as const,
            })),
            execution: {
                mode: "replay",
                modelId: result.output.diagnostics.modelId,
                promptVersion: result.output.diagnostics.promptVersion,
                attempts: result.output.diagnostics.providerAttempts,
                durationMs: result.output.diagnostics.durationMs,
                fallbackReason: null,
            },
            diagnostics: {
                sources: prepared.records.map(record => ({
                    source: record.source,
                    title:
                        record.source.kind === "company"
                            ? "Company Architecture"
                            : `Document ${record.source.id}`,
                    contentHash: record.contentHash!,
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
            roleSelection: prepared.roleSelection,
            sourceSetHash: prepared.sourceSetHash,
            historyHash: prepared.historyHash,
            contextKey: prepared.contextKey,
        };
    }
    let before: Awaited<ReturnType<typeof snapshot>> | undefined;
    try {
        const [identity] = await sql<
            { database: string; username: string }[]
        >`SELECT current_database() AS database,current_user AS username`;
        assert.equal(identity?.database, "vantage_role_m2_20261106");
        assert.equal(identity?.username, "vantage_role_m2");
        const markers = await sql`SELECT marker FROM _vantage_integration_identity`;
        assert.equal(markers.length, 1);
        assert.equal(markers[0]!.marker, "vantage-role-m2-20261106");
        const rows = await sql<
            { id: string; ciphertext: string }[]
        >`SELECT id::text,ciphertext FROM pdr_ai_v2_vantage_role_contextual_runs WHERE company_id=${owner.companyId} AND owner_user_id=${owner.userPk}`;
        const saved = rows
                .map(row => JSON.parse(decryptSecret(row.ciphertext)) as Saved)
                .sort((left, right) => right.roleSelection.revision - left.roleSelection.revision),
            a = saved.find(value => value.roleSelection.primaryRoleId === "partnerships-lead"),
            b = saved.find(value => value.roleSelection.primaryRoleId === "security-engineer");
        assert.ok(
            a && b,
            "Run real HTTP acceptance to save both valid role reports before direct controls"
        );
        assert.equal(a.owner, owner.id);
        assert.equal(b.owner, owner.id);
        assert.notEqual(a.report.id, b.report.id);
        assert.equal(a.report.sourceSetHash, b.report.sourceSetHash);
        assert.equal(a.report.historyHash, b.report.historyHash);
        const nativeBefore = await native();
        await select("security-engineer");
        const oldA = await host.load({ reportId: a.report.id });
        assert.equal(oldA.report?.roleSelection.primaryRoleId, "partnerships-lead");
        const oldReport = oldA.report;
        assert.ok(oldReport);
        const topic = oldReport.topics[0]!;
        const reviewed = await host.review({
            reportId: a.report.id,
            topicId: topic.id,
            expectedVersion: oldReport.version,
            decision: {
                value: "needs-more-evidence",
                text: "Direct role control: inspect the original evidence before deciding.",
            },
        });
        assert.equal(reviewed.report!.version, oldReport.version + 1);
        assert.equal(reviewed.report!.topics[0]!.decision?.value, "needs-more-evidence");
        await rejected(
            () =>
                host.review({
                    reportId: a.report.id,
                    topicId: topic.id,
                    expectedVersion: oldReport.version,
                    status: "kept",
                }),
            "stale_review",
            409
        );
        results.push({
            case: "old-role-report-read-review-after-primary-switch-and-stale-review-CAS",
            passed: true,
            expectedCode: "stale_review",
        });
        before = await snapshot();
        assert.ok(before.length >= 2);
        await select("partnerships-lead");
        const stalePrepared = await host.prepare(),
            staleGenerated = await generate(stalePrepared);
        assert.ok(staleGenerated.output);
        const staleCandidate = candidate(stalePrepared, staleGenerated);
        await select("security-engineer");
        await rejected(
            () =>
                host.commit(
                    stalePrepared,
                    staleGenerated.output.generated,
                    staleCandidate,
                    staleGenerated.trace.validatedCompound
                ),
            "stale_context",
            409
        );
        results.push({
            case: "prepare-primary-switch-commit-rejected",
            passed: true,
            expectedCode: "stale_context",
        });
        assert.deepEqual(await snapshot(), before);
        const [roleCheckpoint] = await sql<
            { business_context_v0: postgres.JSONValue }[]
        >`SELECT business_context_v0 FROM pdr_ai_v2_user_company_memberships WHERE user_id=${owner.userPk} AND company_id=${owner.companyId}`;
        assert.ok(roleCheckpoint);
        await sql`UPDATE pdr_ai_v2_user_company_memberships SET business_context_v0=jsonb_set(business_context_v0,'{mappingVersion}','"stale-role-map-control"'::jsonb) WHERE user_id=${owner.userPk} AND company_id=${owner.companyId}`;
        try {
            await rejected(() => host.prepare(), "stale_role_mapping", 409);
            assert.equal((await host.load({ reportId: a.report.id })).report?.id, a.report.id);
        } finally {
            await sql`UPDATE pdr_ai_v2_user_company_memberships SET business_context_v0=${sql.json(roleCheckpoint.business_context_v0)} WHERE user_id=${owner.userPk} AND company_id=${owner.companyId}`;
        }
        results.push({
            case: "stale-confirmed-map-blocks-generation-preserves-historical-read",
            passed: true,
            expectedCode: "stale_role_mapping",
        });
        const prepared = await host.prepare(),
            generated = await generate(prepared);
        assert.ok(generated.output);
        assert.equal(prepared.roleContext.primaryRoleId, "security-engineer");
        const oppositePrimary =
            prepared.roleContext.primaryRoleId === "security-engineer"
                ? "partnerships-lead"
                : "security-engineer";
        const valid = candidate(prepared, generated);
        await rejected(
            () =>
                host.commit(
                    prepared,
                    generated.output.generated,
                    { ...valid, summary: "A swapped report is not the validated output." },
                    generated.trace.validatedCompound
                ),
            "report_content_binding_invalid",
            409
        );
        const wrong = structuredClone(generated.trace.validatedCompound);
        assert.ok(wrong);
        wrong.experimental.topics.reverse();
        const wrongCandidate = candidate(prepared, generated, wrong);
        await rejected(
            () => host.commit(prepared, generated.output.generated, wrongCandidate, wrong),
            "contextual_semantic_failed",
            409
        );
        await rejected(
            () =>
                host.commit(
                    prepared,
                    generated.output.generated,
                    {
                        ...valid,
                        roleSelection: {
                            ...valid.roleSelection,
                            primaryRoleId: oppositePrimary,
                        },
                    },
                    generated.trace.validatedCompound
                ),
            "report_role_binding_invalid",
            409
        );
        const malformed = structuredClone(generated.trace.validatedCompound);
        assert.ok(malformed);
        malformed.experimental.headline = "";
        await assert.rejects(
            () => host.commit(prepared, generated.output.generated, valid, malformed),
            error => error instanceof z.ZodError
        );
        results.push({
            case: "invalid-wrong-role-compound-and-post-generation-swap-rejected",
            passed: true,
        });
        assert.deepEqual(await snapshot(), before);
        const [section] = await sql<
            { id: string; content: string }[]
        >`SELECT id::text,content FROM pdr_ai_v2_document_context_chunks WHERE document_id=${fixture.docs.D08!.id} AND version_id=${fixture.docs.D08!.versionId} ORDER BY id LIMIT 1`;
        assert.ok(section);
        await sql`UPDATE pdr_ai_v2_document_context_chunks SET content=content||' Source changed after freeze.' WHERE id=${section.id}`;
        try {
            await rejected(
                () =>
                    host.commit(
                        prepared,
                        generated.output.generated,
                        valid,
                        generated.trace.validatedCompound
                    ),
                "scenario_source_binding_invalid",
                409
            );
        } finally {
            await sql`UPDATE pdr_ai_v2_document_context_chunks SET content=${section.content} WHERE id=${section.id}`;
        }
        results.push({
            case: "prepare-source-change-commit-rejected",
            passed: true,
            expectedCode: "scenario_source_binding_invalid",
        });
        const [versionTime] = await sql<
            { created_at: Date }[]
        >`SELECT created_at FROM pdr_ai_v2_document_versions WHERE id=${fixture.docs.D08!.versionId} AND document_id=${fixture.docs.D08!.id}`;
        assert.ok(versionTime);
        await sql`UPDATE pdr_ai_v2_document_versions SET created_at=created_at+interval '1 minute' WHERE id=${fixture.docs.D08!.versionId}`;
        try {
            await rejected(
                () =>
                    host.commit(
                        prepared,
                        generated.output.generated,
                        valid,
                        generated.trace.validatedCompound
                    ),
                "stale_context",
                409
            );
        } finally {
            await sql`UPDATE pdr_ai_v2_document_versions SET created_at=${versionTime.created_at} WHERE id=${fixture.docs.D08!.versionId}`;
        }
        results.push({
            case: "same-version-source-date-change-invalidates-freeze",
            passed: true,
            expectedCode: "stale_context",
        });
        const [grant] =
            await sql`SELECT * FROM pdr_ai_v2_document_grants WHERE document_id=${fixture.docs.D08!.id} AND principal_type='user' AND principal_id=${owner.userPk}`;
        assert.ok(grant);
        await sql`DELETE FROM pdr_ai_v2_document_grants WHERE document_id=${fixture.docs.D08!.id} AND principal_type='user' AND principal_id=${owner.userPk}`;
        try {
            await rejected(() => host.prepare(), "source_unavailable", 403);
            await rejected(() => host.load({ reportId: a.report.id }), "source_unavailable", 403);
        } finally {
            await sql`INSERT INTO pdr_ai_v2_document_grants ${sql(grant)}`;
        }
        results.push({
            case: "real-document-grant-revocation-withholds-generation-and-read",
            passed: true,
            expectedCode: "source_unavailable",
        });
        const [role] = await sql<
            { permissions: string[] }[]
        >`SELECT permissions FROM pdr_ai_v2_workspace_roles WHERE company_id=${owner.companyId} AND slug='role-reviewer'`;
        assert.ok(role);
        await sql`UPDATE pdr_ai_v2_workspace_roles SET permissions=${sql.array(role.permissions.filter(permission => permission !== "documents.edit"))} WHERE company_id=${owner.companyId} AND slug='role-reviewer'`;
        try {
            await rejected(() => host.prepare(), "write_forbidden", 403);
            await rejected(
                () =>
                    host.review({
                        reportId: a.report.id,
                        topicId: topic.id,
                        expectedVersion: reviewed.report!.version,
                        status: "kept",
                    }),
                "write_forbidden",
                403
            );
        } finally {
            await sql`UPDATE pdr_ai_v2_workspace_roles SET permissions=${sql.array(role.permissions)} WHERE company_id=${owner.companyId} AND slug='role-reviewer'`;
        }
        results.push({
            case: "real-role-write-permission-rechecked",
            passed: true,
            expectedCode: "write_forbidden",
        });
        assert.deepEqual(
            await snapshot(),
            before,
            "All negative controls preserve every encrypted report byte and version"
        );
        assert.deepEqual(await native(), nativeBefore, "No native lifecycle/action/outbox changes");
        assert.equal((await host.load({ reportId: a.report.id })).report?.id, a.report.id);
        assert.equal((await host.load({ reportId: b.report.id })).report?.id, b.report.id);
        const evidence = {
            kind: "real-postgresql-role-controls",
            passed: true,
            at: new Date().toISOString(),
            identity:
                "Declared synthetic identity wrapper only; actual PostgreSQL membership, permissions, grants, source reads, guarded commit and encryption. HTTP authentication is a separate acceptance artifact.",
            implementation: fingerprints(),
            results,
            before,
            after: await snapshot(),
            nativeBefore,
            nativeAfter: await native(),
            replay: {
                sourceSetHash: prepared.sourceSetHash,
                historyHash: prepared.historyHash,
                roleSelection: prepared.roleSelection,
                ranking: prepared.ranking,
                invocations: generated.trace.invocations,
            },
        };
        const output = resolve(OUTPUT, `acceptance-db-${Date.now()}.json`);
        writeFileSync(output, JSON.stringify(evidence, null, 2));
        return { output, checks: results.length };
    } catch (error) {
        writeFileSync(
            resolve(OUTPUT, `acceptance-db-failed-${Date.now()}.json`),
            JSON.stringify(
                {
                    passed: false,
                    at: new Date().toISOString(),
                    results,
                    before,
                    after: await snapshot(),
                    error: {
                        name: error instanceof Error ? error.name : "unknown",
                        code: (error as { code?: string }).code,
                    },
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
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    runRoleDbControls()
        .then(result => {
            console.log(JSON.stringify(result));
            process.exit(0);
        })
        .catch(error => {
            console.error(error instanceof Error ? error.message : "Role controls failed");
            process.exit(1);
        });
}

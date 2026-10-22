#!/usr/bin/env node
/** Additive acceptance probes for the explicitly isolated synthetic runtime only. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
    accountsFor,
    APP_URL,
    APP_HOST,
    DATABASE_HOST,
    DATABASE_PORT,
    DATABASE,
    DATABASE_USER,
    PROJECT,
    ROOT,
    RUNTIME_DIR,
    assertDatabaseUrl,
    assertNoDotenv,
    readRuntime,
    systemEnvironment,
    workspaceSlugsFor,
} from "./vantage-integration-runtime.mjs";

const DESCRIPTORS = [
    ["manual_period_roundtrip", "TL API/date persistence; Joseph metrics form"],
    ["impossible_date_rejected", "TL API calendar validation; Joseph calendar controls"],
    ["reversed_period_rejected", "TL API period validation; Joseph calendar controls"],
    ["finite_signed_metric_contract", "TL/product metric domain contract; Joseph form validation"],
    ["private_sharing_rejected", "TL API private-only contract; Joseph sharing menu"],
    ["foreign_metric_observation_rejected", "TL workspace and metric ownership"],
    ["foreign_metric_evidence_edits_rejected", "TL workspace ownership"],
    ["request_company_override_ignored", "TL request context tenant binding"],
    ["foreign_company_query_does_not_leak", "TL read scope"],
    ["permission_revocation_blocks_and_restores", "TL membership and Vantage authorization"],
];

async function runIsolatedChild() {
    const child = spawn(
        process.execPath,
        [resolve(ROOT, "scripts/dev/vantage-integration-probes.mjs"), "--isolated-child"],
        {
            cwd: ROOT,
            env: systemEnvironment(),
            shell: false,
            windowsHide: true,
            stdio: "inherit",
        }
    );
    await new Promise((done, reject) => {
        child.on("error", () => reject(new Error("Could not start isolated probe subprocess.")));
        child.on("close", code => {
            process.exitCode = code ?? 1;
            done();
        });
    });
}

async function probes() {
    assertNoDotenv();
    const config = readRuntime();
    const accounts = accountsFor(config);
    assertDatabaseUrl(config.databaseUrl);
    if (
        !/^[1-9][0-9]*$/.test(config.companyId ?? "") ||
        !/^[1-9][0-9]*$/.test(config.outsideCompanyId ?? "") ||
        config.companyId === config.outsideCompanyId
    )
        throw new Error("Invalid synthetic workspace identifiers.");
    const runTag = randomUUID().replaceAll("-", "").slice(0, 16);
    const runId = `api-probe-${runTag}`;
    const results = [];
    const cookies = new Map();
    const created = {};
    let membershipRestored = null;
    const requireStore = createRequire(resolve(ROOT, "packages/store/package.json"));
    const { default: postgres } = await import(
        pathToFileURL(requireStore.resolve("postgres")).href
    );
    const sql = postgres(config.databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });

    function scrub(value) {
        let text = String(value);
        for (const secret of [
            config.databaseUrl,
            config.databasePassword,
            config.authSecret,
            config.loginPassword,
            ...cookies.values(),
        ])
            if (secret) text = text.split(secret).join("[synthetic-secret-redacted]");
        return text;
    }

    function rememberCookies(response) {
        if (typeof response.headers.getSetCookie !== "function")
            throw new Error("Node must support Headers.getSetCookie for the real auth probe.");
        for (const line of response.headers.getSetCookie()) {
            const pair = line.split(";", 1)[0];
            const separator = pair.indexOf("=");
            if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
        }
    }

    async function api(path, { method = "GET", data, authenticated = true } = {}) {
        if (!path.startsWith("/api/")) throw new Error("Probe URLs must be local API paths.");
        const target = new URL(path, APP_URL);
        if (target.origin !== APP_URL || target.hostname !== APP_HOST)
            throw new Error("Refusing a non-loopback probe URL.");
        const response = await fetch(target, {
            method,
            redirect: "error",
            signal: AbortSignal.timeout(120_000),
            headers: {
                origin: APP_URL,
                ...(data === undefined ? {} : { "content-type": "application/json" }),
                ...(authenticated && cookies.size
                    ? { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") }
                    : {}),
            },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        rememberCookies(response);
        let body;
        try {
            body = await response.json();
        } catch {
            body = null;
        }
        return { status: response.status, body };
    }

    function ensure(condition, message) {
        if (!condition) throw new Error(message);
    }

    async function verifyIdentity() {
        const [identity] =
            await sql`SELECT current_database() AS database, current_user AS username`;
        ensure(
            identity.database === DATABASE && identity.username === DATABASE_USER,
            "Unexpected SQL identity; no probe rows written."
        );
        const marker = await sql`SELECT marker FROM _vantage_integration_identity`;
        ensure(
            marker.length === 1 && marker[0].marker === PROJECT,
            "Unexpected isolated database marker."
        );
        const companies =
            await sql`SELECT id::text, slug FROM pdr_ai_v2_company WHERE id IN (${config.companyId}, ${config.outsideCompanyId})`;
        ensure(
            companies.some(
                c => c.id === config.companyId && c.slug === workspaceSlugsFor(config).primary
            ),
            "Primary synthetic workspace mismatch."
        );
        ensure(
            companies.some(
                c =>
                    c.id === config.outsideCompanyId && c.slug === workspaceSlugsFor(config).outside
            ),
            "Outside synthetic workspace mismatch."
        );
    }

    async function observationRows(source) {
        return sql`SELECT id, company_id::text AS "companyId", metric_id AS "metricId", created_by_user_id AS "createdByUserId", value, period_start::text AS "periodStart", period_end::text AS "periodEnd", source FROM pdr_ai_v2_vantage_metric_observations WHERE source=${source} ORDER BY id`;
    }

    async function createDefinition(name, suffix, definition, unit) {
        const response = await api("/api/vantage/metrics", {
            method: "POST",
            data: {
                key: `${runId}-${suffix}`,
                name,
                definition,
                unit,
            },
        });
        ensure(
            response.status === 201 && response.body?.definition?.id,
            `Probe-only metric creation HTTP ${response.status}.`
        );
        return response.body.definition;
    }

    async function probe(id, task) {
        const owner = DESCRIPTORS.find(item => item[0] === id)?.[1] ?? "TL";
        try {
            const evidence = await task();
            const { pass, ...details } = evidence;
            const result = { id, status: pass ? "PASS" : "FAIL", owner, evidence: details };
            results.push(result);
            console.log(JSON.stringify(result));
        } catch (error) {
            const result = {
                id,
                status: "FAIL",
                owner,
                error: scrub(error instanceof Error ? error.message : error),
            };
            results.push(result);
            console.log(JSON.stringify(result));
        }
    }

    try {
        await verifyIdentity();
        const login = await api("/api/auth/sign-in/email", {
            method: "POST",
            authenticated: false,
            data: {
                email: accounts[0].email,
                password: config.loginPassword,
            },
        });
        ensure(
            login.status === 200 && cookies.size > 0,
            `Synthetic Better Auth sign-in HTTP ${login.status}.`
        );
        const session = await api("/api/auth/get-session");
        ensure(
            session.status === 200 && session.body?.user?.id === accounts[0].id,
            "Real auth session did not match the configured synthetic subject."
        );
        const admission = await api("/api/vantage/metrics");
        ensure(
            admission.status === 200,
            `Permitted actor initial metrics HTTP ${admission.status}.`
        );

        created.countMetric = await createDefinition(
            "Signups",
            "count",
            "Probe-only finite numeric metric for date persistence; signed interpretation is a separate metric contract.",
            "count"
        );
        created.signedMetric = await createDefinition(
            "Probe signed net cashflow change",
            "signed",
            "Probe-only signed net change; negative values represent a decrease and are valid.",
            "USD"
        );
        created.foreignMetricId = `probe-foreign-metric-${runTag}`;
        created.foreignEvidenceId = `probe-foreign-evidence-${runTag}`;
        await sql.begin(async tx => {
            await tx`INSERT INTO pdr_ai_v2_vantage_metric_definitions (id, company_id, key, name, definition, unit) VALUES (${created.foreignMetricId}, ${config.outsideCompanyId}, ${`${runId}-foreign`}, 'Probe outside metric', 'Synthetic foreign workspace probe only.', 'count')`;
            await tx`INSERT INTO pdr_ai_v2_vantage_evidence (id, company_id, created_by_user_id, kind, title, body, source, observed_at, visibility) VALUES (${created.foreignEvidenceId}, ${config.outsideCompanyId}, ${accounts[2].id}, 'note', 'Probe outside evidence', 'Synthetic outside workspace data only.', ${runId}, '2026-10-19', 'private')`;
        });

        await probe("manual_period_roundtrip", async () => {
            const source = `${runId}-manual-period`;
            const request = {
                metricId: created.countMetric.id,
                value: 17,
                periodStart: "2026-10-12",
                periodEnd: "2026-10-18",
                source,
                note: "Manual date preservation acceptance probe.",
            };
            const response = await api("/api/vantage/metrics/observations", {
                method: "POST",
                data: request,
            });
            const responseRows =
                response.body?.observations?.filter(item => item.source === source) ?? [];
            const list = await api("/api/vantage/metrics");
            const listRows = list.body?.observations?.filter(item => item.source === source) ?? [];
            const sqlRows = await observationRows(source);
            const exact = row =>
                row?.periodStart === request.periodStart &&
                row?.periodEnd === request.periodEnd &&
                row?.value === request.value;
            return {
                pass:
                    response.status === 201 &&
                    list.status === 200 &&
                    responseRows.length === 1 &&
                    listRows.length === 1 &&
                    sqlRows.length === 1 &&
                    [responseRows[0], listRows[0], sqlRows[0]].every(exact),
                request,
                responseStatus: response.status,
                responseRows,
                listStatus: list.status,
                listRows,
                sqlRows,
            };
        });

        for (const [id, start, end, suffix] of [
            ["impossible_date_rejected", "2026-02-30", "2026-03-01", "impossible"],
            ["reversed_period_rejected", "2026-10-18", "2026-10-12", "reversed"],
        ])
            await probe(id, async () => {
                const source = `${runId}-${suffix}`;
                const request = {
                    metricId: created.countMetric.id,
                    value: 1,
                    periodStart: start,
                    periodEnd: end,
                    source,
                };
                const response = await api("/api/vantage/metrics/observations", {
                    method: "POST",
                    data: request,
                });
                const rows = await observationRows(source);
                return {
                    pass: response.status === 400 && rows.length === 0,
                    expectedStatus: 400,
                    actualStatus: response.status,
                    request,
                    error: response.body?.error ?? null,
                    rowsWritten: rows.length,
                };
            });

        await probe("finite_signed_metric_contract", async () => {
            const accepted = [-3.5, 2.25];
            const rejected = ["NaN", "Infinity", "-Infinity"];
            const requests = [
                ...accepted.map((value, index) => ({
                    metricId: created.signedMetric.id,
                    value,
                    periodStart: "2026-10-12",
                    periodEnd: "2026-10-18",
                    source: `${runId}-signed-${index}`,
                })),
                ...rejected.map((value, index) => ({
                    metricId: created.signedMetric.id,
                    value,
                    periodStart: "2026-10-12",
                    periodEnd: "2026-10-18",
                    source: `${runId}-nonfinite-${index}`,
                })),
            ];
            const responses = [];
            for (const request of requests) {
                const response = await api("/api/vantage/metrics/observations", {
                    method: "POST",
                    data: request,
                });
                responses.push({
                    request,
                    status: response.status,
                    rows: await observationRows(request.source),
                });
            }
            const acceptedResults = responses.slice(0, accepted.length);
            const rejectedResults = responses.slice(accepted.length);
            return {
                pass:
                    acceptedResults.every(
                        result => result.status === 201 && result.rows.length === 1
                    ) &&
                    rejectedResults.every(
                        result => result.status === 400 && result.rows.length === 0
                    ),
                expected:
                    "Finite signed numbers, including negative/fractional values, persist; NaN and Infinity spellings are rejected without rows.",
                metric: { name: created.signedMetric.name, unit: created.signedMetric.unit },
                responses,
            };
        });

        await probe("private_sharing_rejected", async () => {
            const response = await api("/api/vantage/evidence", {
                method: "POST",
                data: {
                    kind: "note",
                    title: `${runId} private-only record`,
                    body: "Synthetic acceptance probe only.",
                    source: runId,
                    observedAt: "2026-10-19",
                    visibility: "private",
                },
            });
            ensure(
                response.status === 201 && response.body?.evidence?.id,
                `Private probe setup HTTP ${response.status}.`
            );
            created.privateEvidenceId = response.body.evidence.id;
            const patch = await api(`/api/vantage/evidence/${created.privateEvidenceId}`, {
                method: "PATCH",
                data: { visibility: "shared" },
            });
            const [row] =
                await sql`SELECT id, visibility, company_id::text AS "companyId" FROM pdr_ai_v2_vantage_evidence WHERE id=${created.privateEvidenceId}`;
            return {
                pass:
                    patch.status === 400 &&
                    row?.visibility === "private" &&
                    row.companyId === config.companyId,
                expectedStatus: 400,
                actualStatus: patch.status,
                persisted: row,
            };
        });

        await probe("foreign_metric_observation_rejected", async () => {
            const source = `${runId}-foreign-observation`;
            const response = await api("/api/vantage/metrics/observations", {
                method: "POST",
                data: {
                    metricId: created.foreignMetricId,
                    companyId: config.outsideCompanyId,
                    value: 1,
                    periodStart: "2026-10-12",
                    periodEnd: "2026-10-18",
                    source,
                },
            });
            const rows = await observationRows(source);
            return {
                pass: response.status === 404 && rows.length === 0,
                expectedStatus: 404,
                actualStatus: response.status,
                rowsWritten: rows.length,
                foreignMetricId: created.foreignMetricId,
            };
        });

        await probe("foreign_metric_evidence_edits_rejected", async () => {
            const metric = await api(`/api/vantage/metrics/${created.foreignMetricId}`, {
                method: "PATCH",
                data: { name: "Unauthorized probe rename" },
            });
            const evidence = await api(`/api/vantage/evidence/${created.foreignEvidenceId}`, {
                method: "PATCH",
                data: { title: "Unauthorized probe edit" },
            });
            const [metricRow] =
                await sql`SELECT id, name, company_id::text AS "companyId" FROM pdr_ai_v2_vantage_metric_definitions WHERE id=${created.foreignMetricId}`;
            const [evidenceRow] =
                await sql`SELECT id, title, company_id::text AS "companyId" FROM pdr_ai_v2_vantage_evidence WHERE id=${created.foreignEvidenceId}`;
            return {
                pass:
                    metric.status === 404 &&
                    evidence.status === 404 &&
                    metricRow?.name === "Probe outside metric" &&
                    evidenceRow?.title === "Probe outside evidence",
                metricStatus: metric.status,
                evidenceStatus: evidence.status,
                sqlReadback: { metric: metricRow, evidence: evidenceRow },
            };
        });

        await probe("request_company_override_ignored", async () => {
            const source = `${runId}-tenant-override`;
            const response = await api("/api/vantage/metrics/observations", {
                method: "POST",
                data: {
                    companyId: config.outsideCompanyId,
                    userId: accounts[2].id,
                    metricId: created.countMetric.id,
                    value: 2,
                    periodStart: "2026-10-12",
                    periodEnd: "2026-10-18",
                    source,
                },
            });
            const rows = await observationRows(source);
            return {
                pass:
                    response.status === 201 &&
                    rows.length === 1 &&
                    rows[0].companyId === config.companyId &&
                    rows[0].createdByUserId === accounts[0].id,
                actualStatus: response.status,
                attemptedCompanyId: config.outsideCompanyId,
                expectedCompanyId: config.companyId,
                sqlRows: rows,
            };
        });

        await probe("foreign_company_query_does_not_leak", async () => {
            const metrics = await api(`/api/vantage/metrics?companyId=${config.outsideCompanyId}`);
            const evidence = await api(
                `/api/vantage/evidence?companyId=${config.outsideCompanyId}`
            );
            const metricVisible =
                metrics.body?.definitions?.some(row => row.id === created.foreignMetricId) ?? false;
            const evidenceVisible =
                evidence.body?.evidence?.some(row => row.id === created.foreignEvidenceId) ?? false;
            return {
                pass:
                    metrics.status === 200 &&
                    evidence.status === 200 &&
                    !metricVisible &&
                    !evidenceVisible,
                metricsStatus: metrics.status,
                evidenceStatus: evidence.status,
                foreignMetricVisible: metricVisible,
                foreignEvidenceVisible: evidenceVisible,
            };
        });

        await probe("permission_revocation_blocks_and_restores", async () => {
            const [membership] =
                await sql`SELECT m.id, m.role, m.status FROM pdr_ai_v2_user_company_memberships m JOIN pdr_ai_v2_users u ON u.id=m.user_id WHERE u."userId"=${accounts[0].id} AND m.company_id=${config.companyId}`;
            ensure(
                membership?.role === "owner" && membership.status === "active",
                "Expected the synthetic owner's original active membership before permission probe."
            );
            const weekStart = "2026-08-03";
            const [{ count: before }] =
                await sql`SELECT count(*)::int AS count FROM pdr_ai_v2_vantage_agendas WHERE company_id=${config.companyId} AND week_start=${weekStart}`;
            let read, generation, afterCount;
            membershipRestored = false;
            try {
                await sql`UPDATE pdr_ai_v2_user_company_memberships SET role='viewer' WHERE id=${membership.id} AND company_id=${config.companyId}`;
                read = await api("/api/vantage/metrics");
                generation = await api("/api/vantage/agendas", {
                    method: "POST",
                    data: { weekStart, generationMode: "rules" },
                });
                [{ count: afterCount }] =
                    await sql`SELECT count(*)::int AS count FROM pdr_ai_v2_vantage_agendas WHERE company_id=${config.companyId} AND week_start=${weekStart}`;
            } finally {
                const restored =
                    await sql`UPDATE pdr_ai_v2_user_company_memberships SET role=${membership.role}, status=${membership.status} WHERE id=${membership.id} AND company_id=${config.companyId} RETURNING role, status`;
                membershipRestored =
                    restored.length === 1 &&
                    restored[0].role === membership.role &&
                    restored[0].status === membership.status;
            }
            const restoredAccess = await api("/api/vantage/metrics");
            return {
                pass:
                    read.status === 403 &&
                    generation.status === 403 &&
                    before === afterCount &&
                    membershipRestored &&
                    restoredAccess.status === 200,
                roleBefore: membership.role,
                roleDuringProbe: "viewer",
                readStatus: read.status,
                rulesGenerateStatus: generation.status,
                reportRowsBefore: before,
                reportRowsAfter: afterCount,
                membershipRestored,
                restoredAccessStatus: restoredAccess.status,
            };
        });
    } catch (error) {
        results.push({
            id: "probe_setup_or_global_failure",
            status: "FAIL",
            owner: "TL integration runtime",
            error: scrub(error instanceof Error ? error.message : error),
        });
    } finally {
        await sql.end({ timeout: 5 }).catch(error => {
            results.push({
                id: "database_close",
                status: "FAIL",
                owner: "TL integration runtime",
                error: scrub(error instanceof Error ? error.message : error),
            });
        });
        for (const [id, owner] of DESCRIPTORS)
            if (!results.some(result => result.id === id))
                results.push({
                    id,
                    status: "NOT_RUN",
                    owner,
                    reason: "A prerequisite or global probe setup failed; no result inferred.",
                });
        const report = {
            runId,
            completedAt: new Date().toISOString(),
            boundary:
                "Real loopback Better Auth HTTP, verified isolated PostgreSQL, additive probe-only rows; no .env, provider, original checkout, or real credentials.",
            database: {
                host: DATABASE_HOST,
                port: DATABASE_PORT,
                name: DATABASE,
                user: DATABASE_USER,
            },
            created,
            membershipRestored,
            summary: {
                pass: results.filter(row => row.status === "PASS").length,
                fail: results.filter(row => row.status === "FAIL").length,
                notRun: results.filter(row => row.status === "NOT_RUN").length,
            },
            results,
        };
        const serialized = scrub(JSON.stringify(report, null, 2) + "\n");
        const reportPath = resolve(RUNTIME_DIR, `${runId}.json`);
        writeFileSync(reportPath, serialized);
        writeFileSync(resolve(RUNTIME_DIR, "api-probes-latest.json"), serialized);
        console.log(
            JSON.stringify({ report: reportPath, summary: report.summary, membershipRestored })
        );
        process.exitCode = report.summary.fail || report.summary.notRun ? 1 : 0;
    }
}

try {
    if (process.argv[2] === "--isolated-child") await probes();
    else if (process.argv.length === 2) await runIsolatedChild();
    else throw new Error("Run node scripts/dev/vantage-integration-probes.mjs without arguments.");
} catch (error) {
    console.error(
        JSON.stringify({
            status: "FAIL",
            id: "probe_launcher",
            error: "Probe launcher or early setup failed; runtime secrets are excluded from this diagnostic.",
            code:
                typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
                    ? error.code
                    : null,
        })
    );
    process.exitCode = 1;
}

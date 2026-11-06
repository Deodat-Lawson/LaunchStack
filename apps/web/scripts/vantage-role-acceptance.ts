/** Real Better Auth + Joseph API + fixed-source role pair. Never selects model/provider/role via generation input. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIR = resolve(ROOT, "test-output/vantage-role-m2-20261106");
const APP = "http://localhost:3187";
const BASE = "/api/vantage/role-contextual";
type Json = Record<string, any>;
async function config() {
    const path = pathToFileURL(resolve(ROOT, "scripts/dev/vantage-role-runtime.mjs")).href;
    const runtime = (await import(path)) as {
        readRuntime(): { databaseUrl: string; loginPassword: string };
        assertDatabaseUrl(value: string): URL;
    };
    const value = runtime.readRuntime();
    runtime.assertDatabaseUrl(value.databaseUrl);
    assert.equal(
        process.env.DATABASE_URL,
        value.databaseUrl,
        "Sanitized role runtime environment required"
    );
    return value;
}
function digest(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function implementation() {
    return Object.fromEntries(
        [
            "apps/web/src/server/vantage/role-contextual-host.ts",
            "apps/web/src/server/vantage/role-contextual-service.ts",
            "pipelines/src/vantage/experiments/role-pair-milestone-v1.ts",
            "pipelines/src/vantage/dynamic-retrieval/retrieve.ts",
            "pipelines/src/vantage/role-context-v0/role-map.json",
        ].map(file => [
            file,
            createHash("sha256")
                .update(readFileSync(resolve(ROOT, file)))
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
        "pdr_ai_v2_event_outbox",
    ];
    const tables =
        await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ${sql(names)}`;
    const values: Json = {};
    for (const { table_name } of tables) {
        assert.ok(names.includes(table_name));
        const [row] = await sql.unsafe(
            `SELECT count(*)::int AS count,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM "${table_name}" t`
        );
        values[table_name] = row;
    }
    assert.equal(Object.keys(values).length, names.length);
    return values;
}
function assertReview(
    saved: Json,
    expected: { actor: string; at: string; topicId: string; version: number; text: string }
) {
    const topic = saved.report.topics.find((item: Json) => item.id === expected.topicId);
    assert.ok(topic?.decision);
    assert.equal(topic.decision.value, "needs-more-evidence");
    assert.equal(topic.decision.text, expected.text);
    assert.equal(topic.decision.recordedAt, expected.at);
    const audit = saved.reviews.at(-1);
    assert.ok(audit);
    assert.equal(audit.actor, expected.actor);
    assert.equal(audit.at, expected.at);
    assert.equal(audit.topicId, expected.topicId);
    assert.equal(audit.version, expected.version);
}
function consequentialOrder(saved: Json, fixture: Json) {
    const ref = (id: string) => `doc:${fixture.docs[id].id}@${fixture.docs[id].versionId}`;
    return [
        ...saved.ranking.roleMatches,
        ...saved.ranking.recentChanges,
        ...saved.ranking.unresolvedOlderItems,
    ]
        .filter((item: Json) =>
            [ref("D01"), ref("D08")].includes(
                `${item.source.kind}:${item.source.id}@${item.source.version}`
            )
        )
        .sort((a: Json, b: Json) => a.rank - b.rank)
        .map((item: Json) => (item.source.id === fixture.docs.D01.id ? "D01" : "D08"));
}
function withoutReadMeasurement(value: Json) {
    const stable = { ...value };
    delete stable.checkedAt;
    return stable;
}
function readMeasurements(saved: Json) {
    return {
        registry: saved.envelope.manifest.sourceRegistry.map((entry: Json) => ({
            source: entry.source,
            checkedAt: entry.checkedAt ?? null,
        })),
        sources: saved.sources.map((entry: Json) => ({
            source: entry.source,
            checkedAt: entry.checkedAt ?? null,
        })),
    };
}
function invariantProjection(saved: Json) {
    return {
        owner: saved.owner,
        company: saved.company,
        sourceAuthority: saved.sourceAuthority,
        sourceSetHash: saved.sourceSetHash,
        historyHash: saved.historyHash,
        actor: saved.envelope.manifest.actor,
        window: saved.envelope.manifest.reportWindow,
        roleIds: [...saved.roleSelection.roleIds].sort(),
        canonicalRoleDefinitions: [...saved.roleContext.roles].sort((a: Json, b: Json) =>
            a.roleId.localeCompare(b.roleId)
        ),
        roleContextPrincipal: saved.roleContext.authenticatedPrincipalRef,
        roleContextProvenance: saved.roleContext.provenance,
        mappingVersion: saved.roleSelection.mappingVersion,
        persistedMappingVersion: saved.roleSelection.persistedMappingVersion,
        userConfirmed: saved.roleSelection.userConfirmed,
        fallback: saved.roleSelection.fallback,
        nativeData: saved.envelope.v1Input.data,
        reviewedTopics: saved.envelope.v1Input.reviewedTopics,
        registry: saved.envelope.manifest.sourceRegistry.map(withoutReadMeasurement),
        snapshotEntries: saved.envelope.evidenceSnapshot.entries.map(withoutReadMeasurement),
        sources: saved.sources.map(withoutReadMeasurement),
        sourceFreeze: saved.envelope.freeze.sources,
        actorFreeze: saved.envelope.freeze.actorACL,
        architectureFreeze: saved.envelope.freeze.companyArchitecture,
        starsFreeze: saved.envelope.freeze.personalStars,
        companyArchitectureVersion: saved.envelope.manifest.companyArchitectureVersion,
        personalStarVersions: saved.envelope.manifest.personalStarVersions,
    };
}
async function validateSavedRolePair({
    savedFallback,
    savedA,
    savedB,
    fixture,
    reloadA,
    reloadB,
    reviewA,
    reviewB,
    resumedFrom,
}: Json) {
    const owner: Json = fixture.accounts[0];
    const ids = ["partnerships-lead", "security-engineer"];
    assert.deepEqual(savedA.report, reloadA);
    assert.deepEqual(savedB.report, reloadB);
    assertReview(savedA, {
        actor: owner.id,
        at: fixture.domainClock,
        topicId: reviewA.topicId,
        version: reloadA.version,
        text: reviewA.decision.text,
    });
    assertReview(savedB, {
        actor: owner.id,
        at: fixture.domainClock,
        topicId: reviewB.topicId,
        version: reloadB.version,
        text: reviewB.decision.text,
    });
    const { roleMilestoneOutputSize } = await import(
        "../../../pipelines/src/vantage/experiments/role-pair-milestone-v1"
    );
    const { normalizeGenerationV2 } = await import(
        "../../../pipelines/src/vantage/validate-generation-v2"
    );
    const generationMetrics = [];
    for (const savedReport of [savedFallback, savedA, savedB]) {
        const audit = savedReport.generationAudit;
        assert.ok(audit, "Actual persisted generation audit required");
        assert.equal(audit.invocations, 1);
        assert.equal(audit.transportProfile, "role-pair-m2");
        const isLegacyNeutral = resumedFrom && savedReport.report.id === savedFallback.report.id;
        const frameMessage = audit.promptMessages.find(
            (message: Json) =>
                message.type === "system" &&
                typeof message.content === "string" &&
                message.content.startsWith("M2 trustedPrimary=")
        );
        if (!isLegacyNeutral)
            assert.ok(
                frameMessage,
                "Actual prepared wire must contain a marked trusted-primary snapshot"
            );
        const primaryFrame = frameMessage
            ? JSON.parse(frameMessage.content.split("\n")[0].slice("M2 trustedPrimary=".length))
            : null;
        const primary = savedReport.roleContext.roles.find(
            (role: Json) => role.roleId === savedReport.roleContext.primaryRoleId
        );
        if (!isLegacyNeutral && savedReport.roleSelection.fallback)
            assert.deepEqual(primaryFrame, {
                primaryRoleId: null,
                mappingVersion: savedReport.roleContext.mappingVersion,
                fallback: true,
                responsibilities: [],
                priorities: [],
            });
        else if (!isLegacyNeutral)
            assert.deepEqual(primaryFrame, {
                primaryRoleId: primary.roleId,
                mappingVersion: savedReport.roleContext.mappingVersion,
                description: primary.description,
                responsibilities: primary.responsibilities,
                priorities: primary.priorities,
            });
        assert.ok(audit.suppliedPromptMessages.length > 0);
        assert.equal(audit.attempts.length, 1);
        assert.deepEqual(audit.attempts[0].issues, []);
        assert.ok(audit.attempts[0].promptBytes > 0 && audit.attempts[0].promptBytes <= 23500);
        assert.ok(audit.outputSize.outputTokens <= 2400);
        assert.equal(audit.outputSize.outputTokenCap, 2400);
        assert.deepEqual(roleMilestoneOutputSize(audit.compound), audit.outputSize);
        assert.ok(audit.promptMessages.length > 0);
        assert.equal(
            Buffer.byteLength(
                JSON.stringify(audit.promptMessages.map((message: Json) => message.content))
            ),
            audit.attempts[0].promptBytes
        );
        const normalized = normalizeGenerationV2(audit.compound, savedReport.envelope).report;
        assert.deepEqual(
            {
                summary: savedReport.report.summary,
                headline: savedReport.report.headline,
                brief: savedReport.report.brief,
                keyFigures: savedReport.report.keyFigures,
                topics: savedReport.report.topics.map(
                    ({ id: _id, status: _status, decision: _decision, ...topic }: Json) => topic
                ),
                origin: "ai",
                enhancements: [],
            },
            normalized
        );
        assert.equal(
            audit.priorityPlan.persona,
            savedReport.roleSelection.fallback ? "neutral" : "mapped"
        );
        generationMetrics.push({
            reportId: savedReport.report.id,
            primary: savedReport.roleSelection.primaryRoleId ?? null,
            persona: audit.priorityPlan.persona,
            promptBytes: audit.attempts[0].promptBytes,
            proxyOutputTokens: audit.outputSize.outputTokens,
            tokenizer: "js-tiktoken/o200k_base",
            providerMappingVerified: false,
            invocations: audit.invocations,
            trustedPrimaryWireStatus: isLegacyNeutral
                ? "pre-fix-neutral-control-retained"
                : "exact-canonical-snapshot-verified",
        });
    }
    const projectionA = invariantProjection(savedA),
        projectionB = invariantProjection(savedB);
    assert.deepEqual(
        projectionA,
        projectionB,
        "Only primary/revision/run-context may differ; authorized data/history/control sources must match exactly"
    );
    assert.equal(savedA.envelope.evidenceSnapshot.entries.length, 11);
    assert.equal(savedB.envelope.evidenceSnapshot.entries.length, 11);
    assert.equal(savedFallback.envelope.evidenceSnapshot.entries.length, 11);
    assert.deepEqual(consequentialOrder(savedA, fixture), ["D01", "D08"]);
    assert.deepEqual(consequentialOrder(savedB, fixture), ["D08", "D01"]);
    assert.equal(savedA.roleContext.primaryRoleId, ids[0]);
    assert.equal(savedB.roleContext.primaryRoleId, ids[1]);
    assert.equal(savedFallback.roleContext.userConfirmed, false);
    assert.equal(savedA.envelope.manifest.reportWindow.asOf, fixture.domainClock);
    assert.deepEqual(savedA.envelope.manifest.reportWindow, savedB.envelope.manifest.reportWindow);
    for (const savedReport of [savedA, savedB])
        for (const [logicalKey, doc] of Object.entries<Json>(fixture.docs)) {
            const entry = savedReport.envelope.evidenceSnapshot.entries.find(
                (item: Json) =>
                    item.source.kind === "doc" &&
                    String(item.source.id) === String(doc.id) &&
                    String(item.source.version) === String(doc.versionId)
            );
            assert.ok(entry, logicalKey);
            assert.equal(entry.excerpt, doc.text);
            assert.equal(entry.contentHash, doc.hash);
        }
    return {
        generationMetrics,
        projectionA,
        projectionB,
        checkedAtMeasurements: { A: readMeasurements(savedA), B: readMeasurements(savedB) },
    };
}

export async function runRoleHttpAcceptance(options: { resumeArtifact?: string } = {}) {
    const runtime = await config();
    const fixture = JSON.parse(readFileSync(resolve(DIR, "role-fixture.json"), "utf8")) as Json;
    let resumedFrom: Json | null = null;
    if (options.resumeArtifact) {
        assert.match(options.resumeArtifact, /^acceptance-http-failed-\d+\.json$/);
        const raw = readFileSync(resolve(DIR, options.resumeArtifact), "utf8");
        const prior = JSON.parse(raw) as Json;
        const unknown = prior.trace.find(
            (entry: Json) => entry.label === "initial-unknown-profile" && entry.status === 200
        )?.body;
        const neutral = prior.trace.find(
            (entry: Json) =>
                entry.label === "generate-real-unconfirmed-neutral" && entry.status === 200
        )?.body.report;
        assert.equal(unknown?.roles.userConfirmed, false);
        assert.equal(unknown.roles.fallback, true);
        assert.ok(neutral?.id);
        resumedFrom = {
            artifact: options.resumeArtifact,
            sha256: createHash("sha256").update(raw).digest("hex"),
            unknownProfileControl: unknown,
            neutralReportId: neutral.id,
            priorTrace: prior.trace,
            priorFailure: prior.error,
            policy: "Preserve all prior rows; reselect actual Joseph primary to create a new pair under fresh context revisions.",
        };
    }
    const sql = postgres(runtime.databaseUrl, { max: 1 });
    const trace: Json[] = [];
    const cookies = new Map<string, string>();
    const [owner, peer, outsider] = fixture.accounts as Json[];
    const ids = ["partnerships-lead", "security-engineer"];
    async function request(
        label: string,
        method: string,
        path: string,
        actor?: string,
        body?: unknown
    ) {
        const url = new URL(path, APP);
        assert.equal(url.origin, APP);
        const response = await fetch(url, {
            method,
            redirect: "manual",
            headers: {
                origin: APP,
                ...(body === undefined ? {} : { "content-type": "application/json" }),
                ...(actor && cookies.has(actor) ? { cookie: cookies.get(actor)! } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        let data: Json;
        try {
            data = JSON.parse(text);
        } catch {
            data = { nonJson: text.slice(0, 160) };
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
    function status(result: { status: number; data: Json }, expected: number) {
        assert.equal(result.status, expected, JSON.stringify(result.data));
        return result.data;
    }
    function boundary(result: { status: number; data: Json }, expected: number, code: string) {
        status(result, expected);
        assert.equal(result.data.code, code);
    }
    async function signin(account: Json) {
        const result = await request(
            `signin-${account.userPk}`,
            "POST",
            "/api/auth/sign-in/email",
            undefined,
            { email: account.email, password: runtime.loginPassword }
        );
        status(result, 200);
        assert.equal(result.data.user.id, account.id);
        const values = result.response.headers.getSetCookie();
        assert.ok(values.length);
        cookies.set(account.id, values.map(value => value.split(";")[0]).join("; "));
    }
    async function reportSnapshot() {
        return [
            ...(await sql`SELECT id::text,version,context_key,md5(ciphertext) AS hash FROM pdr_ai_v2_vantage_role_contextual_runs ORDER BY id`),
        ];
    }
    async function membership() {
        const [row] =
            await sql`SELECT business_context_v0,vantage_context_revision FROM pdr_ai_v2_user_company_memberships WHERE company_id=${fixture.companyId} AND user_id=${owner!.userPk}`;
        return row;
    }
    const nativeBefore = await nativeSnapshot(sql);
    const initialReports = await reportSnapshot();
    const initialMembership = await membership();
    try {
        status(await request("unauthenticated-denied", "GET", BASE), 401);
        await signin(owner!);
        await signin(peer!);
        await signin(outsider!);
        let personal = status(
            await request(
                resumedFrom ? "current-profile-before-resumed-pair" : "initial-unknown-profile",
                "GET",
                BASE + "/personal",
                owner!.id
            ),
            200
        );
        if (!resumedFrom) {
            assert.equal(personal.roles.userConfirmed, false);
            assert.equal(personal.roles.fallback, true);
            assert.equal(
                initialReports.length,
                0,
                "Initial neutral control must run before mapped reports"
            );
        }
        const arch = status(
            await request("architecture-read", "GET", BASE + "/architecture", owner!.id),
            200
        );
        assert.equal(arch.available, true);
        if (arch.state === "unreviewed")
            status(
                await request("architecture-review", "POST", BASE + "/architecture", owner!.id, {
                    expectedRevision: arch.revision,
                    expectedProjectionFingerprint: arch.projectionFingerprint,
                    state: "unknowns-marked",
                }),
                200
            );
        const fallback = resumedFrom
            ? status(
                  await request(
                      "reload-original-real-unconfirmed-neutral",
                      "GET",
                      `${BASE}/reports/${resumedFrom.neutralReportId}`,
                      owner!.id
                  ),
                  200
              ).report
            : status(
                  await request("generate-real-unconfirmed-neutral", "POST", BASE, owner!.id, {}),
                  200
              ).report;
        assert.ok(fallback);
        assert.equal(fallback.roleSelection.fallback, true);
        assert.equal(fallback.roleSelection.userConfirmed, false);
        assert.equal(fallback.topics.length, 2);
        assert.match(fallback.headline, /confirming business responsibilities/);
        async function canaryChecks(label: string, reportId: string, view: Json) {
            assert.ok(
                fixture.canaries && Object.keys(fixture.canaries).length >= 2,
                "Real private/outside canary fixtures required"
            );
            for (const [name, doc] of Object.entries<Json>(fixture.canaries)) {
                assert.ok(
                    !view.documents.some((entry: Json) => String(entry.id) === String(doc.id)),
                    `Unauthorized ${name} canary appeared in actual document-scope listing`
                );
                boundary(
                    await request(
                        `${label}-${name}-source-denied`,
                        "GET",
                        `${BASE}/reports/${reportId}/source?${new URLSearchParams({ kind: "doc", id: doc.id, version: doc.versionId })}`,
                        owner!.id
                    ),
                    404,
                    "not_found"
                );
            }
        }
        await canaryChecks(
            resumedFrom ? "before-fresh-primary-trial" : "before-mapped-role",
            fallback.id,
            personal
        );
        const unchanged = await membership();
        status(
            await request("unknown-role-patch400", "PATCH", BASE + "/personal", owner!.id, {
                expectedRevision: personal.state.revision,
                roleIds: ["unknown-role", "security-engineer"],
                primaryRoleId: "unknown-role",
            }),
            400
        );
        assert.deepEqual(await membership(), unchanged);
        const spoofBefore = await reportSnapshot();
        status(
            await request("generation-role-field-spoof400", "POST", BASE, owner!.id, {
                roleIds: ids,
                primaryRoleId: "security-engineer",
                roleContext: { primaryRoleId: "security-engineer" },
            }),
            400
        );
        assert.deepEqual(await reportSnapshot(), spoofBefore);
        assert.deepEqual(await membership(), unchanged);
        personal = status(
            await request(
                "confirm-both-primary-partnerships",
                "PATCH",
                BASE + "/personal",
                owner!.id,
                { expectedRevision: personal.state.revision, roleIds: ids, primaryRoleId: ids[0] }
            ),
            200
        );
        assert.equal(personal.roles.primaryRoleId, ids[0]);
        assert.equal(personal.roles.userConfirmed, true);
        assert.equal(personal.roles.fallback, false);
        const A = status(
            await request("generate-primary-partnerships", "POST", BASE, owner!.id, {}),
            200
        ).report;
        assert.ok(A);
        assert.equal(A.roleSelection.primaryRoleId, ids[0]);
        assert.match(A.topics[0].title, /pitch/i);
        assert.ok(A.topics.some((topic: Json) => /access review/i.test(topic.title)));
        const beforeReviewA = A.version;
        const reviewA = {
            topicId: A.topics[0].id,
            expectedVersion: A.version,
            decision: {
                value: "needs-more-evidence",
                text: "Confirm the invitation and unfinished slides before deciding.",
            },
        };
        const concurrent = await Promise.all([
            request(
                "review-A-concurrent-a",
                "PATCH",
                `${BASE}/reports/${A.id}`,
                owner!.id,
                reviewA
            ),
            request(
                "review-A-concurrent-b",
                "PATCH",
                `${BASE}/reports/${A.id}`,
                owner!.id,
                reviewA
            ),
        ]);
        assert.deepEqual(concurrent.map(item => item.status).sort(), [200, 409]);
        assert.equal(concurrent.find(item => item.status === 409)!.data.code, "stale_review");
        boundary(
            await request(
                "stale-A-review409",
                "PATCH",
                `${BASE}/reports/${A.id}`,
                owner!.id,
                reviewA
            ),
            409,
            "stale_review"
        );
        const reviewedA = status(
            await request("reload-reviewed-A", "GET", `${BASE}/reports/${A.id}`, owner!.id),
            200
        ).report;
        assert.equal(reviewedA.version, beforeReviewA + 1);
        const personalA = personal;
        personal = status(
            await request("same-both-primary-security", "PATCH", BASE + "/personal", owner!.id, {
                expectedRevision: personal.state.revision,
                roleIds: ids,
                primaryRoleId: ids[1],
            }),
            200
        );
        assert.equal(personal.roles.primaryRoleId, ids[1]);
        assert.deepEqual([...personal.roles.roleIds].sort(), [...personalA.roles.roleIds].sort());
        const B = status(
            await request("generate-primary-security", "POST", BASE, owner!.id, {}),
            200
        ).report;
        assert.ok(B);
        assert.equal(B.roleSelection.primaryRoleId, ids[1]);
        assert.match(B.topics[0].title, /access review/i);
        assert.ok(B.topics.some((topic: Json) => /pitch/i.test(topic.title)));
        assert.notEqual(A.id, B.id);
        const reviewB = {
            topicId: B.topics[0].id,
            expectedVersion: B.version,
            decision: {
                value: "needs-more-evidence",
                text: "Confirm review completion evidence and final sign-off before deciding.",
            },
        };
        const reviewedB = status(
            await request("review-B", "PATCH", `${BASE}/reports/${B.id}`, owner!.id, reviewB),
            200
        ).report;
        assert.equal(reviewedB.version, B.version + 1);
        await canaryChecks("after-primary-change", B.id, personal);
        for (const report of [A, B]) {
            const outside = status(
                await request(
                    `outside-company-denied-${report.id}`,
                    "GET",
                    `${BASE}/reports/${report.id}`,
                    outsider!.id
                ),
                403
            );
            assert.equal(outside.error, "Vantage access denied.");
            boundary(
                await request(
                    `peer-private-report-denied-${report.id}`,
                    "GET",
                    `${BASE}/reports/${report.id}`,
                    peer!.id
                ),
                404,
                "not_found"
            );
            for (const logicalKey of ["D01", "D08"]) {
                const doc = fixture.docs[logicalKey];
                const opened = status(
                    await request(
                        `open-${report.id}-${logicalKey}`,
                        "GET",
                        `${BASE}/reports/${report.id}/source?${new URLSearchParams({ kind: "doc", id: doc.id, version: doc.versionId })}`,
                        owner!.id
                    ),
                    200
                );
                assert.equal(opened.body, doc.text);
                assert.equal(opened.contentHash, doc.hash);
            }
        }
        const reloadA = status(
            await request("old-A-reloads-after-B", "GET", `${BASE}/reports/${A.id}`, owner!.id),
            200
        ).report;
        const reloadB = status(
            await request("B-reloads-current", "GET", `${BASE}/reports/${B.id}`, owner!.id),
            200
        ).report;
        assert.equal(reloadA.id, A.id);
        assert.equal(reloadA.roleSelection.primaryRoleId, ids[0]);
        assert.equal(reloadB.roleSelection.primaryRoleId, ids[1]);
        const { configureSecretBox, decryptSecret } = await import("@launchstack/store/crypto");
        configureSecretBox({ key: process.env.EMBEDDING_SECRETS_KEY });
        async function saved(id: string) {
            const [row] =
                await sql`SELECT ciphertext FROM pdr_ai_v2_vantage_role_contextual_runs WHERE id=${id}::uuid AND company_id=${fixture.companyId} AND owner_user_id=${owner!.userPk}`;
            assert.ok(row);
            return JSON.parse(decryptSecret(row.ciphertext)) as Json;
        }
        const savedFallback = await saved(fallback.id),
            savedA = await saved(A.id),
            savedB = await saved(B.id);
        const { generationMetrics, projectionA, checkedAtMeasurements } =
            await validateSavedRolePair({
                savedFallback,
                savedA,
                savedB,
                fixture,
                reloadA,
                reloadB,
                reviewA,
                reviewB,
                resumedFrom,
            });
        const nativeAfter = await nativeSnapshot(sql);
        assert.deepEqual(nativeAfter, nativeBefore);
        const evidence = {
            kind: "real-authenticated-joseph-primary-role-pair-postgresql",
            passed: true,
            at: new Date().toISOString(),
            implementation: implementation(),
            domainClock: fixture.domainClock,
            trace,
            initialMembership,
            resumedFrom,
            finalMembership: await membership(),
            initialReports,
            finalReports: await reportSnapshot(),
            savedFallback,
            savedA,
            savedB,
            generationMetrics,
            sourceEquivalence: {
                equal: true,
                checkedAtMeasurements,
                projection: projectionA,
                digest: digest(projectionA),
                allowedDifferences: [
                    "source checkedAt read-measurement time only (all raw values retained separately)",
                    "trusted primaryRoleId",
                    "role preference revision",
                    "primary-first role array order",
                    "run/context fingerprints and generated topic order",
                ],
            },
            ranking: {
                A: consequentialOrder(savedA, fixture),
                B: consequentialOrder(savedB, fixture),
            },
            nativeBefore,
            nativeAfter,
            limitations: [
                "Auth is real Better Auth over loopback HTTP; subsequent direct controls label their synthetic identity wrapper.",
                "Outside-company HTTP denial occurs at the outer isolated workspace gate.",
                "Deterministic authored replay and manual checklist do not measure model quality.",
            ],
        };
        const output = resolve(DIR, `acceptance-http-${Date.now()}.json`);
        writeFileSync(output, JSON.stringify(evidence, null, 2), { flag: "wx" });
        return {
            output,
            checks: trace.length,
            reportIds: { fallback: fallback.id, A: A.id, B: B.id },
            sourceEquivalenceDigest: digest(projectionA),
        };
    } catch (error) {
        const output = resolve(DIR, `acceptance-http-failed-${Date.now()}.json`);
        writeFileSync(
            output,
            JSON.stringify(
                {
                    passed: false,
                    implementation: implementation(),
                    at: new Date().toISOString(),
                    error: {
                        message: error instanceof Error ? error.message : String(error),
                        code: (error as Json).code,
                    },
                    trace,
                    initialMembership,
                    initialReports,
                    nativeBefore,
                    resumedFrom,
                    currentReports: await reportSnapshot(),
                    membership: await membership(),
                },
                null,
                2
            ),
            { flag: "wx" }
        );
        throw error;
    } finally {
        await sql.end({ timeout: 5 });
    }
}
/** Completes assertions for a preserved real HTTP trial; only authentication and GET/SELECT operations run here. */
export async function completeCapturedRoleTrial(name: string) {
    assert.match(name, /^acceptance-http-failed-\d+\.json$/);
    const raw = readFileSync(resolve(DIR, name), "utf8");
    const captured = JSON.parse(raw) as Json;
    assert.ok(
        captured.error.message.includes("checkedAt") && captured.nativeBefore,
        "Only complete the captured known read-measurement assertion failure"
    );
    const fixture = JSON.parse(readFileSync(resolve(DIR, "role-fixture.json"), "utf8")) as Json;
    const runtime = await config();
    const sql = postgres(runtime.databaseUrl, { max: 1 });
    const trace: Json[] = [];
    const cookies = new Map<string, string>();
    const [owner, peer, outsider] = fixture.accounts as Json[];
    const prior = (label: string) => {
        const entry = captured.trace.find((item: Json) => item.label === label);
        assert.ok(entry, label);
        return entry;
    };
    const A = prior("generate-primary-partnerships").body.report,
        B = prior("generate-primary-security").body.report;
    assert.equal(prior("generate-primary-partnerships").status, 200);
    assert.equal(prior("generate-primary-security").status, 200);
    assert.equal(prior("unknown-role-patch400").status, 400);
    assert.equal(prior("generation-role-field-spoof400").status, 400);
    const original = captured.resumedFrom;
    assert.ok(original?.unknownProfileControl && original?.neutralReportId);
    assert.equal(original.unknownProfileControl.roles.userConfirmed, false);
    assert.equal(original.unknownProfileControl.roles.fallback, true);
    const originalRaw = readFileSync(resolve(DIR, original.artifact), "utf8");
    assert.equal(createHash("sha256").update(originalRaw).digest("hex"), original.sha256);
    async function reports() {
        return [
            ...(await sql`SELECT id::text,version,context_key,md5(ciphertext) AS hash FROM pdr_ai_v2_vantage_role_contextual_runs ORDER BY id`),
        ];
    }
    async function membership() {
        const [row] =
            await sql`SELECT business_context_v0,vantage_context_revision FROM pdr_ai_v2_user_company_memberships WHERE company_id=${fixture.companyId} AND user_id=${owner!.userPk}`;
        return row;
    }
    async function request(
        label: string,
        path: string,
        actor: string,
        signin = false,
        body?: unknown
    ) {
        const url = new URL(path, APP);
        assert.equal(url.origin, APP);
        const response = await fetch(url, {
            method: signin ? "POST" : "GET",
            redirect: "manual",
            headers: {
                origin: APP,
                ...(signin ? { "content-type": "application/json" } : {}),
                ...(cookies.has(actor) ? { cookie: cookies.get(actor)! } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const data = (await response.json()) as Json;
        trace.push({
            label,
            method: signin ? "POST" : "GET",
            path: url.pathname + url.search,
            status: response.status,
            body: signin ? { user: { id: data.user?.id, email: data.user?.email } } : data,
        });
        return { response, data };
    }
    try {
        const before = await reports();
        assert.deepEqual(before, captured.currentReports);
        assert.deepEqual(await membership(), captured.membership);
        for (const account of [owner!, peer!, outsider!]) {
            const result = await request(
                "continuation-signin-" + account.userPk,
                "/api/auth/sign-in/email",
                account.id,
                true,
                { email: account.email, password: runtime.loginPassword }
            );
            assert.equal(result.response.status, 200);
            assert.equal(result.data.user.id, account.id);
            const values = result.response.headers.getSetCookie();
            assert.ok(values.length);
            cookies.set(account.id, values.map(value => value.split(";")[0]).join("; "));
        }
        const load = async (id: string) => {
            const result = await request(
                "continuation-report-" + id,
                `${BASE}/reports/${id}`,
                owner!.id
            );
            assert.equal(result.response.status, 200);
            return result.data.report;
        };
        const reloadA = await load(A.id),
            reloadB = await load(B.id);
        await load(original.neutralReportId);
        const personal = await request(
            "continuation-personal-scope",
            BASE + "/personal",
            owner!.id
        );
        assert.equal(personal.response.status, 200);
        assert.equal(personal.data.roles.primaryRoleId, "security-engineer");
        for (const report of [A, B]) {
            for (const logicalKey of ["D01", "D08"]) {
                const doc = fixture.docs[logicalKey];
                const result = await request(
                    `continuation-open-${report.id}-${logicalKey}`,
                    `${BASE}/reports/${report.id}/source?${new URLSearchParams({ kind: "doc", id: doc.id, version: doc.versionId })}`,
                    owner!.id
                );
                assert.equal(result.response.status, 200);
                assert.equal(result.data.body, doc.text);
                assert.equal(result.data.contentHash, doc.hash);
            }
            for (const [canary, doc] of Object.entries<Json>(fixture.canaries)) {
                assert.ok(
                    !personal.data.documents.some(
                        (entry: Json) => String(entry.id) === String(doc.id)
                    )
                );
                const result = await request(
                    `continuation-${canary}-denied-${report.id}`,
                    `${BASE}/reports/${report.id}/source?${new URLSearchParams({ kind: "doc", id: doc.id, version: doc.versionId })}`,
                    owner!.id
                );
                assert.equal(result.response.status, 404);
                assert.equal(result.data.code, "not_found");
            }
            const peerDenied = await request(
                "continuation-peer-denied-" + report.id,
                `${BASE}/reports/${report.id}`,
                peer!.id
            );
            assert.equal(peerDenied.response.status, 404);
            assert.equal(peerDenied.data.code, "not_found");
            const outsiderDenied = await request(
                "continuation-outside-denied-" + report.id,
                `${BASE}/reports/${report.id}`,
                outsider!.id
            );
            assert.equal(outsiderDenied.response.status, 403);
            assert.equal(outsiderDenied.data.error, "Vantage access denied.");
        }
        const { configureSecretBox, decryptSecret } = await import("@launchstack/store/crypto");
        configureSecretBox({ key: process.env.EMBEDDING_SECRETS_KEY });
        const saved = async (id: string) => {
            const [row] =
                await sql`SELECT ciphertext FROM pdr_ai_v2_vantage_role_contextual_runs WHERE id=${id}::uuid AND company_id=${fixture.companyId} AND owner_user_id=${owner!.userPk}`;
            assert.ok(row);
            return JSON.parse(decryptSecret(row.ciphertext)) as Json;
        };
        const savedFallback = await saved(original.neutralReportId),
            savedA = await saved(A.id),
            savedB = await saved(B.id);
        const reviewA = {
                topicId: A.topics[0].id,
                decision: { text: "Confirm the invitation and unfinished slides before deciding." },
            },
            reviewB = {
                topicId: B.topics[0].id,
                decision: {
                    text: "Confirm review completion evidence and final sign-off before deciding.",
                },
            };
        const proof = await validateSavedRolePair({
            savedFallback,
            savedA,
            savedB,
            fixture,
            reloadA,
            reloadB,
            reviewA,
            reviewB,
            resumedFrom: original,
        });
        const nativeAfter = await nativeSnapshot(sql);
        assert.deepEqual(nativeAfter, captured.nativeBefore);
        assert.deepEqual(await reports(), before);
        assert.deepEqual(await membership(), captured.membership);
        const output = resolve(DIR, `acceptance-http-${Date.now()}.json`);
        writeFileSync(
            output,
            JSON.stringify(
                {
                    kind: "real-authenticated-primary-role-pair-with-read-only-assertion-continuation",
                    passed: true,
                    at: new Date().toISOString(),
                    implementation: implementation(),
                    domainMutationsInContinuation: false,
                    continuedFrom: {
                        artifact: name,
                        sha256: createHash("sha256").update(raw).digest("hex"),
                        knownAssertionCorrection:
                            "Project only operational checkedAt read measurement; preserve all other fields and every raw value.",
                    },
                    initialNeutralLineage: original,
                    trace: [...captured.trace, ...trace],
                    initialMembership: captured.initialMembership,
                    finalMembership: await membership(),
                    initialReports: captured.initialReports,
                    finalReports: await reports(),
                    savedFallback,
                    savedA,
                    savedB,
                    generationMetrics: proof.generationMetrics,
                    sourceEquivalence: {
                        equal: true,
                        projection: proof.projectionA,
                        digest: digest(proof.projectionA),
                        checkedAtMeasurements: proof.checkedAtMeasurements,
                        excludedField:
                            "checkedAt only on source records/registry/snapshot (read measurement)",
                        allowedRoleDifferences: [
                            "trusted primary",
                            "preference revision",
                            "primary-first ordering",
                            "run/context provenance",
                        ],
                    },
                    ranking: {
                        A: consequentialOrder(savedA, fixture),
                        B: consequentialOrder(savedB, fixture),
                    },
                    nativeBefore: captured.nativeBefore,
                    nativeAfter,
                    limitations: [
                        "Initial neutral control retains its honest pre-full-role-wire transport revision.",
                        "Outer workspace gate denies the outside company; peer canaries additionally use actual document-scope listing and source denial.",
                        "Auth is actual Better Auth; deterministic replay is not model quality evidence.",
                    ],
                },
                null,
                2
            ),
            { flag: "wx" }
        );
        return {
            output,
            checks: captured.trace.length + trace.length,
            reportIds: { fallback: savedFallback.report.id, A: A.id, B: B.id },
            generationMetrics: proof.generationMetrics,
            sourceEquivalenceDigest: digest(proof.projectionA),
        };
    } finally {
        await sql.end({ timeout: 5 });
    }
}
/** Offline transport projection over actual previously saved frozen envelopes; no auth or new generation-quality claim. */
export async function projectPersistedRoleWire() {
    const runtime = await config();
    const sql = postgres(runtime.databaseUrl, { max: 1 });
    try {
        const { configureSecretBox, decryptSecret } = await import("@launchstack/store/crypto");
        configureSecretBox({ key: process.env.EMBEDDING_SECRETS_KEY });
        const { runRoleMilestoneGeneration } = await import(
            "../../../pipelines/src/vantage/experiments/role-pair-milestone-v1"
        );
        const rows =
            await sql`SELECT id::text,ciphertext FROM pdr_ai_v2_vantage_role_contextual_runs ORDER BY created_at,id`;
        assert.ok(rows.length >= 3);
        const metrics = [];
        for (const row of rows) {
            const saved = JSON.parse(decryptSecret(row.ciphertext)) as Json;
            const refs = Object.fromEntries(
                Object.entries<Json>(
                    JSON.parse(readFileSync(resolve(DIR, "role-fixture.json"), "utf8")).docs
                ).map(([logicalKey, doc]) => [
                    logicalKey,
                    { kind: "doc", id: doc.id, version: doc.versionId },
                ])
            );
            const result = await runRoleMilestoneGeneration({
                envelope: saved.envelope,
                sourceRefs: refs as Parameters<typeof runRoleMilestoneGeneration>[0]["sourceRefs"],
                roleContext: saved.roleContext,
                ranking: saved.ranking,
            });
            const metric = {
                reportId: row.id,
                primary: saved.roleContext.primaryRoleId ?? null,
                outcome: result.outcome,
                promptBytes: result.attempts[0]?.promptBytes,
                setup: "setup" in result ? result.setup : undefined,
                invocations: result.trace.invocations,
                sourceCount: saved.envelope.evidenceSnapshot.entries.length,
            };
            metrics.push(metric);
            assert.equal(result.outcome, "v2-first-pass", JSON.stringify(metric));
            assert.equal(
                Buffer.byteLength(
                    JSON.stringify(result.trace.promptMessages.map(message => message.content))
                ),
                result.attempts[0]!.promptBytes
            );
        }
        const output = resolve(DIR, `wire-projection-${Date.now()}.json`);
        writeFileSync(
            output,
            JSON.stringify(
                {
                    kind: "offline-transport-projection-of-actual-saved-envelopes",
                    at: new Date().toISOString(),
                    implementation: implementation(),
                    passed: true,
                    domainMutations: false,
                    metrics,
                },
                null,
                2
            ),
            { flag: "wx" }
        );
        return { output, checks: metrics.length, metrics };
    } finally {
        await sql.end({ timeout: 5 });
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    (process.argv.some(arg => arg.startsWith("--complete-captured-http="))
        ? completeCapturedRoleTrial(
              process.argv.find(arg => arg.startsWith("--complete-captured-http="))!.split("=")[1]!
          )
        : process.argv.includes("--project-saved-wire")
          ? projectPersistedRoleWire()
          : runRoleHttpAcceptance({
                resumeArtifact: process.argv
                    .find(arg => arg.startsWith("--resume-http="))
                    ?.split("=")[1],
            })
    )
        .then(value => {
            console.log(JSON.stringify(value));
            process.exit(0);
        })
        .catch(error => {
            console.error(
                error instanceof Error
                    ? `${error.message} code=${(error as Json).code ?? "unknown"}`
                    : "Role acceptance failed"
            );
            process.exit(1);
        });
}

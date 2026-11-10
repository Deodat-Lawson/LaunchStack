import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { configureSecretBox, decryptSecret, encryptSecret } from "@launchstack/store/crypto";
import {
    reviewFingerprint,
    runWeeklyReviewV21,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import {
    RATED_CRITERIA,
    type ValidationJudge,
} from "@launchstack/pipelines/vantage/weekly-review-validation";
import { createWeeklyReviewAuthority } from "~/server/vantage/weekly-review-authority";
import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
import type { WeeklyReviewDatabase } from "~/server/vantage/weekly-review-types";

// This test creates synthetic rows in the named database only. It requires the
// official engine and product migrations, and never contacts a provider.
const databaseUrl = process.env.VANTAGE_BUDGET_TEST_DATABASE_URL;
const expectedDatabase = "/vantage_budget_internal_v1_20261109";
function checkedUrl(): string {
    if (!databaseUrl) throw new Error("VANTAGE_BUDGET_TEST_DATABASE_URL is required");
    const url = new URL(databaseUrl);
    if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.port !== "55569" ||
        url.pathname !== expectedDatabase
    )
        throw new Error("Refusing non-owned synthetic database");
    return databaseUrl;
}

describe("internal budget retrieval against official PostgreSQL schema", () => {
    it("uses eligible historical versions, excludes denied tenants and bounds chunk acquisition", async () => {
        const sql = postgres(checkedUrl(), { max: 2, idle_timeout: 1 });
        const database: WeeklyReviewDatabase = {
            transaction: work =>
                sql.begin(async tx =>
                    work(
                        async (text, params = []) =>
                            [...(await tx.unsafe(text, params as never[]))] as Record<
                                string,
                                unknown
                            >[]
                    )
                ) as unknown as ReturnType<typeof work>,
        };
        try {
            const company = (
                await sql`INSERT INTO pdr_ai_v2_company(name,"numberOfEmployees") VALUES ('budget synthetic', '1') RETURNING id`
            )[0]!.id;
            const otherCompany = (
                await sql`INSERT INTO pdr_ai_v2_company(name,"numberOfEmployees") VALUES ('other synthetic', '1') RETURNING id`
            )[0]!.id;
            const addDocument = async (
                companyId: string,
                title: string,
                category: string,
                body: string,
                created = "2026-10-20T00:00:00Z",
                updated = "2026-10-20T00:00:00Z"
            ) => {
                const id = (
                    await sql`INSERT INTO pdr_ai_v2_document(url,category,title,company_id,created_at,updated_at) VALUES ('synthetic',${category},${title},${companyId},${created},${updated}) RETURNING id`
                )[0]!.id;
                const version = (
                    await sql`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,created_at) VALUES (${id},1,'synthetic','text/plain',${created}) RETURNING id`
                )[0]!.id;
                await sql`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,page_number,line_start) VALUES (${id},${version},${body},1,1)`;
                return { id: String(id), version: String(version) };
            };
            const architecture = await addDocument(
                company,
                "Architecture",
                "Shared",
                "Architecture evidence"
            );
            const old = await addDocument(
                company,
                "Older evidence",
                "Shared",
                "Eligible older evidence",
                "2026-10-19T00:00:00Z",
                "2026-11-20T00:00:00Z"
            );
            const denied = await addDocument(
                company,
                "Secret title",
                "Denied",
                "SECRET DENIED CONTENT"
            );
            const foreign = await addDocument(
                otherCompany,
                "Foreign title",
                "Shared",
                "SECRET FOREIGN CONTENT"
            );
            const bulky = await addDocument(
                company,
                "Bulky optional",
                "Shared",
                "first chunk",
                "2026-10-01T00:00:00Z",
                "2026-10-01T00:00:00Z"
            );
            await sql`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,page_number,line_start) SELECT ${bulky.id},${bulky.version},repeat('x',1000),1,n FROM generate_series(2,130) n`;
            const futureOnly: string[] = [];
            for (let index = 0; index < 22; index++) {
                const item = await addDocument(
                    company,
                    `Future ${index}`,
                    "Shared",
                    "not yet eligible",
                    "2026-11-10T00:00:00Z",
                    "2026-12-01T00:00:00Z"
                );
                futureOnly.push(item.id);
            }
            const futureVersion = (
                await sql`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,created_at) VALUES (${old.id},2,'future','text/plain','2026-11-02') RETURNING id`
            )[0]!.id;
            await sql`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,page_number,line_start) VALUES (${old.id},${futureVersion},'FUTURE CONTENT',1,1)`;
            await sql`UPDATE pdr_ai_v2_document SET current_version_id=${futureVersion} WHERE id=${old.id}`;
            await sql`INSERT INTO pdr_ai_v2_vantage_weekly_review_policy(company_id,architecture_document_id,required_document_ids) VALUES (${company},${architecture.id},'[]'::jsonb)`;
            const actor = {
                companyId: String(company),
                userId: "budget-test-" + randomUUID(),
                role: "member",
                canRead: true,
                canMutate: true,
                documentScope: {
                    kind: "except" as const,
                    deniedCategories: ["Denied"],
                    deniedDocumentIds: [],
                    allowedDocumentIds: [],
                },
            };
            const baseline = createWeeklyReviewAuthority(database, async () => actor);
            const baselineContext = await baseline.collectWeeklyReviewContext(actor, "2026-10-19");
            expect(baselineContext.selectionDiagnostics).toBeUndefined();
            expect(baselineContext.sources.map(source => source.id)).not.toContain(old.id);
            let revokedOptional = false;
            const authority = createWeeklyReviewAuthority(
                database,
                async () => ({
                    ...actor,
                    documentScope: {
                        ...actor.documentScope,
                        deniedDocumentIds: revokedOptional ? [Number(bulky.id)] : [],
                    },
                }),
                { internalRetrievalV1: true }
            );
            const identity = { candidateId: randomUUID(), asOf: "2026-11-09T00:00:00Z" };
            const context = await authority.collectWeeklyReviewContext(
                actor,
                "2026-10-19",
                identity
            );
            expect(context.sources.find(source => source.id === old.id)).toMatchObject({
                version: old.version,
                text: "Eligible older evidence",
            });
            expect(context.sources.map(source => source.id)).not.toContain(denied.id);
            expect(context.sources.map(source => source.id)).not.toContain(foreign.id);
            expect(JSON.stringify(context)).not.toContain("SECRET DENIED CONTENT");
            expect(JSON.stringify(context)).not.toContain("SECRET FOREIGN CONTENT");
            expect(context.selectionDiagnostics).toMatchObject({
                schemaVersion: "vantage-internal-selection/v1",
                cutoff: "2026-10-26T00:00:00.000Z",
                acquisition: {
                    candidateLimit: 64,
                    chunkLimitPerSource: 128,
                    maxLoadedTextBytes: 128000,
                    deadlineMs: 3000,
                },
            });
            expect(context.selectionDiagnostics!.deniedCount).toBeGreaterThanOrEqual(1);
            expect(context.selectionDiagnostics!.omitted.map(item => item.id)).not.toContain(
                denied.id
            );
            expect(context.selectionDiagnostics!.selected.map(item => item.id)).not.toContain(
                denied.id
            );
            expect(JSON.stringify(context.selectionDiagnostics)).not.toContain("Secret title");
            expect(context.selectionDiagnostics!.acquisition.loadedTextBytes).toBeLessThanOrEqual(
                128000
            );
            expect(context.sources.map(source => source.id)).not.toContain(bulky.id);
            expect(context.selectionDiagnostics!.omitted).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: bulky.id,
                        reason: expect.stringMatching(
                            /^(source_context_unavailable|acquisition_budget|budget_exceeded)$/
                        ),
                    }),
                    expect.objectContaining({
                        id: futureOnly[0],
                        reason: "source_version_unavailable",
                        temporalEligibility: "unavailable",
                    }),
                ])
            );

            // Seed an accepted legacy report using the real envelope encryption and
            // read it through the existing repository before and after invalidation.
            configureSecretBox({ key: Buffer.alloc(32, 17).toString("base64") });
            const reportId = randomUUID();
            const report = { topics: [{ id: "kept" }] };
            const envelope = {
                schema: "vantage-weekly-review/v2.1",
                id: reportId,
                companyId: actor.companyId,
                ownerId: actor.userId,
                report,
                evidence: { prior: true },
            };
            const sealed = encryptSecret(
                JSON.stringify(envelope),
                `vantage-report:${actor.companyId}:${actor.userId}:${reportId}`
            );
            const architectureDependency = context.sources
                .filter(source => source.id === architecture.id)
                .map(({ kind, id, version, hash, purpose }) => ({
                    kind,
                    id,
                    version,
                    hash,
                    purpose,
                }));
            await sql`INSERT INTO pdr_ai_v2_vantage_weekly_review_runs(id,company_id,owner_id,week_start,idempotency_key,input_hash,status,dependencies,ciphertext,key_version) VALUES (${reportId},${company},${actor.userId},'2026-10-19','prior','prior','accepted',${JSON.stringify(architectureDependency)}::jsonb,${sealed.ciphertext},${sealed.keyVersion})`;
            await sql`INSERT INTO pdr_ai_v2_vantage_weekly_review_active(company_id,owner_id,week_start,run_id) VALUES (${company},${actor.userId},'2026-10-19',${reportId})`;
            const repository = createWeeklyReviewRepository(
                database,
                authority.assertCurrentWeeklyReviewAuthority
            );
            expect((await repository.get(actor, reportId)).report).toEqual(report);
            const current = { ...actor, authorityEpoch: context.authorityEpoch };
            const candidateInput = {
                ...identity,
                week: "2026-10-19",
                role: context.role,
                mandatoryCoverage: context.mandatoryCoverage,
                sources: context.sources,
            };
            const dependencies = context.sources.map(({ kind, id, version, hash, purpose }) => ({
                kind,
                id,
                version,
                hash,
                purpose,
            }));
            const requestHash = reviewFingerprint({
                week: candidateInput.week,
                expectedActiveId: reportId,
                role: context.role,
                sources: context.sources,
                epoch: context.authorityEpoch,
                budgetProfile: "internal-v1",
            });
            const reserved = await repository.reserve(
                current,
                candidateInput.week,
                randomUUID(),
                requestHash,
                dependencies,
                identity.candidateId
            );
            expect(reserved).toMatchObject({ id: identity.candidateId, created: true });
            const reference = context.sources.find(source => source.id === architecture.id)!.ref;
            const generated = {
                schemaVersion: "vantage-weekly-review/v2.1",
                headline: "Synthetic review",
                brief: "Review evidence",
                summary: "Architecture evidence",
                keyFigures: [],
                topics: [
                    {
                        title: "Review",
                        facts: [{ text: "Architecture evidence", refs: [reference] }],
                        conflicts: [],
                        whyItMatters: "Review matters",
                        whyNow: "Review now",
                        decisionQuestion: "What next?",
                        rationale: "Evidence exists",
                        recommendation: null,
                        proposedNextStep: "Review",
                        unknowns: [],
                        proposedOwner: null,
                        proposedDue: null,
                        helpRequested: null,
                    },
                ],
            };
            const validationJudge: ValidationJudge = {
                kind: "fixture-replay",
                id: "synthetic-only",
                evaluate: async request => {
                    const source = request.input.scenario.documents[0]!;
                    const unit = request.outputUnits[0]!;
                    const evidence = [
                        { kind: "source" as const, id: source.id, quote: source.text.slice(0, 20) },
                        { kind: "output" as const, id: unit.id, quote: unit.text },
                    ];
                    return {
                        judgment: {
                            expectations: request.input.scenario.expectations.map(item => ({
                                expectationId: item.id,
                                verdict: "met" as const,
                                reason: "Synthetic assessment",
                                evidence,
                            })),
                            ratings: RATED_CRITERIA.map(criterion => ({
                                criterion,
                                score: 4 as const,
                                reason: "Synthetic assessment",
                                evidence,
                            })),
                        },
                    };
                },
            };
            const result = await runWeeklyReviewV21(candidateInput, {
                generation: { modelId: "synthetic-generation" } as never,
                judge: { modelId: "synthetic-judge" } as never,
                invoke: (async () => ({
                    result: generated,
                    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
                })) as never,
                validationJudge,
                authorizeDispatch: kind => repository.authorizeDispatch(current, reserved.id, kind),
                budgetProfile: "internal-v1",
                selectionDiagnostics: context.selectionDiagnostics,
            });
            expect(result.evidence.schemaVersion).toBe("vantage-admission/v2");
            await expect(
                repository.accept(current, reserved.id, {
                    ...result,
                    evidence: {
                        ...result.evidence,
                        budget: { ...result.evidence.budget, reportReserveBytes: 1500 },
                    },
                    expectedActiveId: reportId,
                })
            ).rejects.toThrow("candidate_admission_invalid");
            expect(await repository.active(actor, candidateInput.week)).toBe(reportId);
            await repository.accept(current, reserved.id, {
                ...result,
                expectedActiveId: reportId,
            });
            const [stored] =
                await sql`SELECT ciphertext,dependencies FROM pdr_ai_v2_vantage_weekly_review_runs WHERE id=${reserved.id}`;
            expect(String(stored!.ciphertext)).not.toContain("Bulky optional");
            const persistedDependencies =
                typeof stored!.dependencies === "string"
                    ? JSON.parse(stored!.dependencies)
                    : stored!.dependencies;
            expect(persistedDependencies).not.toEqual(
                expect.arrayContaining([expect.objectContaining({ id: bulky.id })])
            );
            const decrypted = JSON.parse(
                decryptSecret(
                    String(stored!.ciphertext),
                    `vantage-report:${actor.companyId}:${actor.userId}:${reserved.id}`
                )
            );
            expect(decrypted.evidence.selectionDiagnostics.omitted).toEqual(
                expect.arrayContaining([expect.objectContaining({ id: bulky.id })])
            );
            revokedOptional = true;
            const readback = await repository.get(actor, reserved.id);
            expect(readback.report).toEqual(result.report);
            const publicEvidence = readback.evidence as {
                selectionDiagnostics?: {
                    omitted?: unknown[];
                    omittedCount?: number;
                    omissionReasonCounts?: Record<string, number>;
                };
            };
            expect(publicEvidence.selectionDiagnostics).not.toHaveProperty("omitted");
            expect(publicEvidence.selectionDiagnostics?.omittedCount).toBe(
                decrypted.evidence.selectionDiagnostics.omitted.length
            );
            expect(
                publicEvidence.selectionDiagnostics?.omissionReasonCounts
                    ?.source_context_unavailable
            ).toBeGreaterThanOrEqual(1);
            expect((await repository.get(actor, reportId)).report).toEqual(report);
            await sql`UPDATE pdr_ai_v2_document_context_chunks SET content='changed content' WHERE document_id=${old.id} AND version_id=${old.version}`;
            await expect(
                database.transaction(query =>
                    authority.assertCurrentWeeklyReviewAuthority(
                        query,
                        { ...actor, authorityEpoch: context.authorityEpoch },
                        context.sources,
                        "dispatch"
                    )
                )
            ).rejects.toThrow("source_authority_changed");
            expect(await repository.active(actor, "2026-10-19")).toBe(reserved.id);
            expect((await repository.get(actor, reportId)).report).toEqual(report);

            // The real epoch trigger serializes a same-company content write,
            // while a different company's write remains independent.
            let unlock!: () => void;
            let locked!: () => void;
            const acquired = new Promise<void>(resolve => {
                locked = resolve;
            });
            const release = new Promise<void>(resolve => {
                unlock = resolve;
            });
            const holding = sql.begin(async tx => {
                await tx`SELECT version FROM pdr_ai_v2_vantage_weekly_review_epochs WHERE company_id=${company} FOR SHARE`;
                locked();
                await release;
            });
            try {
                await acquired;
                await sql`UPDATE pdr_ai_v2_document SET title='other tenant updated' WHERE id=${foreign.id}`;
                await expect(
                    sql.begin(async tx => {
                        await tx`SET LOCAL lock_timeout='100ms'`;
                        await tx`UPDATE pdr_ai_v2_document_context_chunks SET content='racing update' WHERE document_id=${old.id} AND version_id=${old.version}`;
                    })
                ).rejects.toMatchObject({ code: "55P03" });
            } finally {
                unlock();
                await holding;
            }
        } finally {
            configureSecretBox({ key: undefined });
            await sql.end({ timeout: 2 });
        }
    }, 30000);
});

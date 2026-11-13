import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { configureSecretBox, decryptSecret } from "@launchstack/store/crypto";
import { hashScopedText } from "@launchstack/pipelines/vantage/scoped-evidence";
import {
    reviewFingerprint,
    runWeeklyReviewV21,
    type WeeklyReviewInput,
    type WeeklyReviewV21,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import {
    RATED_CRITERIA,
    type ValidationJudge,
} from "@launchstack/pipelines/vantage/weekly-review-validation";
import { createWeeklyReviewAuthority } from "~/server/vantage/weekly-review-authority";
import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
import type { WeeklyReviewDatabase } from "~/server/vantage/weekly-review-types";

function checkedUrl(): string {
    const value = process.env.VANTAGE_SCOPED_TEST_DATABASE_URL;
    if (!value) throw new Error("VANTAGE_SCOPED_TEST_DATABASE_URL is required");
    const url = new URL(value);
    if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.port !== "55570" ||
        url.pathname !== "/vantage_scoped_evidence_20261113"
    ) {
        throw new Error("Refusing non-owned synthetic database");
    }
    return value;
}

// Uses official migrated tables and real envelope encryption. Model/Judge ports
// are injected deterministic fixtures and provide engineering integration evidence.
describe("scoped evidence through real PostgreSQL authority and acceptance", () => {
    it("persists validated scope policy, accepts v3 evidence, and fails closed on races and ACL changes", async () => {
        const sql = postgres(checkedUrl(), { max: 2, idle_timeout: 1 });
        const client = drizzle(sql);
        const database: WeeklyReviewDatabase = {
            transaction: work =>
                client.transaction(async tx =>
                    work(async (text, parameters = []) => {
                        const parts = text
                            .split(/(\$\d+)/g)
                            .map(part =>
                                /^\$\d+$/.test(part)
                                    ? drizzleSql.param(parameters[Number(part.slice(1)) - 1])
                                    : drizzleSql.raw(part)
                            );
                        return [
                            ...(await tx.execute(drizzleSql.join(parts, drizzleSql.raw("")))),
                        ] as Record<string, unknown>[];
                    })
                ),
        };
        configureSecretBox({ key: Buffer.alloc(32, 23).toString("base64") });
        try {
            const [company] =
                await sql`INSERT INTO pdr_ai_v2_company(name,"numberOfEmployees") VALUES ('scoped synthetic', '1') RETURNING id`;
            const [otherCompany] =
                await sql`INSERT INTO pdr_ai_v2_company(name,"numberOfEmployees") VALUES ('scoped other tenant', '1') RETURNING id`;
            const addDocument = async (companyId: string, title: string, chunks: string[]) => {
                const [doc] =
                    await sql`INSERT INTO pdr_ai_v2_document(url,category,title,company_id,created_at,updated_at) VALUES ('synthetic','Shared',${title},${companyId},'2026-11-01','2026-11-01') RETURNING id`;
                const [version] =
                    await sql`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,created_at) VALUES (${doc!.id},1,'synthetic','text/plain','2026-11-01') RETURNING id`;
                for (const [ordinal, content] of chunks.entries()) {
                    await sql`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,page_number,line_start) VALUES (${doc!.id},${version!.id},${content},1,${ordinal + 1})`;
                }
                return {
                    id: String(doc!.id),
                    version: String(version!.id),
                    text: chunks.join("\n"),
                };
            };
            const firstChunk = "Approved architecture evidence for the weekly decision.";
            const chunks = [
                firstChunk,
                ...Array.from(
                    { length: 128 },
                    (_, index) => `Outside configured span ${index}. ` + "x".repeat(270)
                ),
            ];
            const span = firstChunk + "\n" + chunks[1]!.slice(0, 32);
            const architecture = await addDocument(
                String(company!.id),
                "Large architecture",
                chunks
            );
            const privateNote = await addDocument(String(company!.id), "Private star", [
                "Private planning evidence.",
            ]);
            const foreign = await addDocument(String(otherCompany!.id), "Foreign document", [
                "Foreign tenant evidence.",
            ]);
            expect(Buffer.byteLength(architecture.text)).toBeGreaterThan(32000);
            expect(chunks).toHaveLength(129);
            const scope = {
                version: architecture.version,
                expectedParentHash: hashScopedText(architecture.text),
                qualification: "Architecture decision span approved by workspace administrator",
                requiredUnits: [
                    {
                        id: "architecture-decision",
                        start: 0,
                        end: span.length,
                        excerptHash: hashScopedText(span),
                    },
                ],
            };
            const scopes = { [architecture.id]: scope };
            const actor = {
                companyId: String(company!.id),
                userId: "scoped-test-" + randomUUID(),
                role: "admin",
                canRead: true,
                canMutate: true,
                canConfigure: true,
                documentScope: {
                    kind: "except" as const,
                    deniedCategories: [],
                    deniedDocumentIds: [] as number[],
                    allowedDocumentIds: [],
                },
            };
            let deniedDocumentIds: number[] = [];
            let canConfigure = true;
            const loadActor = async () => ({
                ...actor,
                canConfigure,
                documentScope: { ...actor.documentScope, deniedDocumentIds },
            });
            const authority = createWeeklyReviewAuthority(database, loadActor, {
                internalRetrievalV1: true,
                scopedEvidenceV2: true,
            });
            const disabled = createWeeklyReviewAuthority(database, loadActor, {
                internalRetrievalV1: true,
            });
            const repository = createWeeklyReviewRepository(
                database,
                authority.assertCurrentWeeklyReviewAuthority
            );
            const week = "2026-11-09";
            const collect = () =>
                authority.collectWeeklyReviewContext(actor, week, {
                    candidateId: randomUUID(),
                    asOf: "2026-11-13T12:00:00.000Z",
                });
            const validate = (configured = scopes, document = architecture.id) =>
                database.transaction(query =>
                    authority.validateCompanySources(query, actor, document, [], configured)
                );

            await expect(
                database.transaction(query =>
                    disabled.validateCompanySources(query, actor, architecture.id, [], scopes)
                )
            ).rejects.toThrow("scoped_evidence_disabled");
            canConfigure = false;
            await expect(validate()).rejects.toThrow("review_configuration_denied");
            canConfigure = true;
            await expect(validate()).resolves.toBeDefined();
            await expect(
                validate({ [architecture.id]: { ...scope, expectedParentHash: "0".repeat(64) } })
            ).rejects.toThrow("source_authority_changed");
            await expect(
                validate({ [architecture.id]: { ...scope, version: foreign.version } })
            ).rejects.toThrow("source_version_unavailable");
            await expect(validate({}, foreign.id)).rejects.toThrow("source_access_denied");

            // Validation and persistence run together under the authority's company lock.
            await database.transaction(async query => {
                await authority.validateCompanySources(query, actor, architecture.id, [], scopes);
                await query(
                    "INSERT INTO pdr_ai_v2_vantage_weekly_review_policy(company_id,architecture_document_id,required_document_ids,required_source_scopes) VALUES($1::bigint,$2::bigint,'[]'::jsonb,$3::jsonb)",
                    [actor.companyId, architecture.id, JSON.stringify(scopes)]
                );
            });
            const [policy] =
                await sql`SELECT required_source_scopes FROM pdr_ai_v2_vantage_weekly_review_policy WHERE company_id=${actor.companyId}`;
            expect(policy!.required_source_scopes).toEqual(scopes);
            await sql`INSERT INTO pdr_ai_v2_document_settings(document_id,company_id,restricted,updated_by) VALUES (${privateNote.id},${actor.companyId},true,${actor.userId})`;
            await expect(
                database.transaction(query =>
                    authority.validateCompanySources(query, actor, privateNote.id, [], {})
                )
            ).rejects.toThrow("required_context_audience");
            await database.transaction(async query => {
                await authority.validatePreferenceSources(query, actor, [privateNote.id]);
                await query(
                    "INSERT INTO pdr_ai_v2_vantage_weekly_review_preferences(company_id,actor_id,star_document_ids) VALUES($1::bigint,$2,$3::jsonb)",
                    [actor.companyId, actor.userId, JSON.stringify([privateNote.id])]
                );
            });
            await expect(
                database.transaction(query =>
                    authority.validatePreferenceSources(query, actor, [architecture.id], scopes)
                )
            ).rejects.toThrow("personal_scope_cannot_narrow_required");
            const starScopes = {
                [privateNote.id]: {
                    version: privateNote.version,
                    expectedParentHash: hashScopedText(privateNote.text),
                    qualification: "Private planning span chosen by this actor",
                    requiredUnits: [
                        {
                            id: "planning",
                            start: 0,
                            end: 8,
                            excerptHash: hashScopedText(privateNote.text.slice(0, 8)),
                        },
                    ],
                },
            };
            await database.transaction(async query => {
                await authority.validatePreferenceSources(
                    query,
                    actor,
                    [privateNote.id],
                    starScopes
                );
                await query(
                    "UPDATE pdr_ai_v2_vantage_weekly_review_preferences SET star_source_scopes=$3::jsonb,version=version+1 WHERE company_id=$1::bigint AND actor_id=$2",
                    [actor.companyId, actor.userId, JSON.stringify(starScopes)]
                );
            });
            const [preferences] =
                await sql`SELECT star_source_scopes FROM pdr_ai_v2_vantage_weekly_review_preferences WHERE company_id=${actor.companyId} AND actor_id=${actor.userId}`;
            expect(preferences!.star_source_scopes).toEqual(starScopes);
            expect(
                (await collect()).scopedEvidence?.find(
                    source => source.documentId === privateNote.id
                )?.audience
            ).toBe("actor");
            // Keep the admission scenario mixed, covering ordinary exact-version dependencies too.
            await sql`UPDATE pdr_ai_v2_vantage_weekly_review_preferences SET star_source_scopes='{}'::jsonb,version=version+1 WHERE company_id=${actor.companyId} AND actor_id=${actor.userId}`;
            const context = await collect();
            expect(context.scopedEvidence).toHaveLength(1);
            expect(context.scopedEvidence![0]!.coverage).toMatchObject({
                state: "relevant_spans_reviewed",
                originalCompleteness: "unknown",
                includedUnits: 1,
                requiredUnits: 1,
            });
            expect(context.sources.find(source => source.id === architecture.id)?.text).toBe(span);
            expect(context.sources.find(source => source.id === privateNote.id)?.audience).toBe(
                "actor"
            );
            expect(context.dependencies?.find(source => source.id === architecture.id)?.kind).toBe(
                "scoped-document"
            );

            const prepare = async () => {
                const frozen = await collect();
                const current = { ...actor, authorityEpoch: frozen.authorityEpoch };
                const input: WeeklyReviewInput = {
                    ...frozen.inputIdentity!,
                    week,
                    role: frozen.role,
                    mandatoryCoverage: frozen.mandatoryCoverage,
                    sources: frozen.sources,
                    scopedEvidence: frozen.scopedEvidence,
                };
                const reserved = await repository.reserve(
                    current,
                    week,
                    randomUUID(),
                    reviewFingerprint(input),
                    frozen.dependencies!,
                    input.candidateId
                );
                return { frozen, current, input, reserved };
            };
            const candidate = await prepare();
            const report: WeeklyReviewV21 = {
                schemaVersion: "vantage-weekly-review/v2.1",
                headline: "Synthetic scoped review",
                brief: "Review the approved span",
                summary: span,
                keyFigures: [],
                topics: [
                    {
                        title: "Architecture",
                        facts: [{ text: span, refs: [candidate.input.sources[0]!.ref] }],
                        conflicts: [],
                        whyItMatters: "Review company evidence",
                        whyNow: "Weekly decision",
                        decisionQuestion: "What next?",
                        rationale: "Approved scoped evidence",
                        recommendation: null,
                        proposedNextStep: "Discuss",
                        unknowns: ["Original PDF completeness is unknown."],
                        proposedOwner: null,
                        proposedDue: null,
                        helpRequested: null,
                    },
                ],
            };
            const validationJudge: ValidationJudge = {
                kind: "fixture-replay",
                id: "synthetic-scoped-postgres",
                async evaluate(request) {
                    const output = request.outputUnits[0]!;
                    const source = request.input.scenario.documents[0]!;
                    const evidence = [
                        { kind: "source" as const, id: source.id, quote: source.text.slice(0, 20) },
                        { kind: "output" as const, id: output.id, quote: output.text },
                    ];
                    return {
                        judgment: {
                            expectations: request.input.scenario.expectations.map(item => ({
                                expectationId: item.id,
                                verdict: "met" as const,
                                reason: "Synthetic integration fixture",
                                evidence: [
                                    {
                                        kind: "source" as const,
                                        id: item.evidence[0]!.sourceId,
                                        quote: item.evidence[0]!.quote,
                                    },
                                    { kind: "output" as const, id: output.id, quote: output.text },
                                ],
                            })),
                            ratings: RATED_CRITERIA.map(criterion => ({
                                criterion,
                                score: 4 as const,
                                reason: "Synthetic integration fixture",
                                evidence,
                            })),
                        },
                    };
                },
            };
            const result = await runWeeklyReviewV21(candidate.input, {
                generation: { modelId: "synthetic-generation" } as never,
                judge: { modelId: "synthetic-judge" } as never,
                invoke: (async () => ({
                    result: report,
                    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
                })) as never,
                validationJudge,
                authorizeDispatch: kind =>
                    repository.authorizeDispatch(candidate.current, candidate.reserved.id, kind),
                budgetProfile: "scoped-v2",
                selectionDiagnostics: candidate.frozen.selectionDiagnostics,
            });
            expect(result.evidence.schemaVersion).toBe("vantage-admission/v3");
            const [reservedRow] =
                await sql`SELECT dependencies FROM pdr_ai_v2_vantage_weekly_review_runs WHERE id=${candidate.reserved.id}`;
            const frozenDependencies = reservedRow!.dependencies as {
                kind: string;
                scope?: { dependency: unknown };
            }[];
            expect(
                frozenDependencies
                    .filter(dependency => dependency.kind === "scoped-document")
                    .map(dependency => dependency.scope!.dependency)
            ).toEqual(result.evidence.inputSnapshot.scopedEvidence);
            await expect(
                repository.accept(candidate.current, candidate.reserved.id, {
                    ...result,
                    evidence: { ...result.evidence, judgeInputBytes: 1 },
                    expectedActiveId: null,
                })
            ).rejects.toThrow("candidate_admission_invalid");
            expect(await repository.active(actor, week)).toBeNull();
            await repository.accept(candidate.current, candidate.reserved.id, {
                ...result,
                expectedActiveId: null,
            });
            expect(await repository.active(actor, week)).toBe(candidate.reserved.id);
            const [stored] =
                await sql`SELECT ciphertext,key_version FROM pdr_ai_v2_vantage_weekly_review_runs WHERE id=${candidate.reserved.id}`;
            expect(stored!.ciphertext).not.toContain(span);
            const decrypted = JSON.parse(
                decryptSecret(
                    String(stored!.ciphertext),
                    `vantage-report:${actor.companyId}:${actor.userId}:${candidate.reserved.id}`
                )
            ) as { evidence: { schemaVersion: string; inputSnapshot: WeeklyReviewInput } };
            expect(decrypted.evidence.schemaVersion).toBe("vantage-admission/v3");
            expect(decrypted.evidence.inputSnapshot.scopedEvidence).toEqual(context.scopedEvidence);
            const flagOffRepository = createWeeklyReviewRepository(
                database,
                disabled.assertCurrentWeeklyReviewAuthority
            );
            expect((await flagOffRepository.get(actor, candidate.reserved.id)).report).toEqual(
                result.report
            );

            // A newer version does not rewrite exact accepted history.
            const [future] =
                await sql`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,created_at) VALUES (${architecture.id},2,'synthetic','text/plain','2026-12-01') RETURNING id`;
            await sql`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,page_number,line_start) VALUES (${architecture.id},${future!.id},'Future source text',1,1)`;
            await sql`UPDATE pdr_ai_v2_document SET current_version_id=${future!.id} WHERE id=${architecture.id}`;
            expect((await collect()).scopedEvidence![0]!.parentVersion).toBe(architecture.version);
            expect((await flagOffRepository.get(actor, candidate.reserved.id)).report).toEqual(
                result.report
            );
            deniedDocumentIds = [Number(architecture.id)];
            await expect(flagOffRepository.get(actor, candidate.reserved.id)).rejects.toThrow(
                "source_access_denied"
            );
            deniedDocumentIds = [];
            await sql`INSERT INTO pdr_ai_v2_document_settings(document_id,company_id,restricted,updated_by) VALUES (${architecture.id},${actor.companyId},true,${actor.userId})`;
            await expect(flagOffRepository.get(actor, candidate.reserved.id)).rejects.toThrow(
                "required_context_audience"
            );
            await sql`DELETE FROM pdr_ai_v2_document_settings WHERE document_id=${architecture.id}`;

            const racing = await prepare();
            let release!: () => void;
            let entered!: () => void;
            const acquired = new Promise<void>(resolve => {
                entered = resolve;
            });
            const continueWork = new Promise<void>(resolve => {
                release = resolve;
            });
            const holding = database.transaction(async query => {
                await authority.assertCurrentWeeklyReviewAuthority(
                    query,
                    racing.current,
                    racing.frozen.dependencies!,
                    "dispatch"
                );
                entered();
                await continueWork;
            });
            try {
                await acquired;
                await expect(
                    sql.begin(async tx => {
                        await tx`SET LOCAL lock_timeout='100ms'`;
                        await tx`UPDATE pdr_ai_v2_document_context_chunks SET content=content || ' outside change' WHERE document_id=${architecture.id} AND version_id=${architecture.version} AND line_start=129`;
                    })
                ).rejects.toMatchObject({ code: "55P03" });
                await sql`UPDATE pdr_ai_v2_document SET title='Independent tenant write' WHERE id=${foreign.id}`;
            } finally {
                release();
                await holding;
            }
            await sql`UPDATE pdr_ai_v2_document_context_chunks SET content=content || ' outside change' WHERE document_id=${architecture.id} AND version_id=${architecture.version} AND line_start=129`;
            await expect(
                repository.authorizeDispatch(racing.current, racing.reserved.id, "generation")
            ).rejects.toThrow("source_authority_changed");
            await expect(flagOffRepository.get(actor, candidate.reserved.id)).rejects.toThrow(
                "source_authority_changed"
            );
            await repository.fail(actor, racing.reserved.id, "source_authority_changed");
            expect(await repository.active(actor, week)).toBe(candidate.reserved.id);
            await sql`UPDATE pdr_ai_v2_document_context_chunks SET content=${chunks[128]!} WHERE document_id=${architecture.id} AND version_id=${architecture.version} AND line_start=129`;
            expect((await flagOffRepository.get(actor, candidate.reserved.id)).report).toEqual(
                result.report
            );

            const policyRace = await prepare();
            await sql`UPDATE pdr_ai_v2_vantage_weekly_review_policy SET required_source_scopes=${JSON.stringify({ [architecture.id]: { ...scope, qualification: "Revised administrator decision scope" } })}::jsonb,version=version+1 WHERE company_id=${actor.companyId}`;
            await expect(
                repository.authorizeDispatch(
                    policyRace.current,
                    policyRace.reserved.id,
                    "generation"
                )
            ).rejects.toThrow("source_authority_changed");
            expect(await repository.active(actor, week)).toBe(candidate.reserved.id);
            expect((await flagOffRepository.get(actor, candidate.reserved.id)).report).toEqual(
                result.report
            );
        } finally {
            configureSecretBox({ key: undefined });
            await sql.end({ timeout: 2 });
        }
    }, 60000);

    it("enforces PostgreSQL microsecond cutoff precision, inclusive equality, and ACL precedence", async () => {
        const sql = postgres(checkedUrl(), { max: 2, idle_timeout: 1 });
        const client = drizzle(sql);
        const queries: string[] = [];
        const database: WeeklyReviewDatabase = {
            transaction: work =>
                client.transaction(async tx =>
                    work(async (text, parameters = []) => {
                        queries.push(text);
                        const parts = text
                            .split(/(\$\d+)/g)
                            .map(part =>
                                /^\$\d+$/.test(part)
                                    ? drizzleSql.param(parameters[Number(part.slice(1)) - 1])
                                    : drizzleSql.raw(part)
                            );
                        return [
                            ...(await tx.execute(drizzleSql.join(parts, drizzleSql.raw("")))),
                        ] as Record<string, unknown>[];
                    })
                ),
        };
        try {
            const cutoff = "2026-11-16T00:00:00.000Z";
            const afterCutoff = "2026-11-16T00:00:00.000001Z";
            const text = "Exact timestamp boundary evidence.";
            const [company] =
                await sql`INSERT INTO pdr_ai_v2_company(name,"numberOfEmployees") VALUES ('scoped timestamp synthetic', '1') RETURNING id`;
            const [document] =
                await sql`INSERT INTO pdr_ai_v2_document(url,category,title,company_id,created_at,updated_at) VALUES ('synthetic','Shared','Timestamp boundary',${company!.id},'2026-11-01','2026-11-01') RETURNING id`;
            const [version] =
                await sql`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,created_at) VALUES (${document!.id},1,'synthetic','text/plain',${afterCutoff}::timestamptz) RETURNING id`;
            await sql`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,page_number,line_start) VALUES (${document!.id},${version!.id},${text},1,1)`;
            const scopes = {
                [String(document!.id)]: {
                    version: String(version!.id),
                    expectedParentHash: hashScopedText(text),
                    qualification: "Administrator configured timestamp-boundary evidence",
                    requiredUnits: [
                        {
                            id: "boundary",
                            start: 0,
                            end: text.length,
                            excerptHash: hashScopedText(text),
                        },
                    ],
                },
            };
            await sql`INSERT INTO pdr_ai_v2_vantage_weekly_review_policy(company_id,architecture_document_id,required_document_ids,required_source_scopes) VALUES (${company!.id},${document!.id},'[]'::jsonb,${JSON.stringify(scopes)}::jsonb)`;
            const actor = {
                companyId: String(company!.id),
                userId: "scoped-cutoff-" + randomUUID(),
                role: "admin",
                canRead: true,
                canMutate: true,
                canConfigure: true,
                documentScope: {
                    kind: "except" as const,
                    deniedCategories: [],
                    deniedDocumentIds: [] as number[],
                    allowedDocumentIds: [],
                },
            };
            let denied = false;
            const authority = createWeeklyReviewAuthority(
                database,
                async () => ({
                    ...actor,
                    documentScope: {
                        ...actor.documentScope,
                        deniedDocumentIds: denied ? [Number(document!.id)] : [],
                    },
                }),
                { internalRetrievalV1: true, scopedEvidenceV2: true }
            );
            const collect = () =>
                authority.collectWeeklyReviewContext(actor, "2026-11-09", {
                    candidateId: randomUUID(),
                    asOf: cutoff,
                });
            const [precision] =
                await sql`SELECT created_at > ${cutoff}::timestamptz AS after_cutoff FROM pdr_ai_v2_document_versions WHERE id=${version!.id}`;
            expect(precision!.after_cutoff).toBe(true);
            queries.length = 0;
            await expect(collect()).rejects.toThrow("source_version_unavailable");
            expect(queries.some(query => query.includes("bounded_scoped_chunks"))).toBe(false);

            denied = true;
            queries.length = 0;
            await expect(collect()).rejects.toThrow("source_access_denied");
            expect(queries.some(query => query.includes("bounded_scoped_chunks"))).toBe(false);
            denied = false;
            await sql`UPDATE pdr_ai_v2_document_versions SET created_at=${cutoff}::timestamptz WHERE id=${version!.id}`;
            const [equal] =
                await sql`SELECT created_at = ${cutoff}::timestamptz AS at_cutoff FROM pdr_ai_v2_document_versions WHERE id=${version!.id}`;
            expect(equal!.at_cutoff).toBe(true);
            const context = await collect();
            expect(context.sources.find(source => source.id === String(document!.id))?.text).toBe(
                text
            );
            expect(context.scopedEvidence![0]!.parentVersion).toBe(String(version!.id));
            expect(context.scopedEvidence![0]!.coverage.state).toBe("full_document_reviewed");
        } finally {
            await sql.end({ timeout: 2 });
        }
    }, 30000);
});

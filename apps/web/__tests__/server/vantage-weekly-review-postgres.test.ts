import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { configureSecretBox } from "@launchstack/store/crypto";
import { createWeeklyReviewAuthority } from "~/server/vantage/weekly-review-authority";
import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
import type { WeeklyReviewDatabase } from "~/server/vantage/weekly-review-types";

// Explicit opt-in file: absence is a failed prerequisite, never a green skipped DB suite.
describe("Weekly Review per-company PostgreSQL authority locks", () => {
    it("blocks same-company authority mutations but allows another tenant to write", async () => {
        const url = process.env.VANTAGE_PRODUCTION_TEST_DATABASE_URL;
        if (!url)
            throw new Error(
                "Set VANTAGE_PRODUCTION_TEST_DATABASE_URL to the dedicated synthetic acceptance database"
            );
        const parsed = new URL(url);
        if (
            !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
            parsed.port !== "55569" ||
            parsed.pathname !== "/vantage_production_acceptance"
        )
            throw new Error("Refusing non-owned test database");
        const schema = "vantage_lock_" + randomUUID().replaceAll("-", "");
        const admin = postgres(url, { max: 1 });
        await admin.unsafe('CREATE SCHEMA "' + schema + '"');
        const a = postgres(url, { max: 1, connection: { search_path: schema } });
        const b = postgres(url, { max: 1, connection: { search_path: schema } });
        try {
            const names = [
                "users",
                "user_company_memberships",
                "workspace_roles",
                "workspace_groups",
                "workspace_group_members",
                "folder_settings",
                "folder_grants",
                "document_settings",
                "document_grants",
                "category",
                "document",
                "document_versions",
                "document_context_chunks",
            ];
            for (const name of names)
                await a.unsafe(
                    "CREATE TABLE pdr_ai_v2_" +
                        name +
                        " (id bigint PRIMARY KEY,company_id bigint,document_id bigint,user_id bigint,group_id bigint)"
                );
            const migration = await readFile(
                resolve(process.cwd(), "drizzle/20261109200000_vantage_weekly_reviews.sql"),
                "utf8"
            );
            await a.unsafe(migration.replaceAll("--> statement-breakpoint", ""));
            await a.unsafe(
                await readFile(
                    resolve(process.cwd(), "drizzle/20261109220000_vantage_review_recovery.sql"),
                    "utf8"
                )
            );
            await a.unsafe(
                await readFile(
                    resolve(
                        process.cwd(),
                        "drizzle/20261109230000_vantage_authority_after_write.sql"
                    ),
                    "utf8"
                )
            );
            await a.unsafe("INSERT INTO pdr_ai_v2_document(id,company_id) VALUES(1,1),(2,2)");
            const beforeNoop = (
                await a.unsafe(
                    "SELECT version FROM pdr_ai_v2_vantage_weekly_review_epochs WHERE company_id=1"
                )
            )[0]?.version;
            await a.unsafe(
                "INSERT INTO pdr_ai_v2_document(id,company_id) VALUES(1,1) ON CONFLICT DO NOTHING"
            );
            expect(
                (
                    await a.unsafe(
                        "SELECT version FROM pdr_ai_v2_vantage_weekly_review_epochs WHERE company_id=1"
                    )
                )[0]?.version
            ).toBe(beforeNoop);

            let entered!: () => void, release!: () => void;
            const locked = new Promise<void>(resolve => {
                entered = resolve;
            });
            const continueWork = new Promise<void>(resolve => {
                release = resolve;
            });
            const tx = a.begin(async q => {
                await q.unsafe(
                    "SELECT version FROM pdr_ai_v2_vantage_weekly_review_epochs WHERE company_id=1 FOR SHARE"
                );
                entered();
                await continueWork;
            });
            await locked;
            await b.unsafe("SET lock_timeout='300ms'");
            await expect(
                b.unsafe("UPDATE pdr_ai_v2_document SET company_id=2 WHERE id=2")
            ).resolves.toBeDefined();
            await expect(
                b.unsafe("UPDATE pdr_ai_v2_document SET company_id=1 WHERE id=1")
            ).rejects.toMatchObject({ code: "55P03" });
            release();
            await tx;
            await expect(
                b.unsafe("UPDATE pdr_ai_v2_document SET company_id=1 WHERE id=1")
            ).resolves.toBeDefined();

            configureSecretBox({ key: Buffer.alloc(32, 11).toString("base64") });
            const database: WeeklyReviewDatabase = {
                transaction: work =>
                    a.begin(async tx =>
                        work(
                            async (text, params = []) =>
                                [...(await tx.unsafe(text, params as never[]))] as Record<
                                    string,
                                    unknown
                                >[]
                        )
                    ) as unknown as ReturnType<typeof work>,
            };
            await a.unsafe(
                "ALTER TABLE pdr_ai_v2_document ADD title text, ADD category text, ADD current_version_id bigint, ADD updated_at timestamptz"
            );
            await a.unsafe("ALTER TABLE pdr_ai_v2_document_versions ADD created_at timestamptz");
            await a.unsafe(
                "ALTER TABLE pdr_ai_v2_document_context_chunks ADD version_id bigint, ADD content text, ADD page_number integer, ADD line_start integer"
            );
            await a.unsafe("ALTER TABLE pdr_ai_v2_document_settings ADD restricted boolean");
            await a.unsafe(
                "ALTER TABLE pdr_ai_v2_folder_settings ADD visibility text, ADD category_id bigint"
            );
            await a.unsafe("ALTER TABLE pdr_ai_v2_category ADD name text");
            await a.unsafe(
                "UPDATE pdr_ai_v2_document SET title='Architecture',category='Shared',current_version_id=10 WHERE id=1"
            );
            await a.unsafe(
                "INSERT INTO pdr_ai_v2_document(id,company_id,title,category,current_version_id) VALUES(3,1,'Personal note','Private',30)"
            );
            await a.unsafe(
                "INSERT INTO pdr_ai_v2_document_versions(id,document_id,created_at) VALUES(10,1,'2026-11-01'),(30,3,'2026-11-01')"
            );
            await a.unsafe(
                "INSERT INTO pdr_ai_v2_document_context_chunks(id,document_id,version_id,content,page_number,line_start) VALUES(100,1,10,'Company architecture',1,1),(300,3,30,'Private star',1,1)"
            );
            await a.unsafe(
                "INSERT INTO pdr_ai_v2_document_settings(id,company_id,document_id,restricted) VALUES(3,1,3,true)"
            );
            await a.unsafe(
                "INSERT INTO pdr_ai_v2_vantage_weekly_review_policy(company_id,architecture_document_id,required_document_ids) VALUES(1,1,'[3]')"
            );
            const authorityActor = {
                companyId: "1",
                userId: "owner",
                role: "member",
                canRead: true,
                canMutate: true,
                documentScope: { kind: "everything" as const },
            };
            const actualAuthority = createWeeklyReviewAuthority(
                database,
                async () => authorityActor
            );
            await expect(
                actualAuthority.collectWeeklyReviewContext(authorityActor, "2026-11-09")
            ).rejects.toThrow("required_context_audience");
            await a.unsafe(
                "UPDATE pdr_ai_v2_vantage_weekly_review_policy SET required_document_ids='[]' WHERE company_id=1"
            );
            await a.unsafe(
                "INSERT INTO pdr_ai_v2_vantage_weekly_review_preferences(company_id,actor_id,star_document_ids) VALUES(1,'owner','[3]')"
            );
            const frozen = await actualAuthority.collectWeeklyReviewContext(
                authorityActor,
                "2026-11-09"
            );
            expect(frozen.sources.find(source => source.id === "3")?.audience).toBe("actor");
            expect(frozen.sources.find(source => source.id === "3")?.purpose).toBe("personal-star");
            const frozenArchitecture = frozen.sources.filter(source => source.id === "1");
            await a.unsafe(
                "INSERT INTO pdr_ai_v2_document_versions(id,document_id,created_at) VALUES(11,1,'2099-01-01')"
            );
            await a.unsafe(
                "INSERT INTO pdr_ai_v2_document_context_chunks(id,document_id,version_id,content,page_number,line_start) VALUES(101,1,11,'Future architecture',1,1)"
            );
            await a.unsafe("UPDATE pdr_ai_v2_document SET current_version_id=11 WHERE id=1");
            expect(
                (
                    await actualAuthority.collectWeeklyReviewContext(authorityActor, "2026-11-09")
                ).sources.find(source => source.id === "1")?.version
            ).toBe("10");
            await database.transaction(query =>
                actualAuthority.assertCurrentWeeklyReviewAuthority(
                    query,
                    authorityActor,
                    frozenArchitecture,
                    "read"
                )
            );
            await expect(
                database.transaction(query =>
                    actualAuthority.assertCurrentWeeklyReviewAuthority(
                        query,
                        { ...authorityActor, authorityEpoch: frozen.authorityEpoch },
                        frozenArchitecture,
                        "dispatch"
                    )
                )
            ).rejects.toThrow("source_authority_changed");
            const deniedAuthority = createWeeklyReviewAuthority(database, async () => ({
                ...authorityActor,
                documentScope: {
                    kind: "only" as const,
                    allowedCategories: [],
                    deniedDocumentIds: [],
                    allowedDocumentIds: [],
                },
            }));
            await expect(
                database.transaction(query =>
                    deniedAuthority.assertCurrentWeeklyReviewAuthority(
                        query,
                        authorityActor,
                        frozenArchitecture,
                        "read"
                    )
                )
            ).rejects.toThrow("source_access_denied");
            let permitted = true;
            const repository = createWeeklyReviewRepository(database, async () => {
                if (!permitted) throw new Error("revoked");
            });
            const actor = { companyId: "1", userId: "owner", authorityEpoch: "1" };
            const dependencies = [
                {
                    kind: "document" as const,
                    id: "1",
                    version: "1",
                    hash: "fixture-hash",
                    purpose: "retrieved" as const,
                },
            ];
            const first = await repository.reserve(
                actor,
                "2026-11-09",
                "key-1",
                "hash-1",
                dependencies
            );
            expect(
                (await repository.reserve(actor, "2026-11-09", "key-1", "hash-1", dependencies)).id
            ).toBe(first.id);
            await expect(
                repository.reserve(actor, "2026-11-09", "key-1", "different", dependencies)
            ).rejects.toThrow("idempotency_conflict");
            await expect(
                repository.accept(actor, first.id, {
                    report: { topics: [] },
                    evidence: {},
                    expectedActiveId: null,
                })
            ).rejects.toThrow("unjudged_candidate");
            await repository.authorizeDispatch(actor, first.id, "generation");
            await expect(
                repository.authorizeDispatch(actor, first.id, "generation")
            ).rejects.toThrow("dispatch_already_reserved");
            await repository.authorizeDispatch(actor, first.id, "judge");
            const report = { topics: [{ id: "topic-1", title: "synthetic advice" }] };
            const digest = (value: unknown) =>
                createHash("sha256").update(JSON.stringify(value)).digest("hex");
            const evidence = {
                schemaVersion: "vantage-admission/v1",
                candidateId: first.id,
                reportHash: digest(report),
                inputHash: digest({ test: true }),
                evaluationHash: digest({ testEvaluation: true }),
                evaluation: {
                    status: "assessed",
                    verdict: "pass",
                    error: null,
                    integrityIssues: [],
                },
                qualityEvidence: "synthetic repository acceptance",
            };
            await expect(
                repository.accept(actor, first.id, { report, evidence: {}, expectedActiveId: null })
            ).rejects.toThrow("candidate_admission_invalid");
            await expect(
                repository.accept(actor, first.id, {
                    report,
                    evidence: { ...evidence, reportHash: digest({ forged: true }) },
                    expectedActiveId: null,
                })
            ).rejects.toThrow("candidate_admission_invalid");
            await expect(
                repository.accept(actor, first.id, {
                    report,
                    evidence: {
                        ...evidence,
                        evaluation: { ...evidence.evaluation, verdict: "fail" },
                    },
                    expectedActiveId: null,
                })
            ).rejects.toThrow("candidate_admission_invalid");
            await repository.accept(actor, first.id, { report, evidence, expectedActiveId: null });
            expect(await repository.active(actor, "2026-11-09")).toBe(first.id);
            const loadedTopic = (await repository.get(actor, first.id)).report.topics[0];
            if (!loadedTopic) throw new Error("Accepted fixture topic is missing");
            expect(loadedTopic.title).toBe("synthetic advice");
            const stored = (
                await a.unsafe(
                    "SELECT ciphertext,key_version FROM pdr_ai_v2_vantage_weekly_review_runs WHERE id=$1",
                    [first.id]
                )
            )[0]!;
            expect(stored.ciphertext).not.toContain("synthetic advice");
            expect(stored.key_version).toBe(1);
            const decision = {
                key: "decision-1",
                expectedVersion: 1,
                topicId: "topic-1",
                decision: "discuss",
            };
            expect(await repository.decide(actor, first.id, decision)).toBe(2);
            expect(await repository.decide(actor, first.id, decision)).toBe(2);
            await expect(
                repository.decide(actor, first.id, { ...decision, key: "decision-2" })
            ).rejects.toThrow("stale_review");
            await expect(repository.get({ ...actor, companyId: "2" }, first.id)).rejects.toThrow(
                "review_not_found"
            );
            const rejected = await repository.reserve(
                actor,
                "2026-11-09",
                "key-2",
                "hash-2",
                dependencies
            );
            await repository.fail(actor, rejected.id, "judge_failed");
            expect(await repository.active(actor, "2026-11-09")).toBe(first.id);
            await expect(
                repository.authorizeDispatch(actor, rejected.id, "generation")
            ).rejects.toThrow("review_not_reserved");
            const uncertain = await repository.reserve(
                actor,
                "2026-11-09",
                "crash-uncertain",
                "crash-hash",
                dependencies
            );
            await repository.authorizeDispatch(actor, uncertain.id, "generation");
            await expect(repository.expireUncertain(actor, uncertain.id)).rejects.toThrow(
                "review_reservation_not_expired"
            );
            await a.unsafe(
                "UPDATE pdr_ai_v2_vantage_weekly_review_runs SET created_at=now()-interval '121 seconds' WHERE id=$1",
                [uncertain.id]
            );
            expect((await repository.expireUncertain(actor, uncertain.id)).expired).toBe(true);
            expect(
                (
                    await repository.reserve(
                        actor,
                        "2026-11-09",
                        "crash-uncertain",
                        "crash-hash",
                        dependencies
                    )
                ).status
            ).toBe("failed");
            expect((await repository.expireUncertain(actor, first.id)).status).toBe("accepted");
            const next = await repository.reserve(
                actor,
                "2026-11-09",
                "next-valid",
                "next-hash",
                dependencies
            );
            await repository.authorizeDispatch(actor, next.id, "generation");
            await repository.authorizeDispatch(actor, next.id, "judge");
            await repository.accept(actor, next.id, {
                report,
                evidence: { ...evidence, candidateId: next.id },
                expectedActiveId: first.id,
            });
            await expect(
                repository.restore(actor, first.id, {
                    expectedActiveId: first.id,
                    key: "restore-stale",
                })
            ).rejects.toThrow("active_review_changed");
            const restored = await repository.restore(actor, first.id, {
                expectedActiveId: next.id,
                key: "restore-1",
            });
            expect(restored.replayed).toBe(false);
            expect(
                (
                    await repository.restore(actor, first.id, {
                        expectedActiveId: next.id,
                        key: "restore-1",
                    })
                ).replayed
            ).toBe(true);
            await expect(
                repository.restore(actor, first.id, {
                    expectedActiveId: first.id,
                    key: "restore-1",
                })
            ).rejects.toThrow("idempotency_conflict");
            permitted = false;
            await expect(repository.get(actor, first.id)).rejects.toThrow("revoked");
            await expect(
                repository.restore(actor, first.id, {
                    expectedActiveId: first.id,
                    key: "revoked-restore",
                })
            ).rejects.toThrow("revoked");
            expect(await repository.active(actor, "2026-11-09")).toBe(first.id);
            const down = await readFile(
                resolve(
                    process.cwd(),
                    "drizzle/rollback/20261109200000_vantage_weekly_reviews.sql"
                ),
                "utf8"
            );
            await expect(a.unsafe(down)).rejects.toMatchObject({ code: "23514" });
            await a.unsafe("SET app.vantage_weekly_review_enabled='true'");
            await expect(a.unsafe(down)).rejects.toMatchObject({ code: "23514" });
            await a.unsafe("SET app.vantage_weekly_review_enabled='off'");
            await a.unsafe(down);
            expect(
                (
                    await a.unsafe(
                        "SELECT id FROM pdr_ai_v2_vantage_weekly_review_runs WHERE id=$1",
                        [first.id]
                    )
                ).length
            ).toBe(1);
        } finally {
            configureSecretBox({ key: undefined });
            await a.end();
            await b.end();
            await admin.unsafe('DROP SCHEMA "' + schema + '" CASCADE');
            await admin.end();
        }
    }, 30000);
});

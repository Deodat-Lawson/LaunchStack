/** Persistent, opt-in synthetic UI seed. No model calls; never deletes or reseeds existing fixtures. */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { configureDatabase, createDb } from "@launchstack/store/client";
import { company, document, documentVersions } from "@launchstack/store/schema";
import {
    addTopicV1,
    generationSnapshot,
    generateWeeklyAgendaV1,
    getAgendaV1,
    getPendingHistoricalQuestionsV1,
    reportPeriod,
    saveGeneration,
    validateGenerationResult,
    vantageEvidence,
    type GenerationRuntime,
} from "@launchstack/pipelines/vantage";
import type { BusinessRoleContextV0 } from "@launchstack/pipelines/vantage/context-v0";
import { authAccount, authUser, users } from "~/server/db/schema";
import { seedSophiaCompositionFixtureV0 } from "~/server/vantage/experiments/sophia-fixture-v0";
import {
    SOPHIA_SYNTHETIC_COMPANY_PREFIX,
    SOPHIA_SYNTHETIC_DOCUMENT_PREFIX,
} from "~/server/vantage/experiments/sophia-composition-v0";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtimeDir = resolve(root, "test-output/vantage-context-demo/runtime");
const fixtureFile = resolve(runtimeDir, "fixture.json");
const credentialsFile = resolve(runtimeDir, "credentials.json");
const seedStateFile = resolve(runtimeDir, "seed-state.json");
const asOf = process.env.VANTAGE_CONTEXT_DEMO_AS_OF ?? "2026-10-26T23:59:00.000Z";
if (!Number.isFinite(Date.parse(asOf)))
    throw new Error("A real explicit fixture cutoff is required.");
// Explicit demo catalog, not a production retrieval/ranking policy. All eleven
// original synthetic documents remain untouched in PostgreSQL.
const demoDocumentKeys = [
    "company",
    "privacyStar",
    "deletionQa",
    "deletionCopy",
    "independentOps",
    "olderBlocker",
] as const;
interface Descriptor {
    schemaVersion: "vantage-context-demo/v1";
    fixtureId: string;
    companyId: string;
    actorId: string;
    documentIds: string[];
    starDocumentIds: string[];
    roleContext: BusinessRoleContextV0;
    roleProfileVersions: Record<string, string>;
    weeks: { weekStart: string; asOf: string; label: string }[];
}
interface SeedState {
    schemaVersion: "vantage-context-demo-seed/v1";
    fixtureId: string;
    priorSourceId: string;
    priorTopicId?: string;
    agendaIds: Record<string, string>;
}
function writeJson(path: string, value: unknown, create = false) {
    if (!resolve(path).startsWith(runtimeDir + sep)) throw new Error("Invalid seed output path.");
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n", {
        flag: create ? "wx" : "w",
        mode: 0o600,
    });
}
function databaseUrl(): string {
    const raw = process.env.VANTAGE_TL_TEST_DATABASE_URL;
    if (process.env.VANTAGE_TL_TEST_MODE !== "true" || !raw || process.env.DATABASE_URL !== raw)
        throw new Error("Explicit dedicated synthetic database required.");
    const target = new URL(raw);
    if (
        target.protocol !== "postgres:" ||
        target.hostname !== "127.0.0.1" ||
        !["55437", "55438"].includes(process.env.VANTAGE_CONTEXT_DEMO_DB_PORT ?? "55437") ||
        target.port !== (process.env.VANTAGE_CONTEXT_DEMO_DB_PORT ?? "55437") ||
        target.pathname !== "/vantage_week2_tl_contract_v1" ||
        target.username !== "vantage_week2_tl" ||
        target.search ||
        target.hash
    )
        throw new Error("Wrong synthetic database target.");
    return raw;
}

async function main() {
    if (
        process.env.VANTAGE_CONTEXT_DEMO_ENABLED !== "true" ||
        resolve(process.env.VANTAGE_CONTEXT_DEMO_FIXTURE ?? "") !== fixtureFile ||
        resolve(process.env.VANTAGE_CONTEXT_DEMO_CREDENTIALS ?? "") !== credentialsFile
    )
        throw new Error("The local runtime launcher must own this seed.");
    mkdirSync(runtimeDir, { recursive: true });
    const secrets = JSON.parse(readFileSync(credentialsFile, "utf8")) as {
        schemaVersion: string;
        loginPassword: string;
        loginEmail?: string;
        actorId?: string;
    };
    if (
        secrets.schemaVersion !== "vantage-context-demo-secrets/v1" ||
        !/^[a-f0-9]{48}$/.test(secrets.loginPassword)
    )
        throw new Error("Invalid local credentials.");
    const connection = createDb({ url: databaseUrl(), maxConnections: 5 });
    configureDatabase(connection.db);
    const database = connection.db;
    try {
        let descriptor: Descriptor;
        if (existsSync(fixtureFile)) {
            descriptor = JSON.parse(readFileSync(fixtureFile, "utf8")) as Descriptor;
            if (
                descriptor.schemaVersion !== "vantage-context-demo/v1" ||
                !/^[1-9]\d*$/.test(descriptor.companyId) ||
                descriptor.actorId !== `sophia-fixture-${descriptor.fixtureId}` ||
                descriptor.weeks.length !== 2 ||
                descriptor.weeks.some(
                    (week, index) =>
                        week.asOf !== asOf || week.weekStart !== ["2026-10-05", "2026-10-12"][index]
                )
            )
                throw new Error("Existing descriptor differs; it was preserved.");
        } else {
            const fixture = await seedSophiaCompositionFixtureV0(database);
            descriptor = {
                schemaVersion: "vantage-context-demo/v1",
                fixtureId: fixture.fixtureId,
                companyId: fixture.companyId,
                actorId: fixture.actorId,
                documentIds: demoDocumentKeys.map(key => fixture.docs[key].id),
                starDocumentIds: fixture.request.starDocumentIds.map(String),
                roleContext: fixture.request.roleContext,
                roleProfileVersions: { ...fixture.request.roleProfileVersions },
                weeks: ["2026-10-05", "2026-10-12"].map(weekStart => ({
                    weekStart,
                    asOf,
                    label: "Backfilled synthetic week",
                })),
            };
            // Fresh seed only: align explicit fixture state observations with the new demo cutoff.
            // This changes no recorded action status and supplies no approval/completion claim.
            for (const doc of [fixture.docs.olderBlocker, fixture.docs.olderResolved]) {
                const [version] = await database
                    .select()
                    .from(documentVersions)
                    .where(eq(documentVersions.id, Number(doc.versionId)));
                const metadata = structuredClone(version!.ocrMetadata) as {
                    text: string;
                    vantageSynthetic: { state: { asOf: string; value: string } };
                };
                metadata.vantageSynthetic.state.asOf = asOf;
                await database
                    .update(documentVersions)
                    .set({ ocrMetadata: metadata })
                    .where(eq(documentVersions.id, Number(doc.versionId)));
            }
            writeJson(fixtureFile, descriptor, true);
        }
        const companyId = BigInt(descriptor.companyId);
        const [owned] = await database
            .select({ name: company.name })
            .from(company)
            .where(eq(company.id, Number(companyId)));
        const [actor] = await database
            .select()
            .from(users)
            .where(and(eq(users.userId, descriptor.actorId), eq(users.companyId, companyId)));
        if (
            owned?.name !== `${SOPHIA_SYNTHETIC_COMPANY_PREFIX}${descriptor.fixtureId}` ||
            !actor?.email ||
            descriptor.roleContext.authenticatedPrincipalRef !== descriptor.actorId
        )
            throw new Error(
                "Synthetic actor/company descriptor mismatch; nothing was overwritten."
            );
        const catalogCreationKeys = demoDocumentKeys.map(
            key => `${SOPHIA_SYNTHETIC_DOCUMENT_PREFIX}${descriptor.fixtureId}/${key}`
        );
        const catalogRows = await database
            .select({ id: document.id, creationKey: document.creationKey })
            .from(document)
            .where(
                and(
                    eq(document.companyId, companyId),
                    inArray(document.creationKey, catalogCreationKeys)
                )
            );
        const catalogByKey = new Map(catalogRows.map(row => [row.creationKey, String(row.id)]));
        const boundedDocumentIds = catalogCreationKeys.map(key => catalogByKey.get(key));
        if (boundedDocumentIds.some(id => !id))
            throw new Error(
                "A bounded synthetic catalog source is missing; no deleted source was recreated."
            );
        const selectedDocumentIds = boundedDocumentIds as string[];
        if (JSON.stringify(descriptor.documentIds) !== JSON.stringify(selectedDocumentIds)) {
            // Authorized local-only selector change. Do not mutate source rows/profile/report/ledger.
            descriptor.documentIds = selectedDocumentIds;
            writeJson(fixtureFile, descriptor);
        }
        const [existingAuth] = await database
            .select()
            .from(authUser)
            .where(eq(authUser.id, descriptor.actorId));
        if (existingAuth && existingAuth.email !== actor.email)
            throw new Error("Existing authentication identity differs; it was preserved.");
        const time = new Date();
        if (!existingAuth)
            await database.insert(authUser).values({
                id: descriptor.actorId,
                name: actor.name ?? "Synthetic Vantage evaluator",
                email: actor.email,
                emailVerified: true,
                createdAt: time,
                updatedAt: time,
            });
        const [account] = await database
            .select()
            .from(authAccount)
            .where(eq(authAccount.id, `${descriptor.actorId}-credential`));
        if (
            account &&
            (account.userId !== descriptor.actorId ||
                account.providerId !== "credential" ||
                account.issuer !== "local:credential" ||
                account.accountId !== descriptor.actorId)
        )
            throw new Error("Existing credential identity differs; it was preserved.");
        if (
            account &&
            (!account.password ||
                !(await verifyPassword({
                    hash: account.password,
                    password: secrets.loginPassword,
                })))
        )
            throw new Error(
                "Saved local credential does not match the existing synthetic account; neither was changed."
            );
        if (!account)
            await database.insert(authAccount).values({
                id: `${descriptor.actorId}-credential`,
                issuer: "local:credential",
                accountId: descriptor.actorId,
                userId: descriptor.actorId,
                providerId: "credential",
                password: await hashPassword(secrets.loginPassword),
                createdAt: time,
                updatedAt: time,
            });
        secrets.loginEmail = actor.email!;
        secrets.actorId = descriptor.actorId;
        writeJson(credentialsFile, secrets);

        const seedState: SeedState = existsSync(seedStateFile)
            ? (JSON.parse(readFileSync(seedStateFile, "utf8")) as SeedState)
            : {
                  schemaVersion: "vantage-context-demo-seed/v1",
                  fixtureId: descriptor.fixtureId,
                  priorSourceId: `context-demo-${descriptor.fixtureId}-past`,
                  agendaIds: {},
              };
        if (seedState.fixtureId !== descriptor.fixtureId)
            throw new Error("Existing seed journal differs; no report was overwritten.");
        writeJson(seedStateFile, seedState);
        const [oldSource] = await database
            .select()
            .from(vantageEvidence)
            .where(eq(vantageEvidence.id, seedState.priorSourceId));
        if (oldSource && String(oldSource.companyId) !== descriptor.companyId)
            throw new Error("Synthetic source identity mismatch.");
        // Once a report exists, a missing source may reflect a later human deletion/revocation.
        // Re-running this helper must preserve that absence rather than restore the source.
        if (!oldSource && Object.keys(seedState.agendaIds).length === 0)
            await database.insert(vantageEvidence).values({
                id: seedState.priorSourceId,
                companyId,
                createdByUserId: descriptor.actorId,
                kind: "note",
                title: "Synthetic deletion acceptance review question",
                body: "The founder asks whether the deletion acceptance evidence is sufficient for a named privacy reviewer to assess pilot access. No privacy approval is recorded in this note.",
                source: "Synthetic founder review note, 2026-10-09",
                observedAt: "2026-10-09",
                visibility: "private",
                tags: ["synthetic", "context-demo", descriptor.fixtureId],
                createdAt: new Date("2026-10-09T16:00:00.000Z"),
                updatedAt: null,
            });
        const runtime: GenerationRuntime = {
            resolveModel: () => null,
            signal: new AbortController().signal,
            budgets: { attemptTimeoutMs: 20000, maxAttempts: 2, retryWaitMs: 1000, totalMs: 45000 },
        };
        for (const week of descriptor.weeks) {
            let agenda = await getAgendaV1(companyId, { weekStart: week.weekStart });
            if (!agenda && seedState.agendaIds[week.weekStart])
                throw new Error("A previously seeded report is missing; it was not recreated.");
            if (!agenda) {
                const snapshot = await generationSnapshot(
                    companyId,
                    reportPeriod(new Date(week.asOf), week.weekStart),
                    "rules",
                    { actorId: descriptor.actorId }
                );
                const result = validateGenerationResult(
                    snapshot.input,
                    await generateWeeklyAgendaV1(structuredClone(snapshot.input), runtime)
                );
                if (result.execution.mode !== "rules") throw new Error("Seed must be Rules only.");
                agenda = await saveGeneration(companyId, descriptor.actorId, snapshot, result);
            }
            seedState.agendaIds[week.weekStart] = agenda.id;
            if (week.weekStart === "2026-10-05") {
                const marker = `Explicit human-authored synthetic review question; fixture ${descriptor.fixtureId}.`;
                let topic = seedState.priorTopicId
                    ? agenda.topics.find(item => item.id === seedState.priorTopicId)
                    : agenda.topics.find(
                          item => item.origin === "founder" && item.rationale === marker
                      );
                if (!topic && !seedState.priorTopicId)
                    topic = await addTopicV1({
                        companyId,
                        agendaId: agenda.id,
                        input: {
                            title: "Deletion acceptance: privacy review remains unverified",
                            facts: [
                                {
                                    text: "The founder requested an acceptance review; the note records no privacy approval.",
                                    refs: [
                                        {
                                            ref: `ev:${seedState.priorSourceId}`,
                                            label: "Synthetic founder review note",
                                            date: "2026-10-09",
                                        },
                                    ],
                                },
                            ],
                            whyItMatters:
                                "The team needs a clear acceptance basis before pilot access is considered.",
                            decisionQuestion:
                                "What evidence should a named privacy reviewer compare before deciding whether deletion acceptance is ready?",
                            proposedNextStep:
                                "Compare the QA and operations account lists, document any sample differences, and ask a named privacy reviewer to record a decision.",
                            proposedOwner: null,
                            proposedDue: null,
                            helpRequested: null,
                            unknowns: [
                                "Progress and approval are unverified; no completion is inferred from missing feedback.",
                            ],
                            conflicts: [],
                            rationale: marker,
                            shared: false,
                        },
                    });
                if (topic) seedState.priorTopicId = topic.id;
            }
            writeJson(seedStateFile, seedState);
        }
        const current = await getAgendaV1(companyId, { weekStart: "2026-10-12" });
        const pending = await getPendingHistoricalQuestionsV1({
            companyId,
            agendaId: current!.id,
            actorId: descriptor.actorId,
        });
        const finalSnapshot = await generationSnapshot(
            companyId,
            reportPeriod(new Date(asOf), "2026-10-12"),
            "rules",
            { actorId: descriptor.actorId }
        );
        // Verify retained ledger identity, including explicit review tombstones and withheld
        // sources, without reintroducing a question that a person has already closed.
        if (
            !finalSnapshot.pendingHistoricalState.questions.some(
                item =>
                    item.questionId === seedState.priorTopicId &&
                    item.originWeekStart === "2026-10-05"
            )
        )
            throw new Error(
                "The persisted current report did not carry the exact prior human question."
            );
        const proof = {
            schemaVersion: "vantage-context-demo-seed-proof/v1",
            syntheticOnly: true,
            backfilled: true,
            fixtureId: descriptor.fixtureId,
            actorId: descriptor.actorId,
            accountEmail: actor.email,
            companyId: descriptor.companyId,
            reportIds: seedState.agendaIds,
            priorQuestionId: seedState.priorTopicId,
            pendingQuestionIds: pending.questions.map(item => item.questionId),
            priorQuestionReview:
                finalSnapshot.pendingHistoricalState.reviews[seedState.priorTopicId!] ?? null,
            unavailableQuestionCount: pending.unavailableCount,
            recordCounts: {
                nativeReports: Object.keys(seedState.agendaIds).length,
                documentSelectors: descriptor.documentIds.length,
                starredDocumentSelectors: descriptor.starDocumentIds.length,
                currentNativeEvidence: finalSnapshot.input.data.currentEvidence.length,
                pendingVisible: pending.questions.length,
                pendingRetained: finalSnapshot.pendingHistoricalState.questions.length,
                explicitPendingReviews: Object.keys(finalSnapshot.pendingHistoricalState.reviews)
                    .length,
            },
            catalogPolicy: "explicit-demo-six-sources/v1",
            catalogOmittedOriginalDocumentCount: 5,
            actualSeededAt: new Date().toISOString(),
            nativeGenerationMode: current!.execution?.mode ?? null,
            modelCalled: false,
            actionsCreatedBySeed: 0,
            notes: "Native repository generationSnapshot/saveGeneration/addTopicV1 APIs; no contract-state handcrafting; no historical timestamp rewrites; no approval invented.",
        };
        const proofFile = resolve(runtimeDir, `seed-proof-${Date.now()}-${randomUUID()}.json`);
        writeJson(proofFile, proof, true);
        console.log(
            `[context-demo] Prepared/verified persistent synthetic fixture ${descriptor.fixtureId}; native Oct05/Oct12 reports and retained exact pending lineage verified. No model call.`
        );
    } finally {
        await connection.close();
    }
}

main().catch(() => {
    console.error(
        "[context-demo] Synthetic native seed unavailable; existing rows and local credential files were preserved."
    );
    process.exitCode = 1;
});

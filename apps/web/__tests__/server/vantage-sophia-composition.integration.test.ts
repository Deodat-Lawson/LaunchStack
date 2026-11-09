/** @jest-environment node */
/** Actual synthetic PostgreSQL, real ACL/profile/retrieval/assembly; session and Joseph are doubles. */
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { eq } from "drizzle-orm";
import { configureDatabase, createDb, type Db, type DbClient } from "@launchstack/store/client";
import { document, documentVersions } from "@launchstack/store/schema";
import { companyMetadata } from "@launchstack/tools/company-context/schema";
import {
    vantageAgendas,
    vantageEvidence,
    type GenerationRuntime,
} from "@launchstack/pipelines/vantage";
import {
    contextSourceKeyV0,
    type ContextGenerationEnvelopeV0,
    type GuardedCommitInputV0,
} from "@launchstack/pipelines/vantage/context-v0";
import type { ResolvedChatModel } from "@launchstack/llm";
import { coerceMessageLikeToMessage } from "@langchain/core/messages";
import { documentGrants } from "~/server/db/schema";

let mockRealDb: DbClient;
const mockSession = jest.fn<Promise<{ user: { id: string } } | null>, []>();
jest.mock("~/server/db", () => ({
    get db() {
        return mockRealDb;
    },
}));
jest.mock("~/server/auth", () => ({ getServerSession: () => mockSession() }));
jest.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { createSophiaCompositionExperimentV0 } from "~/server/vantage/experiments/sophia-composition-v0";
import { seedSophiaCompositionFixtureV0 } from "~/server/vantage/experiments/sophia-fixture-v0";
import type { CompanyArchitectureTransactionV0 } from "~/server/vantage/company-architecture";
import { createSophiaContextGenerationExperimentV0 } from "../../../../pipelines/src/vantage/experiments/sophia-generation-v0";

const url = process.env.VANTAGE_TL_TEST_DATABASE_URL;
if (url) {
    const target = new URL(url);
    if (
        target.hostname !== "127.0.0.1" ||
        target.port !== "55437" ||
        target.pathname !== "/vantage_week2_tl_contract_v1"
    )
        throw new Error("Dedicated isolated TL verification database required.");
}
const suite = url ? describe : describe.skip;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

suite("Actual PostgreSQL Sophia composition experiment", () => {
    jest.setTimeout(process.env.VANTAGE_SOPHIA_LIVE === "true" ? 180000 : 60000);
    let connection: Db;
    let fixture: Awaited<ReturnType<typeof seedSophiaCompositionFixtureV0>>;
    let service: ReturnType<typeof createSophiaCompositionExperimentV0>;
    let keepFixture = false;
    beforeAll(async () => {
        connection = createDb({ url: url!, maxConnections: 12 });
        mockRealDb = connection.db;
        configureDatabase(connection.db);
    });
    beforeEach(async () => {
        fixture = await seedSophiaCompositionFixtureV0(mockRealDb);
        mockSession.mockResolvedValue({ user: { id: fixture.actorId } });
        service = createSophiaCompositionExperimentV0({
            syntheticOnly: true,
            database: mockRealDb,
            resolveJosephFixture: fixture.resolveJosephFixture,
            now: () => new Date(fixture.request.reportWindow.asOf),
        });
        keepFixture = false;
    });
    afterEach(async () => {
        if (!keepFixture) await fixture.cleanup();
    });
    afterAll(async () => {
        await connection?.close();
    });
    const prepare = () => service.prepare(fixture.request);
    const envelope = (
        prepared: Awaited<ReturnType<typeof prepare>>
    ): ContextGenerationEnvelopeV0 => ({
        v1Input: fixture.nativeGenerationInput,
        manifest: prepared.context.manifest,
        evidenceSnapshot: prepared.context.evidenceSnapshot,
        freeze: prepared.context.freeze,
    });
    async function persistReceipt(
        transaction: CompanyArchitectureTransactionV0,
        binding: GuardedCommitInputV0,
        id = randomUUID()
    ) {
        await transaction.insert(vantageAgendas).values({
            id,
            companyId: BigInt(fixture.companyId),
            createdByUserId: fixture.actorId,
            weekStart: fixture.nativeGenerationInput.reportPeriod.weekStart,
            status: "draft",
            summary: binding.generated.v1Result.draft.summary,
            modelMetadata: {
                experimentalReceiptOnly: true,
                contextFingerprint: binding.envelope.manifest.contextFingerprint,
            },
        });
        return { syntheticOnly: true as const, agendaId: id };
    }

    async function generated(
        prepared: Awaited<ReturnType<typeof prepare>>,
        nativeInput = fixture.nativeGenerationInput,
        duringGeneration?: () => Promise<void>
    ) {
        const context = { ...envelope(prepared), v1Input: nativeInput };
        const nativeRef = `ev:${fixture.nativeGenerationInput.data.currentEvidence[0]!.id}`;
        const doc = context.evidenceSnapshot.entries.find(
            entry => entry.source.id === `workspace-document/${fixture.docs.independentOps.id}`
        )!;
        const topic = (ref: string) => ({
            title: "Compare the recorded deletion samples",
            facts: [
                {
                    text: "The supplied record describes its synthetic deletion sample.",
                    refs: [ref],
                },
            ],
            whyItMatters:
                "A shared sample comparison could clarify the differing accounts; completion is not inferred.",
            decisionQuestion: "Which account identifiers should the reviewers compare first?",
            proposedNextStep:
                "Compare the QA and operations sample identifiers for run-17 and record overlapping and unmatched accounts.",
            proposedOwner: null,
            proposedDueInDays: null,
            helpRequested: null,
            unknowns: ["Whether both records describe the same sample."],
            conflicts: [],
            rationale: "Uses only the supplied synthetic accounts.",
        });
        const invoke: NonNullable<
            Parameters<typeof createSophiaContextGenerationExperimentV0>[0]
        > = async <T>() => {
            await duringGeneration?.();
            return {
                result: {
                    native: {
                        summary:
                            "The supplied synthetic deletion account needs a sample comparison.",
                        topics: [topic(nativeRef)],
                        enhancements: [],
                    },
                    experimental: {
                        summary:
                            "The independent synthetic account should be compared with QA before privacy approval is inferred.",
                        topics: [topic(contextSourceKeyV0(doc.source))],
                        enhancements: [],
                    },
                } as T,
                usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
            };
        };
        const model = {
            modelId: "synthetic-no-provider-call",
            behavior: { parameters: { systemMessages: "supported" } },
            prepareMessages: (messages: Parameters<ResolvedChatModel["prepareMessages"]>[0]) =>
                messages.map(coerceMessageLikeToMessage),
        } as unknown as ResolvedChatModel;
        const runtime: GenerationRuntime = {
            resolveModel: () => model,
            signal: new AbortController().signal,
            budgets: { attemptTimeoutMs: 20000, maxAttempts: 2, retryWaitMs: 1000, totalMs: 45000 },
        };
        return {
            envelope: context,
            ...(await createSophiaContextGenerationExperimentV0(invoke)(context, runtime)),
        };
    }

    it("uses actual native versions, Company Architecture once, actor stars, two roles and the real retrieval/assembler", async () => {
        const prepared = await prepare(),
            selected = prepared.context.manifest.selectedRefs;
        expect(selected.filter(ref => ref.kind === "company")).toHaveLength(1);
        expect([...prepared.context.manifest.roleIds].sort()).toEqual(["engineering", "founder"]);
        expect(
            selected.some(
                ref =>
                    ref.id === `workspace-document/${fixture.docs.privacyStar.id}` &&
                    ref.version === fixture.docs.privacyStar.versionId
            )
        ).toBe(true);
        expect(
            prepared.context.manifest.personalStarVersions[
                `workspace-document/${fixture.docs.privacyStar.id}`
            ]
        ).toBe(fixture.docs.privacyStar.versionId);
        expect(
            prepared.context.manifest.retrievalState.selectedRefs.some(
                ref => ref.id === `workspace-document/${fixture.docs.olderBlocker.id}`
            )
        ).toBe(true);
        expect(
            prepared.sourceRecords.find(
                record =>
                    record.source.id === `workspace-document/${fixture.docs.independentOps.id}`
            )?.source.version
        ).toBe(fixture.docs.independentOps.versionId);
        expect(prepared.context.research.mode).toBe("STOP");
        await expect(service.assertFresh(prepared)).resolves.toBe(prepared);
    });

    it("never exposes foreign/ungranted source identities or text", async () => {
        const prepared = await prepare(),
            json = JSON.stringify(prepared);
        expect(prepared.optionalUnavailableCount).toBe(2);
        expect(json).not.toMatch(/SECRET_UNAUTHORIZED|SECRET_FOREIGN/);
        expect(json).not.toContain(`workspace-document/${fixture.docs.hidden.id}`);
        expect(json).not.toContain(`workspace-document/${fixture.docs.foreign.id}`);
    });

    it("collapses the exact connector copy but retains independent conflicting run-17 accounts", async () => {
        const prepared = await prepare();
        const selected = prepared.context.manifest.selectedRefs.map(ref => ref.id);
        expect(
            selected.filter(id =>
                [fixture.docs.deletionQa.id, fixture.docs.deletionCopy.id].some(
                    doc => id === `workspace-document/${doc}`
                )
            )
        ).toHaveLength(1);
        expect(selected).toContain(`workspace-document/${fixture.docs.independentOps.id}`);
        const text = prepared.context.evidenceSnapshot.entries
            .map(entry => entry.excerpt)
            .join("\n");
        expect(text).toContain("3 of 3");
        expect(text).toContain("2 of 3");
        expect(
            prepared.context.manifest.omissions.some(omission => omission.reason === "duplicate")
        ).toBe(true);
    });

    it("does not turn a kept historical question into authoritative older-open work", async () => {
        const prepared = await prepare();
        const olderLane = prepared.context.manifest.retrievalState.laneProvenance.filter(
            item => item.source.id === `workspace-document/${fixture.docs.pendingQuestion.id}`
        );
        expect(
            olderLane.every(item =>
                item.reasons.every(reason => !reason.includes("Older unresolved item"))
            )
        ).toBe(true);
        const blocker = prepared.context.manifest.retrievalState.laneProvenance.find(
            item => item.source.id === `workspace-document/${fixture.docs.olderBlocker.id}`
        );
        expect(blocker?.reasons.some(reason => reason.includes("Older unresolved item"))).toBe(
            true
        );
    });

    it("reserves Company Architecture and required star before optional source capacity", async () => {
        const request = structuredClone(fixture.request);
        request.budgets.maxSources = 2;
        const prepared = await service.prepare(request);
        expect(prepared.context.evidenceSnapshot.entries).toHaveLength(2);
        expect(
            prepared.context.manifest.selectedRefs.some(
                ref => ref.id === `workspace-document/${fixture.docs.privacyStar.id}`
            )
        ).toBe(true);
        expect(prepared.context.manifest.status).toBe("partial");
    });

    it("rejects insufficient required budgets and a partial canonical profile", async () => {
        const request = structuredClone(fixture.request);
        request.budgets.maxExcerptChars = 100;
        await expect(service.prepare(request)).rejects.toMatchObject({
            code: "required_architecture_unavailable",
        });
        const rows = await mockRealDb
            .select({ metadata: companyMetadata.metadata })
            .from(companyMetadata)
            .where(eq(companyMetadata.companyId, BigInt(fixture.companyId)));
        const metadata = structuredClone(rows[0]!.metadata);
        metadata.policies.hidden = {
            ...metadata.company.description!,
            value: "SECRET_UNAUTHORIZED_PROFILE",
            sources: [
                {
                    doc_id: Number(fixture.docs.hidden.id),
                    version_id: Number(fixture.docs.hidden.versionId),
                    doc_name: "Hidden",
                    quote: "Hidden",
                    extracted_at: "2026-10-16T16:00:00Z",
                },
            ],
        };
        await mockRealDb
            .update(companyMetadata)
            .set({ metadata, updatedAt: new Date("2026-10-16T16:00:00Z") })
            .where(eq(companyMetadata.companyId, BigInt(fixture.companyId)));
        await expect(prepare()).rejects.toMatchObject({
            code: "required_architecture_unavailable",
        });
    });

    it("requires current permission for a human privacy star", async () => {
        await mockRealDb
            .delete(documentGrants)
            .where(eq(documentGrants.documentId, BigInt(fixture.docs.privacyStar.id)));
        await expect(prepare()).rejects.toMatchObject({ code: "required_star_unavailable" });
    });

    it("ignores a malicious out-of-catalog search hit without leaking its payload", async () => {
        const prepared = await service.prepare(fixture.request, {
            search: {
                search: async () => ({
                    hits: [
                        {
                            source: { kind: "doc", id: "SECRET_FORGED_SOURCE", version: "1" },
                            title: "SECRET_FORGED_BODY",
                        },
                    ],
                    truncated: false,
                }),
            },
        });
        expect(JSON.stringify(prepared)).not.toMatch(/SECRET_FORGED_SOURCE|SECRET_FORGED_BODY/);
        expect(prepared.context.manifest.selectedRefs).toHaveLength(2);
    });

    it.each(["content", "metadata", "version"])(
        "rejects optional native %s drift after preparation",
        async mutation => {
            const prepared = await prepare();
            if (mutation === "version")
                await mockRealDb
                    .update(document)
                    .set({
                        currentVersionId: BigInt(fixture.docs.olderBlocker.versionId),
                        updatedAt: new Date("2026-10-16T16:00:00Z"),
                    })
                    .where(eq(document.id, Number(fixture.docs.independentOps.id)));
            else
                await mockRealDb
                    .update(documentVersions)
                    .set({
                        ocrMetadata: {
                            text:
                                mutation === "content"
                                    ? "Changed synthetic operations sample."
                                    : fixture.docs.independentOps.text,
                            vantageSynthetic: { revisionNote: "Changed native metadata" },
                        },
                    })
                    .where(eq(documentVersions.id, Number(fixture.docs.independentOps.versionId)));
            await expect(service.assertFresh(prepared)).rejects.toMatchObject({
                code: "stale_optional_sources",
            });
        }
    );

    it("rejects ACL/session and mutable Joseph fixture changes during the generation interval", async () => {
        const prepared = await prepare();
        const joseph = await fixture.resolveJosephFixture();
        joseph.roleProfileVersions.engineering = "changed-v2";
        fixture.replaceJosephFixture(joseph);
        await expect(service.assertFresh(prepared)).rejects.toMatchObject({
            code: "role_or_star_fixture_changed",
        });
        mockSession.mockResolvedValue(null);
        await expect(service.assertFresh(prepared)).rejects.toBeDefined();
    });

    it("accepts only the opaque owned preparation and performs the real TL guarded generated-result binding", async () => {
        const prepared = await prepare(),
            output = await generated(prepared);
        const persist = jest.fn(persistReceipt);
        await expect(
            service.commitGenerated(
                structuredClone(prepared),
                { envelope: output.envelope, generated: output.generated },
                persist
            )
        ).rejects.toMatchObject({ code: "unrecognized_preparation" });
        const receipt = await service.commitGenerated(
            prepared,
            { envelope: output.envelope, generated: output.generated },
            persist
        );
        expect(receipt).toMatchObject({ syntheticOnly: true });
        if (!("agendaId" in receipt)) throw new Error("Missing synthetic receipt identity");
        const stored = await mockRealDb
            .select()
            .from(vantageAgendas)
            .where(eq(vantageAgendas.id, receipt.agendaId));
        expect(stored).toHaveLength(1);
        expect(stored[0]?.modelMetadata?.experimentalReceiptOnly).toBe(true);
        expect(persist).toHaveBeenCalledTimes(1);
        const forged = structuredClone(output.generated);
        forged.manifestFingerprint = "wrong-fingerprint";
        await expect(
            service.commitGenerated(
                prepared,
                { envelope: output.envelope, generated: forged },
                persist
            )
        ).rejects.toBeDefined();
        expect(persist).toHaveBeenCalledTimes(1);
    });

    it("rolls back an owned agenda-only experimental receipt when its callback fails", async () => {
        const prepared = await prepare(),
            output = await generated(prepared),
            id = randomUUID();
        await expect(
            service.commitGenerated(
                prepared,
                { envelope: output.envelope, generated: output.generated },
                async (transaction, binding) => {
                    await persistReceipt(transaction, binding, id);
                    throw new Error("Synthetic rollback probe");
                }
            )
        ).rejects.toThrow("Synthetic rollback probe");
        expect(
            await mockRealDb.select().from(vantageAgendas).where(eq(vantageAgendas.id, id))
        ).toHaveLength(0);
    });

    it("rejects a forged native body that retains the authentic stored inputVersion", async () => {
        const request = structuredClone(fixture.request);
        request.nativeInput.data.currentEvidence[0]!.body = "Forged synthetic current-world claim.";
        const prepared = await service.prepare(request);
        const output = await generated(prepared, request.nativeInput);
        const persist = jest.fn(persistReceipt);
        await expect(
            service.commitGenerated(
                prepared,
                { envelope: output.envelope, generated: output.generated },
                persist
            )
        ).rejects.toMatchObject({ code: "stale_native_input" });
        expect(persist).not.toHaveBeenCalled();
    });

    it("blocks native v1 evidence drift at final generated commit without saving agenda/actions", async () => {
        const prepared = await prepare(),
            output = await generated(prepared);
        await mockRealDb
            .update(vantageEvidence)
            .set({
                body: "Changed synthetic v1 evidence.",
                updatedAt: new Date("2026-10-16T17:00:00Z"),
            })
            .where(
                eq(vantageEvidence.id, fixture.nativeGenerationInput.data.currentEvidence[0]!.id)
            );
        const persist = jest.fn(async () => ({ syntheticOnly: true }));
        await expect(
            service.commitGenerated(
                prepared,
                { envelope: output.envelope, generated: output.generated },
                persist
            )
        ).rejects.toMatchObject({ code: "stale_native_input" });
        expect(persist).not.toHaveBeenCalled();
    });

    it.each(["document-acl", "document-text", "company-profile"])(
        "blocks %s changes inside the mocked generation call before the final receipt",
        async mutation => {
            const prepared = await prepare();
            const output = await generated(prepared, fixture.nativeGenerationInput, async () => {
                if (mutation === "document-acl")
                    await mockRealDb
                        .delete(documentGrants)
                        .where(eq(documentGrants.documentId, BigInt(fixture.docs.privacyStar.id)));
                else if (mutation === "document-text")
                    await mockRealDb
                        .update(documentVersions)
                        .set({
                            ocrMetadata: {
                                text: "Changed operations account during generation.",
                                vantageSynthetic: {},
                            },
                        })
                        .where(
                            eq(documentVersions.id, Number(fixture.docs.independentOps.versionId))
                        );
                else
                    await mockRealDb
                        .update(companyMetadata)
                        .set({
                            buildStatus: "building",
                            buildStartedAt: new Date("2026-10-16T17:00:00Z"),
                        })
                        .where(eq(companyMetadata.companyId, BigInt(fixture.companyId)));
            });
            expect(output.generated.v1Result.execution.mode).toBe("ai");
            const persist = jest.fn(persistReceipt);
            await expect(
                service.commitGenerated(
                    prepared,
                    { envelope: output.envelope, generated: output.generated },
                    persist
                )
            ).rejects.toBeDefined();
            expect(persist).not.toHaveBeenCalled();
        }
    );

    it("emits a reusable actual-PG envelope for separate A/B provider evaluation", async () => {
        const prepared = await prepare();
        const outputDirectory = process.env.VANTAGE_SOPHIA_COMPOSITION_ARTIFACT_DIR;
        if (!outputDirectory) return;
        const sourceRoot = resolve(__dirname, "../../../.."),
            ignoredRoot = resolve(sourceRoot, "test-output");
        const destination = resolve(outputDirectory);
        if (!destination.startsWith(ignoredRoot + sep))
            throw new Error(
                "Composition artifact must stay under the ignored source test-output directory."
            );
        keepFixture = process.env.VANTAGE_SOPHIA_KEEP_FIXTURE === "true";
        mkdirSync(destination, { recursive: true });
        const path = resolve(destination, `sophia-composition-${fixture.fixtureId}.json`);
        writeFileSync(
            path,
            JSON.stringify(
                {
                    syntheticOnly: true,
                    fixtureId: fixture.fixtureId,
                    companyId: fixture.companyId,
                    actorId: fixture.actorId,
                    request: fixture.request,
                    docs: fixture.docs,
                    sourceSnapshotFingerprint: prepared.sourceSnapshotFingerprint,
                    nativeInputHash: hash(fixture.nativeGenerationInput),
                    retainedOwnedFixture: keepFixture,
                    envelope: envelope(prepared),
                    sourceRecords: prepared.sourceRecords,
                    optionalUnavailableCount: prepared.optionalUnavailableCount,
                    limitations: [
                        "Actual native PostgreSQL profile/document/evidence and ACL reads; session/cookie and Joseph role/star discovery are synthetic test doubles.",
                        "Sophia retrieval and TL assembly are real, using the explicit native authorized catalog; no live RAG, embedding, public research or model call in this preparation.",
                        "No production routes or action statuses are changed. An opt-in live run saves one owned synthetic agenda-only receipt after native/context freshness guards; no generated topic/action save is claimed.",
                    ],
                },
                null,
                2
            ),
            { flag: "wx" }
        );
        console.log(`Synthetic Sophia composition artifact: ${path}`);
        if (process.env.VANTAGE_SOPHIA_LIVE === "true") {
            const outputDirectory = resolve(destination, `live-${fixture.fixtureId}`);
            const secretValues = [
                process.env.CHAT_API_KEY,
                process.env.CHAT_BASE_URL,
                process.env.CHAT_BASE_URL ? new URL(process.env.CHAT_BASE_URL).hostname : undefined,
            ].filter((value): value is string => !!value);
            const sanitize = (text: string) =>
                secretValues.reduce((safe, value) => safe.split(value).join("[REDACTED]"), text);
            const logs: string[] = [];
            const exitCode = await new Promise<number | null>((fulfilled, rejected) => {
                const child = spawn(
                    process.execPath,
                    [
                        "--import",
                        "tsx",
                        resolve(
                            sourceRoot,
                            "pipelines/scripts/vantage-sophia-generation-experiment.mjs"
                        ),
                        "--live",
                        "--input",
                        path,
                        "--output",
                        outputDirectory,
                    ],
                    { cwd: sourceRoot, env: process.env, windowsHide: true }
                );
                child.stdout.on("data", data => logs.push(sanitize(String(data))));
                child.stderr.on("data", data => logs.push(sanitize(String(data))));
                child.on("error", rejected);
                child.on("close", fulfilled);
            });
            writeFileSync(resolve(destination, `live-${fixture.fixtureId}.log`), logs.join(""), {
                flag: "wx",
            });
            expect(exitCode).toBe(0);
            const result = JSON.parse(
                readFileSync(resolve(outputDirectory, "b-context.result.json"), "utf8")
            ) as {
                liveModelSuccess: boolean;
                result: Awaited<
                    ReturnType<ReturnType<typeof createSophiaContextGenerationExperimentV0>>
                >;
            };
            expect(result.liveModelSuccess).toBe(true);
            const receipt = await service.commitGenerated(
                prepared,
                { envelope: envelope(prepared), generated: result.result.generated },
                persistReceipt
            );
            if (!("agendaId" in receipt))
                throw new Error("Missing live synthetic receipt identity");
            const stored = await mockRealDb
                .select()
                .from(vantageAgendas)
                .where(eq(vantageAgendas.id, receipt.agendaId));
            expect(stored).toHaveLength(1);
            writeFileSync(
                resolve(destination, `live-${fixture.fixtureId}.guarded-receipt.json`),
                JSON.stringify(
                    {
                        syntheticOnly: true,
                        fixtureId: fixture.fixtureId,
                        receipt,
                        stored,
                        meaning:
                            "Owned synthetic agenda-only transaction receipt after actual TL/native/context guards; no production report/topic/action save.",
                    },
                    (_, value) => (typeof value === "bigint" ? value.toString() : value),
                    2
                ),
                { flag: "wx" }
            );
            console.log(`Synthetic live guarded receipt: ${receipt.agendaId}`);
        }
    });
});

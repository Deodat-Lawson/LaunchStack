import { describe, expect, it } from "vitest";
import examples from "../../../../docs/design/examples/weekly-decision-agenda-v1.json";
import normalFixture from "../../../../fixtures/vantage-context-v0/normal.json";
import type { GenerationResult } from "../contract-v1";
import {
    ContextPortErrorV0,
    commitContextGeneration,
    runContextV0Pipeline,
    runContextV0Generation,
    sanitizeResearchPlan,
    wrapExistingGenerationPort,
} from "./adapters";
import { createFixtureV0Ports as createFixturePorts, createMockTransaction } from "./mocks";
import type { FixtureV0Input, FixtureV0Overrides } from "./mocks";
import type { ContextGenerationEnvelopeV0, GenerationRuntime } from "./ports";

const fixtureInput = normalFixture as unknown as FixtureV0Input;
const createFixtureV0Ports = (overrides: FixtureV0Overrides = {}) =>
    createFixturePorts(fixtureInput, overrides);
const compatibleV1Input = {
    ...structuredClone(examples.internal.input),
    reportPeriod: {
        ...examples.internal.input.reportPeriod,
        startInclusive: "2026-10-12T00:00:00Z",
        endExclusive: "2026-10-19T00:00:00Z",
        asOf: "2026-10-19T12:00:00Z",
    },
};

const result = examples.internal.success as unknown as GenerationResult;
result.signals.since = "2026-10-12";
result.signals.computedAt = "2026-10-19T12:00:00Z";
const runtime = {
    resolveModel: () => null,
    signal: new AbortController().signal,
    budgets: { attemptTimeoutMs: 20000, maxAttempts: 2, retryWaitMs: 1000, totalMs: 45000 },
} as GenerationRuntime;

describe("Vantage context v0 adapters", () => {
    it("runs all replaceable ports and makes STOP explicit when no research planner exists", async () => {
        const ports = createFixtureV0Ports();
        const output = await runContextV0Pipeline(
            {
                principalRef: "user-joseph",
                companyId: "company-tilde",
                reportWindow: {
                    startInclusive: "2026-10-12T00:00:00Z",
                    endExclusive: "2026-10-19T00:00:00Z",
                    asOf: "2026-10-19T12:00:00Z",
                },
                budgets: {
                    maxSources: 20,
                    maxExcerptChars: 8000,
                    timeoutMs: 5000,
                    maxQueries: 2,
                    maxTokens: 1200,
                },
                runId: "run-demo-1",
                inputVersion: "input-v0-1",
            },
            ports
        );
        expect(output.research.mode).toBe("STOP");
        expect(output.research.status).toBe("stopped");
        expect(output.manifest.contextFingerprint).toMatch(/^[a-f0-9]+$/);
    });

    it("rejects unresolved mandatory context before retrieval or public research", async () => {
        const ports = createFixtureV0Ports({
            requiredContext: {
                ...createFixtureV0Ports().fixture.requiredContext,
                status: "partial",
                coverage: {
                    ...createFixtureV0Ports().fixture.requiredContext.coverage,
                    missing: [{ kind: "doc", id: "missing", version: "v1" }],
                },
            },
        });
        await expect(
            runContextV0Pipeline(
                {
                    principalRef: "user-joseph",
                    companyId: "company-tilde",
                    reportWindow: {
                        startInclusive: "2026-10-12T00:00:00Z",
                        endExclusive: "2026-10-19T00:00:00Z",
                        asOf: "2026-10-19T12:00:00Z",
                    },
                    budgets: {
                        maxSources: 20,
                        maxExcerptChars: 8000,
                        timeoutMs: 5000,
                        maxQueries: 2,
                        maxTokens: 1200,
                    },
                    runId: "run-demo-1",
                    inputVersion: "input-v0-1",
                },
                ports
            )
        ).rejects.toMatchObject({ status: 409 });
    });

    it("binds required context to the trusted actor ACL and report cutoff", async () => {
        const ports = createFixtureV0Ports();
        const required = structuredClone(ports.fixture.requiredContext);
        required.actor.aclDigest = "stale-acl";
        ports.roles.resolveRequiredContext = async () => required;
        await expect(
            runContextV0Pipeline(
                {
                    principalRef: "user-joseph",
                    companyId: "company-tilde",
                    reportWindow: {
                        startInclusive: "2026-10-12T00:00:00Z",
                        endExclusive: "2026-10-19T00:00:00Z",
                        asOf: "2026-10-19T12:00:00Z",
                    },
                    budgets: {
                        maxSources: 20,
                        maxExcerptChars: 8000,
                        timeoutMs: 5000,
                        maxQueries: 2,
                        maxTokens: 1200,
                    },
                    runId: "run-demo-1",
                    inputVersion: "input-v0-1",
                },
                ports
            )
        ).rejects.toMatchObject({ status: 403 });
        const ports2 = createFixtureV0Ports();
        const required2 = structuredClone(ports2.fixture.requiredContext);
        required2.asOf = "2026-10-18T12:00:00Z";
        ports2.roles.resolveRequiredContext = async () => required2;
        await expect(
            runContextV0Pipeline(
                {
                    principalRef: "user-joseph",
                    companyId: "company-tilde",
                    reportWindow: {
                        startInclusive: "2026-10-12T00:00:00Z",
                        endExclusive: "2026-10-19T00:00:00Z",
                        asOf: "2026-10-19T12:00:00Z",
                    },
                    budgets: {
                        maxSources: 20,
                        maxExcerptChars: 8000,
                        timeoutMs: 5000,
                        maxQueries: 2,
                        maxTokens: 1200,
                    },
                    runId: "run-demo-1",
                    inputVersion: "input-v0-1",
                },
                ports2
            )
        ).rejects.toMatchObject({ status: 409 });
    });

    it("resolves internal research refs against the trusted catalog before invoking Sophia", async () => {
        const ports = createFixtureV0Ports();
        let called = false;
        ports.planResearch = () => ({
            contractVersion: "v0-proposed",
            mode: "internal",
            gapPurpose: "check",
            internalSourceRefs: [{ kind: "doc", id: "missing", version: "v1" }],
            publicSafeQueryProjection: [],
            budgets: {
                maxSources: 2,
                maxExcerptChars: 100,
                timeoutMs: 100,
                maxQueries: 1,
                maxTokens: 100,
            },
        });
        ports.research = {
            research: async () => {
                called = true;
                return ports.fixture.research;
            },
        };
        await expect(
            runContextV0Pipeline(
                {
                    principalRef: "user-joseph",
                    companyId: "company-tilde",
                    reportWindow: {
                        startInclusive: "2026-10-12T00:00:00Z",
                        endExclusive: "2026-10-19T00:00:00Z",
                        asOf: "2026-10-19T12:00:00Z",
                    },
                    budgets: {
                        maxSources: 20,
                        maxExcerptChars: 8000,
                        timeoutMs: 5000,
                        maxQueries: 2,
                        maxTokens: 1200,
                    },
                    runId: "run-demo-1",
                    inputVersion: "input-v0-1",
                },
                ports
            )
        ).rejects.toMatchObject({ status: 404 });
        expect(called).toBe(false);
    });

    it("sends public research only the server-bound query projection", async () => {
        const ports = createFixtureV0Ports();
        let received: any;
        ports.trustedPublicProjections = [
            { projectionId: "p", query: "approved query", approvalToken: "psqv0_public-1" },
        ];
        ports.planResearch = () => ({
            contractVersion: "v0-proposed",
            mode: "public",
            gapPurpose: "PRIVATE gap text",
            internalSourceRefs: [{ kind: "doc", id: "private-note", version: "v1" }],
            publicSafeQueryProjection: [
                {
                    projectionId: "p",
                    query: "approved query",
                    purpose: "PRIVATE purpose",
                    approvalToken: "psqv0_public-1",
                    validatedAt: "2026-10-19T11:30:00Z",
                    unknown: "strip",
                },
            ],
            budgets: {
                maxSources: 2,
                maxExcerptChars: 100,
                timeoutMs: 100,
                maxQueries: 1,
                maxTokens: 100,
            },
        });
        ports.research = {
            research: async plan => {
                received = plan;
                return {
                    ...ports.fixture.research,
                    mode: "public",
                    gapPurpose: plan.gapPurpose,
                    publicSafeQueryProjection: plan.publicSafeQueryProjection,
                    internalSourceRefs: [],
                    citations: [],
                    status: "partial",
                };
            },
        };
        await runContextV0Pipeline(
            {
                principalRef: "user-joseph",
                companyId: "company-tilde",
                reportWindow: {
                    startInclusive: "2026-10-12T00:00:00Z",
                    endExclusive: "2026-10-19T00:00:00Z",
                    asOf: "2026-10-19T12:00:00Z",
                },
                budgets: {
                    maxSources: 20,
                    maxExcerptChars: 8000,
                    timeoutMs: 5000,
                    maxQueries: 2,
                    maxTokens: 1200,
                },
                runId: "run-demo-1",
                inputVersion: "input-v0-1",
            },
            ports
        );
        expect(received.gapPurpose).toBe("Approved public context lookup");
        expect(received.internalSourceRefs).toEqual([]);
        expect(received.publicSafeQueryProjection[0].purpose).toBe(
            "Approved public context lookup"
        );
        expect(received.publicSafeQueryProjection[0]).not.toHaveProperty("unknown");
        expect(JSON.stringify(received)).not.toContain("PRIVATE");
    });

    it("requires an exact trusted binding for public queries and strips unknown fields", () => {
        expect(() =>
            sanitizeResearchPlan(
                {
                    mode: "public",
                    gapPurpose: "x",
                    publicSafeQueryProjection: [
                        {
                            projectionId: "p",
                            query: "q",
                            purpose: "public",
                            approvalToken: "bad",
                            validatedAt: "2026-10-19T11:30:00Z",
                            privateExcerpt: "secret",
                        },
                    ],
                    internalSourceRefs: [],
                    budgets: {
                        maxSources: 1,
                        maxExcerptChars: 100,
                        timeoutMs: 100,
                        maxQueries: 1,
                        maxTokens: 1,
                    },
                },
                [{ projectionId: "p", query: "q", approvalToken: "psqv0_good" }]
            )
        ).toThrow(ContextPortErrorV0);
        const plan = sanitizeResearchPlan(
            {
                mode: "public",
                gapPurpose: "x",
                publicSafeQueryProjection: [
                    {
                        projectionId: "p",
                        query: "q",
                        purpose: "public",
                        approvalToken: "psqv0_good",
                        validatedAt: "2026-10-19T11:30:00Z",
                        privateExcerpt: "secret",
                    },
                ],
                internalSourceRefs: [],
                budgets: {
                    maxSources: 1,
                    maxExcerptChars: 100,
                    timeoutMs: 100,
                    maxQueries: 1,
                    maxTokens: 1,
                },
            },
            [{ projectionId: "p", query: "q", approvalToken: "psqv0_good" }]
        );
        expect(plan.publicSafeQueryProjection[0]).not.toHaveProperty("privateExcerpt");
    });

    it("keeps exact v1 input and marks compatibility output ignored-v0 with zero V0 citations", async () => {
        const ports = createFixtureV0Ports();
        const assembled = await ports.assembler.assemble({
            runId: "run-demo-1",
            inputVersion: "input-v0-1",
            roleContext: ports.fixture.roleContext,
            requiredContext: ports.fixture.requiredContext,
            retrieval: ports.fixture.retrieval,
            research: ports.fixture.research,
            budgets: {
                maxSources: 20,
                maxExcerptChars: 8000,
                timeoutMs: 5000,
                maxQueries: 2,
                maxTokens: 1200,
            },
            reportWindow: {
                startInclusive: "2026-10-12T00:00:00Z",
                endExclusive: "2026-10-19T00:00:00Z",
                asOf: "2026-10-19T12:00:00Z",
            },
        });
        const seen: unknown[] = [];
        const existing = wrapExistingGenerationPort(async (input, _runtime) => {
            seen.push(input);
            return result;
        });
        const envelope: ContextGenerationEnvelopeV0 = {
            v1Input: compatibleV1Input as never,
            manifest: assembled.manifest,
            evidenceSnapshot: assembled.evidenceSnapshot,
            freeze: assembled.freeze,
        };
        const output = await existing(envelope, runtime);
        expect(seen[0]).toEqual(envelope.v1Input);
        expect(output.contextMode).toBe("ignored-v0");
        expect(output.citationRefs).toEqual([]);
    });

    it("revalidates inside the transaction and never persists stale context", async () => {
        const ports = createFixtureV0Ports();
        const output = await runContextV0Pipeline(
            {
                principalRef: "user-joseph",
                companyId: "company-tilde",
                reportWindow: {
                    startInclusive: "2026-10-12T00:00:00Z",
                    endExclusive: "2026-10-19T00:00:00Z",
                    asOf: "2026-10-19T12:00:00Z",
                },
                budgets: {
                    maxSources: 20,
                    maxExcerptChars: 8000,
                    timeoutMs: 5000,
                    maxQueries: 2,
                    maxTokens: 1200,
                },
                runId: "run-demo-1",
                inputVersion: "input-v0-1",
            },
            ports
        );
        const envelope = {
            v1Input: compatibleV1Input as never,
            manifest: output.manifest,
            evidenceSnapshot: output.evidenceSnapshot,
            freeze: output.freeze,
        };
        const transaction = createMockTransaction("committed");
        const original = ports.server.currentState;
        ports.server.currentState = async request => ({
            ...(await original(request)),
            roleMapVersion: "changed",
        });
        await expect(
            commitContextGeneration(
                {
                    envelope,
                    generated: {
                        v1Result: result,
                        citationRefs: [],
                        manifestFingerprint: output.manifest.contextFingerprint,
                        contextMode: "ignored-v0",
                    },
                },
                ports.server,
                transaction
            )
        ).rejects.toMatchObject({ status: 409 });
        expect(transaction.persistCalls).toBe(0);
    });

    it("rejects direct commit envelopes with forged snapshot, cutoff, fingerprint, mode, or citations", async () => {
        const ports = createFixtureV0Ports();
        const output = await runContextV0Pipeline(
            {
                principalRef: "user-joseph",
                companyId: "company-tilde",
                reportWindow: {
                    startInclusive: "2026-10-12T00:00:00Z",
                    endExclusive: "2026-10-19T00:00:00Z",
                    asOf: "2026-10-19T12:00:00Z",
                },
                budgets: {
                    maxSources: 20,
                    maxExcerptChars: 8000,
                    timeoutMs: 5000,
                    maxQueries: 2,
                    maxTokens: 1200,
                },
                runId: "run-demo-1",
                inputVersion: "input-v0-1",
            },
            ports
        );
        const baseEnvelope = {
            v1Input: compatibleV1Input as never,
            manifest: output.manifest,
            evidenceSnapshot: output.evidenceSnapshot,
            freeze: output.freeze,
        };
        const generated = {
            v1Result: result,
            citationRefs: [],
            manifestFingerprint: output.manifest.contextFingerprint,
            contextMode: "ignored-v0" as const,
        };
        for (const envelope of [
            {
                ...baseEnvelope,
                evidenceSnapshot: {
                    ...baseEnvelope.evidenceSnapshot,
                    contentFingerprint: "forged",
                },
            },
            {
                ...baseEnvelope,
                evidenceSnapshot: {
                    ...baseEnvelope.evidenceSnapshot,
                    asOf: "2026-10-18T00:00:00Z",
                },
            },
        ]) {
            const transaction = createMockTransaction("unexpected");
            await expect(
                commitContextGeneration({ envelope, generated }, ports.server, transaction)
            ).rejects.toMatchObject({ status: 409 });
            expect(transaction.persistCalls).toBe(0);
        }
        const transaction = createMockTransaction("unexpected");
        await expect(
            commitContextGeneration(
                {
                    envelope: baseEnvelope,
                    generated: {
                        ...generated,
                        contextMode: "invalid" as never,
                    },
                },
                ports.server,
                transaction
            )
        ).rejects.toMatchObject({ status: 409 });
        expect(transaction.persistCalls).toBe(0);
    });

    it("fails closed when a freshness map is omitted", async () => {
        const ports = createFixtureV0Ports({
            currentState: {
                ...createFixtureV0Ports().fixture.requiredContext,
                actorAclDigest: "acl-tilde-user-joseph-1",
                sourceVersions: {},
                roleMapVersion: "roles-2026-10-20.1",
                roleProfileVersions: { founder: "profile-founder-v1" },
                companyArchitectureVersion: "company-v3",
                personalStarVersions: {},
            } as never,
        });
        const input = {
            principalRef: "user-joseph",
            companyId: "company-tilde",
            reportWindow: {
                startInclusive: "2026-10-12T00:00:00Z",
                endExclusive: "2026-10-19T00:00:00Z",
                asOf: "2026-10-19T12:00:00Z",
            },
            budgets: {
                maxSources: 20,
                maxExcerptChars: 8000,
                timeoutMs: 5000,
                maxQueries: 2,
                maxTokens: 1200,
            },
            runId: "run-demo-1",
            inputVersion: "input-v0-1",
        };
        await expect(runContextV0Pipeline(input, ports)).rejects.toMatchObject({ status: 503 });
    });

    it("freezes before generation and commits only after the same transaction recheck", async () => {
        const ports = createFixtureV0Ports();
        const transaction = createMockTransaction("ok");
        const currentStateTransactions: unknown[] = [];
        const currentState = ports.server.currentState;
        ports.server.currentState = async request => {
            if (request.transaction) currentStateTransactions.push(request.transaction);
            return currentState(request);
        };
        const output = await runContextV0Generation({
            context: {
                principalRef: "user-joseph",
                companyId: "company-tilde",
                reportWindow: {
                    startInclusive: "2026-10-12T00:00:00Z",
                    endExclusive: "2026-10-19T00:00:00Z",
                    asOf: "2026-10-19T12:00:00Z",
                },
                budgets: {
                    maxSources: 20,
                    maxExcerptChars: 8000,
                    timeoutMs: 5000,
                    maxQueries: 2,
                    maxTokens: 1200,
                },
                runId: "run-demo-1",
                inputVersion: "input-v0-1",
            },
            v1Input: compatibleV1Input as never,
            runtime,
            ports,
            generator: wrapExistingGenerationPort(async () => result),
            commit: transaction,
        });
        expect("persisted" in output).toBe(true);
        expect((output as { persisted: unknown }).persisted).toBe("ok");
        expect(transaction.persistCalls).toBe(1);
        expect(transaction.persistTransaction).toBe(transaction.transactionToken);
        expect(transaction.events).toEqual(["run", "persist"]);
        expect(currentStateTransactions).toHaveLength(1);
        expect(currentStateTransactions[0]).toBe(transaction.transactionToken);
    });

    it("revalidates freshness after generation even without a persistence port", async () => {
        const ports = createFixtureV0Ports();
        const original = ports.server.currentState;
        await expect(
            runContextV0Generation({
                context: {
                    principalRef: "user-joseph",
                    companyId: "company-tilde",
                    reportWindow: {
                        startInclusive: "2026-10-12T00:00:00Z",
                        endExclusive: "2026-10-19T00:00:00Z",
                        asOf: "2026-10-19T12:00:00Z",
                    },
                    budgets: {
                        maxSources: 20,
                        maxExcerptChars: 8000,
                        timeoutMs: 5000,
                        maxQueries: 2,
                        maxTokens: 1200,
                    },
                    runId: "run-demo-1",
                    inputVersion: "input-v0-1",
                },
                v1Input: compatibleV1Input as never,
                runtime,
                ports,
                generator: async envelope => {
                    ports.server.currentState = async request => ({
                        ...(await original(request)),
                        actorAclDigest: "changed-acl",
                    });
                    return {
                        v1Result: result,
                        citationRefs: [],
                        manifestFingerprint: envelope.manifest.contextFingerprint,
                        contextMode: "ignored-v0",
                    };
                },
            })
        ).rejects.toMatchObject({ status: 403 });
    });
});

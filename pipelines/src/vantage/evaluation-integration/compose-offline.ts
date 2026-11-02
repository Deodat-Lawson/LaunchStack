/** Offline composition only: real policy/registry/retrieval boundaries, canned report producer. */
import { createHash } from "node:crypto";
import normal from "../../../../fixtures/vantage-context-v0/normal.json";
import examples from "../../../../docs/design/examples/weekly-decision-agenda-v1.json";
import { createGenerationPort } from "../generation-v1";
import {
    contextSourceKeyV0,
    type ContextSourceEntryV0,
    type ContextSourceRefV0,
} from "../proposals/context-v0";
import {
    createFixtureV0Ports,
    createMockTransaction,
    type FixtureV0Input,
} from "../context-v0/mocks";
import {
    commitContextGeneration,
    createContextAwareGenerationAdapter,
} from "../context-v0/adapters";
import type {
    ContextGenerationEnvelopeV0,
    GenerationInput,
    GenerationRuntime,
} from "../context-v0/ports";
import { runDynamicContextV0 } from "../dynamic-retrieval/pipeline";
import { evaluateVantage } from "../validation/evaluate";
import { fingerprint, parseEvaluationInput } from "../validation/input";
import {
    buildJosephEvaluation,
    materializeJosephOfflineOutput,
    prepareJosephScenario,
    type JosephSemanticCase,
} from "./joseph-adapter";

export const OFFLINE_COMPOSITION_VERSION = "joseph-sophia-offline-integration/v1" as const;
export type OfflineFault =
    | "missing-required"
    | "revoked-required"
    | "acl-changed-during-generation"
    | "unregistered-citation";
type OfflineOutput = Parameters<typeof materializeJosephOfflineOutput>[1];
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const legacyKey = (ref: ContextSourceRefV0) => `${ref.kind}:${ref.id}@${ref.version}`;

/** No provider, credentials, database or public research tool can be injected here. */
export async function runJosephOfflineScenario(
    scenario: JosephSemanticCase,
    savedSyntheticOutput: OfflineOutput,
    options: { fault?: OfflineFault; pipelineVersion?: string } = {}
) {
    const prepared = prepareJosephScenario(scenario);
    const fixture = structuredClone(normal) as unknown as FixtureV0Input;
    const required = fixture.requiredBundle;
    required.actor = prepared.scope;
    required.asOf = prepared.window.asOf;
    const controls = [
        required.companyArchitecture,
        ...required.workspaceMandatoryDocuments,
        ...required.personalVantageStars,
    ];
    for (const entry of controls) {
        entry.companyId = prepared.scope.companyId;
        entry.audience =
            entry.audience.kind === "actor"
                ? prepared.scope.audience
                : { kind: "company", companyId: prepared.scope.companyId };
        entry.aclDigest = prepared.scope.aclDigest;
    }
    const sourceEntries: ContextSourceEntryV0[] = prepared.documents.map(document => ({
        source: document.source,
        companyId: prepared.scope.companyId,
        // Joseph supplied no ACL records. This isolated catalog explicitly assigns
        // required=true documents to the synthetic workspace-mandatory lane;
        // it is not a projection or widening of any existing private source.
        audience: document.required
            ? { kind: "company" as const, companyId: prepared.scope.companyId }
            : prepared.scope.audience,
        access: "allowed",
        aclDigest: prepared.scope.aclDigest,
        sourceDate: document.availableAt,
        checkedAt: prepared.window.asOf,
        excerpt: document.text,
    }));
    required.workspaceMandatoryDocuments.push(
        ...sourceEntries
            .filter((_, index) => prepared.documents[index]!.required)
            .map(entry => ({ ...entry, required: true as const }))
    );
    const requiredEntries = [
        required.companyArchitecture,
        ...required.workspaceMandatoryDocuments,
        ...required.personalVantageStars,
    ];
    const catalog = [
        ...new Map(
            [...controls, ...sourceEntries].map(entry => [contextSourceKeyV0(entry.source), entry])
        ).values(),
    ];
    required.coverage = {
        checked: requiredEntries.map(e => e.source),
        used: requiredEntries.map(e => e.source),
        missing: [],
        revoked: [],
        omitted: [],
    };
    if (options.fault === "missing-required")
        required.coverage.missing.push(required.companyArchitecture.source);
    if (options.fault === "revoked-required") {
        required.companyArchitecture.access = "revoked";
        required.coverage.revoked.push(required.companyArchitecture.source);
    }
    fixture.roleContext = prepared.roleContext;
    fixture.manifest.roleMapVersion = prepared.roleContext.mappingVersion;
    fixture.manifest.roleProfileVersions = Object.fromEntries(
        prepared.roleContext.roleIds.map(id => [id, "synthetic-profile-v1"])
    );
    fixture.manifest.sourceRegistry = catalog;
    fixture.manifest.sourceVersions = Object.fromEntries(
        catalog.map(entry => [legacyKey(entry.source), entry.source.version])
    );
    const ports = createFixtureV0Ports(fixture, { sourceCatalog: catalog });
    let changed = false;
    const originalCurrentState = ports.server.currentState.bind(ports.server);
    ports.server.currentState = async input => {
        const current = await originalCurrentState(input);
        if (changed) current.actorAclDigest = "synthetic-revoked-acl-v2";
        return current;
    };
    const events: string[] = ["gold-free-preparation"];
    let generatorCalls = 0;
    let stage = "authorized-context";
    const transaction = createMockTransaction("synthetic-no-database-commit");
    const provenance = {
        real: [
            "Joseph role mapper",
            "Sophia dynamic retrieval",
            "TL registry/manifest/evidence snapshot",
            "context-aware generation citation guard",
            "final guarded-commit freshness checks",
            "Sophia final-output evaluator",
        ],
        simulated: [
            "authenticated actor/catalog/current state",
            "control company/mandatory/star context",
            "hand-authored synthetic generation response",
            "persistence transaction",
        ],
        generation: "hand-authored synthetic output, not a model response",
        judgment: "none",
        providerCalls: 0,
        sourceAclAssignment:
            "synthetic server catalog: required fixture documents company-audience; other fixture documents actor-private; all permission decisions simulated",
    };
    try {
        const context = await runDynamicContextV0(
            {
                principalRef: prepared.scope.principalRef,
                companyId: prepared.scope.companyId,
                reportWindow: prepared.window,
                budgets: {
                    maxSources: 20,
                    maxQueries: 4,
                    maxExcerptChars: 24000,
                    maxTokens: 24000,
                    timeoutMs: 5000,
                },
                runId: `offline-${scenario.id}`,
                inputVersion: prepared.generationInputFingerprint,
            },
            ports,
            {
                retrieval: {
                    metadata: prepared.documents.map(document => ({
                        source: document.source,
                        title: document.originalId,
                        roleIds: prepared.roleContext.roleIds,
                        changedAt: document.availableAt,
                    })),
                },
                research: { questions: [] },
            }
        );
        events.push("authorized-sophia-retrieval", "tl-manifest-assembled");
        const nativeInput = structuredClone(examples.internal.input) as GenerationInput;
        nativeInput.runId = context.manifest.runId;
        nativeInput.inputVersion = context.manifest.inputVersion;
        nativeInput.reportPeriod = { ...nativeInput.reportPeriod, ...prepared.window };
        for (const key of Object.keys(nativeInput.data) as Array<keyof GenerationInput["data"]>)
            nativeInput.data[key] = [];
        nativeInput.reviewedTopics = [];
        const envelope: ContextGenerationEnvelopeV0 = { v1Input: nativeInput, ...context };
        const runtime: GenerationRuntime = {
            resolveModel: () => null,
            signal: new AbortController().signal,
            budgets: { attemptTimeoutMs: 20000, maxAttempts: 2, retryWaitMs: 1000, totalMs: 45000 },
        };
        let report: ReturnType<typeof materializeJosephOfflineOutput> | undefined;
        const generator = createContextAwareGenerationAdapter(async safeEnvelope => {
            generatorCalls++;
            // Only the allowlisted prepared context crosses this boundary. Gold is attached later.
            if (/"(?:expectations|must_include|must_not_claim)"/.test(JSON.stringify(safeEnvelope)))
                throw new Error("Gold leaked into generation context.");
            for (const document of prepared.documents) {
                const entry = safeEnvelope.evidenceSnapshot.entries.find(
                    item => contextSourceKeyV0(item.source) === document.sourceKey
                );
                if (entry?.excerpt !== document.text)
                    throw new Error(
                        "Scenario document did not survive authorized context selection."
                    );
            }
            report = materializeJosephOfflineOutput(prepared, savedSyntheticOutput);
            const refs = [
                ...new Map(
                    report.topics
                        .flatMap(topic => [...topic.facts, ...topic.conflicts])
                        .flatMap(item => item.refs)
                        .map(ref => [contextSourceKeyV0(ref), ref])
                ).values(),
            ];
            if (options.fault === "unregistered-citation" && refs[0])
                refs[0] = { ...refs[0], version: "not-the-source-version" };
            // Empty V1 Rules carrier is not this synthetic contextual report and is never labeled AI.
            const carrier = await createGenerationPort()(safeEnvelope.v1Input, runtime);
            if (options.fault === "acl-changed-during-generation") changed = true;
            return { v1Result: carrier, citationRefs: refs };
        });
        stage = "generation-test-boundary";
        const generated = await generator(envelope, runtime);
        events.push("synthetic-contextual-output-citation-validated");
        stage = "guarded-commit-test-boundary";
        await commitContextGeneration({ envelope, generated }, ports.server, transaction);
        events.push("mock-guarded-commit");
        if (!report) throw new Error("No synthetic report was returned.");
        stage = "evaluation";
        const adapted = buildJosephEvaluation(prepared, scenario, report, {
            id: `synthetic-${scenario.id}`,
            pipelineVersion: options.pipelineVersion ?? OFFLINE_COMPOSITION_VERSION,
        });
        events.push("gold-attached-after-generation");
        // Give the evaluator the same authorized excerpts as the generation
        // boundary, including explicitly synthetic company/mandatory/star controls.
        // These add no Gold expectations and do not claim a complete workspace.
        const evaluationSources = new Map(
            adapted.input.scenario.documents.map(doc => [doc.id, doc])
        );
        const controlSourceIds: string[] = [];
        for (const entry of context.evidenceSnapshot.entries) {
            const id = contextSourceKeyV0(entry.source);
            if (!evaluationSources.has(id)) {
                if (!entry.excerpt) throw new Error("An evaluator context excerpt is unavailable.");
                const registered = context.manifest.sourceRegistry.find(
                    source => contextSourceKeyV0(source.source) === id
                );
                if (!registered) throw new Error("An evaluator source is not registered.");
                evaluationSources.set(id, {
                    id,
                    version: entry.source.version,
                    availableAt: registered.sourceDate,
                    text: entry.excerpt,
                });
                controlSourceIds.push(id);
            }
        }
        const evaluationInput = parseEvaluationInput({
            ...adapted.input,
            scenario: {
                ...adapted.input.scenario,
                documents: [...evaluationSources.values()],
                contextCompleteness: "excerpted",
            },
        });
        const sidecar = {
            ...adapted.sidecar,
            contextProjection: {
                adapterInputFingerprint: fingerprint(adapted.input),
                evaluationInputFingerprint: fingerprint(evaluationInput),
                supplementalSyntheticControlSourceIds: controlSourceIds,
                scope: "authorized evidence-snapshot excerpts, not a complete workspace or corpus",
            },
        };
        const evaluation = await evaluateVantage(evaluationInput);
        events.push("sophia-evaluation-report");
        return {
            version: OFFLINE_COMPOSITION_VERSION,
            scenarioId: scenario.id,
            outcome: "evaluated" as const,
            provenance,
            events,
            generatorCalls,
            mockPersistCalls: transaction.persistCalls,
            prepared,
            manifest: context.manifest,
            evidenceSnapshot: context.evidenceSnapshot,
            sourceContentHashes: Object.fromEntries(
                catalog.map(entry => [contextSourceKeyV0(entry.source), digest(entry.excerpt)])
            ),
            output: report,
            evaluationInput,
            sidecar,
            evaluation,
            nativeCarrier: {
                mode: generated.v1Result.execution.mode,
                contextMode: generated.contextMode,
                note: "empty Rules compatibility carrier; not the contextual report or model output",
            },
        };
    } catch (error) {
        return {
            version: OFFLINE_COMPOSITION_VERSION,
            scenarioId: scenario.id,
            outcome: "blocked" as const,
            stage,
            status: (error as { status?: number }).status ?? null,
            message: error instanceof Error ? error.message : "Unknown boundary error",
            issues: (error as { issues?: unknown }).issues ?? [],
            events,
            generatorCalls,
            mockPersistCalls: transaction.persistCalls,
            provenance,
        };
    }
}

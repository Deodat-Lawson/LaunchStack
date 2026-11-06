import { createHash } from "node:crypto";
/** Synthetic, read-only pilot context. This module performs no model or database calls. */
import normal from "../../../../fixtures/vantage-context-v0/normal.json";
import examples from "../../../../docs/design/examples/weekly-decision-agenda-v1.json";
import type { ContextGenerationEnvelopeV0, GenerationInput } from "../context-v0/ports";
import type { ContextSourceEntryV0, ContextSourceRefV0 } from "../proposals/context-v0";
import type { TrustedContextSourceV0 } from "../context-v0/contracts";
import { contextSourceKeyV0 } from "../proposals/context-v0";
import { createFixtureV0Ports, type FixtureV0Input } from "../context-v0/mocks";
import { assertEnvelopeBinding } from "../context-v0/adapters";
import { runDynamicContextV0 } from "../dynamic-retrieval/pipeline";
import { computeGenerationSignals, eligibleInput, selectGenerationEvidence } from "../evidence-v1";
import { fingerprint, parseEvaluationInput } from "../validation/input";
import {
    buildJosephEvaluation,
    prepareJosephScenario,
    type JosephSemanticCase,
    type PreparedJosephScenario,
} from "../evaluation-integration/joseph-adapter";

import {
    assessEvaluationCompleteness,
    type TrustedClosedSourceInventory,
} from "./evaluation-completeness";

export const LIVE_PILOT_CONTEXT_VERSION = "joseph-live-pilot-context/v1" as const;
const sourceStateKey = (ref: ContextSourceRefV0) => `${ref.kind}:${ref.id}@${ref.version}`;

/** Only pinned scenario source material enters this preparation; no expected answers leave it. */
export async function prepareLivePilotContext(scenario: JosephSemanticCase) {
    const prepared = prepareJosephScenario(scenario);
    const fixture = structuredClone(normal) as unknown as FixtureV0Input;
    const required = fixture.requiredBundle;
    required.actor = structuredClone(prepared.scope);
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
    const sources: ContextSourceEntryV0[] = prepared.documents.map(document => ({
        source: document.source,
        companyId: prepared.scope.companyId,
        audience: document.required
            ? { kind: "company", companyId: prepared.scope.companyId }
            : prepared.scope.audience,
        access: "allowed",
        aclDigest: prepared.scope.aclDigest,
        sourceDate: document.availableAt,
        checkedAt: prepared.window.asOf,
        excerpt: document.text,
    }));
    required.workspaceMandatoryDocuments.push(
        ...sources
            .filter((_, index) => prepared.documents[index]!.required)
            .map(entry => ({ ...entry, required: true as const }))
    );

    const first = prepared.documents[0]!;
    const intakeRef: ContextSourceRefV0 = {
        kind: "ev",
        id: `pilot-intake-${prepared.scenarioId}`,
        version: "synthetic-intake-v1",
    };
    const intakeBody = `Intake copy of ${first.source.id}@${first.source.version}: ${first.text} This copies the same source and is not independent corroboration.`;
    const intakeEvidence: GenerationInput["data"]["currentEvidence"][number] = {
        id: intakeRef.id,
        kind: "note",
        title: `Intake copy: ${first.originalId}`,
        body: intakeBody,
        source: "Explicit synthetic intake copy; not independent corroboration",
        sourceUrl: null,
        observedAt: "2026-10-18",
        visibility: "private",
        tags: ["synthetic", "intake-copy"],
        createdAt: "2026-10-18T12:00:00.000Z",
    };
    const intakeEntry: ContextSourceEntryV0 = {
        source: intakeRef,
        companyId: prepared.scope.companyId,
        audience: prepared.scope.audience,
        access: "allowed",
        aclDigest: prepared.scope.aclDigest,
        sourceDate: intakeEvidence.createdAt,
        checkedAt: prepared.window.asOf,
        excerpt: intakeBody,
    };
    const catalog = [
        ...new Map(
            [...controls, ...sources, intakeEntry].map(entry => [
                contextSourceKeyV0(entry.source),
                entry,
            ])
        ).values(),
    ];
    const requiredEntries = [
        required.companyArchitecture,
        ...required.workspaceMandatoryDocuments,
        ...required.personalVantageStars,
    ];
    required.coverage = {
        checked: requiredEntries.map(entry => entry.source),
        used: requiredEntries.map(entry => entry.source),
        missing: [],
        revoked: [],
        omitted: [],
    };
    fixture.roleContext = prepared.roleContext;
    fixture.manifest.roleMapVersion = prepared.roleContext.mappingVersion;
    fixture.manifest.roleProfileVersions = Object.fromEntries(
        prepared.roleContext.roleIds.map(id => [id, "synthetic-profile-v1"])
    );
    fixture.manifest.sourceRegistry = catalog;
    fixture.manifest.sourceVersions = Object.fromEntries(
        catalog.map(entry => [sourceStateKey(entry.source), entry.source.version])
    );
    const trustedCatalog: TrustedContextSourceV0[] = catalog.map(entry => ({
        ...entry,
        content: entry.excerpt,
        provenance: {
            connector: "synthetic-live-pilot-fixture",
            locator: entry.source.id,
            retrievedAt: prepared.window.asOf,
            reason:
                contextSourceKeyV0(entry.source) === contextSourceKeyV0(intakeRef)
                    ? `Explicit intake copy of ${first.sourceKey}; not independent corroboration.`
                    : "Server-owned synthetic test catalog; not production authorization.",
        },
    }));
    const ports = createFixtureV0Ports(fixture, { sourceCatalog: catalog, trustedCatalog });
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
            runId: `live-pilot-${scenario.id}`,
            inputVersion: fingerprint({
                version: LIVE_PILOT_CONTEXT_VERSION,
                prepared: prepared.generationInputFingerprint,
                intake: intakeEntry,
            }),
        },
        ports,
        {
            retrieval: {
                metadata: [
                    ...prepared.documents.map(document => ({
                        source: document.source,
                        title: document.originalId,
                        roleIds: prepared.roleContext.roleIds,
                        changedAt: document.availableAt,
                    })),
                    {
                        source: intakeRef,
                        title: intakeEvidence.title,
                        roleIds: prepared.roleContext.roleIds,
                        changedAt: intakeEvidence.createdAt,
                    },
                ],
            },
            research: { questions: [] },
        }
    );
    for (const document of prepared.documents) {
        const selected = context.evidenceSnapshot.entries.find(
            entry => contextSourceKeyV0(entry.source) === document.sourceKey
        );
        if (selected?.excerpt !== document.text)
            throw new Error(
                "An original Joseph source was omitted or changed during pilot context preparation."
            );
    }
    const registeredIntake = context.evidenceSnapshot.entries.find(
        entry => contextSourceKeyV0(entry.source) === contextSourceKeyV0(intakeRef)
    );
    if (registeredIntake?.excerpt !== intakeBody)
        throw new Error("Native intake evidence was not retained in the authorized snapshot.");
    const v1Input = structuredClone(examples.internal.input) as GenerationInput;
    v1Input.runId = context.manifest.runId;
    v1Input.inputVersion = context.manifest.inputVersion;
    v1Input.generationMode = "configured-model";
    v1Input.reportPeriod = { ...v1Input.reportPeriod, ...prepared.window };
    for (const key of Object.keys(v1Input.data) as Array<keyof GenerationInput["data"]>)
        v1Input.data[key] = [];
    v1Input.data.currentEvidence = [intakeEvidence];
    v1Input.reviewedTopics = [];
    const eligible = eligibleInput(v1Input);
    const selection = selectGenerationEvidence(eligible, computeGenerationSignals(eligible));
    if (selection.pack.items.length !== 1 || selection.pack.items[0]?.ref !== `ev:${intakeRef.id}`)
        throw new Error(
            "Live pilot must have one eligible native evidence record, not an empty-generation short circuit."
        );
    const envelope: ContextGenerationEnvelopeV0 = { v1Input, ...context };
    assertEnvelopeBinding(envelope);
    if (/"(?:expectations|must_include|must_not_claim)"/.test(JSON.stringify(envelope)))
        throw new Error("Gold leaked into the generation envelope.");
    return {
        prepared,
        envelope,
        ports,
        intakeEvidence,
        // This attestation describes only the full finite synthetic catalog above.
        // It is not passed to Generation and is never inferred from Gold/expectations.
        trustedEvaluationInventory: {
            scope: "closed-synthetic-scenario" as const,
            scenarioId: prepared.scenarioId,
            generationInputFingerprint: prepared.generationInputFingerprint,
            manifestFingerprint: envelope.manifest.contextFingerprint,
            asOf: prepared.window.asOf,
            researchRequirement: "not-required-for-closed-scenario" as const,
            sourceContentHashes: Object.fromEntries(
                trustedCatalog.map(source => [
                    contextSourceKeyV0(source.source),
                    createHash("sha256").update(source.content!, "utf8").digest("hex"),
                ])
            ),
        },
        nativeEligibility: {
            eligibleEvidenceCount: eligible.data.currentEvidence.length,
            selectedRefs: selection.pack.items.map(item => item.ref),
        },
        scopeProvenance: {
            version: LIVE_PILOT_CONTEXT_VERSION,
            actor: "synthetic scoped fixture, not production authentication",
            companyAndStars:
                "three baseline synthetic control records; no new human approval or real star selection",
            requiredSourceAcl:
                "synthetic workspace-mandatory documents company audience; other scenario documents actor private",
            intake: {
                source: intakeRef,
                copiedFrom: first.source,
                relationship: "explicit duplicate intake copy, not independent corroboration",
                assignedCreatedAt: intakeEvidence.createdAt,
            },
            generation: "not invoked by this context helper",
            contextCompleteness: "partial: research STOP and bounded authorized excerpts",
        },
    };
}

/** Call only after actual generation; original Gold and all exact source excerpts enter the evaluator here. */
export function attachLivePilotEvaluation(
    prepared: PreparedJosephScenario,
    scenario: JosephSemanticCase,
    actualReport: unknown,
    envelope: ContextGenerationEnvelopeV0,
    identity: { id: string; pipelineVersion: string },
    trustedInventory?: TrustedClosedSourceInventory
) {
    assertEnvelopeBinding(envelope);
    if (
        envelope.manifest.actor.companyId !== prepared.scope.companyId ||
        envelope.manifest.actor.principalRef !== prepared.scope.principalRef ||
        envelope.manifest.actor.aclDigest !== prepared.scope.aclDigest
    )
        throw new Error("Evaluation envelope actor does not match the prepared scenario.");
    const adapted = buildJosephEvaluation(prepared, scenario, actualReport, identity);
    const sources = new Map(
        adapted.input.scenario.documents.map(document => [document.id, document])
    );
    const supplemental: string[] = [];
    for (const entry of envelope.evidenceSnapshot.entries) {
        const id = contextSourceKeyV0(entry.source);
        const registered = envelope.manifest.sourceRegistry.find(
            source => contextSourceKeyV0(source.source) === id
        );
        if (
            !registered ||
            entry.excerpt !== registered.excerpt ||
            !entry.excerpt ||
            registered.access !== "allowed"
        )
            throw new Error(
                "Evaluator context does not match an authorized exact-version manifest excerpt."
            );
        const existing = sources.get(id);
        if (
            existing &&
            (existing.text !== entry.excerpt || existing.version !== entry.source.version)
        )
            throw new Error("An original Joseph evaluation source was changed.");
        if (!existing) {
            sources.set(id, {
                id,
                version: entry.source.version,
                availableAt: registered.sourceDate,
                text: entry.excerpt,
            });
            supplemental.push(id);
        }
    }
    for (const original of prepared.documents)
        if (
            !envelope.evidenceSnapshot.entries.some(
                entry =>
                    contextSourceKeyV0(entry.source) === original.sourceKey &&
                    entry.excerpt === original.text
            )
        )
            throw new Error("An original source is missing from the generation snapshot.");
    if (
        trustedInventory &&
        (trustedInventory.scenarioId !== prepared.scenarioId ||
            trustedInventory.generationInputFingerprint !== prepared.generationInputFingerprint)
    )
        throw new Error("Trusted evaluation inventory belongs to a different prepared scenario.");
    const completeness = assessEvaluationCompleteness(envelope, trustedInventory);
    const input = parseEvaluationInput({
        ...adapted.input,
        scenario: {
            ...adapted.input.scenario,
            documents: [...sources.values()],
            contextCompleteness: completeness.status,
        },
    });
    return {
        input,
        sidecar: {
            ...adapted.sidecar,
            liveContext: {
                version: LIVE_PILOT_CONTEXT_VERSION,
                completeness,
                manifestFingerprint: envelope.manifest.contextFingerprint,
                originalAdapterInputFingerprint: fingerprint(adapted.input),
                evaluationInputFingerprint: fingerprint(input),
                supplementalSyntheticControlSourceIds: supplemental,
                intakeLimitation:
                    "A separately registered native evidence record is an explicit copy of the first scenario document, not independent corroboration.",
            },
        },
    };
}

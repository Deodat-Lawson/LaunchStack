import { createHash } from "node:crypto";
import { assertEnvelopeBinding } from "../context-v0/adapters";
import type { AssembledContextManifestV0 } from "../context-v0/contracts";
import type { ContextGenerationEnvelopeV0 } from "../context-v0/ports";
import { contextSourceKeyV0 } from "../proposals/context-v0";
import { fingerprint } from "../validation/input";

/** Server/test-host evidence of a finite corpus, never accepted from model output or Gold. */
export interface TrustedClosedSourceInventory {
    scope: "closed-synthetic-scenario";
    scenarioId: string;
    generationInputFingerprint: string;
    manifestFingerprint: string;
    asOf: string;
    researchRequirement: "must-complete" | "not-required-for-closed-scenario";
    /** Exact full-content hashes, not excerpt hashes presented as complete bodies. */
    sourceContentHashes: Readonly<Record<string, string>>;
}

/** Completeness describes this declared finite scenario, never the entire company/workspace. */
export function assessEvaluationCompleteness(
    envelope: ContextGenerationEnvelopeV0,
    inventory?: TrustedClosedSourceInventory
) {
    assertEnvelopeBinding(envelope);
    const reasons: string[] = [];
    // The shared envelope exposes the base manifest. The assembler's extra
    // diagnostics are optional at this boundary; absence cannot prove coverage.
    const manifest = envelope.manifest as typeof envelope.manifest &
        Partial<Pick<AssembledContextManifestV0, "retrievalState" | "selectedRefs">>;
    const retrieval = manifest.retrievalState;
    if (!inventory) reasons.push("no-trusted-closed-source-inventory");
    const stoppedOutsideScope =
        inventory?.researchRequirement === "not-required-for-closed-scenario" &&
        envelope.manifest.research.mode === "STOP" &&
        envelope.manifest.research.status === "stopped";
    if (
        envelope.manifest.status === "blocked" ||
        (envelope.manifest.status === "partial" && !stoppedOutsideScope)
    )
        reasons.push("manifest-not-complete");
    if (!retrieval || !["complete", "not-run"].includes(retrieval.status))
        reasons.push("retrieval-not-complete");
    if (envelope.manifest.research.status !== "complete" && !stoppedOutsideScope)
        reasons.push("research-not-complete");
    if (envelope.manifest.omissions.length) reasons.push("manifest-omissions");
    if (!retrieval || !Array.isArray(retrieval.omissions) || retrieval.omissions.length)
        reasons.push("retrieval-omissions");
    if (!retrieval || !Array.isArray(retrieval.failures) || retrieval.failures.length)
        reasons.push("retrieval-failures");
    if (envelope.manifest.research.failures.length) reasons.push("research-failures");
    for (const field of ["missing", "revoked", "omitted", "researchOmitted"] as const)
        if (envelope.manifest.coverage[field].length) reasons.push(`coverage-${field}`);
    const entries = envelope.evidenceSnapshot.entries;
    const suppliedKeys = new Set(entries.map(entry => contextSourceKeyV0(entry.source)));
    if (!entries.length) reasons.push("empty-source-snapshot");
    for (const required of [envelope.freeze.companyArchitecture, ...envelope.freeze.personalStars])
        if (!suppliedKeys.has(contextSourceKeyV0(required.ref)))
            reasons.push("required-source-not-in-snapshot");
    for (const refs of [manifest.selectedRefs, manifest.coverage.checked, manifest.coverage.used])
        if (
            !refs ||
            fingerprint([...new Set(refs.map(contextSourceKeyV0))].sort()) !==
                fingerprint([...suppliedKeys].sort())
        )
            reasons.push("selected-or-covered-sources-differ-from-snapshot");
    if (inventory) {
        if (
            inventory.scope !== "closed-synthetic-scenario" ||
            !inventory.scenarioId ||
            !inventory.generationInputFingerprint ||
            inventory.manifestFingerprint !== envelope.manifest.contextFingerprint ||
            inventory.asOf !== envelope.evidenceSnapshot.asOf
        )
            reasons.push("inventory-snapshot-mismatch");
        const keys = entries.map(entry => contextSourceKeyV0(entry.source)).sort();
        if (fingerprint(keys) !== fingerprint(Object.keys(inventory.sourceContentHashes).sort()))
            reasons.push("source-inventory-not-fully-represented");
        for (const entry of entries) {
            const key = contextSourceKeyV0(entry.source);
            const registered = envelope.manifest.sourceRegistry.find(
                source => contextSourceKeyV0(source.source) === key
            )!;
            const fullHash = inventory.sourceContentHashes[key];
            if (
                !fullHash ||
                fullHash !== entry.contentHash ||
                createHash("sha256").update(entry.excerpt, "utf8").digest("hex") !== fullHash
            )
                reasons.push(`not-full-content:${key}`);
            if (
                registered.access !== "allowed" ||
                registered.companyId !== envelope.manifest.actor.companyId ||
                registered.aclDigest !== envelope.manifest.actor.aclDigest ||
                (registered.audience.kind === "actor" &&
                    registered.audience.principalRef !== envelope.manifest.actor.principalRef) ||
                (registered.audience.kind === "company" &&
                    registered.audience.companyId !== envelope.manifest.actor.companyId)
            )
                reasons.push(`source-not-authorized:${key}`);
            if (
                !Number.isFinite(Date.parse(registered.sourceDate)) ||
                Date.parse(registered.sourceDate) > Date.parse(envelope.evidenceSnapshot.asOf)
            )
                reasons.push(`source-not-available:${key}`);
        }
    }
    return {
        version: "vantage-evaluation-completeness/v1" as const,
        status: reasons.length ? ("excerpted" as const) : ("complete" as const),
        scope: "authorized frozen context; complete only for an explicitly declared closed synthetic source inventory",
        manifestFingerprint: envelope.manifest.contextFingerprint,
        inventoryFingerprint: inventory ? fingerprint(inventory) : null,
        reasons: [...new Set(reasons)],
    };
}

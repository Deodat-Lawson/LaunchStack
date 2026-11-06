import fs from "node:fs";
import fixture from "../../fixtures/vantage-context-v0/normal.json";
import examples from "../../docs/design/examples/weekly-decision-agenda-v1.json";
import type { FixtureV0Input } from "../src/vantage/context-v0/mocks";
import type { GenerationInput } from "../src/vantage/contract-v1";
import { createFixtureV0Ports } from "../src/vantage/context-v0/mocks";
import { runContextV0Pipeline } from "../src/vantage/context-v0/adapters";
const data = structuredClone(fixture) as unknown as FixtureV0Input;
const qa =
    "QA deletion verification for synthetic run-17: 3 of 3 sample accounts were deleted. QA reports its sample passed. This sample result is not a recorded privacy sign-off. Independent operations audit of synthetic run-17: 2 of 3 sample accounts were fully deleted; one record remained. The account list may differ from QA's. No reconciled shared sample was supplied.";
const privacy =
    "Human privacy review record: retain the deletion go/no-go question until a named privacy reviewer compares QA and operations samples and records approval. This document contains no approval record.";
for (const item of [
    ...data.retrievalInput.sourceCatalog,
    ...data.manifest.sourceRegistry,
    ...data.requiredBundle.workspaceMandatoryDocuments,
    ...data.requiredBundle.personalVantageStars,
]) {
    if (item.source.id === "doc-weekly-plan") item.excerpt = qa;
    if (item.source.id === "doc-starred-roadmap") item.excerpt = privacy;
}
const window = data.retrievalBundle.reportWindow;
const built = await runContextV0Pipeline(
    {
        principalRef: data.requiredBundle.actor.principalRef,
        companyId: data.requiredBundle.actor.companyId,
        reportWindow: window,
        budgets: {
            maxSources: 20,
            maxQueries: 2,
            maxExcerptChars: 200000,
            maxTokens: 200000,
            timeoutMs: 5000,
        },
        runId: "orbit-v2-golden",
        inputVersion: "orbit-v2-fixture",
    },
    createFixtureV0Ports(data)
);
const input = structuredClone(examples.internal.input) as GenerationInput;
input.runId = built.manifest.runId;
input.inputVersion = built.manifest.inputVersion;
input.reportPeriod = { ...input.reportPeriod, ...window, kind: "completed-week" };
const out = {
    syntheticOnly: true,
    provenance:
        "Orbit revision fixture-revision-1 excerpts, rebound to normal fixture source IDs; QA and Operations share one synthetic document.",
    envelope: {
        v1Input: input,
        manifest: built.manifest,
        evidenceSnapshot: built.evidenceSnapshot,
        freeze: built.freeze,
    },
};
fs.writeFileSync(
    "fixtures/vantage-generation-v2/V2-04.input.json",
    JSON.stringify(out, null, 2) + "\n"
);

/**
 * Runs every scenario fixture and enforces its `expect` block.
 *
 * This is the half the fixtures were missing. A scenario that only describes
 * inputs cannot fail: the cross-company isolation case would report success
 * while another company's evidence sat in the snapshot. Every field a fixture
 * declares under `expect` is asserted below, and an `expect` block is
 * mandatory in the contract, so adding a fixture without expectations is a
 * parse error rather than silent non-coverage.
 *
 * Provider-free. Collection needs no model, and the one review assertion here
 * (`review.sectionStates`) uses the empty-evidence path, which builds its
 * review without calling one — the injected generator throws if it is ever
 * reached.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import {
    FounderWeeklyReviewEvidenceService,
    FounderWeeklyReviewEvidenceSnapshotSchema,
    generateFounderWeeklyReview,
    type FounderWeeklyReviewEvidenceSnapshot,
} from "@launchstack/features/founder-weekly-review";
import { FounderWeeklyReviewDocumentVersionStore } from "~/server/founder-weekly-review/document-version-chunks";
import { StrictCurrentWorkspaceDocumentStore } from "~/server/founder-weekly-review/workspace-document-store";

import { loadScenario } from "../../scripts/founder-weekly-review-scenario-loader";
import {
    seedScenario,
    type SeededScenario,
} from "../../scripts/founder-weekly-review-scenario-seeder";
import type { FounderWeeklyReviewScenario } from "../../test-fixtures/founder-weekly-review/scenarios/contracts";
import { createFounderWeeklyReviewTestDatabase } from "./testDb";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;

const SCENARIO_DIR = join(
    __dirname,
    "..",
    "..",
    "test-fixtures",
    "founder-weekly-review",
    "scenarios"
);
const CAPTURED_AT = new Date("2026-07-27T00:00:00.000Z");
const CUSTOMER_FEEDBACK_CATEGORY = "Customer Feedback";

/** Kept in step with the directories on disk by the first test below. */
const SCENARIOS = [
    "01-empty-evidence",
    "02-founder-context-only",
    "03-relevant-workspace-document",
    "04-first-ever-version-no-invented-diff",
    "05-multiple-versions-in-period",
    "06-customer-feedback",
    "09-cross-company-isolation",
] as const;

/**
 * Workspace retrieval is embedding-based. Scenarios that assert on
 * `workspace_document` get a deterministic stub embedder so the assertion is
 * about the collector's wiring rather than about model similarity scores.
 */
const deterministicVector = () => Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0));

function needsWorkspaceRetrieval(scenario: FounderWeeklyReviewScenario): boolean {
    const counts = scenario.expect.evidence?.sourceTypeCounts;
    return (
        scenario.expect.sourceSemantics?.currentWorkspaceOnly === true ||
        (counts?.workspace_document !== undefined && counts.workspace_document.exact !== 0)
    );
}

interface CollectedScenario {
    scenario: FounderWeeklyReviewScenario;
    snapshot: FounderWeeklyReviewEvidenceSnapshot;
    seeded: SeededScenario;
}

async function collect(name: string): Promise<CollectedScenario> {
    const scenario = await loadScenario(join(SCENARIO_DIR, name, "scenario.json"));
    const testDb = await createFounderWeeklyReviewTestDatabase();
    try {
        const withRetrieval = needsWorkspaceRetrieval(scenario);
        const seeded = await seedScenario(testDb.db, scenario, {
            deterministicWorkspaceEmbeddings: withRetrieval,
        });
        const collector = new FounderWeeklyReviewEvidenceService(
            testDb.db,
            () => CAPTURED_AT,
            { kind: "computed", store: new FounderWeeklyReviewDocumentVersionStore(testDb.db) },
            withRetrieval
                ? new StrictCurrentWorkspaceDocumentStore(testDb.db, {
                      embedQuery: async () => deterministicVector(),
                  })
                : undefined
        );
        const snapshot = await collector.collectFounderWeeklyReviewEvidence({
            companyId: seeded.underReviewCompanyId,
            reportingPeriod: scenario.reportingPeriod,
            workspaceTimezone: scenario.workspaceTimezone,
            founderContext: scenario.founderContext,
            actor: scenario.founderContext ? { externalUserId: "scenario-test" } : undefined,
            requestKey: `scenario-${scenario.name}`,
            capturedAt: CAPTURED_AT,
        });
        return {
            scenario,
            snapshot: FounderWeeklyReviewEvidenceSnapshotSchema.parse(snapshot),
            seeded,
        };
    } finally {
        await testDb.close();
    }
}

function assertEvidenceExpectations(
    scenario: FounderWeeklyReviewScenario,
    snapshot: FounderWeeklyReviewEvidenceSnapshot
): void {
    const evidence = scenario.expect.evidence;
    if (!evidence) return;

    for (const [sourceType, bounds] of Object.entries(evidence.sourceTypeCounts ?? {})) {
        const count = snapshot.items.filter(item => item.sourceType === sourceType).length;
        if (bounds?.exact !== undefined) {
            expect({ sourceType, count }).toEqual({ sourceType, count: bounds.exact });
        }
        if (bounds?.min !== undefined) expect(count).toBeGreaterThanOrEqual(bounds.min);
        if (bounds?.max !== undefined) expect(count).toBeLessThanOrEqual(bounds.max);
    }

    const reported = snapshot.sourceWarnings.map(warning => warning.code);
    for (const code of evidence.warningCodes ?? []) expect(reported).toContain(code);
    for (const code of evidence.forbiddenWarningCodes ?? []) expect(reported).not.toContain(code);
}

function assertDocumentChangeExpectations(
    scenario: FounderWeeklyReviewScenario,
    snapshot: FounderWeeklyReviewEvidenceSnapshot
): void {
    const expected = scenario.expect.documentChanges;
    if (!expected) return;
    expect(snapshot.schemaVersion).toBe("founder-weekly-review-evidence/v2");
    if (snapshot.schemaVersion !== "founder-weekly-review-evidence/v2") return;

    const groups = snapshot.documentChangeAudit.groups;
    if (expected.min !== undefined) expect(groups.length).toBeGreaterThanOrEqual(expected.min);
    if (expected.max !== undefined) expect(groups.length).toBeLessThanOrEqual(expected.max);
    for (const category of expected.requiredCategories ?? []) {
        expect(groups.some(group => group.category === category)).toBe(true);
    }
    if (expected.requireNoInventedBaseline) {
        expect(groups).toHaveLength(0);
        expect(snapshot.documentChangeAudit.rawChanges).toHaveLength(0);
    }

    const rawIds = new Set(
        snapshot.documentChangeAudit.rawChanges.map(change => change.rawChangeId)
    );
    for (const group of groups) {
        expect(group.rawChangeIds.every(rawChangeId => rawIds.has(rawChangeId))).toBe(true);
    }
}

function assertSourceSemantics(
    scenario: FounderWeeklyReviewScenario,
    snapshot: FounderWeeklyReviewEvidenceSnapshot,
    seeded: SeededScenario
): void {
    const semantics = scenario.expect.sourceSemantics;
    if (!semantics) return;

    if (semantics.temporalEvidenceRequired) {
        // A change without a timestamp cannot be placed in a reporting period,
        // so it cannot honestly be cited as something that happened this week.
        for (const item of snapshot.items.filter(entry => entry.sourceType === "document_change")) {
            expect({
                sourceId: item.sourceId,
                hasTimestamp: item.sourceTimestamp !== undefined,
            }).toEqual({
                sourceId: item.sourceId,
                hasTimestamp: true,
            });
        }
    }

    if (semantics.currentWorkspaceOnly) {
        // Retrieved current-state documents must not be re-reported as changes.
        const workspaceDocumentIds = new Set(
            snapshot.items
                .filter(item => item.sourceType === "workspace_document")
                .map(item => String(item.metadata.documentId))
        );
        for (const item of snapshot.items.filter(entry => entry.sourceType === "document_change")) {
            expect(workspaceDocumentIds).not.toContain(String(item.metadata.documentId));
        }
    }

    if (semantics.customerFeedbackOnly) {
        // Only customer_feedback items may be sourced from a Customer Feedback
        // document. Founder context in particular is direction, not testimony.
        const feedbackTitles = new Set(
            scenario.companies.flatMap(company =>
                company.documents
                    .filter(doc => doc.category === CUSTOMER_FEEDBACK_CATEGORY)
                    .map(doc => doc.title)
            )
        );
        for (const item of snapshot.items) {
            if (item.sourceType === "customer_feedback") continue;
            expect({
                sourceId: item.sourceId,
                fromFeedbackDoc: feedbackTitles.has(item.title),
            }).toEqual({
                sourceId: item.sourceId,
                fromFeedbackDoc: false,
            });
        }
    }

    if (semantics.noCrossCompanyLeakage) {
        const underReviewName = scenario.companies.find(entry => entry.underReview)!.name;
        const foreignDocumentIds = new Set(
            [...seeded.documentIdsByCompanyName.entries()]
                .filter(([name]) => name !== underReviewName)
                .flatMap(([, ids]) => ids.map(id => id.toString()))
        );
        const foreignTitles = new Set(
            [...seeded.documentTitlesByCompanyName.entries()]
                .filter(([name]) => name !== underReviewName)
                .flatMap(([, titles]) => titles)
        );
        expect(foreignDocumentIds.size).toBeGreaterThan(0);

        for (const item of snapshot.items) {
            const documentId = item.metadata.documentId;
            expect({
                sourceId: item.sourceId,
                foreignDocument:
                    documentId !== undefined && foreignDocumentIds.has(String(documentId)),
            }).toEqual({ sourceId: item.sourceId, foreignDocument: false });
            expect({
                sourceId: item.sourceId,
                foreignTitle: foreignTitles.has(item.title),
            }).toEqual({
                sourceId: item.sourceId,
                foreignTitle: false,
            });
            // The id also appears inside the composed sourceId, so check the
            // rendered string too rather than trusting metadata alone.
            for (const foreignId of foreignDocumentIds) {
                expect(item.sourceId).not.toContain(`:doc:${foreignId}:`);
            }
        }
    }
}

async function assertReviewExpectations(
    scenario: FounderWeeklyReviewScenario,
    snapshot: FounderWeeklyReviewEvidenceSnapshot
): Promise<void> {
    const sectionStates = scenario.expect.review?.sectionStates;
    if (!sectionStates) return;

    const generated = await generateFounderWeeklyReview({
        evidenceSnapshot: snapshot,
        generate: () => {
            throw new Error(
                "review.sectionStates is only assertable on the deterministic no-model path; " +
                    "this scenario produced evidence and would require a real generation call."
            );
        },
    });

    for (const [section, state] of Object.entries(sectionStates)) {
        const actual =
            generated.reviewPayload.sections[
                section as keyof typeof generated.reviewPayload.sections
            ];
        expect({ section, state: actual?.state }).toEqual({ section, state });
    }
}

describeIfDatabase("founder weekly review scenarios (provider-free collection)", () => {
    jest.setTimeout(120_000);

    it("covers every scenario directory on disk", async () => {
        // Guards the it.each list below: a fixture added without being
        // registered here would otherwise never run.
        const entries = await readdir(SCENARIO_DIR, { withFileTypes: true });
        const onDisk = entries
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort();
        expect(onDisk).toEqual([...SCENARIOS].sort());
    });

    it.each(SCENARIOS)("%s satisfies its declared expectations", async name => {
        const { scenario, snapshot, seeded } = await collect(name);
        expect(snapshot.schemaVersion).toBe("founder-weekly-review-evidence/v2");
        assertEvidenceExpectations(scenario, snapshot);
        assertDocumentChangeExpectations(scenario, snapshot);
        assertSourceSemantics(scenario, snapshot, seeded);
        await assertReviewExpectations(scenario, snapshot);
    });
});

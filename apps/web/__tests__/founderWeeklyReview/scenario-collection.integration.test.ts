import { FounderWeeklyReviewEvidenceService, FounderWeeklyReviewEvidenceSnapshotSchema } from "@launchstack/features/founder-weekly-review";
import { StrictCurrentWorkspaceDocumentStore } from "~/server/founder-weekly-review/workspace-document-store";
import { FounderWeeklyReviewDocumentVersionStore } from "~/server/founder-weekly-review/document-version-chunks";

import { loadScenario } from "../../scripts/founder-weekly-review-scenario-loader";
import { seedScenario } from "../../scripts/founder-weekly-review-scenario-seeder";
import { createFounderWeeklyReviewTestDatabase } from "./testDb";

const describeIfDatabase = process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL ? describe : describe.skip;
const vector = () => Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0);
const fixturePath = (name: string) => `${__dirname}/../../test-fixtures/founder-weekly-review/scenarios/${name}/scenario.json`;
type V2Snapshot = Extract<ReturnType<typeof FounderWeeklyReviewEvidenceSnapshotSchema.parse>, { schemaVersion: "founder-weekly-review-evidence/v2" }>;

async function collect(name: string, deterministicWorkspaceEmbeddings = false) {
    const scenario = await loadScenario(fixturePath(name));
    const testDb = await createFounderWeeklyReviewTestDatabase();
    try {
        const seeded = await seedScenario(testDb.db, scenario, { deterministicWorkspaceEmbeddings });
        const collector = new FounderWeeklyReviewEvidenceService(
            testDb.db,
            () => new Date("2026-07-27T00:00:00.000Z"),
            { kind: "computed", store: new FounderWeeklyReviewDocumentVersionStore(testDb.db) },
            deterministicWorkspaceEmbeddings ? new StrictCurrentWorkspaceDocumentStore(testDb.db, { embedQuery: async () => vector() }) : undefined,
        );
        const snapshot = await collector.collectFounderWeeklyReviewEvidence({
            companyId: seeded.underReviewCompanyId,
            reportingPeriod: scenario.reportingPeriod,
            workspaceTimezone: scenario.workspaceTimezone,
            founderContext: scenario.founderContext,
            actor: scenario.founderContext ? { externalUserId: "scenario-test" } : undefined,
            requestKey: `scenario-${scenario.name}`,
            capturedAt: new Date("2026-07-27T00:00:00.000Z"),
        });
        return { scenario, snapshot: FounderWeeklyReviewEvidenceSnapshotSchema.parse(snapshot) as V2Snapshot };
    } finally {
        await testDb.close();
    }
}

function assertExpectations(scenario: Awaited<ReturnType<typeof loadScenario>>, snapshot: V2Snapshot) {
    expect(snapshot.schemaVersion).toBe("founder-weekly-review-evidence/v2");
    const expected = scenario.expect;
    for (const [sourceType, bounds] of Object.entries(expected?.evidence?.sourceTypeCounts ?? {})) {
        const count = snapshot.items.filter((item) => item.sourceType === sourceType).length;
        if (bounds?.exact !== undefined) expect(count).toBe(bounds.exact);
        if (bounds?.min !== undefined) expect(count).toBeGreaterThanOrEqual(bounds.min);
        if (bounds?.max !== undefined) expect(count).toBeLessThanOrEqual(bounds.max);
    }
    for (const warningCode of expected?.evidence?.warningCodes ?? []) expect(snapshot.sourceWarnings.map((warning) => warning.code)).toContain(warningCode);
    if (expected?.documentChanges) {
        const groups = snapshot.documentChangeAudit.groups;
        if (expected.documentChanges.minGroups !== undefined) expect(groups.length).toBeGreaterThanOrEqual(expected.documentChanges.minGroups);
        if (expected.documentChanges.maxGroups !== undefined) expect(groups.length).toBeLessThanOrEqual(expected.documentChanges.maxGroups);
        if (expected.documentChanges.requiredCategories) for (const category of expected.documentChanges.requiredCategories) expect(groups.some((group) => group.category === category)).toBe(true);
        if (expected.documentChanges.requireNoInventedBaseline) expect(groups).toHaveLength(0);
    }
}

describeIfDatabase("provider-free scenario collection against current LAU-9", () => {
    jest.setTimeout(120_000);

    it.each([
        ["01-empty-evidence", false],
        ["02-founder-context-only", false],
        ["03-relevant-workspace-document", true],
        ["04-first-ever-version-no-invented-diff", false],
        ["05-multiple-versions-in-period", false],
    ] as const)("collects %s with current snapshot v2 semantics", async (name, deterministicWorkspaceEmbeddings) => {
        const { scenario, snapshot } = await collect(name, deterministicWorkspaceEmbeddings);
        assertExpectations(scenario, snapshot);
        if (name === "03-relevant-workspace-document") {
            expect(snapshot.items.some((item) => item.sourceType === "workspace_document")).toBe(true);
            expect(snapshot.items.some((item) => item.sourceType === "document_change")).toBe(false);
            expect(snapshot.items.filter((item) => item.sourceType === "workspace_document").every((item) => item.metadata.documentVersionId !== undefined)).toBe(true);
        }
        if (name === "05-multiple-versions-in-period") {
            const pairKeys = new Set(snapshot.documentChangeAudit.groups.map((group) => `${group.previousVersionId}->${group.currentVersionId}`));
            expect(pairKeys.size).toBeGreaterThanOrEqual(2);
            expect(snapshot.documentChangeAudit.rawChanges.length).toBeGreaterThan(0);
            expect(snapshot.documentChangeAudit.groups.every((group) => group.previousVersionId !== group.currentVersionId)).toBe(true);
        }
    });
});

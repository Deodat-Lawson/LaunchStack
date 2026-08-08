import { resolve } from "node:path";

import { loadScenario, parseScenario } from "../../scripts/founder-weekly-review-scenario-loader";

const scenarioPath = (name: string) => resolve(__dirname, `../../test-fixtures/founder-weekly-review/scenarios/${name}/scenario.json`);

describe("Founder Weekly Review scenario loader", () => {
    it("loads the first-ever-version regression fixture", async () => {
        const scenario = await loadScenario(scenarioPath("04-first-ever-version-no-invented-diff"));
        expect(scenario.name).toBe("first-ever-version-no-invented-diff");
        expect(scenario.expect?.documentChanges?.requireNoInventedBaseline).toBe(true);
    });

    it("applies bounded defaults while rejecting unknown fields", () => {
        const parsed = parseScenario({ ...JSON.parse('{"name":"empty","reportingPeriod":{"start":"2026-07-20","end":"2026-07-26"},"workspaceTimezone":"UTC","companies":[{"name":"Northstar","underReview":true,"documents":[]}]}') });
        expect(parsed.schemaVersion).toBe("founder-weekly-review-scenario/v1");
        expect(() => parseScenario({ ...parsed, unexpected: true })).toThrow();
    });
});

/**
 * Every fixture on disk parses, and each one asserts something. No database
 * needed — this is the cheap gate that catches a malformed or expectation-free
 * fixture before the integration suite has to spin up a database to find it.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { loadScenario, parseScenario } from "../../scripts/founder-weekly-review-scenario-loader";

const SCENARIO_DIR = join(__dirname, "..", "..", "test-fixtures", "founder-weekly-review", "scenarios");

async function scenarioNames(): Promise<string[]> {
    const entries = await readdir(SCENARIO_DIR, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}

describe("founder weekly review scenario loader", () => {
    it("finds the fixture set on disk", async () => {
        await expect(scenarioNames()).resolves.not.toHaveLength(0);
    });

    it("parses every fixture and gives each one a falsifiable expectation", async () => {
        for (const name of await scenarioNames()) {
            const scenario = await loadScenario(join(SCENARIO_DIR, name, "scenario.json"));
            expect(scenario.name).not.toHaveLength(0);
            expect(Object.keys(scenario.expect).length).toBeGreaterThan(0);
            expect(scenario.companies.filter((company) => company.underReview)).toHaveLength(1);
        }
    });

    it("surfaces a parse failure instead of returning a partial scenario", () => {
        expect(() => parseScenario({ name: "broken" })).toThrow();
    });
});

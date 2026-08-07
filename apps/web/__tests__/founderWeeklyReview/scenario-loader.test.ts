import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
    loadScenario,
    parseScenario,
} from "../../scripts/founder-weekly-review-scenario-loader";

const FIXTURE_PATH = resolve(
    __dirname,
    "../../test-fixtures/founder-weekly-review/scenarios/04-single-version-change/scenario.json"
);

function validScenarioObject() {
    return {
        name: "single-version-change",
        reportingPeriod: { start: "2026-07-20", end: "2026-07-26" },
        workspaceTimezone: "America/New_York",
        founderContext: "Focus on onboarding reliability.",
        companies: [
            {
                name: "Northstar Analytics",
                underReview: true,
                documents: [
                    {
                        title: "Onboarding Plan",
                        category: "Planning",
                        versions: [
                            {
                                versionNumber: 1,
                                timestamp: "2026-07-24T10:00:00.000Z",
                                changelog: "Updated ownership.",
                            },
                        ],
                    },
                ],
            },
        ],
    };
}

describe("parseScenario", () => {
    it("accepts a valid scenario and applies schema defaults", () => {
        const parsed = parseScenario(validScenarioObject());
        expect(parsed.schemaVersion).toBe("founder-weekly-review-scenario/v1");
        expect(parsed.companies[0]!.underReview).toBe(true);
        expect(parsed.companies[0]!.documents[0]!.versions[0]!.chunks).toEqual([]);
    });
});

describe("loadScenario", () => {
    it("reads and validates the committed 04-single-version-change fixture", async () => {
        const scenario = await loadScenario(FIXTURE_PATH);
        expect(scenario.name).toBe("single-version-change");
        expect(scenario.companies).toHaveLength(1);
        expect(scenario.companies[0]!.underReview).toBe(true);
        expect(scenario.companies[0]!.documents[0]!.versions[0]!.chunks).toHaveLength(1);
    });

    it("rejects a file whose JSON is valid but violates the contract", async () => {
        const dir = await mkdtemp(join(tmpdir(), "fwr-scenario-"));
        const badPath = join(dir, "bad.json");
        const bad = validScenarioObject();
        bad.companies[0]!.underReview = false;
        await writeFile(badPath, JSON.stringify(bad), "utf8");
        try {
            await expect(loadScenario(badPath)).rejects.toThrow(
                /Exactly one company must have underReview/
            );
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

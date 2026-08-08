import { readFile } from "node:fs/promises";

import { FounderWeeklyReviewScenarioSchema, type FounderWeeklyReviewScenario } from "../test-fixtures/founder-weekly-review/scenarios/contracts";

export function parseScenario(input: unknown): FounderWeeklyReviewScenario {
    return FounderWeeklyReviewScenarioSchema.parse(input);
}

export async function loadScenario(path: string): Promise<FounderWeeklyReviewScenario> {
    return parseScenario(JSON.parse(await readFile(path, "utf8")));
}

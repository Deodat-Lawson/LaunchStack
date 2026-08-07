import { readFile } from "node:fs/promises";

import {
    FounderWeeklyReviewScenarioSchema,
    type FounderWeeklyReviewScenario,
} from "../test-fixtures/founder-weekly-review/scenarios/contracts";

export function parseScenario(input: unknown): FounderWeeklyReviewScenario {
    return FounderWeeklyReviewScenarioSchema.parse(input);
}

export async function loadScenario(path: string): Promise<FounderWeeklyReviewScenario> {
    const body = await readFile(path, "utf8");
    return parseScenario(JSON.parse(body));
}

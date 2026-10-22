/**
 * Vantage — the evidence-backed operating system for founder meetings.
 *
 * Evidence and metrics go in; a weekly agenda comes out with every claim
 * cited; decisions become commitments that next week's agenda checks.
 * See README.md in this folder.
 */
export * from "./schema";
export * from "./types";
export * from "./week";
export * from "./csv";
export * from "./signals";
export * from "./update";
export * from "./db";
export * from "./generator";
export * from "./prepare";
export * from "./contract-v1";
export * from "./period-v1";
export * from "./repository-v1";
export {
    generateWeeklyAgendaV1,
    GENERATION_BUDGETS,
    GENERATION_PROMPT_VERSION,
} from "./generation-v1";
export { validateGenerationResult } from "./validate-generation-v1";

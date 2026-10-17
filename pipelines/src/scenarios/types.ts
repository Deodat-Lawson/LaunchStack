/**
 * Scenarios vertical — domain types shared by the schema, the run loop and
 * the host. The simulation itself lives in `@launchstack/simulation`.
 */
import type { Brief, EvidenceItem, PostReception, ScenarioReport, World } from "@launchstack/simulation";

export const SCENARIO_KINDS = ["scenario", "post_test"] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

export const SCENARIO_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

export type ScenarioStage = "gathering" | "casting" | "simulating" | "reporting" | "done";

export interface ScenarioSourcesInput {
    documentIds: number[];
    searchFiles: boolean;
    prospects: boolean;
    brandComments: boolean;
    companyProfile: boolean;
    notes: string;
}

export const EVIDENCE_KINDS = ["document", "search", "prospect", "brand_comment", "company_profile", "notes"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * Evidence as stored on the run. `ref.type` is "document" when the item came
 * from a file (so a shared reader without access sees it redacted).
 */
export interface StoredEvidence extends EvidenceItem {
    kind: EvidenceKind;
    /** Where to open it in the app, if anywhere. */
    href: string | null;
}

export interface RunUsage {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    credits: number;
}

export const EMPTY_USAGE: RunUsage = { calls: 0, inputTokens: 0, outputTokens: 0, credits: 0 };

export interface RunEstimateStored {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    credits: number;
}

/** Post tests: what was tested, and who the brand is in the simulation. */
export interface PostTestDraft {
    text: string;
    networks: string[];
    brandName: string;
    brandHandle: string;
}

export interface ScenarioRunRecord {
    id: number;
    companyId: bigint;
    createdByUserId: string;
    kind: ScenarioKind;
    title: string;
    subject: string;
    status: ScenarioStatus;
    /** Units completed: 0 nothing, 1 brief, 2 cast, 2 + r after round r, 3 + rounds report. */
    step: number;
    agentCount: number;
    roundCount: number;
    seed: number;
    sources: ScenarioSourcesInput;
    evidence: StoredEvidence[] | null;
    brief: Brief | null;
    world: World | null;
    report: ScenarioReport | null;
    reception: PostReception | null;
    estimate: RunEstimateStored;
    usage: RunUsage;
    draft: PostTestDraft | null;
    draftHash: string | null;
    error: string | null;
    sharedAt: Date | null;
    cancelRequestedAt: Date | null;
    leaseUntil: Date | null;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
}

/** Units in a run: brief, cast, one per round, report. */
export function unitCount(rounds: number): number {
    return 3 + rounds;
}

export function stageOf(run: Pick<ScenarioRunRecord, "status" | "step" | "roundCount">): ScenarioStage {
    if (run.status === "done") return "done";
    if (run.step <= 0) return "gathering";
    if (run.step === 1) return "casting";
    if (run.step < 2 + run.roundCount) return "simulating";
    return "reporting";
}

/** Rounds completed. */
export function roundsDone(run: Pick<ScenarioRunRecord, "step" | "roundCount">): number {
    return Math.max(0, Math.min(run.roundCount, run.step - 2));
}

export const TERMINAL_STATUSES: readonly ScenarioStatus[] = ["done", "failed", "cancelled"];

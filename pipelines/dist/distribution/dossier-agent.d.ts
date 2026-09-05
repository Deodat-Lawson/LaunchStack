import type { AgentModelPort, AgentToolDefinition, ChatTokenUsage } from "@launchstack/llm";
import type { ReadablePage } from "@launchstack/tools/web-research";
import type { RawSearchResult } from "@launchstack/tools/web-research";
import type { TradeDataProvider } from "@launchstack/tools/trade-data";
import type { Dossier, EvidenceKind, PartnerKind, PartnerOrgRecord, ProgramRecord, Territory } from "./types.js";
export declare const DOSSIER_PROMPT_VERSION = "distribution-dossier-agent/v1";
export interface DossierLimits {
    /** Model calls in the research loop. */
    maxTurns: number;
    /** Token ceiling across loop + repair. */
    tokenBudget: number;
    maxPagesPerCandidate: number;
    maxCharsPerPage: number;
    maxSearchesPerCandidate: number;
    maxEvidencePerCandidate: number;
}
export declare const DOSSIER_LIMITS: DossierLimits;
export interface RecordedEvidence {
    id: number;
    kind: EvidenceKind;
    claim: string;
    sourceUrl: string;
    quote: string | null;
    confidence: number;
}
/** What the agent needs from the world; the host wires real tools or fakes. */
export interface DossierAgentPorts {
    model: AgentModelPort;
    fetchPage: (url: string) => Promise<ReadablePage>;
    searchWeb: ((query: string) => Promise<RawSearchResult[]>) | null;
    searchPlaces: ((query: string) => Promise<Array<{
        name: string;
        formattedAddress: string;
        website?: string;
    }>>) | null;
    tradeData: TradeDataProvider | null;
    /** Persist one piece of evidence; returns its id. The host binds companyId/orgId/runId. */
    recordEvidence: (input: Omit<RecordedEvidence, "id">) => Promise<number>;
    signal?: AbortSignal;
}
export interface DossierAgentInput {
    program: ProgramRecord;
    sellerSummary: string;
    org: PartnerOrgRecord;
    kind: PartnerKind;
    territory: Territory | null;
    /** URLs that surfaced this candidate — good first pages. */
    seedUrls: string[];
    hsCodes: string[];
    limits?: Partial<DossierLimits>;
}
export type DossierOutcome = {
    status: "ok";
    dossier: Dossier;
    repaired: boolean;
} | {
    status: "budget_exhausted";
    dossier: null;
    reason: "turns" | "tokens";
} | {
    status: "gate_failed";
    dossier: null;
    errors: GateError[];
};
export interface DossierAgentResult {
    outcome: DossierOutcome;
    evidence: RecordedEvidence[];
    fetchedUrls: string[];
    turns: number;
    usage: ChatTokenUsage;
    modelId?: string;
    playbookHash: string;
    promptVersion: string;
}
export interface GateError {
    code: "unknown_evidence_id" | "unfetched_source" | "empty_dossier";
    message: string;
}
/** Every evidence id in the dossier must exist and its source must have been fetched this session. */
export declare function validateDossierGrounding(dossier: Dossier, evidence: ReadonlyMap<number, RecordedEvidence>, fetched: ReadonlySet<string>): GateError[];
export declare function normalizeUrlForMatch(url: string): string;
export interface DossierToolset {
    tools: AgentToolDefinition[];
    getEvidence(): ReadonlyMap<number, RecordedEvidence>;
    getFetched(): ReadonlySet<string>;
}
/**
 * The agent's tools. `record_evidence` is the only write. The tool schemas
 * carry no tenant fields — see dossier-agent.test.ts.
 */
export declare function makeDossierTools(ports: DossierAgentPorts, input: DossierAgentInput): DossierToolset;
export declare function runDossierAgent(ports: DossierAgentPorts, input: DossierAgentInput): Promise<DossierAgentResult>;
//# sourceMappingURL=dossier-agent.d.ts.map
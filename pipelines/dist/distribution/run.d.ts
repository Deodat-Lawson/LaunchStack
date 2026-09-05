/**
 * The distribution pipeline (design §4.1): eight stages declared with the
 * stage runner. Split into three host-callable pieces so a durable host can
 * make each candidate its own step:
 *
 *   prepareRun     profile → plan → gather → resolve   (one step)
 *   enrichCandidate agent → screen → score → report     (one step per candidate)
 *   finalizeRun    summary                              (one step)
 *
 * `runDistributionPipeline` composes them in-process for tests and
 * synchronous callers. Persistence goes through ./db; the host owns the
 * publish-to-Sources port because it needs apps/web's storage.
 */
import type { PipelineProgressEvent } from "@launchstack/tools/contract";
import type { ComplianceScreenProvider } from "@launchstack/tools/compliance-screen";
import type { TradeDataProvider } from "@launchstack/tools/trade-data";
import type { RawSearchResult, ReadablePage } from "@launchstack/tools/web-research";
import type { AgentModelPort, ChatTokenUsage } from "@launchstack/llm";
import { type SellerProfile } from "./plan.js";
import type { ProgramRecord, RelationshipRecord, RunStatus, RunSummary, SourceCount, Territory } from "./types.js";
export type DistributionStage = Exclude<RunStatus, "queued" | "completed" | "failed">;
export interface PublishDossierInput {
    title: string;
    filename: string;
    markdown: string;
    creationKey: string;
    /** Folder in Sources. */
    category: string;
}
/** Everything the pipeline needs from outside. `createDefaultPorts` wires production. */
export interface DistributionPorts {
    model: AgentModelPort;
    fetchPage: (url: string, signal?: AbortSignal) => Promise<ReadablePage>;
    searchWeb: ((queries: Array<{
        searchQuery: string;
        category: string;
        rationale: string;
    }>) => Promise<RawSearchResult[]>) | null;
    /** Geocode + place search for one city/region query; null when not configured. */
    searchPlaces: ((args: {
        query: string;
        categoryIds?: string[];
        territory: Territory;
    }) => Promise<Array<{
        fsqId: string;
        name: string;
        website?: string;
        formattedAddress: string;
        location: {
            lat: number;
            lng: number;
        };
        categories: Array<{
            id: string;
            name: string;
        }>;
    }>>) | null;
    tradeData: TradeDataProvider | null;
    compliance: ComplianceScreenProvider | null;
    /** Host-owned: store the markdown and run it through document ingestion. */
    publishDossier: ((input: PublishDossierInput) => Promise<{
        documentId: number;
    }>) | null;
    /** Host-owned metering; called once per completed candidate. */
    debitCredits: ((args: {
        amount: number;
        description: string;
        referenceId: string;
    }) => Promise<void>) | null;
    /** Rationale writer; null → template rationale. */
    writeRationale: ((input: string) => Promise<string>) | null;
    creditsPerCandidate: number;
}
export interface RunContext {
    runId: string;
    companyId: bigint;
    programId: string;
    onProgress?: (event: PipelineProgressEvent<DistributionStage>) => void;
    signal?: AbortSignal;
}
export interface PrepareRunResult {
    candidateRelationshipIds: string[];
    sources: SourceCount[];
    mentions: number;
    resolved: number;
    excluded: number;
    warnings: string[];
    profile: SellerProfile;
}
export declare function prepareRun(ctx: RunContext, ports: DistributionPorts): Promise<PrepareRunResult>;
export interface EnrichCandidateResult {
    relationshipId: string;
    status: "ok" | "budget_exhausted" | "gate_failed";
    fitScore: number;
    evidenceCount: number;
    flagged: boolean;
    screened: boolean;
    published: boolean;
    usage: ChatTokenUsage;
    creditsDebited: number;
}
export declare function enrichCandidate(ctx: RunContext, ports: DistributionPorts, args: {
    relationshipId: string;
    profile: SellerProfile;
    seedUrls?: string[];
}): Promise<EnrichCandidateResult>;
export declare function finalizeRun(ctx: RunContext, prepared: Pick<PrepareRunResult, "sources" | "mentions" | "resolved" | "excluded" | "warnings" | "candidateRelationshipIds">, enriched: EnrichCandidateResult[], startedAt: Date): Promise<RunSummary>;
export declare function failRun(ctx: Pick<RunContext, "runId" | "companyId">, message: string): Promise<void>;
export declare function runDistributionPipeline(ctx: RunContext, ports: DistributionPorts): Promise<RunSummary>;
export type { RelationshipRecord, ProgramRecord };
//# sourceMappingURL=run.d.ts.map
/**
 * Stage D — one gated explanation run over a workspace checkout
 * (design §3.4): warm-start from the context bundle, explore through the
 * four read-only tools (or skip straight to the packed digest when the repo
 * fits), validate through the deterministic gate, repair at most once, and
 * return the draft with full provenance either way. The *caller* decides
 * what a failed gate means (the job fails visibly — never a silently
 * degraded answer).
 */
import type { AgentModelPort, ChatTokenUsage } from "@launchstack/llm";
import type { ContextBundle, WorkspaceDiagramType, WorkspaceView } from "@launchstack/pipelines/repo-workspace";
import type { GateResult } from "./gate.js";
export declare const EXPLAINER_PROMPT_VERSION = "repo-explainer-agent/v1";
export interface ExplainLimits {
    /** Model calls in the exploration loop. */
    maxTurns?: number;
    /** Token ceiling across the whole run (loop + repair). */
    tokenBudget?: number;
    /** Digest budget under which the fast path replaces the loop. */
    fastPathMaxChars?: number;
}
export interface ExplainRunInput {
    view: WorkspaceView;
    bundle: ContextBundle;
    port: AgentModelPort;
    repoName: string;
    diagramType: WorkspaceDiagramType;
    instructions?: string | null;
    signal?: AbortSignal;
    onTurn?: (info: {
        turn: number;
        toolCalls: string[];
    }) => void;
    limits?: ExplainLimits;
}
export interface ExplanationRunResult {
    summary: string;
    mermaidCode: string;
    filesRead: string[];
    path: "loop" | "fast";
    turns: number;
    usage: ChatTokenUsage;
    modelId?: string;
    gate: GateResult;
    repaired: boolean;
    skillVersion: string;
    skillHash: string;
    promptVersion: string;
}
export declare const DEFAULT_EXPLAIN_LIMITS: Required<ExplainLimits>;
export declare function runRepoExplanation(input: ExplainRunInput): Promise<ExplanationRunResult>;
//# sourceMappingURL=explain.d.ts.map
/**
 * gate — the deterministic acceptance gate for an LLM-generated repo
 * explanation (summary + Mermaid diagram).
 *
 * Every check here is pure string/set work: no LLM, no network, no clock.
 * The gate runs on every draft, and its errors are collected exhaustively
 * (never early-returned) because they feed the repair prompt — the model gets
 * one shot at fixing *everything* it got wrong, so it must see everything.
 *
 * Checks:
 *   - the summary is substantial (≥ 200 chars) and sectioned (≥ 2 headings);
 *   - the Mermaid code lints (see ./mermaid-lint) and matches the requested
 *     diagram type;
 *   - the node count sits inside a per-type band (too few nodes is a useless
 *     diagram, too many is an unreadable one);
 *   - every file path the draft mentions is grounded: it exists at this
 *     commit AND its content actually entered the model's context.
 */
import type { WorkspaceDiagramType } from "@launchstack/pipelines/repo-workspace";
export type GateErrorCode = "summary_missing" | "summary_unsectioned" | "mermaid_invalid" | "mermaid_type_mismatch" | "node_count_out_of_band" | "ungrounded_path_reference";
export interface GateError {
    code: GateErrorCode;
    message: string;
    detail?: string;
}
export interface GateContext {
    requestedType: WorkspaceDiagramType;
    /** Repo-relative paths of every file that exists at this commit. */
    repoFiles: ReadonlySet<string>;
    /** Paths whose content actually entered the model's context. */
    readPaths: ReadonlySet<string>;
    /** Node-count band; falls back to DEFAULT_NODE_BANDS[requestedType]. */
    nodeBand?: {
        min: number;
        max: number;
    };
}
export interface ExplanationDraft {
    summary: string;
    mermaidCode: string;
}
export interface GateResult {
    ok: boolean;
    errors: GateError[];
    nodeCount: number;
}
export declare const DEFAULT_NODE_BANDS: Record<WorkspaceDiagramType, {
    min: number;
    max: number;
}>;
/** A summary shorter than this (trimmed) is not an explanation. */
export declare const SUMMARY_MIN_CHARS = 200;
export declare function validateExplanation(draft: ExplanationDraft, ctx: GateContext): GateResult;
//# sourceMappingURL=gate.d.ts.map
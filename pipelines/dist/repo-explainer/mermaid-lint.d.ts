/**
 * mermaid-lint — a bounded, dependency-free validator for the Mermaid SUBSET
 * the repo explainer emits.
 *
 * This is deliberately NOT a full Mermaid parser. It answers exactly three
 * questions about a draft diagram, deterministically and without any LLM,
 * network, or dependency:
 *
 *   1. What diagram type does the first meaningful line declare?
 *   2. How many distinct nodes / participants / classes / entities appear?
 *   3. Is the source structurally sane (non-empty, brackets balanced)?
 *
 * Anything Mermaid supports beyond the emitted subset (styling, interaction,
 * exotic arrow heads, multi-line labels, escaped quotes) is out of scope: an
 * unrecognized line simply contributes no nodes. The gate that consumes this
 * result treats "zero nodes" as a failure, so leniency here cannot let an
 * empty diagram through.
 */
export type MermaidKind = "flowchart" | "sequenceDiagram" | "classDiagram" | "erDiagram" | "unknown";
export interface MermaidLintResult {
    ok: boolean;
    kind: MermaidKind;
    nodeCount: number;
    /** Human-readable, each prefixed with a stable code ("empty:", "unknown-kind:", "unbalanced:", "no-nodes:", "too-large:"). */
    errors: string[];
}
/** Inputs longer than this are rejected outright — the gate never needs a
 * diagram that large and refusing early keeps the lint O(bounded). */
export declare const MERMAID_MAX_CHARS = 50000;
export declare function lintMermaid(code: string): MermaidLintResult;
//# sourceMappingURL=mermaid-lint.d.ts.map
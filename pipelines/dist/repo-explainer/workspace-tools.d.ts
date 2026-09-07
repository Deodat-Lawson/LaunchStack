/**
 * The explainer's four read-only tools over one workspace checkout
 * (design §3.4): `repo_map`, `repo_tree`, `search_code`, `read_files`.
 *
 * Everything enforced in the tools, not the prompt:
 * - hygiene: denied paths are invisible in every result,
 * - membership: unknown paths return typed errors the model corrects,
 * - budgets: 25 files / 30k chars per file / 100k chars total per run,
 *   with the remaining budget reported after every read.
 *
 * The factory also tracks which paths actually entered the model's context —
 * the read-set the acceptance gate checks grounding against.
 */
import type { AgentToolDefinition } from "@launchstack/llm";
import type { ContextBundle, WorkspaceView } from "@launchstack/pipelines/repo-workspace";
export declare const READ_BUDGET: {
    readonly maxFilesPerRun: 25;
    readonly maxCharsPerFile: 30000;
    readonly maxTotalChars: 100000;
    readonly maxPathsPerCall: 10;
};
export interface ExplainerToolset {
    tools: AgentToolDefinition[];
    /** Paths whose content actually entered the model's context. */
    getReadPaths(): ReadonlySet<string>;
}
export declare function makeExplainerTools(view: WorkspaceView, bundle: ContextBundle): ExplainerToolset;
//# sourceMappingURL=workspace-tools.d.ts.map
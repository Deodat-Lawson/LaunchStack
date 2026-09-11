/**
 * Publishing an explanation into the Sources library (design §3.5) — the
 * mindmap seam with different nouns. This module owns only the pure half:
 * the Markdown rendering, the filename, and the convergent creation key.
 * The web route does the storing and the `processDocumentUpload` call, like
 * the mindmap publish route does.
 */
import type { RepoExplanationJobResult } from "@launchstack/pipelines/repo-workspace/schema";
import type { WorkspaceDiagramType } from "@launchstack/pipelines/repo-workspace";
/** Same repo, same commit, same diagram type ⇒ the same source — a
 * re-publish converges instead of duplicating (the mindmap's
 * `mindmap:<id>:<revision>` rule). */
export declare function makeExplanationCreationKey(owner: string, repo: string, sha: string, diagramType: WorkspaceDiagramType): string;
export declare function makeExplanationFilename(owner: string, repo: string, sha: string): string;
/** Strip an existing ```mermaid fence so the render never double-fences. */
export declare function stripMermaidFence(code: string): string;
export interface RenderExplanationInput {
    owner: string;
    repo: string;
    diagramType: WorkspaceDiagramType;
    result: RepoExplanationJobResult;
    generatedAt: Date;
}
export declare function renderExplanationMarkdown(input: RenderExplanationInput): string;
//# sourceMappingURL=publish.d.ts.map
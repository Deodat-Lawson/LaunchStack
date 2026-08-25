import type { DiagramType, RepoInfo } from "./types.js";
export declare function getFilesToExploreSystem(diagramType?: DiagramType): string;
export declare const FILES_TO_EXPLORE_SYSTEM: string;
export declare function buildFilesToExploreUserPrompt(tree: string): string;
export declare function parsePathsFromResponse(text: string | null | undefined): string[];
export declare function getSystemPrompt(diagramType?: DiagramType): string;
export declare const SYSTEM_PROMPT: string;
/** Extract the summary from the response (before the mermaid block). */
export declare function extractSummary(text: string | null | undefined): string | null;
/** Extract mermaid code from response (handles ```mermaid ... ``` or raw mermaid). */
export declare function extractMermaidCode(text: string | null | undefined): string | null;
export declare function buildUserPrompt(
    repo: RepoInfo,
    repoContext: string,
    userInstructions?: string | null
): string;
//# sourceMappingURL=prompts.d.ts.map

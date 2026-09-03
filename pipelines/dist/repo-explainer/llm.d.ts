import type { DiagramType, RepoInfo } from "./types.js";
export declare function getFilesToExplore(tree: string, repoPrefix: string, diagramType?: DiagramType): Promise<string[]>;
export declare function explainRepoWithLlm(repo: RepoInfo, repoContext: string, instructions: string | null | undefined, diagramType?: DiagramType): Promise<{
    explanation: string;
    success: boolean;
    error?: string;
}>;
//# sourceMappingURL=llm.d.ts.map
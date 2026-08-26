import type { DiagramType, RepoInfo, StatusCallback } from "./types.js";
export declare function getRepoContext(
    repo: RepoInfo,
    ref: string | null,
    githubToken?: string | null,
    statusCallback?: StatusCallback,
    diagramType?: DiagramType
): Promise<{
    context: string;
    success: boolean;
    error?: string;
}>;
//# sourceMappingURL=github-tools.d.ts.map

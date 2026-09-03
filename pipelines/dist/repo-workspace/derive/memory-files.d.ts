/**
 * The memory-files bundle — the repo's own curated markdown, read first
 * because author-written context is the highest value per token the model
 * will ever get (design §3.3; the AGENTS.md / CLAUDE.md lesson).
 */
import type { MemoryFile, WorkspaceView } from "../types.js";
export declare function collectMemoryFiles(view: WorkspaceView): Promise<MemoryFile[]>;
//# sourceMappingURL=memory-files.d.ts.map
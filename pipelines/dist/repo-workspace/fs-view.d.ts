/**
 * WorkspaceView over a directory on disk — the read-only window stages C and
 * D get onto one commit's checkout (a git worktree).
 *
 * Safety properties, enforced here and nowhere else:
 * - never follows symlinks (lstat before every read),
 * - never exposes `.git` or escapes the root (paths are normalized and
 *   containment-checked),
 * - never returns binary content (NUL probe on the first 8 KiB),
 * - bounded work everywhere (file-count, size, and result caps).
 *
 * Search is a deterministic JS scan. `rg` would be faster on huge trees; the
 * port shape (`WorkspaceView.searchText`) is where a ripgrep-backed
 * implementation slots in without touching any caller (design §2.3).
 */
import type { WorkspaceView } from "./types.js";
/** Suffix/prefix glob: `*.ts`, `src/*`, or a literal path. Anything more
 * elaborate is deliberately unsupported — callers get determinism, not power. */
export declare function matchesGlob(filePath: string, glob: string | undefined): boolean;
export declare function createDirectoryView(rootDir: string, sha: string): WorkspaceView;
//# sourceMappingURL=fs-view.d.ts.map
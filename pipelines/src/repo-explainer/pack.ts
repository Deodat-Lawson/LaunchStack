/**
 * The small-repo fast path's input: a repomix-style single digest of the
 * whole checkout (design §3.4). When the digest fits the budget the agent
 * loop is skipped entirely — one gated call over the full text is cheaper
 * and better for small repositories.
 *
 * Ordering is deliberate and deterministic: memory files first (the author's
 * map), then files by repo-map rank (the load-bearing code), then everything
 * else sorted by path. Denied paths never enter the digest.
 */

import { makeDeniedSet } from "@launchstack/pipelines/repo-workspace";
import type { ContextBundle, WorkspaceView } from "@launchstack/pipelines/repo-workspace";

const PER_FILE_CHAR_CAP = 30_000;

export interface PackResult {
    digest: string;
    includedPaths: string[];
    /** True when the budget cut files out — the fast path must not run. */
    truncated: boolean;
}

export async function packDigest(
    view: WorkspaceView,
    bundle: ContextBundle,
    maxChars: number
): Promise<PackResult> {
    const denied = makeDeniedSet(bundle.hygiene);
    const files = await view.listFiles();
    const existing = new Set(files.map(file => file.path));

    const ordered: string[] = [];
    const seen = new Set<string>();
    const push = (path: string): void => {
        if (seen.has(path) || denied.has(path) || !existing.has(path)) return;
        seen.add(path);
        ordered.push(path);
    };

    for (const memory of bundle.memoryFiles) push(memory.path);
    for (const entry of bundle.map.entries) push(entry.path);
    for (const file of files) push(file.path);

    const sections: string[] = [];
    const includedPaths: string[] = [];
    let used = 0;
    let truncated = false;

    for (const path of ordered) {
        if (used >= maxChars) {
            truncated = true;
            break;
        }
        const content = await view.readFile(path);
        if (content === null) continue; // binary/oversized — not truncation
        const clipped = content.length > PER_FILE_CHAR_CAP;
        const kept = clipped ? content.slice(0, PER_FILE_CHAR_CAP) : content;
        const section = `===== ${path}${clipped ? " (truncated)" : ""} =====\n${kept}`;
        if (used + section.length > maxChars) {
            truncated = true;
            break;
        }
        sections.push(section);
        includedPaths.push(path);
        used += section.length + 2;
    }

    return { digest: sections.join("\n\n"), includedPaths, truncated };
}

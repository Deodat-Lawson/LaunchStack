/**
 * Playbook loading with provenance (repo-explainer skills pattern). The
 * judgment — how to research, how to plan — lives in versioned markdown
 * beside this module; every load returns a version id and a content hash
 * that travel into the run's provenance.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DISTRIBUTION_PLAYBOOK_VERSION = "distribution-playbook/v1";

export type PlaybookName = "research" | "plan" | "score";

export interface Playbook {
    name: PlaybookName;
    version: string;
    /** sha256 over version + name + content. */
    hash: string;
    content: string;
}

const PLAYBOOK_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "playbook");
const cache = new Map<PlaybookName, Playbook>();

export function loadPlaybook(name: PlaybookName): Playbook {
    const cached = cache.get(name);
    if (cached) return cached;
    const filePath = path.join(PLAYBOOK_DIR, `${name}.md`);
    let content: string;
    try {
        content = readFileSync(filePath, "utf8");
    } catch (error) {
        throw new Error(
            `distribution playbook missing: ${name}.md (looked in ${PLAYBOOK_DIR}). ` +
                `The playbook/ directory must ship beside the compiled module. ` +
                `${error instanceof Error ? error.message : String(error)}`
        );
    }
    const hash = createHash("sha256")
        .update(DISTRIBUTION_PLAYBOOK_VERSION)
        .update("\0")
        .update(name)
        .update("\0")
        .update(content)
        .digest("hex");
    const playbook: Playbook = { name, version: DISTRIBUTION_PLAYBOOK_VERSION, hash, content };
    cache.set(name, playbook);
    return playbook;
}

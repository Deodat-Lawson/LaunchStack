/**
 * Skill loading with provenance (design §3.4 "the markdown skills").
 *
 * The editorial judgment — how to explore, what a good diagram is — lives in
 * versioned markdown files beside this module, not in TS string literals.
 * Every load returns a version id and a content hash that travel into the
 * run's provenance, so a rubric edit is a diffable, attributable change
 * (the founder-weekly-review prompt discipline, generalized).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { WorkspaceDiagramType } from "@launchstack/pipelines/repo-workspace";
import { DIAGRAM_TYPES } from "@launchstack/pipelines/repo-workspace";

export const EXPLAINER_SKILL_VERSION = "repo-explainer-skills/v1";

export interface ExplainerSkills {
    version: string;
    /** sha256 over version + both file contents — the provenance hash. */
    hash: string;
    /** The task frame and exploration guidance (explain.md). */
    system: string;
    /** The diagram rubric for the requested type. */
    rubric: string;
}

const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "skills");

const cache = new Map<WorkspaceDiagramType, ExplainerSkills>();

function readSkillFile(relative: string): string {
    const filePath = path.join(SKILLS_DIR, relative);
    try {
        return readFileSync(filePath, "utf8");
    } catch (error) {
        throw new Error(
            `repo-explainer skill file missing: ${relative} (looked in ${SKILLS_DIR}). ` +
                `The skills/ directory must ship beside the compiled module. ` +
                `${error instanceof Error ? error.message : String(error)}`
        );
    }
}

export function loadExplainerSkills(diagramType: WorkspaceDiagramType): ExplainerSkills {
    if (!DIAGRAM_TYPES.includes(diagramType)) {
        throw new RangeError(`unknown diagram type "${diagramType}"`);
    }
    const cached = cache.get(diagramType);
    if (cached) return cached;

    const system = readSkillFile("explain.md");
    const rubric = readSkillFile(path.join("diagrams", `${diagramType}.md`));
    const hash = createHash("sha256")
        .update(EXPLAINER_SKILL_VERSION)
        .update("\0")
        .update(system)
        .update("\0")
        .update(rubric)
        .digest("hex");

    const skills: ExplainerSkills = { version: EXPLAINER_SKILL_VERSION, hash, system, rubric };
    cache.set(diagramType, skills);
    return skills;
}

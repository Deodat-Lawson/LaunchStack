/**
 * Skill loading with provenance (design §3.4 "the markdown skills").
 *
 * The editorial judgment — how to explore, what a good diagram is — lives in
 * versioned markdown files beside this module, not in TS string literals.
 * Every load returns a version id and a content hash that travel into the
 * run's provenance, so a rubric edit is a diffable, attributable change
 * (the founder-weekly-review prompt discipline, generalized).
 */
import type { WorkspaceDiagramType } from "@launchstack/pipelines/repo-workspace";
export declare const EXPLAINER_SKILL_VERSION = "repo-explainer-skills/v1";
export interface ExplainerSkills {
    version: string;
    /** sha256 over version + both file contents — the provenance hash. */
    hash: string;
    /** The task frame and exploration guidance (explain.md). */
    system: string;
    /** The diagram rubric for the requested type. */
    rubric: string;
}
export declare function loadExplainerSkills(diagramType: WorkspaceDiagramType): ExplainerSkills;
//# sourceMappingURL=skills.d.ts.map
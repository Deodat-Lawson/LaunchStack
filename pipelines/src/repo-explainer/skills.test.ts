import { describe, expect, it } from "vitest";

import type { WorkspaceDiagramType } from "@launchstack/pipelines/repo-workspace";
import { DIAGRAM_TYPES } from "@launchstack/pipelines/repo-workspace";

import { EXPLAINER_SKILL_VERSION, loadExplainerSkills } from "./skills";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Every rubric must commit the model to its Mermaid kind. */
const EXPECTED_RUBRIC_KIND: Record<WorkspaceDiagramType, string> = {
    architecture: "flowchart TD",
    sequence: "sequenceDiagram",
    class: "classDiagram",
    er: "erDiagram",
    component: "flowchart TD",
};

describe("loadExplainerSkills", () => {
    it("loads a complete skill set for every diagram type", () => {
        for (const diagramType of DIAGRAM_TYPES) {
            const skills = loadExplainerSkills(diagramType);
            expect(skills.version).toBe(EXPLAINER_SKILL_VERSION);
            expect(skills.system.length).toBeGreaterThan(0);
            expect(skills.rubric.length).toBeGreaterThan(0);
            expect(skills.hash).toMatch(SHA256_HEX);
        }
    });

    it("ships the output contract in the system frame", () => {
        for (const diagramType of DIAGRAM_TYPES) {
            const { system } = loadExplainerSkills(diagramType);
            expect(system).toContain("Output contract");
            expect(system).toContain("submit_result");
        }
    });

    it("hands each diagram type its own rubric with the right Mermaid kind", () => {
        for (const diagramType of DIAGRAM_TYPES) {
            const { rubric } = loadExplainerSkills(diagramType);
            expect(rubric).toContain(EXPECTED_RUBRIC_KIND[diagramType]);
        }
    });

    it("returns a 64-character lowercase hex provenance hash", () => {
        const { hash } = loadExplainerSkills("architecture");
        expect(hash).toMatch(SHA256_HEX);
        expect(hash).toHaveLength(64);
    });

    it("is stable across loads — the cache returns the identical object", () => {
        const first = loadExplainerSkills("sequence");
        const second = loadExplainerSkills("sequence");
        expect(second).toBe(first);
        expect(second.hash).toBe(first.hash);
    });

    it("produces a distinct hash per diagram type", () => {
        const hashes = DIAGRAM_TYPES.map(type => loadExplainerSkills(type).hash);
        expect(new Set(hashes).size).toBe(DIAGRAM_TYPES.length);
    });

    it("shares the system frame but not the rubric across types", () => {
        const architecture = loadExplainerSkills("architecture");
        const er = loadExplainerSkills("er");
        expect(er.system).toBe(architecture.system);
        expect(er.rubric).not.toBe(architecture.rubric);
    });

    it("throws a RangeError for a diagram type outside DIAGRAM_TYPES", () => {
        expect(() => loadExplainerSkills("gantt" as WorkspaceDiagramType)).toThrow(RangeError);
        expect(() => loadExplainerSkills("" as WorkspaceDiagramType)).toThrow(
            /unknown diagram type/
        );
    });
});

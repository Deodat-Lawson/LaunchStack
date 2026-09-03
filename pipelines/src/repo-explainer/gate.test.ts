import { describe, expect, it } from "vitest";

import type { WorkspaceDiagramType } from "@launchstack/pipelines/repo-workspace";

import {
    DEFAULT_NODE_BANDS,
    SUMMARY_MIN_CHARS,
    validateExplanation,
    type GateContext,
    type GateErrorCode,
    type GateResult,
} from "./gate";

/* ──────────────────────────────────────────────────────────────
 * Fixture builders
 * ────────────────────────────────────────────────────────────── */

/** ≥ 200 chars, two headings, deliberately free of slash-containing tokens. */
const VALID_SUMMARY = [
    "## Overview",
    "This repository implements a marketing pipeline that derives a deterministic " +
        "context bundle from a connected repository and asks the model for a summary " +
        "plus a diagram of the requested type.",
    "## Verification",
    "Every draft passes through the deterministic acceptance gate before anything " +
        "is persisted, so malformed diagrams and hallucinated file references are " +
        "caught before a user ever sees them.",
].join("\n\n");

/** Valid flowchart with exactly `n` unique nodes (chained edges). */
const flowchart = (n: number): string =>
    ["flowchart TD", ...Array.from({ length: n - 1 }, (_, i) => `    n${i} --> n${i + 1}`)].join(
        "\n"
    );

/** Valid sequence diagram with exactly `n` participants. */
const sequence = (n: number): string =>
    ["sequenceDiagram", ...Array.from({ length: n }, (_, i) => `    participant P${i}`)].join("\n");

/** Valid class diagram with exactly `n` classes. */
const classes = (n: number): string =>
    ["classDiagram", ...Array.from({ length: n }, (_, i) => `    class C${i}`)].join("\n");

/** Valid ER diagram with exactly `n` entity blocks. */
const er = (n: number): string =>
    [
        "erDiagram",
        ...Array.from({ length: n }, (_, i) => [
            `    E${i} {`,
            "        string id",
            "    }",
        ]).flat(),
    ].join("\n");

const ctx = (overrides: Partial<GateContext> = {}): GateContext => ({
    requestedType: "architecture",
    repoFiles: new Set<string>(),
    readPaths: new Set<string>(),
    ...overrides,
});

const codes = (result: GateResult): GateErrorCode[] => result.errors.map(e => e.code);

/* ──────────────────────────────────────────────────────────────
 * Defaults
 * ────────────────────────────────────────────────────────────── */

describe("DEFAULT_NODE_BANDS", () => {
    it("exposes the documented per-type bands", () => {
        expect(DEFAULT_NODE_BANDS).toEqual({
            architecture: { min: 5, max: 15 },
            component: { min: 5, max: 15 },
            sequence: { min: 3, max: 12 },
            class: { min: 3, max: 15 },
            er: { min: 3, max: 15 },
        });
    });
});

/* ──────────────────────────────────────────────────────────────
 * Summary checks
 * ────────────────────────────────────────────────────────────── */

describe("summary checks", () => {
    it("flags only summary_missing for a short but sectioned summary", () => {
        const result = validateExplanation(
            { summary: "## A\n## B", mermaidCode: flowchart(6) },
            ctx()
        );
        expect(codes(result)).toEqual(["summary_missing"]);
        expect(result.ok).toBe(false);
        expect(result.nodeCount).toBe(6);
    });

    it("flags only summary_unsectioned for a long but heading-free summary", () => {
        const summary = "word ".repeat(60).trim();
        expect(summary.length).toBeGreaterThanOrEqual(SUMMARY_MIN_CHARS);
        const result = validateExplanation({ summary, mermaidCode: flowchart(6) }, ctx());
        expect(codes(result)).toEqual(["summary_unsectioned"]);
    });

    it("flags summary_unsectioned when only one heading exists", () => {
        const summary = "## Only\n\n" + "word ".repeat(60).trim();
        const result = validateExplanation({ summary, mermaidCode: flowchart(6) }, ctx());
        expect(codes(result)).toEqual(["summary_unsectioned"]);
    });

    it("counts ## through #### as headings but not # or #####", () => {
        const summary =
            "# Top\n\n##### TooDeep\n\n### Deep\n\n#### Deeper\n\n" + "word ".repeat(60).trim();
        const result = validateExplanation({ summary, mermaidCode: flowchart(6) }, ctx());
        // ### and #### give the required two; # and ##### never count.
        expect(codes(result)).toEqual([]);

        const tooFew = "# Top\n\n##### TooDeep\n\n## Real\n\n" + "word ".repeat(60).trim();
        const result2 = validateExplanation({ summary: tooFew, mermaidCode: flowchart(6) }, ctx());
        expect(codes(result2)).toEqual(["summary_unsectioned"]);
    });

    it("trims before measuring length", () => {
        const padded = "   \n" + "## A\n## B" + "\n   ";
        const result = validateExplanation({ summary: padded, mermaidCode: flowchart(6) }, ctx());
        expect(codes(result)).toEqual(["summary_missing"]);
    });
});

/* ──────────────────────────────────────────────────────────────
 * Mermaid validity and type matching
 * ────────────────────────────────────────────────────────────── */

describe("mermaid checks", () => {
    it("flags mermaid_invalid without a duplicate type mismatch when the kind is unknown", () => {
        const result = validateExplanation(
            { summary: VALID_SUMMARY, mermaidCode: "pie title Pets" },
            ctx()
        );
        expect(codes(result)).toEqual(["mermaid_invalid"]);
        expect(codes(result)).not.toContain("mermaid_type_mismatch");
        const invalid = result.errors[0];
        expect(invalid?.detail).toMatch(/unknown-kind:/);
    });

    it("skips the band check when the diagram does not lint (band only on lint-ok)", () => {
        // Two nodes — far below the architecture band — but the unclosed
        // bracket means the count is untrustworthy and the band must stay quiet.
        const broken = "flowchart TD\n    a[Broken --> b";
        const result = validateExplanation({ summary: VALID_SUMMARY, mermaidCode: broken }, ctx());
        expect(codes(result)).toEqual(["mermaid_invalid"]);
        expect(codes(result)).not.toContain("node_count_out_of_band");
    });

    const mismatchMatrix: Array<[WorkspaceDiagramType, string]> = [
        ["architecture", sequence(5)],
        ["component", classes(5)],
        ["sequence", flowchart(5)],
        ["class", er(3)],
        ["er", flowchart(5)],
    ];

    for (const [requestedType, mermaidCode] of mismatchMatrix) {
        it(`flags mermaid_type_mismatch for "${requestedType}" given a wrong-kind diagram`, () => {
            const result = validateExplanation(
                { summary: VALID_SUMMARY, mermaidCode },
                ctx({ requestedType })
            );
            expect(codes(result)).toEqual(["mermaid_type_mismatch"]);
        });
    }

    const matchMatrix: Array<[WorkspaceDiagramType, string]> = [
        ["architecture", flowchart(5)],
        ["component", flowchart(5)],
        ["sequence", sequence(3)],
        ["class", classes(3)],
        ["er", er(3)],
    ];

    for (const [requestedType, mermaidCode] of matchMatrix) {
        it(`accepts a matching diagram for "${requestedType}"`, () => {
            const result = validateExplanation(
                { summary: VALID_SUMMARY, mermaidCode },
                ctx({ requestedType })
            );
            expect(result.errors).toEqual([]);
            expect(result.ok).toBe(true);
        });
    }
});

/* ──────────────────────────────────────────────────────────────
 * Node-count band
 * ────────────────────────────────────────────────────────────── */

describe("node-count band", () => {
    it("flags a count below the default band", () => {
        const result = validateExplanation(
            { summary: VALID_SUMMARY, mermaidCode: flowchart(3) },
            ctx({ requestedType: "architecture" })
        );
        expect(codes(result)).toEqual(["node_count_out_of_band"]);
        expect(result.nodeCount).toBe(3);
    });

    it("flags a count above the default band", () => {
        const result = validateExplanation(
            { summary: VALID_SUMMARY, mermaidCode: flowchart(16) },
            ctx({ requestedType: "architecture" })
        );
        expect(codes(result)).toEqual(["node_count_out_of_band"]);
    });

    it("respects a band override that admits the diagram", () => {
        const result = validateExplanation(
            { summary: VALID_SUMMARY, mermaidCode: flowchart(3) },
            ctx({ requestedType: "architecture", nodeBand: { min: 2, max: 3 } })
        );
        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);
    });

    it("respects a band override that rejects an otherwise-in-band diagram", () => {
        const result = validateExplanation(
            { summary: VALID_SUMMARY, mermaidCode: flowchart(6) },
            ctx({ requestedType: "architecture", nodeBand: { min: 7, max: 9 } })
        );
        expect(codes(result)).toEqual(["node_count_out_of_band"]);
    });
});

/* ──────────────────────────────────────────────────────────────
 * Grounding
 * ────────────────────────────────────────────────────────────── */

describe("grounding", () => {
    it("flags a path that does not exist in the repository", () => {
        const result = validateExplanation(
            {
                summary: VALID_SUMMARY + "\n\nThe entry point is src/missing.ts.",
                mermaidCode: flowchart(6),
            },
            ctx()
        );
        expect(codes(result)).toEqual(["ungrounded_path_reference"]);
        expect(result.errors[0]?.detail).toBe("not in repository");
        expect(result.errors[0]?.message).toContain("src/missing.ts");
    });

    it("flags a real path whose content was never read", () => {
        const result = validateExplanation(
            {
                summary: VALID_SUMMARY + "\n\nThe entry point is src/present.ts.",
                mermaidCode: flowchart(6),
            },
            ctx({ repoFiles: new Set(["src/present.ts"]) })
        );
        expect(codes(result)).toEqual(["ungrounded_path_reference"]);
        expect(result.errors[0]?.detail).toBe("referenced but never read");
    });

    it("accepts a path that exists and was read", () => {
        const files = new Set(["src/present.ts"]);
        const result = validateExplanation(
            {
                summary: VALID_SUMMARY + "\n\nThe entry point is src/present.ts.",
                mermaidCode: flowchart(6),
            },
            ctx({ repoFiles: files, readPaths: files })
        );
        expect(result.errors).toEqual([]);
    });

    it("checks tokens inside the mermaid code too", () => {
        const mermaidCode = [
            "flowchart TD",
            "    a[src/api/router.ts] --> b",
            "    b --> c",
            "    c --> d",
            "    d --> e",
            "    e --> f",
        ].join("\n");
        const result = validateExplanation({ summary: VALID_SUMMARY, mermaidCode }, ctx());
        expect(codes(result)).toEqual(["ungrounded_path_reference"]);
        expect(result.errors[0]?.message).toContain("src/api/router.ts");
    });

    it("ignores slash-free tokens like Node.js and package.json", () => {
        const summary =
            VALID_SUMMARY +
            "\n\nBuilt on Node.js with configuration in package.json and tsconfig.base.json.";
        const result = validateExplanation({ summary, mermaidCode: flowchart(6) }, ctx());
        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);
    });

    it("reports a repeated offending path only once", () => {
        const summary =
            VALID_SUMMARY + "\n\nBoth src/dup.ts and src/dup.ts appear, plus src/dup.ts again.";
        const result = validateExplanation({ summary, mermaidCode: flowchart(6) }, ctx());
        expect(codes(result)).toEqual(["ungrounded_path_reference"]);
    });

    it("caps individual path errors at 10, summarizes the rest, and still collects other errors", () => {
        const paths = Array.from({ length: 15 }, (_, i) => `src/gone-${i}.ts`);
        const summary = paths.join(" and ");
        expect(summary.trim().length).toBeGreaterThanOrEqual(SUMMARY_MIN_CHARS);
        const result = validateExplanation({ summary, mermaidCode: flowchart(6) }, ctx());

        const grounding = result.errors.filter(e => e.code === "ungrounded_path_reference");
        expect(grounding).toHaveLength(11);
        expect(grounding[10]?.message).toMatch(/and 5 more/);
        // The ten individual errors keep their per-path details.
        expect(grounding.slice(0, 10).every(e => e.detail === "not in repository")).toBe(true);
        // The unsectioned-summary error is collected alongside, not swallowed.
        expect(codes(result)).toContain("summary_unsectioned");
        expect(result.errors).toHaveLength(12);
    });
});

/* ──────────────────────────────────────────────────────────────
 * Everything is collected — no early return
 * ────────────────────────────────────────────────────────────── */

describe("error collection", () => {
    it("reports every failing check of a thoroughly bad draft at once", () => {
        const result = validateExplanation(
            { summary: "See src/nope.ts", mermaidCode: flowchart(2) },
            ctx({ requestedType: "class" })
        );
        expect(result.ok).toBe(false);
        expect([...codes(result)].sort()).toEqual([
            "mermaid_type_mismatch",
            "node_count_out_of_band",
            "summary_missing",
            "summary_unsectioned",
            "ungrounded_path_reference",
        ]);
        expect(result.nodeCount).toBe(2);
    });
});

/* ──────────────────────────────────────────────────────────────
 * Clean pass
 * ────────────────────────────────────────────────────────────── */

describe("clean pass", () => {
    it("accepts a realistic, fully grounded draft", () => {
        const files = new Set([
            "pipelines/src/repo-explainer/gate.ts",
            "pipelines/src/repo-explainer/mermaid-lint.ts",
            "apps/web/server.ts",
        ]);
        const draft = {
            summary:
                VALID_SUMMARY +
                "\n\nThe gate lives in pipelines/src/repo-explainer/gate.ts and the lint in " +
                "pipelines/src/repo-explainer/mermaid-lint.ts, wired from apps/web/server.ts.",
            mermaidCode: [
                "flowchart TD",
                "    ui[Web UI] --> api[API]",
                "    api --> gate[pipelines/src/repo-explainer/gate.ts]",
                "    gate --> lint[Mermaid lint]",
                "    gate --> store[(Postgres)]",
                "    api --> jobs[Background jobs]",
            ].join("\n"),
        };
        const result = validateExplanation(
            draft,
            ctx({ requestedType: "architecture", repoFiles: files, readPaths: files })
        );
        expect(result).toEqual({ ok: true, errors: [], nodeCount: 6 });
    });
});

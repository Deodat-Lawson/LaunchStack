import { describe, expect, it } from "vitest";

import { MERMAID_MAX_CHARS, lintMermaid } from "./mermaid-lint";

/* ──────────────────────────────────────────────────────────────
 * Kind detection
 * ────────────────────────────────────────────────────────────── */

describe("kind detection", () => {
    it('detects "flowchart TD"', () => {
        expect(lintMermaid("flowchart TD\n    a --> b").kind).toBe("flowchart");
    });

    it('detects legacy "graph TD" as flowchart', () => {
        const result = lintMermaid("graph TD\n    a --> b");
        expect(result.kind).toBe("flowchart");
        expect(result.ok).toBe(true);
        expect(result.nodeCount).toBe(2);
    });

    it("detects sequenceDiagram", () => {
        expect(lintMermaid("sequenceDiagram\n    participant A").kind).toBe("sequenceDiagram");
    });

    it("detects classDiagram", () => {
        expect(lintMermaid("classDiagram\n    class A").kind).toBe("classDiagram");
    });

    it("detects erDiagram", () => {
        expect(lintMermaid("erDiagram\n    A ||--o{ B : has").kind).toBe("erDiagram");
    });

    it("flags an unsupported diagram type with unknown-kind", () => {
        const result = lintMermaid('pie title Pets\n    "Dogs" : 386');
        expect(result.kind).toBe("unknown");
        expect(result.ok).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatch(/^unknown-kind:/);
    });

    it("skips %% comment lines when finding the kind line", () => {
        const result = lintMermaid("%% generated\n%% by the explainer\nflowchart TD\n    a --> b");
        expect(result.kind).toBe("flowchart");
        expect(result.ok).toBe(true);
    });
});

/* ──────────────────────────────────────────────────────────────
 * Fenced vs bare input
 * ────────────────────────────────────────────────────────────── */

describe("fence handling", () => {
    const bare = "flowchart TD\n    a --> b";

    it("strips a ```mermaid fence and matches the bare result", () => {
        const fenced = "```mermaid\n" + bare + "\n```";
        expect(lintMermaid(fenced)).toEqual(lintMermaid(bare));
        expect(lintMermaid(fenced).ok).toBe(true);
    });

    it("strips an anonymous ``` fence too", () => {
        const fenced = "```\n" + bare + "\n```";
        expect(lintMermaid(fenced)).toEqual(lintMermaid(bare));
    });

    it("accepts surrounding whitespace around a fenced block", () => {
        const fenced = "\n\n```mermaid\n" + bare + "\n```\n\n";
        expect(lintMermaid(fenced).ok).toBe(true);
    });
});

/* ──────────────────────────────────────────────────────────────
 * Flowchart node counting
 * ────────────────────────────────────────────────────────────── */

describe("flowchart node counting", () => {
    it("counts mixed declaration styles, edge-only ids, and excludes subgraph names", () => {
        const code = [
            "flowchart TD",
            "    subgraph Backend",
            "        a[Web]",
            "        b(Server)",
            "        c{Choice}",
            "        d([Stadium])",
            "        e[[Subroutine]]",
            "        f((Circle))",
            "    end",
            "    a --> b",
            "    b -->|calls| c",
            "    c --- d",
            "    d -.-> e",
            "    e ==> f",
            "    f --> g",
            "    g --> h",
        ].join("\n");
        const result = lintMermaid(code);
        expect(result.kind).toBe("flowchart");
        // a..f declared, g and h edge-only; "Backend" must not count.
        expect(result.nodeCount).toBe(8);
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it("counts unspaced edges", () => {
        const result = lintMermaid("flowchart LR\n    a-->b\n    b---c\n    my-node-->a");
        expect(result.nodeCount).toBe(4);
        expect(result.ok).toBe(true);
    });

    it("does not count a bare id on its own line (outside the emitted subset)", () => {
        const result = lintMermaid("flowchart TD\n    lonely");
        expect(result.nodeCount).toBe(0);
        expect(result.ok).toBe(false);
        expect(result.errors.some(e => e.startsWith("no-nodes:"))).toBe(true);
    });

    it("does not fabricate edges from quoted label text", () => {
        const result = lintMermaid('flowchart TD\n    a["x --> y"] --> b');
        expect(result.nodeCount).toBe(2);
        expect(result.ok).toBe(true);
    });
});

/* ──────────────────────────────────────────────────────────────
 * Sequence diagram node counting
 * ────────────────────────────────────────────────────────────── */

describe("sequence diagram node counting", () => {
    it("counts participants, actors, aliases, and message-only ids", () => {
        const code = [
            "sequenceDiagram",
            "    participant Alice",
            "    actor Bob",
            "    participant Db as Database",
            "    Alice->>Bob: hello",
            "    Bob-->>Alice:",
            "    Alice->Cache: read",
            "    Note over Alice,Bob: greeting",
        ].join("\n");
        const result = lintMermaid(code);
        expect(result.kind).toBe("sequenceDiagram");
        // Alice, Bob, Db, Cache — the Note line adds nothing.
        expect(result.nodeCount).toBe(4);
        expect(result.ok).toBe(true);
    });

    it("counts a diagram made only of message lines", () => {
        const result = lintMermaid("sequenceDiagram\n    A->>B: ping\n    B-->>A: pong");
        expect(result.nodeCount).toBe(2);
        expect(result.ok).toBe(true);
    });

    it("reports no-nodes when only control-flow keywords appear", () => {
        const result = lintMermaid("sequenceDiagram\n    loop retry\n    end");
        expect(result.nodeCount).toBe(0);
        expect(result.ok).toBe(false);
        expect(result.errors.some(e => e.startsWith("no-nodes:"))).toBe(true);
    });
});

/* ──────────────────────────────────────────────────────────────
 * Class diagram node counting
 * ────────────────────────────────────────────────────────────── */

describe("class diagram node counting", () => {
    it("counts declarations and every relation flavor of the subset", () => {
        const code = [
            "classDiagram",
            "    class Animal",
            "    class Dog {",
            "        +bark() void",
            "    }",
            "    Animal <|-- Dog",
            "    Animal --> Food",
            "    Dog *-- Tail",
            "    Dog o-- Collar",
        ].join("\n");
        const result = lintMermaid(code);
        expect(result.kind).toBe("classDiagram");
        // Animal, Dog, Food, Tail, Collar.
        expect(result.nodeCount).toBe(5);
        expect(result.ok).toBe(true);
    });
});

/* ──────────────────────────────────────────────────────────────
 * ER diagram node counting
 * ────────────────────────────────────────────────────────────── */

describe("er diagram node counting", () => {
    it("counts entities from relations and standalone blocks, not attributes", () => {
        const code = [
            "erDiagram",
            "    CUSTOMER ||--o{ ORDER : places",
            "    ORDER ||--|{ LINE-ITEM : contains",
            "    CUSTOMER {",
            "        string name",
            "        string email",
            "    }",
            "    DELIVERY-ADDRESS {",
            "        string street",
            "    }",
        ].join("\n");
        const result = lintMermaid(code);
        expect(result.kind).toBe("erDiagram");
        // CUSTOMER, ORDER, LINE-ITEM, DELIVERY-ADDRESS.
        expect(result.nodeCount).toBe(4);
        expect(result.ok).toBe(true);
    });

    it("does not mistake cardinality braces for unbalanced brackets", () => {
        const result = lintMermaid("erDiagram\n    A ||--o{ B : has\n    B }|..|| C : held");
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it("still flags a genuinely unclosed entity block", () => {
        const result = lintMermaid("erDiagram\n    A ||--o{ B : has\n    A {\n        string id");
        expect(result.ok).toBe(false);
        expect(result.errors.some(e => e.startsWith("unbalanced:"))).toBe(true);
    });
});

/* ──────────────────────────────────────────────────────────────
 * Structural sanity
 * ────────────────────────────────────────────────────────────── */

describe("structural sanity", () => {
    it("rejects empty input", () => {
        const result = lintMermaid("");
        expect(result).toEqual({
            ok: false,
            kind: "unknown",
            nodeCount: 0,
            errors: ["empty: no diagram source provided"],
        });
    });

    it("rejects whitespace-only input", () => {
        const result = lintMermaid("   \n\t  \n");
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toMatch(/^empty:/);
    });

    it("rejects comment-only input", () => {
        const result = lintMermaid("%% nothing here\n%% at all");
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toMatch(/^empty:/);
    });

    it("reports no-nodes for a kind line with an empty body", () => {
        const result = lintMermaid("flowchart TD");
        expect(result.kind).toBe("flowchart");
        expect(result.nodeCount).toBe(0);
        expect(result.ok).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatch(/^no-nodes:/);
    });

    it("detects an unclosed bracket", () => {
        const result = lintMermaid("flowchart TD\n    a[Broken --> b");
        expect(result.ok).toBe(false);
        expect(result.errors.some(e => e.startsWith("unbalanced:"))).toBe(true);
    });

    it("detects a closer arriving before its opener", () => {
        const result = lintMermaid("flowchart TD\n    a] --> b");
        expect(result.ok).toBe(false);
        expect(result.errors.some(e => e.startsWith("unbalanced:"))).toBe(true);
    });

    it("ignores brackets inside quoted strings", () => {
        const result = lintMermaid('flowchart TD\n    A["hi [there]"] --> B');
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.nodeCount).toBe(2);
    });

    it("flags an unterminated quote as unbalanced", () => {
        const result = lintMermaid('flowchart TD\n    A["oops] --> B');
        expect(result.ok).toBe(false);
        expect(result.errors.some(e => e.startsWith("unbalanced:"))).toBe(true);
    });

    it("rejects input over the size cap without doing further work", () => {
        const huge = "flowchart TD\n" + "x".repeat(MERMAID_MAX_CHARS);
        const result = lintMermaid(huge);
        expect(result).toEqual({
            ok: false,
            kind: "unknown",
            nodeCount: 0,
            errors: [`too-large: input is ${huge.length} characters (limit ${MERMAID_MAX_CHARS})`],
        });
    });
});

/* ──────────────────────────────────────────────────────────────
 * Determinism
 * ────────────────────────────────────────────────────────────── */

describe("determinism", () => {
    it("returns deep-equal results for the same input", () => {
        const fixtures = [
            "flowchart TD\n    a --> b\n    b --> c",
            "sequenceDiagram\n    A->>B: hi",
            "classDiagram\n    A <|-- B",
            "erDiagram\n    A ||--o{ B : has",
            "pie nope",
            "",
        ];
        for (const fixture of fixtures) {
            expect(lintMermaid(fixture)).toEqual(lintMermaid(fixture));
        }
    });
});

/**
 * mermaid-lint — a bounded, dependency-free validator for the Mermaid SUBSET
 * the repo explainer emits.
 *
 * This is deliberately NOT a full Mermaid parser. It answers exactly three
 * questions about a draft diagram, deterministically and without any LLM,
 * network, or dependency:
 *
 *   1. What diagram type does the first meaningful line declare?
 *   2. How many distinct nodes / participants / classes / entities appear?
 *   3. Is the source structurally sane (non-empty, brackets balanced)?
 *
 * Anything Mermaid supports beyond the emitted subset (styling, interaction,
 * exotic arrow heads, multi-line labels, escaped quotes) is out of scope: an
 * unrecognized line simply contributes no nodes. The gate that consumes this
 * result treats "zero nodes" as a failure, so leniency here cannot let an
 * empty diagram through.
 */

export type MermaidKind =
    | "flowchart"
    | "sequenceDiagram"
    | "classDiagram"
    | "erDiagram"
    | "unknown";

export interface MermaidLintResult {
    ok: boolean;
    kind: MermaidKind;
    nodeCount: number;
    /** Human-readable, each prefixed with a stable code ("empty:", "unknown-kind:", "unbalanced:", "no-nodes:", "too-large:"). */
    errors: string[];
}

/** Inputs longer than this are rejected outright — the gate never needs a
 * diagram that large and refusing early keeps the lint O(bounded). */
export const MERMAID_MAX_CHARS = 50_000;

/**
 * Node / participant / entity / class identifier for this subset. The charset
 * is `[A-Za-z0-9_.-]`, but hyphens are interior-only so that an unspaced edge
 * (`Bob-->>Alice:`) never bleeds its leading dashes into the id.
 */
const ID = "[A-Za-z0-9_.]+(?:-[A-Za-z0-9_.]+)*";

/* ──────────────────────────────────────────────────────────────
 * Preprocessing
 * ────────────────────────────────────────────────────────────── */

/** Strips a wrapping ```mermaid (or bare ```) fence; bare input passes through. */
function stripFence(text: string): string {
    if (!text.startsWith("```")) return text;
    const lines = text.split("\n");
    const first = (lines[0] ?? "").trim();
    const last = (lines[lines.length - 1] ?? "").trim();
    if (lines.length >= 2 && /^```(?:mermaid)?$/i.test(first) && last === "```") {
        return lines.slice(1, -1).join("\n").trim();
    }
    return text;
}

function detectKind(kindLine: string): MermaidKind {
    const word = kindLine.split(/\s+/, 1)[0] ?? "";
    if (word === "flowchart" || word === "graph") return "flowchart";
    if (word === "sequenceDiagram") return "sequenceDiagram";
    if (word === "classDiagram") return "classDiagram";
    if (word === "erDiagram") return "erDiagram";
    return "unknown";
}

const isMeaningful = (line: string): boolean => line !== "" && !line.startsWith("%%");

/* ──────────────────────────────────────────────────────────────
 * Structural sanity — bracket balance outside quoted strings
 * ────────────────────────────────────────────────────────────── */

/** Returns a human-readable problem, or null when (), [], {} all balance.
 * Characters inside double-quoted strings are ignored, so `A["hi [there]"]`
 * is balanced. Escapes are not part of the subset. */
function findImbalance(text: string): string | null {
    let round = 0;
    let square = 0;
    let curly = 0;
    let inQuote = false;
    for (const ch of text) {
        if (ch === '"') {
            inQuote = !inQuote;
            continue;
        }
        if (inQuote) continue;
        if (ch === "(") round++;
        else if (ch === ")") round--;
        else if (ch === "[") square++;
        else if (ch === "]") square--;
        else if (ch === "{") curly++;
        else if (ch === "}") curly--;
        if (round < 0 || square < 0 || curly < 0) {
            return "closing bracket appears before its opener";
        }
    }
    if (inQuote) return "unterminated double-quoted string";
    const open: string[] = [];
    if (round > 0) open.push(`${round} unclosed "("`);
    if (square > 0) open.push(`${square} unclosed "["`);
    if (curly > 0) open.push(`${curly} unclosed "{"`);
    return open.length > 0 ? open.join(", ") : null;
}

/* ──────────────────────────────────────────────────────────────
 * Node counting per kind
 * ────────────────────────────────────────────────────────────── */

/** Flowchart edges of the subset: -->, ---, -.->, ==> with optional |label|. */
const FLOW_EDGE_TEST = /-\.->|-->|==>|---/;
const FLOW_EDGE_SPLIT = /(?:-\.->|-->|==>|---)(?:\|[^|]*\|)?/;
const FLOW_SKIP =
    /^(?:subgraph\b|end\b|direction\b|classDef\b|class\b|style\b|linkStyle\b|click\b)/;
const LEADING_ID = new RegExp(`^(${ID})`);

/**
 * Unique ids appearing in bracket declarations (`id[Label]`, `id(Label)`,
 * `id{Label}`, `id([Label])`, `id[[Label]]`, `id((Label))`) or on either
 * side of an edge. `subgraph` names never count.
 */
function countFlowchartNodes(bodyLines: readonly string[]): number {
    const ids = new Set<string>();
    for (const raw of bodyLines) {
        const line = raw.trim();
        if (!isMeaningful(line) || FLOW_SKIP.test(line)) continue;
        // Mask quoted label text so `A["a --> b"]` does not fabricate an edge.
        const masked = line.replace(/"[^"]*"/g, '""');
        const hasEdge = FLOW_EDGE_TEST.test(masked);
        for (const segment of masked.split(FLOW_EDGE_SPLIT)) {
            const term = segment.trim();
            const match = LEADING_ID.exec(term);
            if (!match) continue;
            const id = match[1] ?? "";
            // Guard against stray punctuation runs ("-", "..") matching the id charset.
            if (!/[A-Za-z0-9_]/.test(id)) continue;
            const rest = term.slice(id.length).trimStart();
            const isDeclaration = /^[[({]/.test(rest);
            if (hasEdge || isDeclaration) ids.add(id);
        }
    }
    return ids.size;
}

const SEQ_PARTICIPANT = new RegExp(`^(?:participant|actor)\\s+(${ID})`);
const SEQ_MESSAGE = new RegExp(`^(${ID})\\s*-{1,2}>{1,2}\\s*(${ID})\\s*:`);

/** Unique `participant`/`actor` declarations plus ids on message lines. */
function countSequenceNodes(bodyLines: readonly string[]): number {
    const ids = new Set<string>();
    for (const raw of bodyLines) {
        const line = raw.trim();
        if (!isMeaningful(line)) continue;
        const declared = SEQ_PARTICIPANT.exec(line);
        if (declared) {
            ids.add(declared[1] ?? "");
            continue;
        }
        const message = SEQ_MESSAGE.exec(line);
        if (message) {
            ids.add(message[1] ?? "");
            ids.add(message[2] ?? "");
        }
    }
    ids.delete("");
    return ids.size;
}

const CLASS_DECL = new RegExp(`^class\\s+(${ID})`);
const CLASS_RELATION = new RegExp(`^(${ID})\\s*(?:<\\|--|\\*--|o--|-->)\\s*(${ID})`);

/** Unique `class Name` declarations plus names on relation lines. */
function countClassNodes(bodyLines: readonly string[]): number {
    const ids = new Set<string>();
    for (const raw of bodyLines) {
        const line = raw.trim();
        if (!isMeaningful(line)) continue;
        const declared = CLASS_DECL.exec(line);
        if (declared) {
            ids.add(declared[1] ?? "");
            continue;
        }
        const relation = CLASS_RELATION.exec(line);
        if (relation) {
            ids.add(relation[1] ?? "");
            ids.add(relation[2] ?? "");
        }
    }
    ids.delete("");
    return ids.size;
}

const ER_RELATION = new RegExp(`^(${ID})\\s*[|}o]{1,2}(?:--|\\.\\.)[|{o]{1,2}\\s*(${ID})`);
const ER_BLOCK = new RegExp(`^(${ID})\\s*\\{`);

/** Unique entity names in relations (`A ||--o{ B : label`) and blocks (`A {`). */
function countErNodes(bodyLines: readonly string[]): number {
    const ids = new Set<string>();
    for (const raw of bodyLines) {
        const line = raw.trim();
        if (!isMeaningful(line)) continue;
        const relation = ER_RELATION.exec(line);
        if (relation) {
            ids.add(relation[1] ?? "");
            ids.add(relation[2] ?? "");
            continue;
        }
        const block = ER_BLOCK.exec(line);
        if (block) ids.add(block[1] ?? "");
    }
    ids.delete("");
    return ids.size;
}

/* ──────────────────────────────────────────────────────────────
 * Entry point
 * ────────────────────────────────────────────────────────────── */

export function lintMermaid(code: string): MermaidLintResult {
    if (code.length > MERMAID_MAX_CHARS) {
        return {
            ok: false,
            kind: "unknown",
            nodeCount: 0,
            errors: [`too-large: input is ${code.length} characters (limit ${MERMAID_MAX_CHARS})`],
        };
    }

    const text = stripFence(code.trim());
    if (text === "") {
        return {
            ok: false,
            kind: "unknown",
            nodeCount: 0,
            errors: ["empty: no diagram source provided"],
        };
    }

    const lines = text.split("\n");
    const kindIndex = lines.findIndex(line => isMeaningful(line.trim()));
    if (kindIndex === -1) {
        return {
            ok: false,
            kind: "unknown",
            nodeCount: 0,
            errors: ["empty: only comments and blank lines"],
        };
    }

    const errors: string[] = [];
    const kindLine = (lines[kindIndex] ?? "").trim();
    const kind = detectKind(kindLine);
    if (kind === "unknown") {
        errors.push(
            `unknown-kind: "${kindLine.slice(0, 60)}" does not declare a supported diagram type ` +
                "(flowchart, graph, sequenceDiagram, classDiagram, erDiagram)"
        );
    }

    // ER cardinality markers (`||--o{`, `}o..o|`) reuse brace characters that
    // are not brackets; mask them so only real entity-block braces are counted.
    const balanceText =
        kind === "erDiagram" ? text.replace(/[|}o]{1,2}(?:--|\.\.)[|{o]{1,2}/g, "--") : text;
    const imbalance = findImbalance(balanceText);
    if (imbalance !== null) {
        errors.push(`unbalanced: ${imbalance}`);
    }

    const body = lines.slice(kindIndex + 1);
    let nodeCount = 0;
    switch (kind) {
        case "flowchart":
            nodeCount = countFlowchartNodes(body);
            break;
        case "sequenceDiagram":
            nodeCount = countSequenceNodes(body);
            break;
        case "classDiagram":
            nodeCount = countClassNodes(body);
            break;
        case "erDiagram":
            nodeCount = countErNodes(body);
            break;
        case "unknown":
            break;
    }

    if (kind !== "unknown" && nodeCount === 0) {
        errors.push("no-nodes: the diagram declares a type but contains no countable nodes");
    }

    return { ok: errors.length === 0 && nodeCount > 0, kind, nodeCount, errors };
}

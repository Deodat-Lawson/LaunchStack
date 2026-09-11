/**
 * gate — the deterministic acceptance gate for an LLM-generated repo
 * explanation (summary + Mermaid diagram).
 *
 * Every check here is pure string/set work: no LLM, no network, no clock.
 * The gate runs on every draft, and its errors are collected exhaustively
 * (never early-returned) because they feed the repair prompt — the model gets
 * one shot at fixing *everything* it got wrong, so it must see everything.
 *
 * Checks:
 *   - the summary is substantial (≥ 200 chars) and sectioned (≥ 2 headings);
 *   - the Mermaid code lints (see ./mermaid-lint) and matches the requested
 *     diagram type;
 *   - the node count sits inside a per-type band (too few nodes is a useless
 *     diagram, too many is an unreadable one);
 *   - every file path the draft mentions is grounded: it exists at this
 *     commit AND its content actually entered the model's context.
 */

import type { WorkspaceDiagramType } from "@launchstack/pipelines/repo-workspace";

import { lintMermaid, type MermaidKind } from "./mermaid-lint";

export type GateErrorCode =
    | "summary_missing"
    | "summary_unsectioned"
    | "mermaid_invalid"
    | "mermaid_type_mismatch"
    | "node_count_out_of_band"
    | "ungrounded_path_reference";

export interface GateError {
    code: GateErrorCode;
    message: string;
    detail?: string;
}

export interface GateContext {
    requestedType: WorkspaceDiagramType;
    /** Repo-relative paths of every file that exists at this commit. */
    repoFiles: ReadonlySet<string>;
    /** Paths whose content actually entered the model's context. */
    readPaths: ReadonlySet<string>;
    /** Node-count band; falls back to DEFAULT_NODE_BANDS[requestedType]. */
    nodeBand?: { min: number; max: number };
}

export interface ExplanationDraft {
    summary: string;
    mermaidCode: string;
}

export interface GateResult {
    ok: boolean;
    errors: GateError[];
    nodeCount: number;
}

/** The Mermaid kind each requested diagram type must declare. */
const EXPECTED_KIND: Record<WorkspaceDiagramType, Exclude<MermaidKind, "unknown">> = {
    architecture: "flowchart",
    component: "flowchart",
    sequence: "sequenceDiagram",
    class: "classDiagram",
    er: "erDiagram",
};

export const DEFAULT_NODE_BANDS: Record<WorkspaceDiagramType, { min: number; max: number }> = {
    architecture: { min: 5, max: 15 },
    component: { min: 5, max: 15 },
    sequence: { min: 3, max: 12 },
    class: { min: 3, max: 15 },
    er: { min: 3, max: 15 },
};

/** A summary shorter than this (trimmed) is not an explanation. */
export const SUMMARY_MIN_CHARS = 200;

/** Individual ungrounded-path errors reported before collapsing the rest. */
const MAX_PATH_ERRORS = 10;

/** Slash-containing, extension-bearing path tokens ("src/a/b.ts"); bare
 * names like "package.json" or "Node.js" carry no slash and never match. */
const PATH_TOKEN_SOURCE = String.raw`(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,10}`;

export function validateExplanation(draft: ExplanationDraft, ctx: GateContext): GateResult {
    const errors: GateError[] = [];

    // ── Summary ────────────────────────────────────────────────
    const summary = draft.summary.trim();
    if (summary.length < SUMMARY_MIN_CHARS) {
        errors.push({
            code: "summary_missing",
            message: `summary is ${summary.length} characters after trimming; at least ${SUMMARY_MIN_CHARS} required`,
        });
    }
    const headingCount = summary.match(/^#{2,4}\s+\S/gm)?.length ?? 0;
    if (headingCount < 2) {
        errors.push({
            code: "summary_unsectioned",
            message: `summary has ${headingCount} markdown heading(s) (## through ####); at least 2 required`,
        });
    }

    // ── Mermaid ────────────────────────────────────────────────
    const lint = lintMermaid(draft.mermaidCode);
    if (lint.errors.length > 0) {
        errors.push({
            code: "mermaid_invalid",
            message: "mermaid diagram failed lint",
            detail: lint.errors.join("; "),
        });
    }
    const expectedKind = EXPECTED_KIND[ctx.requestedType];
    // An "unknown" kind is already reported as mermaid_invalid — reporting a
    // mismatch on top of it would double-count the same defect.
    if (lint.kind !== "unknown" && lint.kind !== expectedKind) {
        errors.push({
            code: "mermaid_type_mismatch",
            message:
                `requested type "${ctx.requestedType}" expects a ${expectedKind} diagram, ` +
                `got ${lint.kind}`,
        });
    }
    // The band is only meaningful over a diagram that lints clean; a broken
    // diagram already fails and its node count is not trustworthy.
    if (lint.ok) {
        const band = ctx.nodeBand ?? DEFAULT_NODE_BANDS[ctx.requestedType];
        if (lint.nodeCount < band.min || lint.nodeCount > band.max) {
            errors.push({
                code: "node_count_out_of_band",
                message: `diagram has ${lint.nodeCount} node(s); expected between ${band.min} and ${band.max}`,
            });
        }
    }

    // ── Grounding ──────────────────────────────────────────────
    const pathToken = new RegExp(PATH_TOKEN_SOURCE, "g");
    const seen = new Set<string>();
    const ungrounded: GateError[] = [];
    const combined = `${draft.summary}\n${draft.mermaidCode}`;
    for (const match of combined.matchAll(pathToken)) {
        const token = match[0];
        if (seen.has(token)) continue;
        seen.add(token);
        if (!ctx.repoFiles.has(token)) {
            ungrounded.push({
                code: "ungrounded_path_reference",
                message: `path "${token}" does not exist at this commit`,
                detail: "not in repository",
            });
        } else if (!ctx.readPaths.has(token)) {
            ungrounded.push({
                code: "ungrounded_path_reference",
                message: `path "${token}" exists but its content never entered the model's context`,
                detail: "referenced but never read",
            });
        }
    }
    if (ungrounded.length > MAX_PATH_ERRORS) {
        errors.push(...ungrounded.slice(0, MAX_PATH_ERRORS));
        errors.push({
            code: "ungrounded_path_reference",
            message: `…and ${ungrounded.length - MAX_PATH_ERRORS} more ungrounded path reference(s)`,
        });
    } else {
        errors.push(...ungrounded);
    }

    return { ok: errors.length === 0, errors, nodeCount: lint.nodeCount };
}

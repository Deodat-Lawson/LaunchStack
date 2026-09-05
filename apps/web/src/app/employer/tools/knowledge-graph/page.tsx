"use client";

/**
 * /employer/tools/knowledge-graph — the parked entity-graph view (ADR-010).
 *
 * Deliberately linked from no navigation: it shows what stage-F entity
 * extraction produced, which is an index-health question, not a product
 * surface. Chat answers entity questions from the company-facts leg instead.
 */

import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";
import { GraphView } from "./GraphView";

export default function KnowledgeGraphPage() {
    return (
        <ToolsStudioShell>
            <header
                style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 12,
                    padding: "14px 18px",
                    borderBottom: "1px solid var(--line)",
                    background: "var(--panel)",
                    flexShrink: 0,
                }}
            >
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                    Knowledge graph
                </span>
                <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                    Index health — entities extracted at upload, joined by co-occurrence. Chat
                    answers entity questions from company facts, not from this graph.
                </span>
            </header>
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                <GraphView />
            </div>
        </ToolsStudioShell>
    );
}

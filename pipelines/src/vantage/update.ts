/**
 * The weekly update — the same evidence, reused. Markdown a founder pastes
 * into a program update, an investor note or an application, built only
 * from what they chose to share. Pure, so the sharing rule is testable.
 */

import type { AgendaDto, CommitmentDto, TopicDto, VantageFact } from "./types";
import { formatNumber, periodLabel } from "./signals";
import { weekLabel } from "./week";

export interface WeeklyUpdateInput {
    agenda: AgendaDto;
    commitments: CommitmentDto[];
    /** Include private topics as well — for the founder's own copy. */
    includePrivate?: boolean;
    /**
     * Pack refs (`ev:<id>`) of evidence the founder kept private. In the
     * shared update a fact that cites one is withheld rather than quoted:
     * sharing a topic is not the same as sharing every note behind it.
     */
    privateRefs?: ReadonlySet<string>;
}

const WITHHELD = "- _(a fact from a private note is withheld)_";

function citesPrivate(refs: { ref: string }[], privateRefs?: ReadonlySet<string>): boolean {
    return Boolean(privateRefs && refs.some(r => privateRefs.has(r.ref)));
}

function factLine(fact: VantageFact, withhold: boolean): string {
    if (withhold) return WITHHELD;
    const cites = fact.refs.map(r => r.label + (r.date ? ` (${r.date})` : "")).join("; ");
    const mark = fact.unsupported ? " _(unverified — no source)_" : "";
    return `- ${fact.text}${cites ? ` — _${cites}_` : ""}${mark}`;
}

function topicBlock(topic: TopicDto, redact: ReadonlySet<string> | undefined): string {
    const lines: string[] = [`### ${topic.title}`];
    if (topic.facts.length > 0) {
        lines.push(
            "",
            "**What happened**",
            ...topic.facts.map(f => factLine(f, citesPrivate(f.refs, redact)))
        );
    }
    if (topic.whyItMatters) lines.push("", `**Why it matters:** ${topic.whyItMatters}`);
    if (topic.conflicts.length > 0) {
        lines.push(
            "",
            "**Conflicting evidence**",
            ...topic.conflicts.map(c => (citesPrivate(c.refs, redact) ? WITHHELD : `- ${c.text}`))
        );
    }
    if (topic.unknowns.length > 0) {
        lines.push("", "**Unknown**", ...topic.unknowns.map(u => `- ${u}`));
    }
    if (topic.decision) {
        lines.push("", `**Decision:** ${topic.decision}`);
    } else if (topic.decisionQuestion) {
        lines.push("", `**Open decision:** ${topic.decisionQuestion}`);
    }
    if (topic.helpRequested) lines.push("", `**Help requested:** ${topic.helpRequested}`);
    return lines.join("\n");
}

export function renderWeeklyUpdate(input: WeeklyUpdateInput): string {
    const { agenda } = input;
    const visible = agenda.topics
        .filter(t => t.status !== "dismissed")
        .filter(t => (input.includePrivate ?? false) || t.shared)
        .sort((a, b) => a.position - b.position);

    const lines: string[] = [`# ${weekLabel(agenda.weekStart)} — update`, ""];

    const signals = agenda.signals;
    if (signals && signals.metricChanges.length > 0) {
        lines.push("## Numbers", "");
        for (const c of signals.metricChanges) {
            const change =
                c.previous === null
                    ? "first number"
                    : c.pct !== null
                      ? `${c.pct > 0 ? "+" : ""}${Math.round(c.pct * 100)}% vs ${formatNumber(c.previous.value, c.unit)}`
                      : `${c.delta! > 0 ? "+" : ""}${formatNumber(c.delta!, c.unit)} vs previous`;
            lines.push(
                `- **${c.name}**: ${formatNumber(c.latest.value, c.unit)} (${periodLabel(c.latest.periodStart, c.latest.periodEnd)}) — ${change}. _${c.definition}_`
            );
        }
        lines.push("");
    }

    // The founder's own copy quotes everything; the shared one withholds
    // facts that rest on private notes.
    const redact = input.includePrivate ? undefined : input.privateRefs;
    if (visible.length > 0) {
        lines.push("## Topics", "");
        for (const t of visible) lines.push(topicBlock(t, redact), "");
    } else {
        lines.push("_No topics shared this week._", "");
    }

    const open = input.commitments.filter(
        c => c.status === "open" && ((input.includePrivate ?? false) || c.shared)
    );
    const resolved = input.commitments.filter(
        c => c.status !== "open" && ((input.includePrivate ?? false) || c.shared)
    );
    if (open.length > 0 || resolved.length > 0) {
        lines.push("## Commitments", "");
        for (const c of open) lines.push(`- [ ] ${c.title} — ${c.owner}, due ${c.dueOn}`);
        for (const c of resolved)
            lines.push(
                `- [${c.status === "done" ? "x" : " "}] ${c.title} — ${c.owner}, ${c.status}${c.outcome ? `: ${c.outcome}` : ""}`
            );
        lines.push("");
    }

    const help = visible.filter(t => t.helpRequested);
    if (help.length > 0) {
        lines.push("## Where help would unblock us", "");
        for (const t of help) lines.push(`- ${t.helpRequested} _(${t.title})_`);
        lines.push("");
    }

    lines.push(
        "---",
        "_Every number above carries its period, source and definition. Facts marked unverified have no source on file._"
    );
    return (
        lines
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim() + "\n"
    );
}

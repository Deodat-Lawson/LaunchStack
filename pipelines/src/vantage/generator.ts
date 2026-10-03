/**
 * The agenda generator: an evidence pack in, three to five topics out, every
 * factual sentence cited by pack id. Provider-neutral — the caller resolves
 * the model (the web app installs its deployment's config first) and hands
 * it over, so this module reads no environment.
 *
 * What the model is held to, and how:
 * - Facts cite pack ids; `validateFacts` drops anything the pack cannot
 *   confirm and marks the sentence unsupported rather than deleting it.
 * - Observed fact, interpretation and suggestion are separate fields, so
 *   the screen can label them and the founder can reject the last two.
 * - "Unknown" is a field, not a guess.
 * - A topic must carry a decision and a next step, or it is not a topic.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeStructuredWithUsage, type ResolvedChatModel } from "@launchstack/llm";
import { z } from "zod";

import { orNull } from "./db";
import { validateFacts, validateRefs } from "./signals";
import type { AgendaDraft, DraftTopic, EvidencePack } from "./types";
import { addDays, isIsoDate, weekEndOf } from "./week";

export const VANTAGE_PROMPT_VERSION = "vantage-agenda/v1";

const FactSchema = z.object({
    text: z.string().min(1).max(600),
    refs: z.array(z.string()).max(8),
});

const TopicSchema = z.object({
    title: z.string().min(1).max(200),
    facts: z.array(FactSchema).min(1).max(6),
    whyItMatters: z.string().min(1).max(800),
    decisionQuestion: z.string().min(1).max(500),
    proposedNextStep: z.string().min(1).max(600),
    proposedOwner: z.string().max(120).nullable(),
    proposedDueInDays: z.number().int().min(1).max(28).nullable(),
    helpRequested: z.string().max(500).nullable(),
    unknowns: z.array(z.string().max(300)).max(6),
    conflicts: z.array(FactSchema).max(4),
    rationale: z.string().min(1).max(600),
});

export const AgendaDraftSchema = z.object({
    summary: z.string().min(1).max(1200),
    topics: z.array(TopicSchema).min(1).max(5),
});

export type AgendaDraftOutput = z.infer<typeof AgendaDraftSchema>;

export const SYSTEM_PROMPT = `You prepare the agenda for a founder's weekly team or mentor meeting. You are an analyst, not a cheerleader.

You will receive an evidence pack: every item has an id (like ev:…, obs:…, cm:…), a label, a date and text. You will also receive the week's computed signals: metric changes, conflicting numbers, overdue commitments.

Produce three to five discussion topics. Each topic must have:
1. facts — what happened. Each fact is ONE observed sentence and the ids it comes from. Cite only ids from the pack. Never state a number, quote or event that is not in the pack. If nothing in the pack supports a sentence, do not write it.
2. whyItMatters — why it merits discussion: a change, a contradiction, a missed target, or an important unknown. This is your interpretation; say so plainly if the data is thin.
3. decisionQuestion — the choice the meeting should make, phrased as a question with real alternatives ("Improve onboarding, or spend next week on another acquisition channel?").
4. proposedNextStep — one experiment or action that would resolve the uncertainty; name an owner if the pack names one, else null; a due date in days from now (7 by default).
5. helpRequested — what a mentor or program administrator could unblock, or null.
6. unknowns — what the data does not say. Write "unknown" honestly instead of guessing.
7. conflicts — where two sources disagree (a deck says 1,200 users; analytics says 900 signups). Say whether the terms may mean different things.
8. rationale — why you put this topic forward, in one or two sentences, so the founder can reject it.

Rules:
- Do not invent trends from tiny samples: two interviews are two interviews.
- Interview enthusiasm is not proof of willingness to pay. Say so if a topic leans on it.
- Private notes (marked "(private note)") may inform a topic but must not be quoted in facts.
- Prefer fewer, sharper topics over five vague ones. Never pad.
- The summary is one short paragraph: what changed since the last meeting, in plain words, with no claims that are not in the pack.
- Return JSON matching the schema exactly.`;

function formatPack(pack: EvidencePack): string {
    const { signals } = pack;
    const lines: string[] = [];
    lines.push(`Agenda week: ${pack.weekStart} to ${weekEndOf(pack.weekStart)}.`);
    lines.push(`Evidence window: from ${signals.since}.`);
    lines.push("");
    lines.push("## Signals");
    if (signals.metricChanges.length === 0) lines.push("- No metric observations.");
    for (const c of signals.metricChanges) {
        const change =
            c.previous === null
                ? "no prior period"
                : c.pct !== null
                  ? `${c.pct > 0 ? "+" : ""}${Math.round(c.pct * 100)}% vs ${c.previous.value}`
                  : `${c.delta! > 0 ? "+" : ""}${c.delta} vs ${c.previous.value}`;
        lines.push(
            `- ${c.name} (${c.key}): ${c.latest.value} for ${c.latest.periodStart}..${c.latest.periodEnd}; ${change}${c.notable ? " [notable]" : ""}. Cite obs:${c.latest.observationId}${c.previous ? ` and obs:${c.previous.observationId}` : ""}.`
        );
    }
    for (const x of signals.metricConflicts) {
        lines.push(
            `- CONFLICT ${x.name}: ${x.a.value} (${x.a.source ?? "no source"}, ${x.a.periodStart}..${x.a.periodEnd}) vs ${x.b.value} (${x.b.source ?? "no source"}, ${x.b.periodStart}..${x.b.periodEnd}). Cite obs:${x.a.observationId} and obs:${x.b.observationId}.`
        );
    }
    if (signals.metricsWithoutData.length > 0)
        lines.push(
            `- No numbers recorded for: ${signals.metricsWithoutData.map(m => m.name).join(", ")}.`
        );
    if (signals.overdueCommitmentIds.length > 0)
        lines.push(
            `- Overdue commitments: ${signals.overdueCommitmentIds.map(id => `cm:${id}`).join(", ")}.`
        );
    if (signals.dueThisWeekCommitmentIds.length > 0)
        lines.push(
            `- Due this week: ${signals.dueThisWeekCommitmentIds.map(id => `cm:${id}`).join(", ")}.`
        );
    if (signals.resolvedCommitmentIds.length > 0)
        lines.push(
            `- Resolved recently: ${signals.resolvedCommitmentIds.map(id => `cm:${id}`).join(", ")}.`
        );
    lines.push("");
    lines.push("## Evidence pack");
    if (pack.items.length === 0) lines.push("(empty)");
    for (const item of pack.items) {
        lines.push(`[${item.ref}] ${item.label}${item.date ? ` — ${item.date}` : ""}`);
        lines.push(item.text.replace(/\n/g, "\n    "));
        lines.push("");
    }
    return lines.join("\n");
}

export interface GenerateAgendaArgs {
    pack: EvidencePack;
    model: ResolvedChatModel;
    /** Today, for turning "due in N days" into a date. */
    today: string;
}

/**
 * Turn the model's output into stored topics: citations checked against
 * the pack, due-in-days resolved to a date, empty strings normalised.
 */
export function normaliseDraft(
    output: AgendaDraftOutput,
    pack: EvidencePack,
    today: string
): DraftTopic[] {
    return output.topics.map(t => ({
        title: t.title.trim(),
        facts: validateFacts(pack, t.facts),
        whyItMatters: t.whyItMatters.trim(),
        decisionQuestion: t.decisionQuestion.trim(),
        proposedNextStep: t.proposedNextStep.trim(),
        proposedOwner: orNull(t.proposedOwner),
        proposedDue:
            t.proposedDueInDays && isIsoDate(today) ? addDays(today, t.proposedDueInDays) : null,
        helpRequested: orNull(t.helpRequested),
        unknowns: t.unknowns.map(u => u.trim()).filter(Boolean),
        conflicts: t.conflicts
            .map(c => ({ text: c.text.trim(), refs: validateRefs(pack, c.refs) }))
            .filter(c => c.text.length > 0),
        rationale: t.rationale.trim(),
    }));
}

export async function generateAgendaDraft(args: GenerateAgendaArgs): Promise<AgendaDraft> {
    const messages = [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(formatPack(args.pack))];
    const { result, usage, modelId } = await invokeStructuredWithUsage(
        args.model,
        AgendaDraftSchema,
        messages,
        { name: "vantage_agenda" }
    );
    const topics = normaliseDraft(result, args.pack, args.today);
    return {
        summary: result.summary.trim(),
        topics,
        origin: "ai",
        modelMetadata: {
            mode: "ai",
            modelId: modelId ?? args.model.modelId,
            route: args.model.route,
            promptVersion: VANTAGE_PROMPT_VERSION,
            usage: usage ?? null,
            unsupportedFacts: topics.reduce(
                (n, t) => n + t.facts.filter(f => f.unsupported).length,
                0
            ),
        },
    };
}

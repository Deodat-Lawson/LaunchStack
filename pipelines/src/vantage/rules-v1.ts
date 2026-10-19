import type { EnhancementCandidate, GenerationInput } from "./contract-v1";
import type { AgendaDraft, DraftTopic, EvidencePack, VantageEvidenceRef } from "./types";
import { dayAdd, localDate } from "./evidence-v1";

export function canonicalRefs(input: GenerationInput): Map<string, VantageEvidenceRef> {
    const refs = new Map<string, VantageEvidenceRef>();
    for (const e of input.data.currentEvidence)
        refs.set(`ev:${e.id}`, {
            ref: `ev:${e.id}`,
            label: e.source ?? e.title,
            date: e.observedAt,
        });
    for (const o of [...input.data.currentObservations, ...input.data.comparisonObservations])
        refs.set(`obs:${o.id}`, {
            ref: `obs:${o.id}`,
            label: o.source ?? o.metricName,
            date: o.periodEnd,
        });
    for (const c of [...input.data.carryForwardCommitments, ...input.data.resolvedCommitments])
        refs.set(`cm:${c.id}`, { ref: `cm:${c.id}`, label: c.title, date: c.dueOn });
    return refs;
}
const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
/** Conservative deduplication, not semantic equivalence or a grounding proof. */
export function reviewedMatch(topic: DraftTopic, input: GenerationInput) {
    const refs = new Set([...topic.facts, ...topic.conflicts].flatMap(f => f.refs.map(r => r.ref)));
    const title = words(topic.title);
    return input.reviewedTopics.find(
        ({ topic: reviewed }) =>
            reviewed.title.trim().toLowerCase() === topic.title.trim().toLowerCase() ||
            [...reviewed.facts, ...reviewed.conflicts].some(f =>
                f.refs.some(r => refs.has(r.ref))
            ) ||
            [...words(reviewed.title)].filter(w => title.has(w)).length >= 2
    );
}

/** Reviewed content is never returned as a replacement. Suggestions stay separate. */
export function protectReviewedTopics(
    input: GenerationInput,
    topics: DraftTopic[],
    enhancements: EnhancementCandidate[]
) {
    const fresh: DraftTopic[] = [];
    for (const topic of topics) {
        const target = reviewedMatch(topic, input);
        if (!target) {
            fresh.push(topic);
            continue;
        }
        const refs = [
            ...new Map(
                [...topic.facts, ...topic.conflicts].flatMap(f => f.refs).map(r => [r.ref, r])
            ).values(),
        ].slice(0, 8);
        const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
        const existingRefs = new Set(
            [...target.topic.facts, ...target.topic.conflicts].flatMap(f => f.refs.map(r => r.ref))
        );
        const newFacts = [...topic.facts, ...topic.conflicts].filter(f =>
            f.refs.some(r => !existingRefs.has(r.ref))
        );
        const newStep =
            topic.proposedNextStep.trim() &&
            !same(topic.proposedNextStep, target.topic.proposedNextStep);
        const newQuestion = !same(topic.decisionQuestion, target.topic.decisionQuestion);
        if (refs.length && (newStep || newFacts.length || newQuestion))
            enhancements.push({
                topicId: target.topic.id,
                baseTopicVersion: target.contentVersion,
                kind: newStep ? "idea" : newFacts.length ? "evidence" : "question",
                text: newStep
                    ? topic.proposedNextStep
                    : newFacts.length
                      ? newFacts
                            .map(f => f.text)
                            .join(" ")
                            .slice(0, 1600)
                      : topic.decisionQuestion,
                refs,
                rationale: `${topic.whyItMatters.slice(0, 600)} This is a separate suggestion; the original decision and actions remain unchanged.`,
            });
    }
    const unique = new Map<string, EnhancementCandidate>();
    for (const e of enhancements)
        unique.set(`${e.topicId}:${e.kind}:${e.text.trim().toLowerCase()}`, e);
    return { topics: fresh.slice(0, 5), enhancements: [...unique.values()].slice(0, 30) };
}

export function rulesGeneration(
    input: GenerationInput,
    pack: EvidencePack
): { draft: AgendaDraft; enhancements: EnhancementCandidate[] } {
    const sources = canonicalRefs(input);
    const selected = new Set(pack.items.map(i => i.ref));
    const refs = (...ids: string[]) =>
        ids.filter(id => selected.has(id)).map(id => sources.get(id)!);
    const topics: DraftTopic[] = [];
    const due = dayAdd(localDate(input.reportPeriod.asOf), 7);
    const make = (
        title: string,
        text: string,
        citations: VantageEvidenceRef[],
        question: string,
        unknown: string
    ): DraftTopic => ({
        title: title.slice(0, 200),
        facts: [{ text: text.slice(0, 600), refs: citations }],
        whyItMatters:
            "This supplied observation may merit discussion. Its wider significance and cause have not been established.",
        decisionQuestion: question.slice(0, 500),
        proposedNextStep:
            "Review the cited source and agree one check that would reduce the stated uncertainty.",
        proposedOwner: null,
        proposedDue: due,
        helpRequested: null,
        unknowns: [unknown],
        conflicts: [],
        rationale:
            "Selected from the supplied reporting-period evidence; any next step is a suggestion for human review.",
    });
    // Derive the summary from selected, source-linked topics, including those routed
    // to enhancements. This never reconstructs or replaces reviewed content.
    const short = (value: string, limit: number) => {
        const text = value.replace(/\s+/g, " ").trim();
        if (text.length <= limit) return text;
        const prefix = text.slice(0, limit - 1);
        return `${prefix.slice(0, prefix.lastIndexOf(" ") > 0 ? prefix.lastIndexOf(" ") : prefix.length)}…`;
    };
    let focus: DraftTopic | undefined;
    const takeaways = new Map<DraftTopic, string>();
    let hasMetricChange = false;
    const conflicting = new Set(pack.signals.metricConflicts.map(c => c.metricId));
    for (const c of pack.signals.metricConflicts) {
        const citations = refs(`obs:${c.a.observationId}`, `obs:${c.b.observationId}`);
        if (citations.length !== 2) continue;
        const text = `${c.name}: ${c.a.value} for ${c.a.periodStart} to ${c.a.periodEnd}, versus ${c.b.value} for ${c.b.periodStart} to ${c.b.periodEnd}; these periods overlap.`;
        const topic = make(
            `Reconcile ${c.name}`,
            text,
            citations,
            `How should we reconcile the overlapping observations of ${c.name}?`,
            "Whether definitions or overlapping coverage explain the disagreement."
        );
        topic.conflicts = [{ text: text.slice(0, 600), refs: citations }];
        topic.whyItMatters = `The overlapping measurements of ${c.name.slice(0, 120)} cannot support a reliable trend. Resolving their coverage would make this week's discussion better informed.`;
        topic.proposedNextStep =
            "Compare the two cited exports' date coverage, definitions, and duplicate handling. Recalculate over one matching window before interpreting the difference as a change.";
        focus ??= topic;
        topics.push(topic);
    }
    for (const c of pack.signals.metricChanges) {
        if (conflicting.has(c.metricId) || !c.notable || !c.previous) continue;
        const citations = refs(`obs:${c.latest.observationId}`, `obs:${c.previous.observationId}`);
        if (citations.length !== 2) continue;
        topics.push(
            make(
                `Review the change in ${c.name}`,
                `${c.name}: ${c.latest.value} ${c.unit} for ${c.latest.periodStart} to ${c.latest.periodEnd}; ${c.previous.value} for the comparable prior period ${c.previous.periodStart} to ${c.previous.periodEnd}.${c.pct != null && Number.isFinite(c.pct) ? ` Change: ${Number((c.pct * 100).toFixed(1))}%.` : ""}`,
                citations,
                `What should we check before changing the plan in response to ${c.name}?`,
                "The cause, sample reliability, and whether the change will persist are unknown."
            )
        );
    }
    for (const c of pack.signals.metricChanges) {
        const topic = topics.find(t => t.title === `Review the change in ${c.name}`.slice(0, 200));
        if (!topic || !c.previous || conflicting.has(c.metricId)) continue;
        const change =
            c.pct != null && Number.isFinite(c.pct)
                ? ` ${Math.abs(Number((c.pct * 100).toFixed(1)))}%`
                : "";
        const movement =
            c.latest.value > c.previous.value
                ? "rose"
                : c.latest.value < c.previous.value
                  ? "fell"
                  : "was unchanged";
        takeaways.set(
            topic,
            `${short(c.name, 60)} ${movement}${change} (${c.previous.value} to ${c.latest.value}) across comparable reporting windows.`
        );
        hasMetricChange = true;
    }
    for (const topic of topics) {
        if (topic.conflicts.length) continue;
        topic.whyItMatters =
            "This comparable-period change is a signal to investigate, not evidence of its cause or business impact. Understanding whether it persists can inform the next weekly plan.";
        topic.proposedNextStep = `For ${short(topic.title.replace("Review the change in ", ""), 120)}, verify the cited counts and definition, then compare the next equivalent reporting window. Record whether the change persists before proposing a response.`;
    }
    for (const item of pack.items) {
        if (item.kind === "commitment") {
            const c = [
                ...input.data.carryForwardCommitments,
                ...input.data.resolvedCommitments,
            ].find(c => item.ref === `cm:${c.id}`)!;
            const context =
                c.status === "open"
                    ? "Carry-forward commitment"
                    : "Commitment resolved in this period";
            topics.push(
                make(
                    `${context}: ${c.title}`,
                    `${c.title}; owner ${c.owner}; original due ${c.dueOn}; status ${c.status}. ${c.outcome ? `Recorded outcome: ${c.outcome}` : "No outcome is recorded."}`,
                    refs(item.ref),
                    c.status === "open"
                        ? "Continue, revise, or drop this commitment?"
                        : "What does the recorded outcome imply for the next step?",
                    "The source does not establish the cause of the outcome or delay."
                )
            );
            const topic = topics[topics.length - 1]!;
            topic.whyItMatters =
                c.status === "open"
                    ? "This earlier commitment is still open. Its status is relevant when deciding what work to carry into the coming week; the source does not explain any delay."
                    : "This recorded resolution provides context for the next plan. Its outcome should be examined before repeating or changing the approach.";
            topic.proposedNextStep =
                c.status === "open"
                    ? `Review “${short(c.title, 140)}” with the recorded owner. Establish its current status and any blocker, then propose keeping, revising, or dropping it for human approval.`
                    : `Review the recorded outcome of “${short(c.title, 140)}”. Identify what was learned and whether a follow-up is justified; if no outcome is recorded, collect that first.`;
        } else if (item.kind === "evidence") {
            const e = input.data.currentEvidence.find(e => item.ref === `ev:${e.id}`)!;
            topics.push(
                make(
                    `Discuss ${e.title}`,
                    `The supplied ${e.kind} records: ${e.body.slice(0, 450)}`,
                    refs(item.ref),
                    `What should we learn or test next from ${e.title}?`,
                    "This individual source does not establish prevalence; whether the observation repeats is unknown."
                )
            );
            const topic = topics[topics.length - 1]!;
            topic.whyItMatters = `“${short(e.title, 100)}” supplies a concrete observation to investigate this week. A follow-up could help distinguish an isolated experience from a repeatable pattern; its wider significance is still unknown.`;
            topic.proposedNextStep = `Suggested check for “${short(e.title, 100)}”: ${e.kind === "interview" ? "observe a small follow-up sample in the same task or context, recording what happens without prompting and where assistance is needed" : "collect an independent observation in the same context and compare it with the cited account"}. Use what repeats or differs to decide whether a targeted change deserves testing.`;
            topic.rationale = `Selected because “${short(e.title, 100)}” offers a specific observation that can be checked this week, not because its wider impact is established.`;
            // Only specialize an explicit navigation difficulty in the supplied excerpt.
            // Other feedback keeps a general follow-up check; no task is invented.
            const navigation = e.body
                .slice(0, 450)
                .match(
                    /\b(?:could not|couldn't|cannot|can't|unable to) find (?:the |a |an )?([^.!?\n]{1,70}?\b(?:action|button|link))(?=[.!?,;\s]|$)/i
                );
            if (e.kind === "interview" && navigation) {
                const task = navigation[1]!;
                topic.title = `Check whether testers can find the ${task}`.slice(0, 200);
                topic.decisionQuestion = `Can new testers locate and use the ${task} without help?`;
                topic.whyItMatters =
                    "The interview identifies a specific navigation obstacle that is testable this week. Checking whether it repeats can inform whether a design experiment is warranted.";
                topic.unknowns = [
                    "This individual source does not establish prevalence; we do not know whether other users encounter the same difficulty.",
                ];
                topic.proposedNextStep = `Ask new testers to locate and use the ${task} without prompting. Record completion, time taken, and requests for help. If the same difficulty recurs, consider testing clearer wording or placement.`;
                topic.rationale =
                    "The interview names a concrete obstacle that can be checked this week; wider impact is still unknown.";
            }
            takeaways.set(
                topic,
                `${hasMetricChange ? "Separately, the" : "The"} ${e.kind} reports: ${short(e.body, 150)}`
            );
            if (!focus) focus = topic;
        }
    }
    if (!topics.length) {
        const item = pack.items.find(
            i =>
                i.kind === "observation" &&
                input.data.currentObservations.some(o => i.ref === `obs:${o.id}`)
        );
        if (item)
            topics.push(
                make(
                    "Review the current measurement",
                    item.text.slice(0, 600),
                    refs(item.ref),
                    "Is the current measurement sufficient to guide this week's discussion?",
                    "A comparable, unambiguous prior measurement may be missing."
                )
            );
    }
    if (topics.length === 1 && topics[0]!.title === "Review the current measurement") {
        topics[0]!.whyItMatters =
            "The current measurement offers a baseline, but does not establish an increase or decrease without a comparable prior observation.";
        topics[0]!.proposedNextStep =
            "Find a prior observation with the same definition and reporting coverage, or collect the next equivalent window. Compare only after confirming that the windows are comparable.";
    }
    focus ??= topics[0];
    // Human-readable attribution supplements the full canonical refs on facts.
    // Keep observations and attribution together within the summary budget.
    const highlight = (topic: DraftTopic, limit: number) => {
        const fact = topic.facts[0]!;
        const labels = [...new Set(fact.refs.map(ref => ref.label))].join("; ");
        const attribution = ` [Source: ${short(labels, 45)}]`;
        return `${short(takeaways.get(topic) ?? fact.text, limit - attribution.length)}${attribution}`;
    };
    const highlights = topics.slice(0, 2).map(t => highlight(t, 180));
    if (focus && !topics.slice(0, 2).includes(focus)) highlights.push(highlight(focus, 110));
    const summary = focus
        ? `${highlights.join(" ")}\n\nSuggested weekly focus: ${short(focus.proposedNextStep!.replace(/^Suggested check for /, "Investigate "), 310)} Why this focus: ${short(focus.rationale, 130)}\n\nUncertainty: ${short(focus.unknowns[0]!, 125)}${hasMetricChange && focus.facts.some(f => f.refs.some(r => r.ref.startsWith("ev:"))) ? " Monitor the metric separately; the evidence does not establish a link or explain its change." : ""}${reviewedMatch(focus, input) ? " Consider this separately without changing the existing decision." : ""}`
        : pack.items.length
          ? "Only prior context is available in the selected sources. It does not establish a current-week change. Suggested weekly focus: collect a current observation with matching coverage before interpreting a trend."
          : "No eligible evidence is available for this period.";
    const protectedResult = protectReviewedTopics(input, topics, []);
    return {
        draft: {
            summary,
            topics: protectedResult.topics,
            origin: "rules",
            modelMetadata: { mode: "rules" },
        },
        enhancements: protectedResult.enhancements,
    };
}

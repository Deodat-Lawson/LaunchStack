import type { DemoReport, DemoSourceRef } from "../demo-contract";

export interface WeeklyBriefView {
    headline: string;
    preview: string;
    previewLabel:
        | "Stored report summary"
        | "Reported evidence"
        | "Reported conflict"
        | "Question from saved report"
        | null;
    /** Exact stored text, including paragraph boundaries. */
    fullSummary: string;
    evidence: { text: string; refs: DemoSourceRef[] }[];
    unknowns: string[];
    previewRefs: DemoSourceRef[];
    highlight: { text: string; refs: DemoSourceRef[]; unreviewed: boolean } | null;
}

// Accept only complete texts: never clip a sentence or its trailing qualification.
function isCompactCompleteText(text: string): boolean {
    return (
        text.length <= 500 &&
        /[.!?\u3002\uff01\uff1f]["'\u201d\u2019)]*$/.test(text) &&
        (text.match(/[.!?\u3002\uff01\uff1f]+/g)?.length ?? 0) <= 2
    );
}
function sourceKey(ref: DemoSourceRef): string {
    return JSON.stringify([ref.kind, ref.id, ref.version]);
}

/** Display-only selection: no inference about agreement, approval or current policy. */
export function selectWeeklyBrief(report: DemoReport): WeeklyBriefView {
    const fullSummary = report.summary;
    const summary = fullSummary.trim();
    const topic = report.topics.find(item => item.title.trim()) ?? report.topics[0];
    const evidence = report.topics.flatMap(item => item.facts).filter(fact => fact.text.trim());
    const unknowns = report.topics.flatMap(item => item.unknowns).filter(text => text.trim());
    const headline =
        topic && topic.title.trim().length > 0 ? topic.title.trim() : "Review this week's report";
    const question = topic?.decisionQuestion.trim();
    let preview =
        question && question.length > 0
            ? question
            : "Read the full brief and review the source evidence before deciding.";
    let previewLabel: WeeklyBriefView["previewLabel"] = question
        ? "Question from saved report"
        : null;

    let previewRefs: DemoSourceRef[] = [];
    let highlight: WeeklyBriefView["highlight"] = null;
    if (summary && isCompactCompleteText(summary)) {
        preview = summary;
        previewLabel = "Stored report summary";
    } else if (topic) {
        const knownSources = new Set(
            report.diagnostics.sources.map(item => sourceKey(item.source))
        );
        const validated = (item: { refs: DemoSourceRef[] }) =>
            item.refs.length > 0 && item.refs.every(ref => knownSources.has(sourceKey(ref)));
        const selected: typeof topic.facts = [];
        for (const fact of topic.facts) {
            if (!validated(fact) || !fact.text.trim()) continue;
            const candidate = [...selected, fact].map(item => item.text.trim()).join(" ");
            if (!isCompactCompleteText(candidate)) break;
            selected.push(fact);
            if (selected.length === 2) break;
        }
        const factsText = selected.map(item => item.text.trim()).join(" ");
        const conflicts = topic.conflicts.filter(item => item.text.trim());
        const selectedRefs = new Set(selected.flatMap(item => item.refs).map(sourceKey));
        // A conflict may add qualifications even when its sources are covered.
        // Without semantic inference, only verbatim inclusion establishes coverage.
        const conflictsCovered = conflicts.every(
            item =>
                validated(item) &&
                item.refs.every(ref => selectedRefs.has(sourceKey(ref))) &&
                factsText.includes(item.text.trim())
        );
        if (factsText && conflictsCovered) {
            preview = factsText;
            previewLabel = "Reported evidence";
            previewRefs = selected.flatMap(item => item.refs);
        } else if (conflicts.length > 0 && conflicts.every(validated)) {
            const conflictText = conflicts.map(item => item.text.trim()).join(" ");
            if (isCompactCompleteText(conflictText)) {
                preview = conflictText;
                previewLabel = "Reported conflict";
                previewRefs = conflicts.flatMap(item => item.refs);
            }
        }
    }
    // Add one complete statement from an independent source, never a clipped
    // fragment or rationale. A summary/question has no selected evidence refs.
    if (previewRefs.length > 0 && topic) {
        const represented = new Set(previewRefs.map(sourceKey));
        const known = new Map(
            report.diagnostics.sources.map(item => [sourceKey(item.source), item])
        );
        const supplemental = topic.facts.find(
            fact =>
                fact.text.trim().length <= 350 &&
                isCompactCompleteText(fact.text.trim()) &&
                !preview.includes(fact.text.trim()) &&
                fact.refs.length > 0 &&
                fact.refs.every(
                    ref => known.has(sourceKey(ref)) && !represented.has(sourceKey(ref))
                )
        );
        if (supplemental) {
            highlight = {
                text: supplemental.text,
                refs: supplemental.refs,
                unreviewed: supplemental.refs.some(
                    ref => known.get(sourceKey(ref))?.reviewState === "unreviewed"
                ),
            };
        }
    }
    return {
        headline,
        preview,
        previewLabel,
        fullSummary,
        evidence,
        unknowns,
        previewRefs,
        highlight,
    };
}

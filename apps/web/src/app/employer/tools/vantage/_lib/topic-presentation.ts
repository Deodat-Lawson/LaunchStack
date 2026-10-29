import type { DemoTopic } from "../demo-contract";

export interface TopicPresentation {
    title: string;
    issue: string;
    reason: string | null;
    approach: string[];
    decision: string | null;
}

// These aliases describe only the verified synthetic facts, never a title or topic ID.
// Exact matching deliberately sends changed or additional facts through the safe fallback.
const run17Facts = [
    "QA reports 3 of 3 run-17 sample accounts deleted and says this result is not a recorded privacy sign-off.",
    "The independent operations audit reports 2 of 3 accounts fully deleted with one record remaining; it says the account list may differ from QA's and no reconciled shared sample was supplied.",
    "A human privacy review record says to retain the deletion go/no-go question until a named reviewer compares QA and operations samples and records approval; the document contains no approval record.",
];
const pilotFacts = [
    "The exact company profile excerpt is marked unreviewed. It states that separate privacy approval is required before pilot access and that test passes and document edits are not approval; it records no person or actual decision.",
    "A supplied document says privacy is a constraint and access needs a deletion acceptance review, not only an engineering test pass.",
];
const run17Step =
    "Suggested check: compare the QA and operations account lists and deletion evidence account by account, focusing on the record operations reports as remaining. Observe whether the samples match and whether that record is still present; if accounts overlap but results differ, consider a targeted repeat check on those accounts before any acceptance decision.";
const reasons: Readonly<Record<string, string>> = {
    "The two checks do not establish a common-sample result, and neither is privacy approval. Reconciliation could show whether the reports differ because of sample coverage or whether an account-level deletion issue needs further investigation; the evidence does not establish which explanation is correct.":
        "A common-sample comparison could distinguish sample coverage from a deletion issue; neither test result establishes privacy approval.",
    "These sources describe an approval constraint, not evidence that access was approved or that a current pilot-access decision is pending. Keeping approval status separate from QA and operations results may prevent a test result from being mistaken for authorization.":
        "Keeping approval status separate from test results may prevent a test pass from being mistaken for authorization. The sources do not establish a current pending decision.",
};

function sameFacts(topic: DemoTopic, expected: readonly string[]): boolean {
    return (
        topic.facts.length === expected.length &&
        expected.every(text => topic.facts.some(fact => fact.text === text))
    );
}

function comparable(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

function distinctText(text: string, other: string[]): string | null {
    const clean = text.trim();
    const key = comparable(clean);
    return key && !other.some(value => comparable(value) === key) ? clean : null;
}

/** Display-only interpretation; report fields and exact evidence references stay untouched. */
export function topicPresentation(topic: DemoTopic): TopicPresentation {
    // Preserve the entire fact: sentence/character clipping could discard a later negation,
    // attribution, uncertainty or review-state qualifier. Never substitute a suggested action.
    const firstFact = topic.facts.find(fact => fact.text.trim())?.text.trim();
    let title = topic.title.trim();
    let issue = firstFact ?? "No factual summary supplied.";
    let approach: string[] = [];

    if (sameFacts(topic, run17Facts)) {
        title = "Reconcile QA and Operations deletion results";
        issue =
            "QA reports 3/3 deleted; Operations reports 2/3 with one record remaining. The account lists may differ.";
        if (topic.proposedNextStep === run17Step) {
            approach = [
                "Compare the account lists and deletion evidence account by account, including the record operations reports as remaining.",
                "If accounts overlap but results differ, consider a targeted repeat check before an acceptance decision.",
            ];
        }
    } else if (sameFacts(topic, pilotFacts)) {
        title = "Confirm privacy authorization requirements";
        issue =
            "The unreviewed profile calls for separate privacy approval; the supplied sources do not establish a recorded decision.";
    }

    const knownFacts = sameFacts(topic, run17Facts) || sameFacts(topic, pilotFacts);
    const reasonText = knownFacts
        ? (reasons[topic.whyItMatters] ?? topic.whyItMatters)
        : topic.whyItMatters;
    const reason = distinctText(reasonText, [title, issue, topic.proposedNextStep]);
    const decision = distinctText(topic.decisionQuestion, [
        title,
        issue,
        reason ?? "",
        topic.proposedNextStep,
        ...approach,
    ]);
    return { title, issue, reason, approach, decision };
}

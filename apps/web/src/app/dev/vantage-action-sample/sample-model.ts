import { topicPresentation } from "~/app/employer/tools/vantage/_lib/topic-presentation";
export {
    topicPresentation,
    type TopicPresentation,
} from "~/app/employer/tools/vantage/_lib/topic-presentation";
import type {
    CommitmentDto,
    PendingHistoricalQuestionsViewV1,
    VantageEvidenceRef,
} from "~/app/employer/tools/vantage/api";
import type {
    DemoSource,
    DemoSourceRef,
    DemoState,
    DemoTopic,
} from "~/app/employer/tools/vantage/demo-contract";
import type { DemoPersonalContextView } from "~/app/employer/tools/vantage/demo-personal-client";

export interface SampleData {
    state: DemoState;
    personal: DemoPersonalContextView;
    sources: DemoSource[];
    commitments: CommitmentDto[];
    pending: PendingHistoricalQuestionsViewV1 | null;
    capturedAt: string;
}

export interface SampleItem {
    id: string;
    type: "proposal" | "question" | "commitment";
    title: string;
    originalTitle: string;
    description: string;
    status: string;
    owner: string | null;
    due: string | null;
    topic?: DemoTopic;
    commitment?: CommitmentDto;
    question?: NonNullable<SampleData["pending"]>["questions"][number];
    refs: DemoSourceRef[];
    /** Historical V1 references have no exact source version. Never promote them to DemoSourceRef. */
    legacyRefs?: VantageEvidenceRef[];
    history: { label: string; detail: string; at?: string }[];
}

const titles: Readonly<Record<string, string>> = {
    "Reconcile run-17 samples before a privacy go/no-go": "Reconcile run-17 deletion checks",
    "Keep pilot-access constraints distinct from test results": "Clarify pilot-access constraints",
    "Deletion acceptance: privacy review remains unverified": "Confirm privacy review evidence",
};

/** Presentation aliases only: the original title and every report field remain available. */
export function readableTitle(title: string): string {
    return titles[title] ?? title.trim();
}

export function sourceKey(ref: DemoSourceRef): string {
    return JSON.stringify([ref.kind, ref.id, ref.version]);
}

export function refLabel(ref: DemoSourceRef): string {
    const title =
        ref.kind === "company"
            ? "Company Architecture"
            : ref.id.replace(/^workspace-document\//, "Document ");
    return `${title} · ${ref.version}`;
}

function exactRefs(topic: DemoTopic): DemoSourceRef[] {
    const refs = new Map<string, DemoSourceRef>();
    for (const ref of [...topic.facts, ...topic.conflicts].flatMap(item => item.refs))
        refs.set(sourceKey(ref), { ...ref });
    return [...refs.values()];
}

/** A deterministic view adapter. Similar wording never merges distinct historical/current records. */
export function createItems(data: SampleData): SampleItem[] {
    const report = data.state.report;
    const proposals: SampleItem[] = (report?.topics ?? []).map(topic => ({
        id: `proposal:${topic.id}`,
        type: "proposal",
        title: topicPresentation(topic).title,
        originalTitle: topic.title,
        description: topicPresentation(topic).issue,
        status: topic.status,
        owner: null,
        due: null,
        topic,
        refs: exactRefs(topic),
        history: [
            {
                label: "Saved report suggestion",
                detail: "A report topic for human review; it is not a committed action.",
                ...(report ? { at: report.generatedAt } : {}),
            },
            ...(topic.decision
                ? [
                      {
                          label: "Recorded human decision",
                          detail: topic.decision.text ?? topic.decision.value,
                          at: topic.decision.recordedAt,
                      },
                  ]
                : []),
        ],
    }));
    const questions: SampleItem[] = (data.pending?.questions ?? []).map(question => ({
        id: `question:${question.questionId}`,
        type: "question",
        title: readableTitle(question.title),
        originalTitle: question.title,
        description: question.question,
        status: "unverified",
        owner: null,
        due: null,
        question,
        refs: [],
        legacyRefs: question.sourceRefs.map(ref => ({ ...ref })),
        history: [
            {
                label: "Historical human record",
                detail: `Origin week ${question.originWeekStart}. Current status is unverified; this is not a commitment.`,
                ...(question.originGeneratedAt ? { at: question.originGeneratedAt } : {}),
            },
            {
                label: "Original review",
                detail: question.humanReview.decision ?? question.humanReview.kind,
                ...(question.humanReview.decidedAt ? { at: question.humanReview.decidedAt } : {}),
            },
        ],
    }));
    const commitments: SampleItem[] = data.commitments.map(commitment => ({
        id: `commitment:${commitment.id}`,
        type: "commitment",
        title: readableTitle(commitment.title),
        originalTitle: commitment.title,
        description: commitment.test ?? "No completion test recorded.",
        status: commitment.status,
        owner: commitment.owner.trim() || null,
        due: commitment.dueOn || null,
        commitment,
        // A topic relationship alone does not establish a source version for this action.
        refs: [],
        history: [
            {
                label: "Committed action",
                detail: "Recorded in Weekly Actions.",
                at: commitment.createdAt,
            },
            ...(commitment.resolvedAt
                ? [
                      {
                          label: "Action resolved",
                          detail: commitment.outcome ?? commitment.status,
                          at: commitment.resolvedAt,
                      },
                  ]
                : []),
        ],
    }));
    return [...proposals, ...questions, ...commitments];
}

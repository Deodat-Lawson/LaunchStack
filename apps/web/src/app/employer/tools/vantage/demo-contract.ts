/** Local synthetic demo extension only. Canonical V1 wire contracts remain separate. */
export interface DemoSourceRef {
    kind: "company" | "doc" | "ev" | "obs" | "cm" | "public";
    id: string;
    version: string;
}
export interface DemoHumanDecision {
    value: "go" | "no-go" | "needs-more-evidence";
    text?: string;
    recordedAt: string;
}
export interface DemoTopic {
    id: string;
    title: string;
    facts: { text: string; refs: DemoSourceRef[] }[];
    conflicts: { text: string; refs: DemoSourceRef[] }[];
    whyItMatters: string;
    decisionQuestion: string;
    proposedNextStep: string;
    unknowns: string[];
    rationale: string;
    status: "suggested" | "kept" | "dismissed";
    decision?: DemoHumanDecision;
}
export interface DemoReport {
    id: string;
    weekStart: string;
    generatedAt: string;
    version: number;
    summary: string;
    topics: DemoTopic[];
    execution: {
        mode: "ai" | "replay";
        modelId: string;
        promptVersion: string;
        attempts: number;
        durationMs: number;
        fallbackReason: null;
        reasoningEffort?: "none";
        replay?: { fixtureId: string; recordedAt: string; originalModelId: string };
    };
    diagnostics: {
        sources: {
            source: DemoSourceRef;
            title: string;
            contentHash: string;
            reviewState?: string;
        }[];
        contextFingerprint: string;
        persisted: true;
        historicalHumanDecisions: number;
        promptBytes?: number;
        promptOmissions?: {
            previousSummary: boolean;
            previousTopics: number;
            previousContext: boolean;
        }[];
        context?: {
            retrievalStatus: string;
            manifestStatus: string;
            researchMode: string;
            researchStatus: string;
            roleIds: string[];
            personalStarCount: number;
            selectedCount: number;
            missingCount: number;
            omittedCount: number;
            missingRefs: DemoSourceRef[];
            omittedRefs: DemoSourceRef[];
            optionalUnavailableCount: number;
        };
    };
}
export interface DemoState {
    /** Explicitly local demo transport; replay never calls a model. */
    generationMode?: "live" | "replay";
    weeks: { weekStart: string; label?: string }[];
    selectedWeek: string;
    report: DemoReport | null;
    nativeAgendaId: string | null;
    companyArchitecture?: DemoSource;
    unavailableReason?: string;
}
export interface DemoSource {
    title: string;
    body: string;
    source: DemoSourceRef;
    sourceDate: string | null;
    contentHash: string;
    reviewState?: string;
    authority: string;
}
export interface DemoTopicReview {
    reportId: string;
    topicId: string;
    expectedVersion: number;
    status?: "kept" | "dismissed";
    decision?: { value: DemoHumanDecision["value"]; text?: string };
}

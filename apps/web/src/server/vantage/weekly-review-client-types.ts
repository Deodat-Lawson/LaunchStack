import type {
    WeeklyReviewV21,
    WeeklyReviewInput,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import type { ReadWeeklyReview } from "./weekly-review-repository";
import type { BusinessRoleContext, BusinessRoleInput } from "./weekly-review-business-role";
import type {
    WeeklyReviewSourceScope,
    WeeklyReviewSourceScopes,
} from "./weekly-review-scoped-selection";
import type {
    inspectContextSource,
    inspectFrozenEvidence,
    ContextSourceInspection,
} from "./weekly-review-evidence-inspection";

export type { WeeklyReviewSourceScope };
export type WeeklyReviewStage = "gathering" | "exploring" | "writing" | "checking" | "saving";
export type WeeklyReviewDto = Omit<ReadWeeklyReview, "report" | "evidence"> & {
    report: Omit<WeeklyReviewV21, "topics"> & {
        topics: (WeeklyReviewV21["topics"][number] & { id: string })[];
    };
    evidence: {
        qualityEvidence?: string;
        inputSnapshot?: WeeklyReviewInput;
        [key: string]: unknown;
    };
};
export interface WeeklyReviewListDto {
    enabled: boolean;
    activeId: string | null;
    runs: {
        id: string;
        week_start: string;
        status: string;
        review_version: number;
        created_at: string;
    }[];
}
export interface WeeklyReviewContextDto {
    enabled: boolean;
    scopedEvidenceEnabled: boolean;
    canConfigure: boolean;
    documents: { id: string; title: string; category: string }[];
    policy: {
        architecture_document_id: string | null;
        required_document_ids: string[];
        required_source_scopes: WeeklyReviewSourceScopes;
        version: number;
        hasHiddenSources: boolean;
    } | null;
    preferences: {
        star_document_ids: string[];
        star_source_scopes: WeeklyReviewSourceScopes;
        version: number;
        hasHiddenSources: boolean;
    } | null;
}
export interface WeeklyReviewRoleDto {
    role: BusinessRoleContext | null;
    version: number;
    canEdit: boolean;
    enabled: boolean;
}
export type WeeklyReviewSourceQuery = ContextSourceInspection;
export type WeeklyReviewSourceInspectionDto = Awaited<ReturnType<typeof inspectContextSource>>;
export type WeeklyReviewEvidenceDto = ReturnType<typeof inspectFrozenEvidence>;
export type WeeklyReviewPolicyInput = {
    expectedVersion: number;
    architectureDocumentId: string;
    requiredDocumentIds: string[];
    requiredSourceScopes?: WeeklyReviewSourceScopes;
};
export type WeeklyReviewStarsInput = {
    expectedVersion: number;
    starDocumentIds: string[];
    starSourceScopes?: WeeklyReviewSourceScopes;
};
export type WeeklyReviewRoleInput = (BusinessRoleInput | { role: null }) & {
    expectedVersion: number;
};
export type WeeklyReviewDecisionInput = {
    expectedVersion: number;
    topicId: string;
    decision: string;
    outcome?: string;
};
export type WeeklyReviewGenerateInput = { weekStart: string; expectedActiveId: string | null };
export type WeeklyReviewEvent =
    | { type: "stage"; stage: WeeklyReviewStage }
    | { type: "result"; result: WeeklyReviewDto }
    | { type: "error"; error: string; status: number };

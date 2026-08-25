import { z } from "zod";
export declare const FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION: "founder-weekly-review-evidence/v1";
export declare const FOUNDER_WEEKLY_REVIEW_SCHEMA_VERSION: "founder-weekly-review/v1";
export declare const FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION: "founder-weekly-review/v2";
export declare const FounderWeeklyReviewStatusSchema: z.ZodEnum<
    ["queued", "collecting", "generating", "draft", "published", "failed"]
>;
export type FounderWeeklyReviewStatus = z.infer<typeof FounderWeeklyReviewStatusSchema>;
/**
 * An IANA zone the host's ICU data recognizes. Rejecting it at the edge matters
 * because an unknown zone is a permanent user-input error: accepted here, it
 * would be persisted and then fail inside the worker, where Inngest treats it
 * as transient and retries it to exhaustion.
 */
export declare function isValidTimeZone(timeZone: string): boolean;
export declare const WorkspaceTimezoneSchema: z.ZodEffects<z.ZodString, string, string>;
/** Durable, request-derived inputs needed to collect evidence after the HTTP response. */
export declare const FounderWeeklyReviewCollectionInputSchema: z.ZodObject<
    {
        workspaceTimezone: z.ZodEffects<z.ZodString, string, string>;
        founderContext: z.ZodOptional<z.ZodString>;
        actorExternalUserId: z.ZodString;
    },
    "strict",
    z.ZodTypeAny,
    {
        workspaceTimezone: string;
        actorExternalUserId: string;
        founderContext?: string | undefined;
    },
    {
        workspaceTimezone: string;
        actorExternalUserId: string;
        founderContext?: string | undefined;
    }
>;
export type FounderWeeklyReviewCollectionInput = z.infer<
    typeof FounderWeeklyReviewCollectionInputSchema
>;
export declare const FounderWeeklyReviewOperationTypeSchema: z.ZodEnum<["retry"]>;
export type FounderWeeklyReviewOperationType = z.infer<
    typeof FounderWeeklyReviewOperationTypeSchema
>;
export declare const ReportingPeriodSchema: z.ZodEffects<
    z.ZodObject<
        {
            start: z.ZodEffects<z.ZodString, string, string>;
            end: z.ZodEffects<z.ZodString, string, string>;
        },
        "strip",
        z.ZodTypeAny,
        {
            start: string;
            end: string;
        },
        {
            start: string;
            end: string;
        }
    >,
    {
        start: string;
        end: string;
    },
    {
        start: string;
        end: string;
    }
>;
export type ReportingPeriod = z.infer<typeof ReportingPeriodSchema>;
export declare const FounderWeeklyReviewEvidenceItemSchema: z.ZodObject<
    {
        sourceType: z.ZodEnum<
            [
                "workspace_document",
                "document_change",
                "customer_feedback",
                "github_activity",
                "manual_note",
                "founder_context",
                "other",
            ]
        >;
        sourceId: z.ZodString;
        title: z.ZodString;
        sourceTimestamp: z.ZodOptional<z.ZodString>;
        excerpt: z.ZodString;
        canonicalUrl: z.ZodOptional<z.ZodString>;
        workspaceDeepLink: z.ZodOptional<z.ZodString>;
        metadata: z.ZodDefault<
            z.ZodRecord<
                z.ZodString,
                z.ZodType<
                    string | number | boolean | (string | number | boolean | null)[] | null,
                    z.ZodTypeDef,
                    string | number | boolean | (string | number | boolean | null)[] | null
                >
            >
        >;
    },
    "strip",
    z.ZodTypeAny,
    {
        sourceType:
            | "workspace_document"
            | "document_change"
            | "customer_feedback"
            | "github_activity"
            | "manual_note"
            | "founder_context"
            | "other";
        sourceId: string;
        title: string;
        excerpt: string;
        metadata: Record<
            string,
            string | number | boolean | (string | number | boolean | null)[] | null
        >;
        sourceTimestamp?: string | undefined;
        canonicalUrl?: string | undefined;
        workspaceDeepLink?: string | undefined;
    },
    {
        sourceType:
            | "workspace_document"
            | "document_change"
            | "customer_feedback"
            | "github_activity"
            | "manual_note"
            | "founder_context"
            | "other";
        sourceId: string;
        title: string;
        excerpt: string;
        sourceTimestamp?: string | undefined;
        canonicalUrl?: string | undefined;
        workspaceDeepLink?: string | undefined;
        metadata?:
            | Record<
                  string,
                  string | number | boolean | (string | number | boolean | null)[] | null
              >
            | undefined;
    }
>;
export type FounderWeeklyReviewEvidenceItem = z.infer<typeof FounderWeeklyReviewEvidenceItemSchema>;
export declare const FounderWeeklyReviewEvidenceWarningSchema: z.ZodObject<
    {
        code: z.ZodString;
        message: z.ZodString;
        sourceType: z.ZodOptional<
            z.ZodEnum<
                [
                    "workspace_document",
                    "document_change",
                    "customer_feedback",
                    "github_activity",
                    "manual_note",
                    "founder_context",
                    "other",
                ]
            >
        >;
    },
    "strip",
    z.ZodTypeAny,
    {
        code: string;
        message: string;
        sourceType?:
            | "workspace_document"
            | "document_change"
            | "customer_feedback"
            | "github_activity"
            | "manual_note"
            | "founder_context"
            | "other"
            | undefined;
    },
    {
        code: string;
        message: string;
        sourceType?:
            | "workspace_document"
            | "document_change"
            | "customer_feedback"
            | "github_activity"
            | "manual_note"
            | "founder_context"
            | "other"
            | undefined;
    }
>;
export type FounderWeeklyReviewEvidenceWarning = z.infer<
    typeof FounderWeeklyReviewEvidenceWarningSchema
>;
export declare const FounderWeeklyReviewEvidenceSnapshotSchema: z.ZodObject<
    {
        schemaVersion: z.ZodLiteral<"founder-weekly-review-evidence/v1">;
        capturedAt: z.ZodString;
        reportingPeriod: z.ZodEffects<
            z.ZodObject<
                {
                    start: z.ZodEffects<z.ZodString, string, string>;
                    end: z.ZodEffects<z.ZodString, string, string>;
                },
                "strip",
                z.ZodTypeAny,
                {
                    start: string;
                    end: string;
                },
                {
                    start: string;
                    end: string;
                }
            >,
            {
                start: string;
                end: string;
            },
            {
                start: string;
                end: string;
            }
        >;
        workspaceTimezone: z.ZodString;
        items: z.ZodArray<
            z.ZodObject<
                {
                    sourceType: z.ZodEnum<
                        [
                            "workspace_document",
                            "document_change",
                            "customer_feedback",
                            "github_activity",
                            "manual_note",
                            "founder_context",
                            "other",
                        ]
                    >;
                    sourceId: z.ZodString;
                    title: z.ZodString;
                    sourceTimestamp: z.ZodOptional<z.ZodString>;
                    excerpt: z.ZodString;
                    canonicalUrl: z.ZodOptional<z.ZodString>;
                    workspaceDeepLink: z.ZodOptional<z.ZodString>;
                    metadata: z.ZodDefault<
                        z.ZodRecord<
                            z.ZodString,
                            z.ZodType<
                                | string
                                | number
                                | boolean
                                | (string | number | boolean | null)[]
                                | null,
                                z.ZodTypeDef,
                                | string
                                | number
                                | boolean
                                | (string | number | boolean | null)[]
                                | null
                            >
                        >
                    >;
                },
                "strip",
                z.ZodTypeAny,
                {
                    sourceType:
                        | "workspace_document"
                        | "document_change"
                        | "customer_feedback"
                        | "github_activity"
                        | "manual_note"
                        | "founder_context"
                        | "other";
                    sourceId: string;
                    title: string;
                    excerpt: string;
                    metadata: Record<
                        string,
                        string | number | boolean | (string | number | boolean | null)[] | null
                    >;
                    sourceTimestamp?: string | undefined;
                    canonicalUrl?: string | undefined;
                    workspaceDeepLink?: string | undefined;
                },
                {
                    sourceType:
                        | "workspace_document"
                        | "document_change"
                        | "customer_feedback"
                        | "github_activity"
                        | "manual_note"
                        | "founder_context"
                        | "other";
                    sourceId: string;
                    title: string;
                    excerpt: string;
                    sourceTimestamp?: string | undefined;
                    canonicalUrl?: string | undefined;
                    workspaceDeepLink?: string | undefined;
                    metadata?:
                        | Record<
                              string,
                              | string
                              | number
                              | boolean
                              | (string | number | boolean | null)[]
                              | null
                          >
                        | undefined;
                }
            >,
            "many"
        >;
        sourceWarnings: z.ZodDefault<
            z.ZodArray<
                z.ZodObject<
                    {
                        code: z.ZodString;
                        message: z.ZodString;
                        sourceType: z.ZodOptional<
                            z.ZodEnum<
                                [
                                    "workspace_document",
                                    "document_change",
                                    "customer_feedback",
                                    "github_activity",
                                    "manual_note",
                                    "founder_context",
                                    "other",
                                ]
                            >
                        >;
                    },
                    "strip",
                    z.ZodTypeAny,
                    {
                        code: string;
                        message: string;
                        sourceType?:
                            | "workspace_document"
                            | "document_change"
                            | "customer_feedback"
                            | "github_activity"
                            | "manual_note"
                            | "founder_context"
                            | "other"
                            | undefined;
                    },
                    {
                        code: string;
                        message: string;
                        sourceType?:
                            | "workspace_document"
                            | "document_change"
                            | "customer_feedback"
                            | "github_activity"
                            | "manual_note"
                            | "founder_context"
                            | "other"
                            | undefined;
                    }
                >,
                "many"
            >
        >;
    },
    "strip",
    z.ZodTypeAny,
    {
        workspaceTimezone: string;
        schemaVersion: "founder-weekly-review-evidence/v1";
        capturedAt: string;
        reportingPeriod: {
            start: string;
            end: string;
        };
        items: {
            sourceType:
                | "workspace_document"
                | "document_change"
                | "customer_feedback"
                | "github_activity"
                | "manual_note"
                | "founder_context"
                | "other";
            sourceId: string;
            title: string;
            excerpt: string;
            metadata: Record<
                string,
                string | number | boolean | (string | number | boolean | null)[] | null
            >;
            sourceTimestamp?: string | undefined;
            canonicalUrl?: string | undefined;
            workspaceDeepLink?: string | undefined;
        }[];
        sourceWarnings: {
            code: string;
            message: string;
            sourceType?:
                | "workspace_document"
                | "document_change"
                | "customer_feedback"
                | "github_activity"
                | "manual_note"
                | "founder_context"
                | "other"
                | undefined;
        }[];
    },
    {
        workspaceTimezone: string;
        schemaVersion: "founder-weekly-review-evidence/v1";
        capturedAt: string;
        reportingPeriod: {
            start: string;
            end: string;
        };
        items: {
            sourceType:
                | "workspace_document"
                | "document_change"
                | "customer_feedback"
                | "github_activity"
                | "manual_note"
                | "founder_context"
                | "other";
            sourceId: string;
            title: string;
            excerpt: string;
            sourceTimestamp?: string | undefined;
            canonicalUrl?: string | undefined;
            workspaceDeepLink?: string | undefined;
            metadata?:
                | Record<
                      string,
                      string | number | boolean | (string | number | boolean | null)[] | null
                  >
                | undefined;
        }[];
        sourceWarnings?:
            | {
                  code: string;
                  message: string;
                  sourceType?:
                      | "workspace_document"
                      | "document_change"
                      | "customer_feedback"
                      | "github_activity"
                      | "manual_note"
                      | "founder_context"
                      | "other"
                      | undefined;
              }[]
            | undefined;
    }
>;
export type FounderWeeklyReviewEvidenceSnapshot = z.infer<
    typeof FounderWeeklyReviewEvidenceSnapshotSchema
>;
export declare const FounderWeeklyReviewConfidenceSchema: z.ZodEnum<["high", "medium", "low"]>;
export type FounderWeeklyReviewConfidence = z.infer<typeof FounderWeeklyReviewConfidenceSchema>;
export declare const FounderWeeklyReviewSectionItemSchema: z.ZodDiscriminatedUnion<
    "kind",
    [
        z.ZodObject<
            {
                kind: z.ZodLiteral<"observed_fact">;
                text: z.ZodString;
                sourceIds: z.ZodArray<z.ZodString, "many">;
                confidence: z.ZodEnum<["high", "medium", "low"]>;
            },
            "strip",
            z.ZodTypeAny,
            {
                kind: "observed_fact";
                text: string;
                sourceIds: string[];
                confidence: "high" | "medium" | "low";
            },
            {
                kind: "observed_fact";
                text: string;
                sourceIds: string[];
                confidence: "high" | "medium" | "low";
            }
        >,
        z.ZodObject<
            {
                kind: z.ZodLiteral<"recommended_item">;
                text: z.ZodString;
                rationale: z.ZodOptional<z.ZodString>;
                sourceIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
                confidence: z.ZodOptional<z.ZodEnum<["high", "medium", "low"]>>;
            },
            "strip",
            z.ZodTypeAny,
            {
                kind: "recommended_item";
                text: string;
                sourceIds: string[];
                confidence?: "high" | "medium" | "low" | undefined;
                rationale?: string | undefined;
            },
            {
                kind: "recommended_item";
                text: string;
                sourceIds?: string[] | undefined;
                confidence?: "high" | "medium" | "low" | undefined;
                rationale?: string | undefined;
            }
        >,
        z.ZodObject<
            {
                kind: z.ZodLiteral<"no_evidence">;
                code: z.ZodEnum<["no_relevant_evidence", "source_unavailable", "not_assessed"]>;
                note: z.ZodOptional<z.ZodString>;
            },
            "strip",
            z.ZodTypeAny,
            {
                code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                kind: "no_evidence";
                note?: string | undefined;
            },
            {
                code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                kind: "no_evidence";
                note?: string | undefined;
            }
        >,
        z.ZodObject<
            {
                kind: z.ZodLiteral<"human_edit">;
                markdown: z.ZodString;
            },
            "strip",
            z.ZodTypeAny,
            {
                kind: "human_edit";
                markdown: string;
            },
            {
                kind: "human_edit";
                markdown: string;
            }
        >,
    ]
>;
export type FounderWeeklyReviewSectionItem = z.infer<typeof FounderWeeklyReviewSectionItemSchema>;
/**
 * LAU-5 payload. Keep this schema byte-for-byte compatible with persisted v1
 * drafts; LAU-7 generation emits the separate v2 schema below.
 */
export declare const FounderWeeklyReviewV1PayloadSchema: z.ZodObject<
    {
        schemaVersion: z.ZodLiteral<"founder-weekly-review/v1">;
        sections: z.ZodObject<
            {
                whatChanged: z.ZodObject<
                    {
                        heading: z.ZodString;
                        items: z.ZodArray<
                            z.ZodDiscriminatedUnion<
                                "kind",
                                [
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"observed_fact">;
                                            text: z.ZodString;
                                            sourceIds: z.ZodArray<z.ZodString, "many">;
                                            confidence: z.ZodEnum<["high", "medium", "low"]>;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: "high" | "medium" | "low";
                                        },
                                        {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: "high" | "medium" | "low";
                                        }
                                    >,
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"recommended_item">;
                                            text: z.ZodString;
                                            rationale: z.ZodOptional<z.ZodString>;
                                            sourceIds: z.ZodDefault<
                                                z.ZodArray<z.ZodString, "many">
                                            >;
                                            confidence: z.ZodOptional<
                                                z.ZodEnum<["high", "medium", "low"]>
                                            >;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            kind: "recommended_item";
                                            text: string;
                                            sourceIds: string[];
                                            confidence?: "high" | "medium" | "low" | undefined;
                                            rationale?: string | undefined;
                                        },
                                        {
                                            kind: "recommended_item";
                                            text: string;
                                            sourceIds?: string[] | undefined;
                                            confidence?: "high" | "medium" | "low" | undefined;
                                            rationale?: string | undefined;
                                        }
                                    >,
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"no_evidence">;
                                            code: z.ZodEnum<
                                                [
                                                    "no_relevant_evidence",
                                                    "source_unavailable",
                                                    "not_assessed",
                                                ]
                                            >;
                                            note: z.ZodOptional<z.ZodString>;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            code:
                                                | "no_relevant_evidence"
                                                | "source_unavailable"
                                                | "not_assessed";
                                            kind: "no_evidence";
                                            note?: string | undefined;
                                        },
                                        {
                                            code:
                                                | "no_relevant_evidence"
                                                | "source_unavailable"
                                                | "not_assessed";
                                            kind: "no_evidence";
                                            note?: string | undefined;
                                        }
                                    >,
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"human_edit">;
                                            markdown: z.ZodString;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            kind: "human_edit";
                                            markdown: string;
                                        },
                                        {
                                            kind: "human_edit";
                                            markdown: string;
                                        }
                                    >,
                                ]
                            >,
                            "many"
                        >;
                    },
                    "strip",
                    z.ZodTypeAny,
                    {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds: string[];
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    },
                    {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds?: string[] | undefined;
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    }
                >;
                whatShipped: z.ZodObject<
                    {
                        heading: z.ZodString;
                        items: z.ZodArray<
                            z.ZodDiscriminatedUnion<
                                "kind",
                                [
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"observed_fact">;
                                            text: z.ZodString;
                                            sourceIds: z.ZodArray<z.ZodString, "many">;
                                            confidence: z.ZodEnum<["high", "medium", "low"]>;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: "high" | "medium" | "low";
                                        },
                                        {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: "high" | "medium" | "low";
                                        }
                                    >,
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"recommended_item">;
                                            text: z.ZodString;
                                            rationale: z.ZodOptional<z.ZodString>;
                                            sourceIds: z.ZodDefault<
                                                z.ZodArray<z.ZodString, "many">
                                            >;
                                            confidence: z.ZodOptional<
                                                z.ZodEnum<["high", "medium", "low"]>
                                            >;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            kind: "recommended_item";
                                            text: string;
                                            sourceIds: string[];
                                            confidence?: "high" | "medium" | "low" | undefined;
                                            rationale?: string | undefined;
                                        },
                                        {
                                            kind: "recommended_item";
                                            text: string;
                                            sourceIds?: string[] | undefined;
                                            confidence?: "high" | "medium" | "low" | undefined;
                                            rationale?: string | undefined;
                                        }
                                    >,
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"no_evidence">;
                                            code: z.ZodEnum<
                                                [
                                                    "no_relevant_evidence",
                                                    "source_unavailable",
                                                    "not_assessed",
                                                ]
                                            >;
                                            note: z.ZodOptional<z.ZodString>;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            code:
                                                | "no_relevant_evidence"
                                                | "source_unavailable"
                                                | "not_assessed";
                                            kind: "no_evidence";
                                            note?: string | undefined;
                                        },
                                        {
                                            code:
                                                | "no_relevant_evidence"
                                                | "source_unavailable"
                                                | "not_assessed";
                                            kind: "no_evidence";
                                            note?: string | undefined;
                                        }
                                    >,
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"human_edit">;
                                            markdown: z.ZodString;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            kind: "human_edit";
                                            markdown: string;
                                        },
                                        {
                                            kind: "human_edit";
                                            markdown: string;
                                        }
                                    >,
                                ]
                            >,
                            "many"
                        >;
                    },
                    "strip",
                    z.ZodTypeAny,
                    {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds: string[];
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    },
                    {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds?: string[] | undefined;
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    }
                >;
                whatCustomersSaid: z.ZodObject<
                    {
                        heading: z.ZodString;
                        items: z.ZodArray<
                            z.ZodDiscriminatedUnion<
                                "kind",
                                [
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"observed_fact">;
                                            text: z.ZodString;
                                            sourceIds: z.ZodArray<z.ZodString, "many">;
                                            confidence: z.ZodEnum<["high", "medium", "low"]>;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: "high" | "medium" | "low";
                                        },
                                        {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: "high" | "medium" | "low";
                                        }
                                    >,
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"recommended_item">;
                                            text: z.ZodString;
                                            rationale: z.ZodOptional<z.ZodString>;
                                            sourceIds: z.ZodDefault<
                                                z.ZodArray<z.ZodString, "many">
                                            >;
                                            confidence: z.ZodOptional<
                                                z.ZodEnum<["high", "medium", "low"]>
                                            >;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            kind: "recommended_item";
                                            text: string;
                                            sourceIds: string[];
                                            confidence?: "high" | "medium" | "low" | undefined;
                                            rationale?: string | undefined;
                                        },
                                        {
                                            kind: "recommended_item";
                                            text: string;
                                            sourceIds?: string[] | undefined;
                                            confidence?: "high" | "medium" | "low" | undefined;
                                            rationale?: string | undefined;
                                        }
                                    >,
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"no_evidence">;
                                            code: z.ZodEnum<
                                                [
                                                    "no_relevant_evidence",
                                                    "source_unavailable",
                                                    "not_assessed",
                                                ]
                                            >;
                                            note: z.ZodOptional<z.ZodString>;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            code:
                                                | "no_relevant_evidence"
                                                | "source_unavailable"
                                                | "not_assessed";
                                            kind: "no_evidence";
                                            note?: string | undefined;
                                        },
                                        {
                                            code:
                                                | "no_relevant_evidence"
                                                | "source_unavailable"
                                                | "not_assessed";
                                            kind: "no_evidence";
                                            note?: string | undefined;
                                        }
                                    >,
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"human_edit">;
                                            markdown: z.ZodString;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            kind: "human_edit";
                                            markdown: string;
                                        },
                                        {
                                            kind: "human_edit";
                                            markdown: string;
                                        }
                                    >,
                                ]
                            >,
                            "many"
                        >;
                    },
                    "strip",
                    z.ZodTypeAny,
                    {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds: string[];
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    },
                    {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds?: string[] | undefined;
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    }
                >;
                currentBlockers: z.ZodObject<
                    {
                        heading: z.ZodString;
                        items: z.ZodArray<
                            z.ZodDiscriminatedUnion<
                                "kind",
                                [
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"observed_fact">;
                                            text: z.ZodString;
                                            sourceIds: z.ZodArray<z.ZodString, "many">;
                                            confidence: z.ZodEnum<["high", "medium", "low"]>;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: "high" | "medium" | "low";
                                        },
                                        {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: "high" | "medium" | "low";
                                        }
                                    >,
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"recommended_item">;
                                            text: z.ZodString;
                                            rationale: z.ZodOptional<z.ZodString>;
                                            sourceIds: z.ZodDefault<
                                                z.ZodArray<z.ZodString, "many">
                                            >;
                                            confidence: z.ZodOptional<
                                                z.ZodEnum<["high", "medium", "low"]>
                                            >;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            kind: "recommended_item";
                                            text: string;
                                            sourceIds: string[];
                                            confidence?: "high" | "medium" | "low" | undefined;
                                            rationale?: string | undefined;
                                        },
                                        {
                                            kind: "recommended_item";
                                            text: string;
                                            sourceIds?: string[] | undefined;
                                            confidence?: "high" | "medium" | "low" | undefined;
                                            rationale?: string | undefined;
                                        }
                                    >,
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"no_evidence">;
                                            code: z.ZodEnum<
                                                [
                                                    "no_relevant_evidence",
                                                    "source_unavailable",
                                                    "not_assessed",
                                                ]
                                            >;
                                            note: z.ZodOptional<z.ZodString>;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            code:
                                                | "no_relevant_evidence"
                                                | "source_unavailable"
                                                | "not_assessed";
                                            kind: "no_evidence";
                                            note?: string | undefined;
                                        },
                                        {
                                            code:
                                                | "no_relevant_evidence"
                                                | "source_unavailable"
                                                | "not_assessed";
                                            kind: "no_evidence";
                                            note?: string | undefined;
                                        }
                                    >,
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"human_edit">;
                                            markdown: z.ZodString;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            kind: "human_edit";
                                            markdown: string;
                                        },
                                        {
                                            kind: "human_edit";
                                            markdown: string;
                                        }
                                    >,
                                ]
                            >,
                            "many"
                        >;
                    },
                    "strip",
                    z.ZodTypeAny,
                    {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds: string[];
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    },
                    {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds?: string[] | undefined;
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    }
                >;
                nextPriorities: z.ZodObject<
                    {
                        heading: z.ZodString;
                        items: z.ZodArray<
                            z.ZodDiscriminatedUnion<
                                "kind",
                                [
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"observed_fact">;
                                            text: z.ZodString;
                                            sourceIds: z.ZodArray<z.ZodString, "many">;
                                            confidence: z.ZodEnum<["high", "medium", "low"]>;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: "high" | "medium" | "low";
                                        },
                                        {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: "high" | "medium" | "low";
                                        }
                                    >,
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"recommended_item">;
                                            text: z.ZodString;
                                            rationale: z.ZodOptional<z.ZodString>;
                                            sourceIds: z.ZodDefault<
                                                z.ZodArray<z.ZodString, "many">
                                            >;
                                            confidence: z.ZodOptional<
                                                z.ZodEnum<["high", "medium", "low"]>
                                            >;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            kind: "recommended_item";
                                            text: string;
                                            sourceIds: string[];
                                            confidence?: "high" | "medium" | "low" | undefined;
                                            rationale?: string | undefined;
                                        },
                                        {
                                            kind: "recommended_item";
                                            text: string;
                                            sourceIds?: string[] | undefined;
                                            confidence?: "high" | "medium" | "low" | undefined;
                                            rationale?: string | undefined;
                                        }
                                    >,
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"no_evidence">;
                                            code: z.ZodEnum<
                                                [
                                                    "no_relevant_evidence",
                                                    "source_unavailable",
                                                    "not_assessed",
                                                ]
                                            >;
                                            note: z.ZodOptional<z.ZodString>;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            code:
                                                | "no_relevant_evidence"
                                                | "source_unavailable"
                                                | "not_assessed";
                                            kind: "no_evidence";
                                            note?: string | undefined;
                                        },
                                        {
                                            code:
                                                | "no_relevant_evidence"
                                                | "source_unavailable"
                                                | "not_assessed";
                                            kind: "no_evidence";
                                            note?: string | undefined;
                                        }
                                    >,
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"human_edit">;
                                            markdown: z.ZodString;
                                        },
                                        "strip",
                                        z.ZodTypeAny,
                                        {
                                            kind: "human_edit";
                                            markdown: string;
                                        },
                                        {
                                            kind: "human_edit";
                                            markdown: string;
                                        }
                                    >,
                                ]
                            >,
                            "many"
                        >;
                    },
                    "strip",
                    z.ZodTypeAny,
                    {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds: string[];
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    },
                    {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds?: string[] | undefined;
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    }
                >;
            },
            "strip",
            z.ZodTypeAny,
            {
                whatChanged: {
                    items: (
                        | {
                              kind: "observed_fact";
                              text: string;
                              sourceIds: string[];
                              confidence: "high" | "medium" | "low";
                          }
                        | {
                              kind: "recommended_item";
                              text: string;
                              sourceIds: string[];
                              confidence?: "high" | "medium" | "low" | undefined;
                              rationale?: string | undefined;
                          }
                        | {
                              code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                              kind: "no_evidence";
                              note?: string | undefined;
                          }
                        | {
                              kind: "human_edit";
                              markdown: string;
                          }
                    )[];
                    heading: string;
                };
                whatShipped: {
                    items: (
                        | {
                              kind: "observed_fact";
                              text: string;
                              sourceIds: string[];
                              confidence: "high" | "medium" | "low";
                          }
                        | {
                              kind: "recommended_item";
                              text: string;
                              sourceIds: string[];
                              confidence?: "high" | "medium" | "low" | undefined;
                              rationale?: string | undefined;
                          }
                        | {
                              code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                              kind: "no_evidence";
                              note?: string | undefined;
                          }
                        | {
                              kind: "human_edit";
                              markdown: string;
                          }
                    )[];
                    heading: string;
                };
                whatCustomersSaid: {
                    items: (
                        | {
                              kind: "observed_fact";
                              text: string;
                              sourceIds: string[];
                              confidence: "high" | "medium" | "low";
                          }
                        | {
                              kind: "recommended_item";
                              text: string;
                              sourceIds: string[];
                              confidence?: "high" | "medium" | "low" | undefined;
                              rationale?: string | undefined;
                          }
                        | {
                              code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                              kind: "no_evidence";
                              note?: string | undefined;
                          }
                        | {
                              kind: "human_edit";
                              markdown: string;
                          }
                    )[];
                    heading: string;
                };
                currentBlockers: {
                    items: (
                        | {
                              kind: "observed_fact";
                              text: string;
                              sourceIds: string[];
                              confidence: "high" | "medium" | "low";
                          }
                        | {
                              kind: "recommended_item";
                              text: string;
                              sourceIds: string[];
                              confidence?: "high" | "medium" | "low" | undefined;
                              rationale?: string | undefined;
                          }
                        | {
                              code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                              kind: "no_evidence";
                              note?: string | undefined;
                          }
                        | {
                              kind: "human_edit";
                              markdown: string;
                          }
                    )[];
                    heading: string;
                };
                nextPriorities: {
                    items: (
                        | {
                              kind: "observed_fact";
                              text: string;
                              sourceIds: string[];
                              confidence: "high" | "medium" | "low";
                          }
                        | {
                              kind: "recommended_item";
                              text: string;
                              sourceIds: string[];
                              confidence?: "high" | "medium" | "low" | undefined;
                              rationale?: string | undefined;
                          }
                        | {
                              code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                              kind: "no_evidence";
                              note?: string | undefined;
                          }
                        | {
                              kind: "human_edit";
                              markdown: string;
                          }
                    )[];
                    heading: string;
                };
            },
            {
                whatChanged: {
                    items: (
                        | {
                              kind: "observed_fact";
                              text: string;
                              sourceIds: string[];
                              confidence: "high" | "medium" | "low";
                          }
                        | {
                              kind: "recommended_item";
                              text: string;
                              sourceIds?: string[] | undefined;
                              confidence?: "high" | "medium" | "low" | undefined;
                              rationale?: string | undefined;
                          }
                        | {
                              code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                              kind: "no_evidence";
                              note?: string | undefined;
                          }
                        | {
                              kind: "human_edit";
                              markdown: string;
                          }
                    )[];
                    heading: string;
                };
                whatShipped: {
                    items: (
                        | {
                              kind: "observed_fact";
                              text: string;
                              sourceIds: string[];
                              confidence: "high" | "medium" | "low";
                          }
                        | {
                              kind: "recommended_item";
                              text: string;
                              sourceIds?: string[] | undefined;
                              confidence?: "high" | "medium" | "low" | undefined;
                              rationale?: string | undefined;
                          }
                        | {
                              code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                              kind: "no_evidence";
                              note?: string | undefined;
                          }
                        | {
                              kind: "human_edit";
                              markdown: string;
                          }
                    )[];
                    heading: string;
                };
                whatCustomersSaid: {
                    items: (
                        | {
                              kind: "observed_fact";
                              text: string;
                              sourceIds: string[];
                              confidence: "high" | "medium" | "low";
                          }
                        | {
                              kind: "recommended_item";
                              text: string;
                              sourceIds?: string[] | undefined;
                              confidence?: "high" | "medium" | "low" | undefined;
                              rationale?: string | undefined;
                          }
                        | {
                              code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                              kind: "no_evidence";
                              note?: string | undefined;
                          }
                        | {
                              kind: "human_edit";
                              markdown: string;
                          }
                    )[];
                    heading: string;
                };
                currentBlockers: {
                    items: (
                        | {
                              kind: "observed_fact";
                              text: string;
                              sourceIds: string[];
                              confidence: "high" | "medium" | "low";
                          }
                        | {
                              kind: "recommended_item";
                              text: string;
                              sourceIds?: string[] | undefined;
                              confidence?: "high" | "medium" | "low" | undefined;
                              rationale?: string | undefined;
                          }
                        | {
                              code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                              kind: "no_evidence";
                              note?: string | undefined;
                          }
                        | {
                              kind: "human_edit";
                              markdown: string;
                          }
                    )[];
                    heading: string;
                };
                nextPriorities: {
                    items: (
                        | {
                              kind: "observed_fact";
                              text: string;
                              sourceIds: string[];
                              confidence: "high" | "medium" | "low";
                          }
                        | {
                              kind: "recommended_item";
                              text: string;
                              sourceIds?: string[] | undefined;
                              confidence?: "high" | "medium" | "low" | undefined;
                              rationale?: string | undefined;
                          }
                        | {
                              code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                              kind: "no_evidence";
                              note?: string | undefined;
                          }
                        | {
                              kind: "human_edit";
                              markdown: string;
                          }
                    )[];
                    heading: string;
                };
            }
        >;
    },
    "strip",
    z.ZodTypeAny,
    {
        schemaVersion: "founder-weekly-review/v1";
        sections: {
            whatChanged: {
                items: (
                    | {
                          kind: "observed_fact";
                          text: string;
                          sourceIds: string[];
                          confidence: "high" | "medium" | "low";
                      }
                    | {
                          kind: "recommended_item";
                          text: string;
                          sourceIds: string[];
                          confidence?: "high" | "medium" | "low" | undefined;
                          rationale?: string | undefined;
                      }
                    | {
                          code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                          kind: "no_evidence";
                          note?: string | undefined;
                      }
                    | {
                          kind: "human_edit";
                          markdown: string;
                      }
                )[];
                heading: string;
            };
            whatShipped: {
                items: (
                    | {
                          kind: "observed_fact";
                          text: string;
                          sourceIds: string[];
                          confidence: "high" | "medium" | "low";
                      }
                    | {
                          kind: "recommended_item";
                          text: string;
                          sourceIds: string[];
                          confidence?: "high" | "medium" | "low" | undefined;
                          rationale?: string | undefined;
                      }
                    | {
                          code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                          kind: "no_evidence";
                          note?: string | undefined;
                      }
                    | {
                          kind: "human_edit";
                          markdown: string;
                      }
                )[];
                heading: string;
            };
            whatCustomersSaid: {
                items: (
                    | {
                          kind: "observed_fact";
                          text: string;
                          sourceIds: string[];
                          confidence: "high" | "medium" | "low";
                      }
                    | {
                          kind: "recommended_item";
                          text: string;
                          sourceIds: string[];
                          confidence?: "high" | "medium" | "low" | undefined;
                          rationale?: string | undefined;
                      }
                    | {
                          code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                          kind: "no_evidence";
                          note?: string | undefined;
                      }
                    | {
                          kind: "human_edit";
                          markdown: string;
                      }
                )[];
                heading: string;
            };
            currentBlockers: {
                items: (
                    | {
                          kind: "observed_fact";
                          text: string;
                          sourceIds: string[];
                          confidence: "high" | "medium" | "low";
                      }
                    | {
                          kind: "recommended_item";
                          text: string;
                          sourceIds: string[];
                          confidence?: "high" | "medium" | "low" | undefined;
                          rationale?: string | undefined;
                      }
                    | {
                          code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                          kind: "no_evidence";
                          note?: string | undefined;
                      }
                    | {
                          kind: "human_edit";
                          markdown: string;
                      }
                )[];
                heading: string;
            };
            nextPriorities: {
                items: (
                    | {
                          kind: "observed_fact";
                          text: string;
                          sourceIds: string[];
                          confidence: "high" | "medium" | "low";
                      }
                    | {
                          kind: "recommended_item";
                          text: string;
                          sourceIds: string[];
                          confidence?: "high" | "medium" | "low" | undefined;
                          rationale?: string | undefined;
                      }
                    | {
                          code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                          kind: "no_evidence";
                          note?: string | undefined;
                      }
                    | {
                          kind: "human_edit";
                          markdown: string;
                      }
                )[];
                heading: string;
            };
        };
    },
    {
        schemaVersion: "founder-weekly-review/v1";
        sections: {
            whatChanged: {
                items: (
                    | {
                          kind: "observed_fact";
                          text: string;
                          sourceIds: string[];
                          confidence: "high" | "medium" | "low";
                      }
                    | {
                          kind: "recommended_item";
                          text: string;
                          sourceIds?: string[] | undefined;
                          confidence?: "high" | "medium" | "low" | undefined;
                          rationale?: string | undefined;
                      }
                    | {
                          code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                          kind: "no_evidence";
                          note?: string | undefined;
                      }
                    | {
                          kind: "human_edit";
                          markdown: string;
                      }
                )[];
                heading: string;
            };
            whatShipped: {
                items: (
                    | {
                          kind: "observed_fact";
                          text: string;
                          sourceIds: string[];
                          confidence: "high" | "medium" | "low";
                      }
                    | {
                          kind: "recommended_item";
                          text: string;
                          sourceIds?: string[] | undefined;
                          confidence?: "high" | "medium" | "low" | undefined;
                          rationale?: string | undefined;
                      }
                    | {
                          code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                          kind: "no_evidence";
                          note?: string | undefined;
                      }
                    | {
                          kind: "human_edit";
                          markdown: string;
                      }
                )[];
                heading: string;
            };
            whatCustomersSaid: {
                items: (
                    | {
                          kind: "observed_fact";
                          text: string;
                          sourceIds: string[];
                          confidence: "high" | "medium" | "low";
                      }
                    | {
                          kind: "recommended_item";
                          text: string;
                          sourceIds?: string[] | undefined;
                          confidence?: "high" | "medium" | "low" | undefined;
                          rationale?: string | undefined;
                      }
                    | {
                          code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                          kind: "no_evidence";
                          note?: string | undefined;
                      }
                    | {
                          kind: "human_edit";
                          markdown: string;
                      }
                )[];
                heading: string;
            };
            currentBlockers: {
                items: (
                    | {
                          kind: "observed_fact";
                          text: string;
                          sourceIds: string[];
                          confidence: "high" | "medium" | "low";
                      }
                    | {
                          kind: "recommended_item";
                          text: string;
                          sourceIds?: string[] | undefined;
                          confidence?: "high" | "medium" | "low" | undefined;
                          rationale?: string | undefined;
                      }
                    | {
                          code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                          kind: "no_evidence";
                          note?: string | undefined;
                      }
                    | {
                          kind: "human_edit";
                          markdown: string;
                      }
                )[];
                heading: string;
            };
            nextPriorities: {
                items: (
                    | {
                          kind: "observed_fact";
                          text: string;
                          sourceIds: string[];
                          confidence: "high" | "medium" | "low";
                      }
                    | {
                          kind: "recommended_item";
                          text: string;
                          sourceIds?: string[] | undefined;
                          confidence?: "high" | "medium" | "low" | undefined;
                          rationale?: string | undefined;
                      }
                    | {
                          code: "no_relevant_evidence" | "source_unavailable" | "not_assessed";
                          kind: "no_evidence";
                          note?: string | undefined;
                      }
                    | {
                          kind: "human_edit";
                          markdown: string;
                      }
                )[];
                heading: string;
            };
        };
    }
>;
export type FounderWeeklyReviewV1Payload = z.infer<typeof FounderWeeklyReviewV1PayloadSchema>;
export declare const FounderWeeklyReviewV2ObservedFactSchema: z.ZodObject<
    {
        kind: z.ZodLiteral<"observed_fact">;
        text: z.ZodString;
        sourceIds: z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], string[]>;
        confidence: z.ZodNumber;
    },
    "strict",
    z.ZodTypeAny,
    {
        kind: "observed_fact";
        text: string;
        sourceIds: string[];
        confidence: number;
    },
    {
        kind: "observed_fact";
        text: string;
        sourceIds: string[];
        confidence: number;
    }
>;
export declare const FounderWeeklyReviewV2ContradictoryEvidenceSchema: z.ZodObject<
    {
        kind: z.ZodLiteral<"contradictory_evidence">;
        text: z.ZodString;
        sourceIds: z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], string[]>;
        confidence: z.ZodNumber;
    },
    "strict",
    z.ZodTypeAny,
    {
        kind: "contradictory_evidence";
        text: string;
        sourceIds: string[];
        confidence: number;
    },
    {
        kind: "contradictory_evidence";
        text: string;
        sourceIds: string[];
        confidence: number;
    }
>;
export declare const FounderWeeklyReviewV2RecommendationSchema: z.ZodObject<
    {
        kind: z.ZodLiteral<"recommendation">;
        label: z.ZodLiteral<"Recommendation">;
        text: z.ZodString;
        rationale: z.ZodOptional<z.ZodString>;
        sourceIds: z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], string[]>;
        confidence: z.ZodNumber;
    },
    "strict",
    z.ZodTypeAny,
    {
        kind: "recommendation";
        text: string;
        sourceIds: string[];
        confidence: number;
        label: "Recommendation";
        rationale?: string | undefined;
    },
    {
        kind: "recommendation";
        text: string;
        sourceIds: string[];
        confidence: number;
        label: "Recommendation";
        rationale?: string | undefined;
    }
>;
export declare const FounderWeeklyReviewV2NoEvidenceSchema: z.ZodObject<
    {
        code: z.ZodString;
        message: z.ZodString;
        cta: z.ZodString;
    },
    "strict",
    z.ZodTypeAny,
    {
        code: string;
        message: string;
        cta: string;
    },
    {
        code: string;
        message: string;
        cta: string;
    }
>;
export declare const FounderWeeklyReviewV2PayloadSchema: z.ZodObject<
    {
        schemaVersion: z.ZodLiteral<"founder-weekly-review/v2">;
        sections: z.ZodObject<
            {
                whatChanged: z.ZodUnion<
                    [
                        z.ZodObject<
                            {
                                state: z.ZodLiteral<"evidence">;
                                items: z.ZodArray<
                                    z.ZodUnion<
                                        [
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"observed_fact">;
                                                    text: z.ZodString;
                                                    sourceIds: z.ZodEffects<
                                                        z.ZodArray<z.ZodString, "many">,
                                                        string[],
                                                        string[]
                                                    >;
                                                    confidence: z.ZodNumber;
                                                },
                                                "strict",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                },
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"contradictory_evidence">;
                                                    text: z.ZodString;
                                                    sourceIds: z.ZodEffects<
                                                        z.ZodArray<z.ZodString, "many">,
                                                        string[],
                                                        string[]
                                                    >;
                                                    confidence: z.ZodNumber;
                                                },
                                                "strict",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "contradictory_evidence";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                },
                                                {
                                                    kind: "contradictory_evidence";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                }
                                            >,
                                        ]
                                    >,
                                    "many"
                                >;
                            },
                            "strict",
                            z.ZodTypeAny,
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                    | {
                                          kind: "contradictory_evidence";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                )[];
                                state: "evidence";
                            },
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                    | {
                                          kind: "contradictory_evidence";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                )[];
                                state: "evidence";
                            }
                        >,
                        z.ZodObject<
                            {
                                state: z.ZodLiteral<"no_evidence">;
                                noEvidence: z.ZodObject<
                                    {
                                        code: z.ZodString;
                                        message: z.ZodString;
                                        cta: z.ZodString;
                                    },
                                    "strict",
                                    z.ZodTypeAny,
                                    {
                                        code: string;
                                        message: string;
                                        cta: string;
                                    },
                                    {
                                        code: string;
                                        message: string;
                                        cta: string;
                                    }
                                >;
                            },
                            "strict",
                            z.ZodTypeAny,
                            {
                                state: "no_evidence";
                                noEvidence: {
                                    code: string;
                                    message: string;
                                    cta: string;
                                };
                            },
                            {
                                state: "no_evidence";
                                noEvidence: {
                                    code: string;
                                    message: string;
                                    cta: string;
                                };
                            }
                        >,
                    ]
                >;
                whatShipped: z.ZodUnion<
                    [
                        z.ZodObject<
                            {
                                state: z.ZodLiteral<"evidence">;
                                items: z.ZodArray<
                                    z.ZodUnion<
                                        [
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"observed_fact">;
                                                    text: z.ZodString;
                                                    sourceIds: z.ZodEffects<
                                                        z.ZodArray<z.ZodString, "many">,
                                                        string[],
                                                        string[]
                                                    >;
                                                    confidence: z.ZodNumber;
                                                },
                                                "strict",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                },
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"contradictory_evidence">;
                                                    text: z.ZodString;
                                                    sourceIds: z.ZodEffects<
                                                        z.ZodArray<z.ZodString, "many">,
                                                        string[],
                                                        string[]
                                                    >;
                                                    confidence: z.ZodNumber;
                                                },
                                                "strict",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "contradictory_evidence";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                },
                                                {
                                                    kind: "contradictory_evidence";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                }
                                            >,
                                        ]
                                    >,
                                    "many"
                                >;
                            },
                            "strict",
                            z.ZodTypeAny,
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                    | {
                                          kind: "contradictory_evidence";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                )[];
                                state: "evidence";
                            },
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                    | {
                                          kind: "contradictory_evidence";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                )[];
                                state: "evidence";
                            }
                        >,
                        z.ZodObject<
                            {
                                state: z.ZodLiteral<"no_evidence">;
                                noEvidence: z.ZodObject<
                                    {
                                        code: z.ZodString;
                                        message: z.ZodString;
                                        cta: z.ZodString;
                                    },
                                    "strict",
                                    z.ZodTypeAny,
                                    {
                                        code: string;
                                        message: string;
                                        cta: string;
                                    },
                                    {
                                        code: string;
                                        message: string;
                                        cta: string;
                                    }
                                >;
                            },
                            "strict",
                            z.ZodTypeAny,
                            {
                                state: "no_evidence";
                                noEvidence: {
                                    code: string;
                                    message: string;
                                    cta: string;
                                };
                            },
                            {
                                state: "no_evidence";
                                noEvidence: {
                                    code: string;
                                    message: string;
                                    cta: string;
                                };
                            }
                        >,
                    ]
                >;
                whatCustomersSaid: z.ZodUnion<
                    [
                        z.ZodObject<
                            {
                                state: z.ZodLiteral<"evidence">;
                                items: z.ZodArray<
                                    z.ZodUnion<
                                        [
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"observed_fact">;
                                                    text: z.ZodString;
                                                    sourceIds: z.ZodEffects<
                                                        z.ZodArray<z.ZodString, "many">,
                                                        string[],
                                                        string[]
                                                    >;
                                                    confidence: z.ZodNumber;
                                                },
                                                "strict",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                },
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"contradictory_evidence">;
                                                    text: z.ZodString;
                                                    sourceIds: z.ZodEffects<
                                                        z.ZodArray<z.ZodString, "many">,
                                                        string[],
                                                        string[]
                                                    >;
                                                    confidence: z.ZodNumber;
                                                },
                                                "strict",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "contradictory_evidence";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                },
                                                {
                                                    kind: "contradictory_evidence";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                }
                                            >,
                                        ]
                                    >,
                                    "many"
                                >;
                            },
                            "strict",
                            z.ZodTypeAny,
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                    | {
                                          kind: "contradictory_evidence";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                )[];
                                state: "evidence";
                            },
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                    | {
                                          kind: "contradictory_evidence";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                )[];
                                state: "evidence";
                            }
                        >,
                        z.ZodObject<
                            {
                                state: z.ZodLiteral<"no_evidence">;
                                noEvidence: z.ZodObject<
                                    {
                                        code: z.ZodString;
                                        message: z.ZodString;
                                        cta: z.ZodString;
                                    },
                                    "strict",
                                    z.ZodTypeAny,
                                    {
                                        code: string;
                                        message: string;
                                        cta: string;
                                    },
                                    {
                                        code: string;
                                        message: string;
                                        cta: string;
                                    }
                                >;
                            },
                            "strict",
                            z.ZodTypeAny,
                            {
                                state: "no_evidence";
                                noEvidence: {
                                    code: string;
                                    message: string;
                                    cta: string;
                                };
                            },
                            {
                                state: "no_evidence";
                                noEvidence: {
                                    code: string;
                                    message: string;
                                    cta: string;
                                };
                            }
                        >,
                    ]
                >;
                currentBlockers: z.ZodUnion<
                    [
                        z.ZodObject<
                            {
                                state: z.ZodLiteral<"evidence">;
                                items: z.ZodArray<
                                    z.ZodUnion<
                                        [
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"observed_fact">;
                                                    text: z.ZodString;
                                                    sourceIds: z.ZodEffects<
                                                        z.ZodArray<z.ZodString, "many">,
                                                        string[],
                                                        string[]
                                                    >;
                                                    confidence: z.ZodNumber;
                                                },
                                                "strict",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                },
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"contradictory_evidence">;
                                                    text: z.ZodString;
                                                    sourceIds: z.ZodEffects<
                                                        z.ZodArray<z.ZodString, "many">,
                                                        string[],
                                                        string[]
                                                    >;
                                                    confidence: z.ZodNumber;
                                                },
                                                "strict",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "contradictory_evidence";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                },
                                                {
                                                    kind: "contradictory_evidence";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                }
                                            >,
                                        ]
                                    >,
                                    "many"
                                >;
                            },
                            "strict",
                            z.ZodTypeAny,
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                    | {
                                          kind: "contradictory_evidence";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                )[];
                                state: "evidence";
                            },
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                    | {
                                          kind: "contradictory_evidence";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: number;
                                      }
                                )[];
                                state: "evidence";
                            }
                        >,
                        z.ZodObject<
                            {
                                state: z.ZodLiteral<"no_evidence">;
                                noEvidence: z.ZodObject<
                                    {
                                        code: z.ZodString;
                                        message: z.ZodString;
                                        cta: z.ZodString;
                                    },
                                    "strict",
                                    z.ZodTypeAny,
                                    {
                                        code: string;
                                        message: string;
                                        cta: string;
                                    },
                                    {
                                        code: string;
                                        message: string;
                                        cta: string;
                                    }
                                >;
                            },
                            "strict",
                            z.ZodTypeAny,
                            {
                                state: "no_evidence";
                                noEvidence: {
                                    code: string;
                                    message: string;
                                    cta: string;
                                };
                            },
                            {
                                state: "no_evidence";
                                noEvidence: {
                                    code: string;
                                    message: string;
                                    cta: string;
                                };
                            }
                        >,
                    ]
                >;
                nextPriorities: z.ZodUnion<
                    [
                        z.ZodObject<
                            {
                                state: z.ZodLiteral<"evidence">;
                                items: z.ZodArray<
                                    z.ZodObject<
                                        {
                                            kind: z.ZodLiteral<"recommendation">;
                                            label: z.ZodLiteral<"Recommendation">;
                                            text: z.ZodString;
                                            rationale: z.ZodOptional<z.ZodString>;
                                            sourceIds: z.ZodEffects<
                                                z.ZodArray<z.ZodString, "many">,
                                                string[],
                                                string[]
                                            >;
                                            confidence: z.ZodNumber;
                                        },
                                        "strict",
                                        z.ZodTypeAny,
                                        {
                                            kind: "recommendation";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                            label: "Recommendation";
                                            rationale?: string | undefined;
                                        },
                                        {
                                            kind: "recommendation";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                            label: "Recommendation";
                                            rationale?: string | undefined;
                                        }
                                    >,
                                    "many"
                                >;
                            },
                            "strict",
                            z.ZodTypeAny,
                            {
                                items: {
                                    kind: "recommendation";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                    label: "Recommendation";
                                    rationale?: string | undefined;
                                }[];
                                state: "evidence";
                            },
                            {
                                items: {
                                    kind: "recommendation";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                    label: "Recommendation";
                                    rationale?: string | undefined;
                                }[];
                                state: "evidence";
                            }
                        >,
                        z.ZodObject<
                            {
                                state: z.ZodLiteral<"no_evidence">;
                                noEvidence: z.ZodObject<
                                    {
                                        code: z.ZodString;
                                        message: z.ZodString;
                                        cta: z.ZodString;
                                    },
                                    "strict",
                                    z.ZodTypeAny,
                                    {
                                        code: string;
                                        message: string;
                                        cta: string;
                                    },
                                    {
                                        code: string;
                                        message: string;
                                        cta: string;
                                    }
                                >;
                            },
                            "strict",
                            z.ZodTypeAny,
                            {
                                state: "no_evidence";
                                noEvidence: {
                                    code: string;
                                    message: string;
                                    cta: string;
                                };
                            },
                            {
                                state: "no_evidence";
                                noEvidence: {
                                    code: string;
                                    message: string;
                                    cta: string;
                                };
                            }
                        >,
                    ]
                >;
            },
            "strict",
            z.ZodTypeAny,
            {
                whatChanged:
                    | {
                          state: "no_evidence";
                          noEvidence: {
                              code: string;
                              message: string;
                              cta: string;
                          };
                      }
                    | {
                          items: (
                              | {
                                    kind: "observed_fact";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                              | {
                                    kind: "contradictory_evidence";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                          )[];
                          state: "evidence";
                      };
                whatShipped:
                    | {
                          state: "no_evidence";
                          noEvidence: {
                              code: string;
                              message: string;
                              cta: string;
                          };
                      }
                    | {
                          items: (
                              | {
                                    kind: "observed_fact";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                              | {
                                    kind: "contradictory_evidence";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                          )[];
                          state: "evidence";
                      };
                whatCustomersSaid:
                    | {
                          state: "no_evidence";
                          noEvidence: {
                              code: string;
                              message: string;
                              cta: string;
                          };
                      }
                    | {
                          items: (
                              | {
                                    kind: "observed_fact";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                              | {
                                    kind: "contradictory_evidence";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                          )[];
                          state: "evidence";
                      };
                currentBlockers:
                    | {
                          state: "no_evidence";
                          noEvidence: {
                              code: string;
                              message: string;
                              cta: string;
                          };
                      }
                    | {
                          items: (
                              | {
                                    kind: "observed_fact";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                              | {
                                    kind: "contradictory_evidence";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                          )[];
                          state: "evidence";
                      };
                nextPriorities:
                    | {
                          state: "no_evidence";
                          noEvidence: {
                              code: string;
                              message: string;
                              cta: string;
                          };
                      }
                    | {
                          items: {
                              kind: "recommendation";
                              text: string;
                              sourceIds: string[];
                              confidence: number;
                              label: "Recommendation";
                              rationale?: string | undefined;
                          }[];
                          state: "evidence";
                      };
            },
            {
                whatChanged:
                    | {
                          state: "no_evidence";
                          noEvidence: {
                              code: string;
                              message: string;
                              cta: string;
                          };
                      }
                    | {
                          items: (
                              | {
                                    kind: "observed_fact";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                              | {
                                    kind: "contradictory_evidence";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                          )[];
                          state: "evidence";
                      };
                whatShipped:
                    | {
                          state: "no_evidence";
                          noEvidence: {
                              code: string;
                              message: string;
                              cta: string;
                          };
                      }
                    | {
                          items: (
                              | {
                                    kind: "observed_fact";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                              | {
                                    kind: "contradictory_evidence";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                          )[];
                          state: "evidence";
                      };
                whatCustomersSaid:
                    | {
                          state: "no_evidence";
                          noEvidence: {
                              code: string;
                              message: string;
                              cta: string;
                          };
                      }
                    | {
                          items: (
                              | {
                                    kind: "observed_fact";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                              | {
                                    kind: "contradictory_evidence";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                          )[];
                          state: "evidence";
                      };
                currentBlockers:
                    | {
                          state: "no_evidence";
                          noEvidence: {
                              code: string;
                              message: string;
                              cta: string;
                          };
                      }
                    | {
                          items: (
                              | {
                                    kind: "observed_fact";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                              | {
                                    kind: "contradictory_evidence";
                                    text: string;
                                    sourceIds: string[];
                                    confidence: number;
                                }
                          )[];
                          state: "evidence";
                      };
                nextPriorities:
                    | {
                          state: "no_evidence";
                          noEvidence: {
                              code: string;
                              message: string;
                              cta: string;
                          };
                      }
                    | {
                          items: {
                              kind: "recommendation";
                              text: string;
                              sourceIds: string[];
                              confidence: number;
                              label: "Recommendation";
                              rationale?: string | undefined;
                          }[];
                          state: "evidence";
                      };
            }
        >;
    },
    "strict",
    z.ZodTypeAny,
    {
        schemaVersion: "founder-weekly-review/v2";
        sections: {
            whatChanged:
                | {
                      state: "no_evidence";
                      noEvidence: {
                          code: string;
                          message: string;
                          cta: string;
                      };
                  }
                | {
                      items: (
                          | {
                                kind: "observed_fact";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                          | {
                                kind: "contradictory_evidence";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                      )[];
                      state: "evidence";
                  };
            whatShipped:
                | {
                      state: "no_evidence";
                      noEvidence: {
                          code: string;
                          message: string;
                          cta: string;
                      };
                  }
                | {
                      items: (
                          | {
                                kind: "observed_fact";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                          | {
                                kind: "contradictory_evidence";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                      )[];
                      state: "evidence";
                  };
            whatCustomersSaid:
                | {
                      state: "no_evidence";
                      noEvidence: {
                          code: string;
                          message: string;
                          cta: string;
                      };
                  }
                | {
                      items: (
                          | {
                                kind: "observed_fact";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                          | {
                                kind: "contradictory_evidence";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                      )[];
                      state: "evidence";
                  };
            currentBlockers:
                | {
                      state: "no_evidence";
                      noEvidence: {
                          code: string;
                          message: string;
                          cta: string;
                      };
                  }
                | {
                      items: (
                          | {
                                kind: "observed_fact";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                          | {
                                kind: "contradictory_evidence";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                      )[];
                      state: "evidence";
                  };
            nextPriorities:
                | {
                      state: "no_evidence";
                      noEvidence: {
                          code: string;
                          message: string;
                          cta: string;
                      };
                  }
                | {
                      items: {
                          kind: "recommendation";
                          text: string;
                          sourceIds: string[];
                          confidence: number;
                          label: "Recommendation";
                          rationale?: string | undefined;
                      }[];
                      state: "evidence";
                  };
        };
    },
    {
        schemaVersion: "founder-weekly-review/v2";
        sections: {
            whatChanged:
                | {
                      state: "no_evidence";
                      noEvidence: {
                          code: string;
                          message: string;
                          cta: string;
                      };
                  }
                | {
                      items: (
                          | {
                                kind: "observed_fact";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                          | {
                                kind: "contradictory_evidence";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                      )[];
                      state: "evidence";
                  };
            whatShipped:
                | {
                      state: "no_evidence";
                      noEvidence: {
                          code: string;
                          message: string;
                          cta: string;
                      };
                  }
                | {
                      items: (
                          | {
                                kind: "observed_fact";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                          | {
                                kind: "contradictory_evidence";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                      )[];
                      state: "evidence";
                  };
            whatCustomersSaid:
                | {
                      state: "no_evidence";
                      noEvidence: {
                          code: string;
                          message: string;
                          cta: string;
                      };
                  }
                | {
                      items: (
                          | {
                                kind: "observed_fact";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                          | {
                                kind: "contradictory_evidence";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                      )[];
                      state: "evidence";
                  };
            currentBlockers:
                | {
                      state: "no_evidence";
                      noEvidence: {
                          code: string;
                          message: string;
                          cta: string;
                      };
                  }
                | {
                      items: (
                          | {
                                kind: "observed_fact";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                          | {
                                kind: "contradictory_evidence";
                                text: string;
                                sourceIds: string[];
                                confidence: number;
                            }
                      )[];
                      state: "evidence";
                  };
            nextPriorities:
                | {
                      state: "no_evidence";
                      noEvidence: {
                          code: string;
                          message: string;
                          cta: string;
                      };
                  }
                | {
                      items: {
                          kind: "recommendation";
                          text: string;
                          sourceIds: string[];
                          confidence: number;
                          label: "Recommendation";
                          rationale?: string | undefined;
                      }[];
                      state: "evidence";
                  };
        };
    }
>;
export type FounderWeeklyReviewV2Payload = z.infer<typeof FounderWeeklyReviewV2PayloadSchema>;
export declare const FounderWeeklyReviewPayloadSchema: z.ZodUnion<
    [
        z.ZodObject<
            {
                schemaVersion: z.ZodLiteral<"founder-weekly-review/v1">;
                sections: z.ZodObject<
                    {
                        whatChanged: z.ZodObject<
                            {
                                heading: z.ZodString;
                                items: z.ZodArray<
                                    z.ZodDiscriminatedUnion<
                                        "kind",
                                        [
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"observed_fact">;
                                                    text: z.ZodString;
                                                    sourceIds: z.ZodArray<z.ZodString, "many">;
                                                    confidence: z.ZodEnum<
                                                        ["high", "medium", "low"]
                                                    >;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: "high" | "medium" | "low";
                                                },
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: "high" | "medium" | "low";
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"recommended_item">;
                                                    text: z.ZodString;
                                                    rationale: z.ZodOptional<z.ZodString>;
                                                    sourceIds: z.ZodDefault<
                                                        z.ZodArray<z.ZodString, "many">
                                                    >;
                                                    confidence: z.ZodOptional<
                                                        z.ZodEnum<["high", "medium", "low"]>
                                                    >;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "recommended_item";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence?:
                                                        | "high"
                                                        | "medium"
                                                        | "low"
                                                        | undefined;
                                                    rationale?: string | undefined;
                                                },
                                                {
                                                    kind: "recommended_item";
                                                    text: string;
                                                    sourceIds?: string[] | undefined;
                                                    confidence?:
                                                        | "high"
                                                        | "medium"
                                                        | "low"
                                                        | undefined;
                                                    rationale?: string | undefined;
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"no_evidence">;
                                                    code: z.ZodEnum<
                                                        [
                                                            "no_relevant_evidence",
                                                            "source_unavailable",
                                                            "not_assessed",
                                                        ]
                                                    >;
                                                    note: z.ZodOptional<z.ZodString>;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    code:
                                                        | "no_relevant_evidence"
                                                        | "source_unavailable"
                                                        | "not_assessed";
                                                    kind: "no_evidence";
                                                    note?: string | undefined;
                                                },
                                                {
                                                    code:
                                                        | "no_relevant_evidence"
                                                        | "source_unavailable"
                                                        | "not_assessed";
                                                    kind: "no_evidence";
                                                    note?: string | undefined;
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"human_edit">;
                                                    markdown: z.ZodString;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "human_edit";
                                                    markdown: string;
                                                },
                                                {
                                                    kind: "human_edit";
                                                    markdown: string;
                                                }
                                            >,
                                        ]
                                    >,
                                    "many"
                                >;
                            },
                            "strip",
                            z.ZodTypeAny,
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: "high" | "medium" | "low";
                                      }
                                    | {
                                          kind: "recommended_item";
                                          text: string;
                                          sourceIds: string[];
                                          confidence?: "high" | "medium" | "low" | undefined;
                                          rationale?: string | undefined;
                                      }
                                    | {
                                          code:
                                              | "no_relevant_evidence"
                                              | "source_unavailable"
                                              | "not_assessed";
                                          kind: "no_evidence";
                                          note?: string | undefined;
                                      }
                                    | {
                                          kind: "human_edit";
                                          markdown: string;
                                      }
                                )[];
                                heading: string;
                            },
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: "high" | "medium" | "low";
                                      }
                                    | {
                                          kind: "recommended_item";
                                          text: string;
                                          sourceIds?: string[] | undefined;
                                          confidence?: "high" | "medium" | "low" | undefined;
                                          rationale?: string | undefined;
                                      }
                                    | {
                                          code:
                                              | "no_relevant_evidence"
                                              | "source_unavailable"
                                              | "not_assessed";
                                          kind: "no_evidence";
                                          note?: string | undefined;
                                      }
                                    | {
                                          kind: "human_edit";
                                          markdown: string;
                                      }
                                )[];
                                heading: string;
                            }
                        >;
                        whatShipped: z.ZodObject<
                            {
                                heading: z.ZodString;
                                items: z.ZodArray<
                                    z.ZodDiscriminatedUnion<
                                        "kind",
                                        [
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"observed_fact">;
                                                    text: z.ZodString;
                                                    sourceIds: z.ZodArray<z.ZodString, "many">;
                                                    confidence: z.ZodEnum<
                                                        ["high", "medium", "low"]
                                                    >;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: "high" | "medium" | "low";
                                                },
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: "high" | "medium" | "low";
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"recommended_item">;
                                                    text: z.ZodString;
                                                    rationale: z.ZodOptional<z.ZodString>;
                                                    sourceIds: z.ZodDefault<
                                                        z.ZodArray<z.ZodString, "many">
                                                    >;
                                                    confidence: z.ZodOptional<
                                                        z.ZodEnum<["high", "medium", "low"]>
                                                    >;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "recommended_item";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence?:
                                                        | "high"
                                                        | "medium"
                                                        | "low"
                                                        | undefined;
                                                    rationale?: string | undefined;
                                                },
                                                {
                                                    kind: "recommended_item";
                                                    text: string;
                                                    sourceIds?: string[] | undefined;
                                                    confidence?:
                                                        | "high"
                                                        | "medium"
                                                        | "low"
                                                        | undefined;
                                                    rationale?: string | undefined;
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"no_evidence">;
                                                    code: z.ZodEnum<
                                                        [
                                                            "no_relevant_evidence",
                                                            "source_unavailable",
                                                            "not_assessed",
                                                        ]
                                                    >;
                                                    note: z.ZodOptional<z.ZodString>;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    code:
                                                        | "no_relevant_evidence"
                                                        | "source_unavailable"
                                                        | "not_assessed";
                                                    kind: "no_evidence";
                                                    note?: string | undefined;
                                                },
                                                {
                                                    code:
                                                        | "no_relevant_evidence"
                                                        | "source_unavailable"
                                                        | "not_assessed";
                                                    kind: "no_evidence";
                                                    note?: string | undefined;
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"human_edit">;
                                                    markdown: z.ZodString;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "human_edit";
                                                    markdown: string;
                                                },
                                                {
                                                    kind: "human_edit";
                                                    markdown: string;
                                                }
                                            >,
                                        ]
                                    >,
                                    "many"
                                >;
                            },
                            "strip",
                            z.ZodTypeAny,
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: "high" | "medium" | "low";
                                      }
                                    | {
                                          kind: "recommended_item";
                                          text: string;
                                          sourceIds: string[];
                                          confidence?: "high" | "medium" | "low" | undefined;
                                          rationale?: string | undefined;
                                      }
                                    | {
                                          code:
                                              | "no_relevant_evidence"
                                              | "source_unavailable"
                                              | "not_assessed";
                                          kind: "no_evidence";
                                          note?: string | undefined;
                                      }
                                    | {
                                          kind: "human_edit";
                                          markdown: string;
                                      }
                                )[];
                                heading: string;
                            },
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: "high" | "medium" | "low";
                                      }
                                    | {
                                          kind: "recommended_item";
                                          text: string;
                                          sourceIds?: string[] | undefined;
                                          confidence?: "high" | "medium" | "low" | undefined;
                                          rationale?: string | undefined;
                                      }
                                    | {
                                          code:
                                              | "no_relevant_evidence"
                                              | "source_unavailable"
                                              | "not_assessed";
                                          kind: "no_evidence";
                                          note?: string | undefined;
                                      }
                                    | {
                                          kind: "human_edit";
                                          markdown: string;
                                      }
                                )[];
                                heading: string;
                            }
                        >;
                        whatCustomersSaid: z.ZodObject<
                            {
                                heading: z.ZodString;
                                items: z.ZodArray<
                                    z.ZodDiscriminatedUnion<
                                        "kind",
                                        [
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"observed_fact">;
                                                    text: z.ZodString;
                                                    sourceIds: z.ZodArray<z.ZodString, "many">;
                                                    confidence: z.ZodEnum<
                                                        ["high", "medium", "low"]
                                                    >;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: "high" | "medium" | "low";
                                                },
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: "high" | "medium" | "low";
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"recommended_item">;
                                                    text: z.ZodString;
                                                    rationale: z.ZodOptional<z.ZodString>;
                                                    sourceIds: z.ZodDefault<
                                                        z.ZodArray<z.ZodString, "many">
                                                    >;
                                                    confidence: z.ZodOptional<
                                                        z.ZodEnum<["high", "medium", "low"]>
                                                    >;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "recommended_item";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence?:
                                                        | "high"
                                                        | "medium"
                                                        | "low"
                                                        | undefined;
                                                    rationale?: string | undefined;
                                                },
                                                {
                                                    kind: "recommended_item";
                                                    text: string;
                                                    sourceIds?: string[] | undefined;
                                                    confidence?:
                                                        | "high"
                                                        | "medium"
                                                        | "low"
                                                        | undefined;
                                                    rationale?: string | undefined;
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"no_evidence">;
                                                    code: z.ZodEnum<
                                                        [
                                                            "no_relevant_evidence",
                                                            "source_unavailable",
                                                            "not_assessed",
                                                        ]
                                                    >;
                                                    note: z.ZodOptional<z.ZodString>;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    code:
                                                        | "no_relevant_evidence"
                                                        | "source_unavailable"
                                                        | "not_assessed";
                                                    kind: "no_evidence";
                                                    note?: string | undefined;
                                                },
                                                {
                                                    code:
                                                        | "no_relevant_evidence"
                                                        | "source_unavailable"
                                                        | "not_assessed";
                                                    kind: "no_evidence";
                                                    note?: string | undefined;
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"human_edit">;
                                                    markdown: z.ZodString;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "human_edit";
                                                    markdown: string;
                                                },
                                                {
                                                    kind: "human_edit";
                                                    markdown: string;
                                                }
                                            >,
                                        ]
                                    >,
                                    "many"
                                >;
                            },
                            "strip",
                            z.ZodTypeAny,
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: "high" | "medium" | "low";
                                      }
                                    | {
                                          kind: "recommended_item";
                                          text: string;
                                          sourceIds: string[];
                                          confidence?: "high" | "medium" | "low" | undefined;
                                          rationale?: string | undefined;
                                      }
                                    | {
                                          code:
                                              | "no_relevant_evidence"
                                              | "source_unavailable"
                                              | "not_assessed";
                                          kind: "no_evidence";
                                          note?: string | undefined;
                                      }
                                    | {
                                          kind: "human_edit";
                                          markdown: string;
                                      }
                                )[];
                                heading: string;
                            },
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: "high" | "medium" | "low";
                                      }
                                    | {
                                          kind: "recommended_item";
                                          text: string;
                                          sourceIds?: string[] | undefined;
                                          confidence?: "high" | "medium" | "low" | undefined;
                                          rationale?: string | undefined;
                                      }
                                    | {
                                          code:
                                              | "no_relevant_evidence"
                                              | "source_unavailable"
                                              | "not_assessed";
                                          kind: "no_evidence";
                                          note?: string | undefined;
                                      }
                                    | {
                                          kind: "human_edit";
                                          markdown: string;
                                      }
                                )[];
                                heading: string;
                            }
                        >;
                        currentBlockers: z.ZodObject<
                            {
                                heading: z.ZodString;
                                items: z.ZodArray<
                                    z.ZodDiscriminatedUnion<
                                        "kind",
                                        [
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"observed_fact">;
                                                    text: z.ZodString;
                                                    sourceIds: z.ZodArray<z.ZodString, "many">;
                                                    confidence: z.ZodEnum<
                                                        ["high", "medium", "low"]
                                                    >;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: "high" | "medium" | "low";
                                                },
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: "high" | "medium" | "low";
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"recommended_item">;
                                                    text: z.ZodString;
                                                    rationale: z.ZodOptional<z.ZodString>;
                                                    sourceIds: z.ZodDefault<
                                                        z.ZodArray<z.ZodString, "many">
                                                    >;
                                                    confidence: z.ZodOptional<
                                                        z.ZodEnum<["high", "medium", "low"]>
                                                    >;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "recommended_item";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence?:
                                                        | "high"
                                                        | "medium"
                                                        | "low"
                                                        | undefined;
                                                    rationale?: string | undefined;
                                                },
                                                {
                                                    kind: "recommended_item";
                                                    text: string;
                                                    sourceIds?: string[] | undefined;
                                                    confidence?:
                                                        | "high"
                                                        | "medium"
                                                        | "low"
                                                        | undefined;
                                                    rationale?: string | undefined;
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"no_evidence">;
                                                    code: z.ZodEnum<
                                                        [
                                                            "no_relevant_evidence",
                                                            "source_unavailable",
                                                            "not_assessed",
                                                        ]
                                                    >;
                                                    note: z.ZodOptional<z.ZodString>;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    code:
                                                        | "no_relevant_evidence"
                                                        | "source_unavailable"
                                                        | "not_assessed";
                                                    kind: "no_evidence";
                                                    note?: string | undefined;
                                                },
                                                {
                                                    code:
                                                        | "no_relevant_evidence"
                                                        | "source_unavailable"
                                                        | "not_assessed";
                                                    kind: "no_evidence";
                                                    note?: string | undefined;
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"human_edit">;
                                                    markdown: z.ZodString;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "human_edit";
                                                    markdown: string;
                                                },
                                                {
                                                    kind: "human_edit";
                                                    markdown: string;
                                                }
                                            >,
                                        ]
                                    >,
                                    "many"
                                >;
                            },
                            "strip",
                            z.ZodTypeAny,
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: "high" | "medium" | "low";
                                      }
                                    | {
                                          kind: "recommended_item";
                                          text: string;
                                          sourceIds: string[];
                                          confidence?: "high" | "medium" | "low" | undefined;
                                          rationale?: string | undefined;
                                      }
                                    | {
                                          code:
                                              | "no_relevant_evidence"
                                              | "source_unavailable"
                                              | "not_assessed";
                                          kind: "no_evidence";
                                          note?: string | undefined;
                                      }
                                    | {
                                          kind: "human_edit";
                                          markdown: string;
                                      }
                                )[];
                                heading: string;
                            },
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: "high" | "medium" | "low";
                                      }
                                    | {
                                          kind: "recommended_item";
                                          text: string;
                                          sourceIds?: string[] | undefined;
                                          confidence?: "high" | "medium" | "low" | undefined;
                                          rationale?: string | undefined;
                                      }
                                    | {
                                          code:
                                              | "no_relevant_evidence"
                                              | "source_unavailable"
                                              | "not_assessed";
                                          kind: "no_evidence";
                                          note?: string | undefined;
                                      }
                                    | {
                                          kind: "human_edit";
                                          markdown: string;
                                      }
                                )[];
                                heading: string;
                            }
                        >;
                        nextPriorities: z.ZodObject<
                            {
                                heading: z.ZodString;
                                items: z.ZodArray<
                                    z.ZodDiscriminatedUnion<
                                        "kind",
                                        [
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"observed_fact">;
                                                    text: z.ZodString;
                                                    sourceIds: z.ZodArray<z.ZodString, "many">;
                                                    confidence: z.ZodEnum<
                                                        ["high", "medium", "low"]
                                                    >;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: "high" | "medium" | "low";
                                                },
                                                {
                                                    kind: "observed_fact";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: "high" | "medium" | "low";
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"recommended_item">;
                                                    text: z.ZodString;
                                                    rationale: z.ZodOptional<z.ZodString>;
                                                    sourceIds: z.ZodDefault<
                                                        z.ZodArray<z.ZodString, "many">
                                                    >;
                                                    confidence: z.ZodOptional<
                                                        z.ZodEnum<["high", "medium", "low"]>
                                                    >;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "recommended_item";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence?:
                                                        | "high"
                                                        | "medium"
                                                        | "low"
                                                        | undefined;
                                                    rationale?: string | undefined;
                                                },
                                                {
                                                    kind: "recommended_item";
                                                    text: string;
                                                    sourceIds?: string[] | undefined;
                                                    confidence?:
                                                        | "high"
                                                        | "medium"
                                                        | "low"
                                                        | undefined;
                                                    rationale?: string | undefined;
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"no_evidence">;
                                                    code: z.ZodEnum<
                                                        [
                                                            "no_relevant_evidence",
                                                            "source_unavailable",
                                                            "not_assessed",
                                                        ]
                                                    >;
                                                    note: z.ZodOptional<z.ZodString>;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    code:
                                                        | "no_relevant_evidence"
                                                        | "source_unavailable"
                                                        | "not_assessed";
                                                    kind: "no_evidence";
                                                    note?: string | undefined;
                                                },
                                                {
                                                    code:
                                                        | "no_relevant_evidence"
                                                        | "source_unavailable"
                                                        | "not_assessed";
                                                    kind: "no_evidence";
                                                    note?: string | undefined;
                                                }
                                            >,
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"human_edit">;
                                                    markdown: z.ZodString;
                                                },
                                                "strip",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "human_edit";
                                                    markdown: string;
                                                },
                                                {
                                                    kind: "human_edit";
                                                    markdown: string;
                                                }
                                            >,
                                        ]
                                    >,
                                    "many"
                                >;
                            },
                            "strip",
                            z.ZodTypeAny,
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: "high" | "medium" | "low";
                                      }
                                    | {
                                          kind: "recommended_item";
                                          text: string;
                                          sourceIds: string[];
                                          confidence?: "high" | "medium" | "low" | undefined;
                                          rationale?: string | undefined;
                                      }
                                    | {
                                          code:
                                              | "no_relevant_evidence"
                                              | "source_unavailable"
                                              | "not_assessed";
                                          kind: "no_evidence";
                                          note?: string | undefined;
                                      }
                                    | {
                                          kind: "human_edit";
                                          markdown: string;
                                      }
                                )[];
                                heading: string;
                            },
                            {
                                items: (
                                    | {
                                          kind: "observed_fact";
                                          text: string;
                                          sourceIds: string[];
                                          confidence: "high" | "medium" | "low";
                                      }
                                    | {
                                          kind: "recommended_item";
                                          text: string;
                                          sourceIds?: string[] | undefined;
                                          confidence?: "high" | "medium" | "low" | undefined;
                                          rationale?: string | undefined;
                                      }
                                    | {
                                          code:
                                              | "no_relevant_evidence"
                                              | "source_unavailable"
                                              | "not_assessed";
                                          kind: "no_evidence";
                                          note?: string | undefined;
                                      }
                                    | {
                                          kind: "human_edit";
                                          markdown: string;
                                      }
                                )[];
                                heading: string;
                            }
                        >;
                    },
                    "strip",
                    z.ZodTypeAny,
                    {
                        whatChanged: {
                            items: (
                                | {
                                      kind: "observed_fact";
                                      text: string;
                                      sourceIds: string[];
                                      confidence: "high" | "medium" | "low";
                                  }
                                | {
                                      kind: "recommended_item";
                                      text: string;
                                      sourceIds: string[];
                                      confidence?: "high" | "medium" | "low" | undefined;
                                      rationale?: string | undefined;
                                  }
                                | {
                                      code:
                                          | "no_relevant_evidence"
                                          | "source_unavailable"
                                          | "not_assessed";
                                      kind: "no_evidence";
                                      note?: string | undefined;
                                  }
                                | {
                                      kind: "human_edit";
                                      markdown: string;
                                  }
                            )[];
                            heading: string;
                        };
                        whatShipped: {
                            items: (
                                | {
                                      kind: "observed_fact";
                                      text: string;
                                      sourceIds: string[];
                                      confidence: "high" | "medium" | "low";
                                  }
                                | {
                                      kind: "recommended_item";
                                      text: string;
                                      sourceIds: string[];
                                      confidence?: "high" | "medium" | "low" | undefined;
                                      rationale?: string | undefined;
                                  }
                                | {
                                      code:
                                          | "no_relevant_evidence"
                                          | "source_unavailable"
                                          | "not_assessed";
                                      kind: "no_evidence";
                                      note?: string | undefined;
                                  }
                                | {
                                      kind: "human_edit";
                                      markdown: string;
                                  }
                            )[];
                            heading: string;
                        };
                        whatCustomersSaid: {
                            items: (
                                | {
                                      kind: "observed_fact";
                                      text: string;
                                      sourceIds: string[];
                                      confidence: "high" | "medium" | "low";
                                  }
                                | {
                                      kind: "recommended_item";
                                      text: string;
                                      sourceIds: string[];
                                      confidence?: "high" | "medium" | "low" | undefined;
                                      rationale?: string | undefined;
                                  }
                                | {
                                      code:
                                          | "no_relevant_evidence"
                                          | "source_unavailable"
                                          | "not_assessed";
                                      kind: "no_evidence";
                                      note?: string | undefined;
                                  }
                                | {
                                      kind: "human_edit";
                                      markdown: string;
                                  }
                            )[];
                            heading: string;
                        };
                        currentBlockers: {
                            items: (
                                | {
                                      kind: "observed_fact";
                                      text: string;
                                      sourceIds: string[];
                                      confidence: "high" | "medium" | "low";
                                  }
                                | {
                                      kind: "recommended_item";
                                      text: string;
                                      sourceIds: string[];
                                      confidence?: "high" | "medium" | "low" | undefined;
                                      rationale?: string | undefined;
                                  }
                                | {
                                      code:
                                          | "no_relevant_evidence"
                                          | "source_unavailable"
                                          | "not_assessed";
                                      kind: "no_evidence";
                                      note?: string | undefined;
                                  }
                                | {
                                      kind: "human_edit";
                                      markdown: string;
                                  }
                            )[];
                            heading: string;
                        };
                        nextPriorities: {
                            items: (
                                | {
                                      kind: "observed_fact";
                                      text: string;
                                      sourceIds: string[];
                                      confidence: "high" | "medium" | "low";
                                  }
                                | {
                                      kind: "recommended_item";
                                      text: string;
                                      sourceIds: string[];
                                      confidence?: "high" | "medium" | "low" | undefined;
                                      rationale?: string | undefined;
                                  }
                                | {
                                      code:
                                          | "no_relevant_evidence"
                                          | "source_unavailable"
                                          | "not_assessed";
                                      kind: "no_evidence";
                                      note?: string | undefined;
                                  }
                                | {
                                      kind: "human_edit";
                                      markdown: string;
                                  }
                            )[];
                            heading: string;
                        };
                    },
                    {
                        whatChanged: {
                            items: (
                                | {
                                      kind: "observed_fact";
                                      text: string;
                                      sourceIds: string[];
                                      confidence: "high" | "medium" | "low";
                                  }
                                | {
                                      kind: "recommended_item";
                                      text: string;
                                      sourceIds?: string[] | undefined;
                                      confidence?: "high" | "medium" | "low" | undefined;
                                      rationale?: string | undefined;
                                  }
                                | {
                                      code:
                                          | "no_relevant_evidence"
                                          | "source_unavailable"
                                          | "not_assessed";
                                      kind: "no_evidence";
                                      note?: string | undefined;
                                  }
                                | {
                                      kind: "human_edit";
                                      markdown: string;
                                  }
                            )[];
                            heading: string;
                        };
                        whatShipped: {
                            items: (
                                | {
                                      kind: "observed_fact";
                                      text: string;
                                      sourceIds: string[];
                                      confidence: "high" | "medium" | "low";
                                  }
                                | {
                                      kind: "recommended_item";
                                      text: string;
                                      sourceIds?: string[] | undefined;
                                      confidence?: "high" | "medium" | "low" | undefined;
                                      rationale?: string | undefined;
                                  }
                                | {
                                      code:
                                          | "no_relevant_evidence"
                                          | "source_unavailable"
                                          | "not_assessed";
                                      kind: "no_evidence";
                                      note?: string | undefined;
                                  }
                                | {
                                      kind: "human_edit";
                                      markdown: string;
                                  }
                            )[];
                            heading: string;
                        };
                        whatCustomersSaid: {
                            items: (
                                | {
                                      kind: "observed_fact";
                                      text: string;
                                      sourceIds: string[];
                                      confidence: "high" | "medium" | "low";
                                  }
                                | {
                                      kind: "recommended_item";
                                      text: string;
                                      sourceIds?: string[] | undefined;
                                      confidence?: "high" | "medium" | "low" | undefined;
                                      rationale?: string | undefined;
                                  }
                                | {
                                      code:
                                          | "no_relevant_evidence"
                                          | "source_unavailable"
                                          | "not_assessed";
                                      kind: "no_evidence";
                                      note?: string | undefined;
                                  }
                                | {
                                      kind: "human_edit";
                                      markdown: string;
                                  }
                            )[];
                            heading: string;
                        };
                        currentBlockers: {
                            items: (
                                | {
                                      kind: "observed_fact";
                                      text: string;
                                      sourceIds: string[];
                                      confidence: "high" | "medium" | "low";
                                  }
                                | {
                                      kind: "recommended_item";
                                      text: string;
                                      sourceIds?: string[] | undefined;
                                      confidence?: "high" | "medium" | "low" | undefined;
                                      rationale?: string | undefined;
                                  }
                                | {
                                      code:
                                          | "no_relevant_evidence"
                                          | "source_unavailable"
                                          | "not_assessed";
                                      kind: "no_evidence";
                                      note?: string | undefined;
                                  }
                                | {
                                      kind: "human_edit";
                                      markdown: string;
                                  }
                            )[];
                            heading: string;
                        };
                        nextPriorities: {
                            items: (
                                | {
                                      kind: "observed_fact";
                                      text: string;
                                      sourceIds: string[];
                                      confidence: "high" | "medium" | "low";
                                  }
                                | {
                                      kind: "recommended_item";
                                      text: string;
                                      sourceIds?: string[] | undefined;
                                      confidence?: "high" | "medium" | "low" | undefined;
                                      rationale?: string | undefined;
                                  }
                                | {
                                      code:
                                          | "no_relevant_evidence"
                                          | "source_unavailable"
                                          | "not_assessed";
                                      kind: "no_evidence";
                                      note?: string | undefined;
                                  }
                                | {
                                      kind: "human_edit";
                                      markdown: string;
                                  }
                            )[];
                            heading: string;
                        };
                    }
                >;
            },
            "strip",
            z.ZodTypeAny,
            {
                schemaVersion: "founder-weekly-review/v1";
                sections: {
                    whatChanged: {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds: string[];
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    };
                    whatShipped: {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds: string[];
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    };
                    whatCustomersSaid: {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds: string[];
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    };
                    currentBlockers: {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds: string[];
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    };
                    nextPriorities: {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds: string[];
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    };
                };
            },
            {
                schemaVersion: "founder-weekly-review/v1";
                sections: {
                    whatChanged: {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds?: string[] | undefined;
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    };
                    whatShipped: {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds?: string[] | undefined;
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    };
                    whatCustomersSaid: {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds?: string[] | undefined;
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    };
                    currentBlockers: {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds?: string[] | undefined;
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    };
                    nextPriorities: {
                        items: (
                            | {
                                  kind: "observed_fact";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: "high" | "medium" | "low";
                              }
                            | {
                                  kind: "recommended_item";
                                  text: string;
                                  sourceIds?: string[] | undefined;
                                  confidence?: "high" | "medium" | "low" | undefined;
                                  rationale?: string | undefined;
                              }
                            | {
                                  code:
                                      | "no_relevant_evidence"
                                      | "source_unavailable"
                                      | "not_assessed";
                                  kind: "no_evidence";
                                  note?: string | undefined;
                              }
                            | {
                                  kind: "human_edit";
                                  markdown: string;
                              }
                        )[];
                        heading: string;
                    };
                };
            }
        >,
        z.ZodObject<
            {
                schemaVersion: z.ZodLiteral<"founder-weekly-review/v2">;
                sections: z.ZodObject<
                    {
                        whatChanged: z.ZodUnion<
                            [
                                z.ZodObject<
                                    {
                                        state: z.ZodLiteral<"evidence">;
                                        items: z.ZodArray<
                                            z.ZodUnion<
                                                [
                                                    z.ZodObject<
                                                        {
                                                            kind: z.ZodLiteral<"observed_fact">;
                                                            text: z.ZodString;
                                                            sourceIds: z.ZodEffects<
                                                                z.ZodArray<z.ZodString, "many">,
                                                                string[],
                                                                string[]
                                                            >;
                                                            confidence: z.ZodNumber;
                                                        },
                                                        "strict",
                                                        z.ZodTypeAny,
                                                        {
                                                            kind: "observed_fact";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        },
                                                        {
                                                            kind: "observed_fact";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        }
                                                    >,
                                                    z.ZodObject<
                                                        {
                                                            kind: z.ZodLiteral<"contradictory_evidence">;
                                                            text: z.ZodString;
                                                            sourceIds: z.ZodEffects<
                                                                z.ZodArray<z.ZodString, "many">,
                                                                string[],
                                                                string[]
                                                            >;
                                                            confidence: z.ZodNumber;
                                                        },
                                                        "strict",
                                                        z.ZodTypeAny,
                                                        {
                                                            kind: "contradictory_evidence";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        },
                                                        {
                                                            kind: "contradictory_evidence";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        }
                                                    >,
                                                ]
                                            >,
                                            "many"
                                        >;
                                    },
                                    "strict",
                                    z.ZodTypeAny,
                                    {
                                        items: (
                                            | {
                                                  kind: "observed_fact";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                            | {
                                                  kind: "contradictory_evidence";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                        )[];
                                        state: "evidence";
                                    },
                                    {
                                        items: (
                                            | {
                                                  kind: "observed_fact";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                            | {
                                                  kind: "contradictory_evidence";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                        )[];
                                        state: "evidence";
                                    }
                                >,
                                z.ZodObject<
                                    {
                                        state: z.ZodLiteral<"no_evidence">;
                                        noEvidence: z.ZodObject<
                                            {
                                                code: z.ZodString;
                                                message: z.ZodString;
                                                cta: z.ZodString;
                                            },
                                            "strict",
                                            z.ZodTypeAny,
                                            {
                                                code: string;
                                                message: string;
                                                cta: string;
                                            },
                                            {
                                                code: string;
                                                message: string;
                                                cta: string;
                                            }
                                        >;
                                    },
                                    "strict",
                                    z.ZodTypeAny,
                                    {
                                        state: "no_evidence";
                                        noEvidence: {
                                            code: string;
                                            message: string;
                                            cta: string;
                                        };
                                    },
                                    {
                                        state: "no_evidence";
                                        noEvidence: {
                                            code: string;
                                            message: string;
                                            cta: string;
                                        };
                                    }
                                >,
                            ]
                        >;
                        whatShipped: z.ZodUnion<
                            [
                                z.ZodObject<
                                    {
                                        state: z.ZodLiteral<"evidence">;
                                        items: z.ZodArray<
                                            z.ZodUnion<
                                                [
                                                    z.ZodObject<
                                                        {
                                                            kind: z.ZodLiteral<"observed_fact">;
                                                            text: z.ZodString;
                                                            sourceIds: z.ZodEffects<
                                                                z.ZodArray<z.ZodString, "many">,
                                                                string[],
                                                                string[]
                                                            >;
                                                            confidence: z.ZodNumber;
                                                        },
                                                        "strict",
                                                        z.ZodTypeAny,
                                                        {
                                                            kind: "observed_fact";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        },
                                                        {
                                                            kind: "observed_fact";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        }
                                                    >,
                                                    z.ZodObject<
                                                        {
                                                            kind: z.ZodLiteral<"contradictory_evidence">;
                                                            text: z.ZodString;
                                                            sourceIds: z.ZodEffects<
                                                                z.ZodArray<z.ZodString, "many">,
                                                                string[],
                                                                string[]
                                                            >;
                                                            confidence: z.ZodNumber;
                                                        },
                                                        "strict",
                                                        z.ZodTypeAny,
                                                        {
                                                            kind: "contradictory_evidence";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        },
                                                        {
                                                            kind: "contradictory_evidence";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        }
                                                    >,
                                                ]
                                            >,
                                            "many"
                                        >;
                                    },
                                    "strict",
                                    z.ZodTypeAny,
                                    {
                                        items: (
                                            | {
                                                  kind: "observed_fact";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                            | {
                                                  kind: "contradictory_evidence";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                        )[];
                                        state: "evidence";
                                    },
                                    {
                                        items: (
                                            | {
                                                  kind: "observed_fact";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                            | {
                                                  kind: "contradictory_evidence";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                        )[];
                                        state: "evidence";
                                    }
                                >,
                                z.ZodObject<
                                    {
                                        state: z.ZodLiteral<"no_evidence">;
                                        noEvidence: z.ZodObject<
                                            {
                                                code: z.ZodString;
                                                message: z.ZodString;
                                                cta: z.ZodString;
                                            },
                                            "strict",
                                            z.ZodTypeAny,
                                            {
                                                code: string;
                                                message: string;
                                                cta: string;
                                            },
                                            {
                                                code: string;
                                                message: string;
                                                cta: string;
                                            }
                                        >;
                                    },
                                    "strict",
                                    z.ZodTypeAny,
                                    {
                                        state: "no_evidence";
                                        noEvidence: {
                                            code: string;
                                            message: string;
                                            cta: string;
                                        };
                                    },
                                    {
                                        state: "no_evidence";
                                        noEvidence: {
                                            code: string;
                                            message: string;
                                            cta: string;
                                        };
                                    }
                                >,
                            ]
                        >;
                        whatCustomersSaid: z.ZodUnion<
                            [
                                z.ZodObject<
                                    {
                                        state: z.ZodLiteral<"evidence">;
                                        items: z.ZodArray<
                                            z.ZodUnion<
                                                [
                                                    z.ZodObject<
                                                        {
                                                            kind: z.ZodLiteral<"observed_fact">;
                                                            text: z.ZodString;
                                                            sourceIds: z.ZodEffects<
                                                                z.ZodArray<z.ZodString, "many">,
                                                                string[],
                                                                string[]
                                                            >;
                                                            confidence: z.ZodNumber;
                                                        },
                                                        "strict",
                                                        z.ZodTypeAny,
                                                        {
                                                            kind: "observed_fact";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        },
                                                        {
                                                            kind: "observed_fact";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        }
                                                    >,
                                                    z.ZodObject<
                                                        {
                                                            kind: z.ZodLiteral<"contradictory_evidence">;
                                                            text: z.ZodString;
                                                            sourceIds: z.ZodEffects<
                                                                z.ZodArray<z.ZodString, "many">,
                                                                string[],
                                                                string[]
                                                            >;
                                                            confidence: z.ZodNumber;
                                                        },
                                                        "strict",
                                                        z.ZodTypeAny,
                                                        {
                                                            kind: "contradictory_evidence";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        },
                                                        {
                                                            kind: "contradictory_evidence";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        }
                                                    >,
                                                ]
                                            >,
                                            "many"
                                        >;
                                    },
                                    "strict",
                                    z.ZodTypeAny,
                                    {
                                        items: (
                                            | {
                                                  kind: "observed_fact";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                            | {
                                                  kind: "contradictory_evidence";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                        )[];
                                        state: "evidence";
                                    },
                                    {
                                        items: (
                                            | {
                                                  kind: "observed_fact";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                            | {
                                                  kind: "contradictory_evidence";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                        )[];
                                        state: "evidence";
                                    }
                                >,
                                z.ZodObject<
                                    {
                                        state: z.ZodLiteral<"no_evidence">;
                                        noEvidence: z.ZodObject<
                                            {
                                                code: z.ZodString;
                                                message: z.ZodString;
                                                cta: z.ZodString;
                                            },
                                            "strict",
                                            z.ZodTypeAny,
                                            {
                                                code: string;
                                                message: string;
                                                cta: string;
                                            },
                                            {
                                                code: string;
                                                message: string;
                                                cta: string;
                                            }
                                        >;
                                    },
                                    "strict",
                                    z.ZodTypeAny,
                                    {
                                        state: "no_evidence";
                                        noEvidence: {
                                            code: string;
                                            message: string;
                                            cta: string;
                                        };
                                    },
                                    {
                                        state: "no_evidence";
                                        noEvidence: {
                                            code: string;
                                            message: string;
                                            cta: string;
                                        };
                                    }
                                >,
                            ]
                        >;
                        currentBlockers: z.ZodUnion<
                            [
                                z.ZodObject<
                                    {
                                        state: z.ZodLiteral<"evidence">;
                                        items: z.ZodArray<
                                            z.ZodUnion<
                                                [
                                                    z.ZodObject<
                                                        {
                                                            kind: z.ZodLiteral<"observed_fact">;
                                                            text: z.ZodString;
                                                            sourceIds: z.ZodEffects<
                                                                z.ZodArray<z.ZodString, "many">,
                                                                string[],
                                                                string[]
                                                            >;
                                                            confidence: z.ZodNumber;
                                                        },
                                                        "strict",
                                                        z.ZodTypeAny,
                                                        {
                                                            kind: "observed_fact";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        },
                                                        {
                                                            kind: "observed_fact";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        }
                                                    >,
                                                    z.ZodObject<
                                                        {
                                                            kind: z.ZodLiteral<"contradictory_evidence">;
                                                            text: z.ZodString;
                                                            sourceIds: z.ZodEffects<
                                                                z.ZodArray<z.ZodString, "many">,
                                                                string[],
                                                                string[]
                                                            >;
                                                            confidence: z.ZodNumber;
                                                        },
                                                        "strict",
                                                        z.ZodTypeAny,
                                                        {
                                                            kind: "contradictory_evidence";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        },
                                                        {
                                                            kind: "contradictory_evidence";
                                                            text: string;
                                                            sourceIds: string[];
                                                            confidence: number;
                                                        }
                                                    >,
                                                ]
                                            >,
                                            "many"
                                        >;
                                    },
                                    "strict",
                                    z.ZodTypeAny,
                                    {
                                        items: (
                                            | {
                                                  kind: "observed_fact";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                            | {
                                                  kind: "contradictory_evidence";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                        )[];
                                        state: "evidence";
                                    },
                                    {
                                        items: (
                                            | {
                                                  kind: "observed_fact";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                            | {
                                                  kind: "contradictory_evidence";
                                                  text: string;
                                                  sourceIds: string[];
                                                  confidence: number;
                                              }
                                        )[];
                                        state: "evidence";
                                    }
                                >,
                                z.ZodObject<
                                    {
                                        state: z.ZodLiteral<"no_evidence">;
                                        noEvidence: z.ZodObject<
                                            {
                                                code: z.ZodString;
                                                message: z.ZodString;
                                                cta: z.ZodString;
                                            },
                                            "strict",
                                            z.ZodTypeAny,
                                            {
                                                code: string;
                                                message: string;
                                                cta: string;
                                            },
                                            {
                                                code: string;
                                                message: string;
                                                cta: string;
                                            }
                                        >;
                                    },
                                    "strict",
                                    z.ZodTypeAny,
                                    {
                                        state: "no_evidence";
                                        noEvidence: {
                                            code: string;
                                            message: string;
                                            cta: string;
                                        };
                                    },
                                    {
                                        state: "no_evidence";
                                        noEvidence: {
                                            code: string;
                                            message: string;
                                            cta: string;
                                        };
                                    }
                                >,
                            ]
                        >;
                        nextPriorities: z.ZodUnion<
                            [
                                z.ZodObject<
                                    {
                                        state: z.ZodLiteral<"evidence">;
                                        items: z.ZodArray<
                                            z.ZodObject<
                                                {
                                                    kind: z.ZodLiteral<"recommendation">;
                                                    label: z.ZodLiteral<"Recommendation">;
                                                    text: z.ZodString;
                                                    rationale: z.ZodOptional<z.ZodString>;
                                                    sourceIds: z.ZodEffects<
                                                        z.ZodArray<z.ZodString, "many">,
                                                        string[],
                                                        string[]
                                                    >;
                                                    confidence: z.ZodNumber;
                                                },
                                                "strict",
                                                z.ZodTypeAny,
                                                {
                                                    kind: "recommendation";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                    label: "Recommendation";
                                                    rationale?: string | undefined;
                                                },
                                                {
                                                    kind: "recommendation";
                                                    text: string;
                                                    sourceIds: string[];
                                                    confidence: number;
                                                    label: "Recommendation";
                                                    rationale?: string | undefined;
                                                }
                                            >,
                                            "many"
                                        >;
                                    },
                                    "strict",
                                    z.ZodTypeAny,
                                    {
                                        items: {
                                            kind: "recommendation";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                            label: "Recommendation";
                                            rationale?: string | undefined;
                                        }[];
                                        state: "evidence";
                                    },
                                    {
                                        items: {
                                            kind: "recommendation";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                            label: "Recommendation";
                                            rationale?: string | undefined;
                                        }[];
                                        state: "evidence";
                                    }
                                >,
                                z.ZodObject<
                                    {
                                        state: z.ZodLiteral<"no_evidence">;
                                        noEvidence: z.ZodObject<
                                            {
                                                code: z.ZodString;
                                                message: z.ZodString;
                                                cta: z.ZodString;
                                            },
                                            "strict",
                                            z.ZodTypeAny,
                                            {
                                                code: string;
                                                message: string;
                                                cta: string;
                                            },
                                            {
                                                code: string;
                                                message: string;
                                                cta: string;
                                            }
                                        >;
                                    },
                                    "strict",
                                    z.ZodTypeAny,
                                    {
                                        state: "no_evidence";
                                        noEvidence: {
                                            code: string;
                                            message: string;
                                            cta: string;
                                        };
                                    },
                                    {
                                        state: "no_evidence";
                                        noEvidence: {
                                            code: string;
                                            message: string;
                                            cta: string;
                                        };
                                    }
                                >,
                            ]
                        >;
                    },
                    "strict",
                    z.ZodTypeAny,
                    {
                        whatChanged:
                            | {
                                  state: "no_evidence";
                                  noEvidence: {
                                      code: string;
                                      message: string;
                                      cta: string;
                                  };
                              }
                            | {
                                  items: (
                                      | {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                      | {
                                            kind: "contradictory_evidence";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                  )[];
                                  state: "evidence";
                              };
                        whatShipped:
                            | {
                                  state: "no_evidence";
                                  noEvidence: {
                                      code: string;
                                      message: string;
                                      cta: string;
                                  };
                              }
                            | {
                                  items: (
                                      | {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                      | {
                                            kind: "contradictory_evidence";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                  )[];
                                  state: "evidence";
                              };
                        whatCustomersSaid:
                            | {
                                  state: "no_evidence";
                                  noEvidence: {
                                      code: string;
                                      message: string;
                                      cta: string;
                                  };
                              }
                            | {
                                  items: (
                                      | {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                      | {
                                            kind: "contradictory_evidence";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                  )[];
                                  state: "evidence";
                              };
                        currentBlockers:
                            | {
                                  state: "no_evidence";
                                  noEvidence: {
                                      code: string;
                                      message: string;
                                      cta: string;
                                  };
                              }
                            | {
                                  items: (
                                      | {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                      | {
                                            kind: "contradictory_evidence";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                  )[];
                                  state: "evidence";
                              };
                        nextPriorities:
                            | {
                                  state: "no_evidence";
                                  noEvidence: {
                                      code: string;
                                      message: string;
                                      cta: string;
                                  };
                              }
                            | {
                                  items: {
                                      kind: "recommendation";
                                      text: string;
                                      sourceIds: string[];
                                      confidence: number;
                                      label: "Recommendation";
                                      rationale?: string | undefined;
                                  }[];
                                  state: "evidence";
                              };
                    },
                    {
                        whatChanged:
                            | {
                                  state: "no_evidence";
                                  noEvidence: {
                                      code: string;
                                      message: string;
                                      cta: string;
                                  };
                              }
                            | {
                                  items: (
                                      | {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                      | {
                                            kind: "contradictory_evidence";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                  )[];
                                  state: "evidence";
                              };
                        whatShipped:
                            | {
                                  state: "no_evidence";
                                  noEvidence: {
                                      code: string;
                                      message: string;
                                      cta: string;
                                  };
                              }
                            | {
                                  items: (
                                      | {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                      | {
                                            kind: "contradictory_evidence";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                  )[];
                                  state: "evidence";
                              };
                        whatCustomersSaid:
                            | {
                                  state: "no_evidence";
                                  noEvidence: {
                                      code: string;
                                      message: string;
                                      cta: string;
                                  };
                              }
                            | {
                                  items: (
                                      | {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                      | {
                                            kind: "contradictory_evidence";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                  )[];
                                  state: "evidence";
                              };
                        currentBlockers:
                            | {
                                  state: "no_evidence";
                                  noEvidence: {
                                      code: string;
                                      message: string;
                                      cta: string;
                                  };
                              }
                            | {
                                  items: (
                                      | {
                                            kind: "observed_fact";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                      | {
                                            kind: "contradictory_evidence";
                                            text: string;
                                            sourceIds: string[];
                                            confidence: number;
                                        }
                                  )[];
                                  state: "evidence";
                              };
                        nextPriorities:
                            | {
                                  state: "no_evidence";
                                  noEvidence: {
                                      code: string;
                                      message: string;
                                      cta: string;
                                  };
                              }
                            | {
                                  items: {
                                      kind: "recommendation";
                                      text: string;
                                      sourceIds: string[];
                                      confidence: number;
                                      label: "Recommendation";
                                      rationale?: string | undefined;
                                  }[];
                                  state: "evidence";
                              };
                    }
                >;
            },
            "strict",
            z.ZodTypeAny,
            {
                schemaVersion: "founder-weekly-review/v2";
                sections: {
                    whatChanged:
                        | {
                              state: "no_evidence";
                              noEvidence: {
                                  code: string;
                                  message: string;
                                  cta: string;
                              };
                          }
                        | {
                              items: (
                                  | {
                                        kind: "observed_fact";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                                  | {
                                        kind: "contradictory_evidence";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                              )[];
                              state: "evidence";
                          };
                    whatShipped:
                        | {
                              state: "no_evidence";
                              noEvidence: {
                                  code: string;
                                  message: string;
                                  cta: string;
                              };
                          }
                        | {
                              items: (
                                  | {
                                        kind: "observed_fact";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                                  | {
                                        kind: "contradictory_evidence";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                              )[];
                              state: "evidence";
                          };
                    whatCustomersSaid:
                        | {
                              state: "no_evidence";
                              noEvidence: {
                                  code: string;
                                  message: string;
                                  cta: string;
                              };
                          }
                        | {
                              items: (
                                  | {
                                        kind: "observed_fact";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                                  | {
                                        kind: "contradictory_evidence";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                              )[];
                              state: "evidence";
                          };
                    currentBlockers:
                        | {
                              state: "no_evidence";
                              noEvidence: {
                                  code: string;
                                  message: string;
                                  cta: string;
                              };
                          }
                        | {
                              items: (
                                  | {
                                        kind: "observed_fact";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                                  | {
                                        kind: "contradictory_evidence";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                              )[];
                              state: "evidence";
                          };
                    nextPriorities:
                        | {
                              state: "no_evidence";
                              noEvidence: {
                                  code: string;
                                  message: string;
                                  cta: string;
                              };
                          }
                        | {
                              items: {
                                  kind: "recommendation";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: number;
                                  label: "Recommendation";
                                  rationale?: string | undefined;
                              }[];
                              state: "evidence";
                          };
                };
            },
            {
                schemaVersion: "founder-weekly-review/v2";
                sections: {
                    whatChanged:
                        | {
                              state: "no_evidence";
                              noEvidence: {
                                  code: string;
                                  message: string;
                                  cta: string;
                              };
                          }
                        | {
                              items: (
                                  | {
                                        kind: "observed_fact";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                                  | {
                                        kind: "contradictory_evidence";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                              )[];
                              state: "evidence";
                          };
                    whatShipped:
                        | {
                              state: "no_evidence";
                              noEvidence: {
                                  code: string;
                                  message: string;
                                  cta: string;
                              };
                          }
                        | {
                              items: (
                                  | {
                                        kind: "observed_fact";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                                  | {
                                        kind: "contradictory_evidence";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                              )[];
                              state: "evidence";
                          };
                    whatCustomersSaid:
                        | {
                              state: "no_evidence";
                              noEvidence: {
                                  code: string;
                                  message: string;
                                  cta: string;
                              };
                          }
                        | {
                              items: (
                                  | {
                                        kind: "observed_fact";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                                  | {
                                        kind: "contradictory_evidence";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                              )[];
                              state: "evidence";
                          };
                    currentBlockers:
                        | {
                              state: "no_evidence";
                              noEvidence: {
                                  code: string;
                                  message: string;
                                  cta: string;
                              };
                          }
                        | {
                              items: (
                                  | {
                                        kind: "observed_fact";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                                  | {
                                        kind: "contradictory_evidence";
                                        text: string;
                                        sourceIds: string[];
                                        confidence: number;
                                    }
                              )[];
                              state: "evidence";
                          };
                    nextPriorities:
                        | {
                              state: "no_evidence";
                              noEvidence: {
                                  code: string;
                                  message: string;
                                  cta: string;
                              };
                          }
                        | {
                              items: {
                                  kind: "recommendation";
                                  text: string;
                                  sourceIds: string[];
                                  confidence: number;
                                  label: "Recommendation";
                                  rationale?: string | undefined;
                              }[];
                              state: "evidence";
                          };
                };
            }
        >,
    ]
>;
export type FounderWeeklyReviewPayload = z.infer<typeof FounderWeeklyReviewPayloadSchema>;
export type FounderWeeklyReviewPayloadSchemaVersion =
    | typeof FOUNDER_WEEKLY_REVIEW_SCHEMA_VERSION
    | typeof FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION;
export declare const FounderWeeklyReviewModelMetadataSchema: z.ZodObject<
    {
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        promptVersion: z.ZodOptional<z.ZodString>;
        temperature: z.ZodOptional<z.ZodNumber>;
        capability: z.ZodOptional<z.ZodString>;
        promptHash: z.ZodOptional<z.ZodString>;
        evidenceSchemaVersion: z.ZodOptional<z.ZodString>;
        reviewPayloadSchemaVersion: z.ZodOptional<z.ZodString>;
        completionId: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
        attributes: z.ZodDefault<
            z.ZodRecord<
                z.ZodString,
                z.ZodType<
                    string | number | boolean | (string | number | boolean | null)[] | null,
                    z.ZodTypeDef,
                    string | number | boolean | (string | number | boolean | null)[] | null
                >
            >
        >;
    },
    "strip",
    z.ZodTypeAny,
    {
        attributes: Record<
            string,
            string | number | boolean | (string | number | boolean | null)[] | null
        >;
        provider?: string | undefined;
        model?: string | undefined;
        promptVersion?: string | undefined;
        temperature?: number | undefined;
        capability?: string | undefined;
        promptHash?: string | undefined;
        evidenceSchemaVersion?: string | undefined;
        reviewPayloadSchemaVersion?: string | undefined;
        completionId?: string | undefined;
        notes?: string | undefined;
    },
    {
        provider?: string | undefined;
        model?: string | undefined;
        promptVersion?: string | undefined;
        temperature?: number | undefined;
        capability?: string | undefined;
        promptHash?: string | undefined;
        evidenceSchemaVersion?: string | undefined;
        reviewPayloadSchemaVersion?: string | undefined;
        completionId?: string | undefined;
        notes?: string | undefined;
        attributes?:
            | Record<
                  string,
                  string | number | boolean | (string | number | boolean | null)[] | null
              >
            | undefined;
    }
>;
export type FounderWeeklyReviewModelMetadata = z.infer<
    typeof FounderWeeklyReviewModelMetadataSchema
>;
export interface FounderWeeklyReviewRunRecord {
    id: string;
    companyId: bigint;
    requestKey: string;
    reportingPeriod: ReportingPeriod;
    status: FounderWeeklyReviewStatus;
    reviewPayload: FounderWeeklyReviewPayload | null;
    reviewSchemaVersion: FounderWeeklyReviewPayloadSchemaVersion;
    evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot | null;
    evidenceSchemaVersion: typeof FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION;
    collectionInput?: FounderWeeklyReviewCollectionInput;
    collectionClaimId?: string | null;
    collectionStartedAt?: Date | null;
    evidenceCollectedAt?: Date | null;
    modelMetadata: FounderWeeklyReviewModelMetadata | null;
    createdByActorId: string;
    retryCount: number;
    failureSequence: number;
    generationAttempt: number;
    generationClaimId: string | null;
    generationJobId: string | null;
    queuedAt: Date;
    claimedAt: Date | null;
    generationStartedAt: Date | null;
    generatedAt: Date | null;
    publishedAt: Date | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date | null;
}
export interface FounderWeeklyReviewOperationRecord {
    id: string;
    runId: string;
    companyId: bigint;
    operationType: FounderWeeklyReviewOperationType;
    requestKey: string;
    sourceFailureSequence: number;
    actorId: string;
    createdAt: Date;
}
export interface CreateFounderWeeklyReviewRunInput {
    id: string;
    companyId: bigint;
    requestKey: string;
    reportingPeriod: ReportingPeriod;
    /** Existing callers may provide a snapshot; workflow callers intentionally do not. */
    evidenceSnapshot?: FounderWeeklyReviewEvidenceSnapshot;
    collectionInput?: FounderWeeklyReviewCollectionInput;
    createdByActorId: string;
}
export interface FounderWeeklyReviewRetryInput {
    operationId: string;
    companyId: bigint;
    runId: string;
    requestKey: string;
    actorId: string;
}
export interface FounderWeeklyReviewClaimInput {
    companyId: bigint;
    runId: string;
    generationClaimId: string;
    generationJobId?: string;
}
export interface FounderWeeklyReviewCollectionClaimInput {
    companyId: bigint;
    runId: string;
    collectionClaimId: string;
}
export interface FounderWeeklyReviewGenerationFailure {
    errorCode: string;
    errorMessage?: string;
}
export interface FounderWeeklyReviewUserActor {
    externalUserId: string;
    internalUserId?: bigint;
    companyId: bigint;
    role: string;
}
export declare function buildFounderWeeklyReviewActorId(
    actor: Pick<FounderWeeklyReviewUserActor, "externalUserId">
): string;
export declare function parseFounderWeeklyReviewPayload(value: unknown): FounderWeeklyReviewPayload;
export declare function parseFounderWeeklyReviewEvidenceSnapshot(
    value: unknown
): FounderWeeklyReviewEvidenceSnapshot;
export declare function parseFounderWeeklyReviewCollectionInput(
    value: unknown
): FounderWeeklyReviewCollectionInput;
export declare function parseFounderWeeklyReviewModelMetadata(
    value: unknown
): FounderWeeklyReviewModelMetadata;
//# sourceMappingURL=contracts.d.ts.map

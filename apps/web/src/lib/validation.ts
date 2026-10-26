import { z } from "zod";
import { NextResponse } from "next/server";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { V, v } from "~/i18n/validation";
import { zodErrorText } from "~/i18n/zod";
import type { Locale } from "~/i18n/locales";
import { AGENT_STYLE_IDS } from "~/lib/agents/definition";
import { ARTIFACT_TYPES, MAX_ARTIFACT_BYTES } from "~/lib/artifact-content";
import { MAX_PASSAGES, MAX_PASSAGE_CHARS, MAX_PASSAGE_TITLE_CHARS } from "~/lib/chat-passages";
import { MAX_TURN_STEPS } from "~/lib/chat-turns";
import { MAX_SESSION_APPEND, MAX_SESSION_MESSAGE_CHARS } from "~/lib/workspace-history";
import {
    FOLDER_VISIBILITIES,
    GRANT_LEVELS,
    PERMISSIONS,
    PRINCIPAL_TYPES,
} from "~/lib/authz/permissions";

export const createErrorResponse = (message: string, status = 400, locale: Locale = "en") => {
    return NextResponse.json(
        {
            success: false,
            error: translatorFor(locale, "errors.api")("validationError"),
            message,
        },
        { status }
    );
};

/**
 * Standard 500 response for unexpected server errors.
 * Never include error.message — log server-side instead.
 *
 * @example
 * } catch (error) {
 *   console.error('[route] error:', error)
 *   return serverError('Failed to process request')
 * }
 */
export const serverError = (message?: string, status = 500, locale: Locale = "en") => {
    return NextResponse.json(
        { success: false, error: message ?? translatorFor(locale, "errors.api")("internal") },
        { status }
    );
};

export const validateRequestBody = async <T>(
    request: Request,
    schema: z.ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; response: NextResponse }> => {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "errors.api");
    try {
        const body = (await request.json()) as unknown;
        const validatedData = schema.parse(body);
        return { success: true, data: validatedData };
    } catch (error) {
        if (error instanceof z.ZodError) {
            const detail = zodErrorText(error, locale, ", ", { pathAlways: true });
            return {
                success: false,
                response: createErrorResponse(t("invalidRequestData", { detail }), 400, locale),
            };
        }
        return {
            success: false,
            response: createErrorResponse(t("invalidJsonFormat"), 400, locale),
        };
    }
};

export const DocumentIdSchema = z.object({
    documentId: z.number().int().positive(V.documentIdPositive),
});

export const CompanyIdSchema = z.object({
    companyId: z.string().min(1, V.companyIdRequired),
});

export const PredictiveAnalysisSchema = z
    .object({
        documentId: z.number().int().positive(V.documentIdPositive),
        analysisType: z
            .enum(["contract", "financial", "technical", "compliance", "general"])
            .optional(),
        includeRelatedDocs: z.boolean().optional(),
        timeoutMs: z.number().int().min(1000).max(120000).optional(),
        forceRefresh: z.boolean().optional(),
    })
    .transform(data => ({
        documentId: data.documentId,
        analysisType: data.analysisType ?? ("general" as const),
        includeRelatedDocs: data.includeRelatedDocs ?? false,
        timeoutMs: data.timeoutMs ?? 30000,
        forceRefresh: data.forceRefresh ?? false,
    }));

const aiPersonaOptions = [
    "general",
    "learning-coach",
    "financial-expert",
    "legal-expert",
    "math-reasoning",
] as const;
const AttachmentPayloadSchema = z.object({
    url: z.string().url(V.attachmentUrlInvalid),
    name: z.string().min(1).max(512),
    mimeType: z.string().min(1).max(256),
    kind: z.enum(["image", "text"]),
});

/** A selected passage as the chat endpoint receives it (`ChatPassagePayload`). */
const ChatPassagePayloadSchema = z.object({
    documentId: z.number().int().positive().optional(),
    title: z.string().min(1).max(MAX_PASSAGE_TITLE_CHARS),
    page: z.number().int().positive().optional(),
    text: z.string().min(1).max(MAX_PASSAGE_CHARS),
});

export const QuestionSchema = z
    .object({
        documentId: z.number().int().positive().optional(),
        companyId: z.number().int().positive().optional(),
        question: z.string().min(1, V.questionRequired).max(120_000, V.questionTooLong),
        // Absent means "the person's own setting"; `bullet-points` is the old
        // name for `organized`.
        style: z.enum([...AGENT_STYLE_IDS, "bullet-points"]).optional(),
        searchScope: z.enum(["document", "company", "archive", "selected", "none"]).optional(),
        archiveName: z.string().optional(),
        // Document IDs for the "selected" scope — a user-picked subset of docs in
        // the sidebar. The route handler verifies every ID belongs to the caller's
        // company before running the multi-doc search.
        selectedDocumentIds: z.array(z.number().int().positive()).optional(),
        enableWebSearch: z.boolean().optional().default(false),
        aiPersona: z.enum(aiPersonaOptions).optional(),
        aiModel: z.string().min(1).optional(),
        provider: z.string().min(1).optional(),
        conversationHistory: z.string().max(120_000).optional(),
        /**
         * The person's own earlier messages in this chat, apart from the
         * transcript above. `fetch_page` reads links from these and the
         * question only (server/chat-web-tools.ts).
         */
        priorQuestions: z.array(z.string().max(4_000)).max(20).optional(),
        modelRoute: z.enum(["default", "fast", "reasoning", "vision"]).optional(),
        reasoningEffort: z.string().min(1).max(64).optional(),
        chatMode: z.enum(["default", "plan"]).optional().default("default"),
        stream: z.boolean().optional().default(false),
        embeddingIndexKey: z.string().min(1).optional(),
        thinkingMode: z
            .union([z.boolean(), z.literal("auto")])
            .optional()
            .default(false),
        // Ephemeral per-turn attachments (NOT indexed as Sources). Images are sent
        // as multimodal content blocks on vision-capable models; text files are
        // inlined into the prompt. Provider image and cumulative byte limits are
        // enforced separately by the route.
        attachments: z.array(AttachmentPayloadSchema).max(100).optional(),
        /**
         * Passages the reader selected in a document and is asking about.
         * They travel beside the question (which holds only what was typed);
         * the route authorizes each `documentId` against the caller's scope.
         */
        passages: z.array(ChatPassagePayloadSchema).max(MAX_PASSAGES).optional(),
        /**
         * Handle of the workspace agent answering this turn. Its standing
         * instructions, style, route and tool policy shape the answer; the
         * route resolves it against the caller's roster.
         */
        agentKey: z
            .string()
            .min(2)
            .max(48)
            .regex(/^[a-z0-9][a-z0-9_-]*$/)
            .nullable()
            .optional(),
    })
    .transform(data => {
        return {
            documentId: data.documentId,
            companyId: data.companyId,
            question: data.question,
            style: data.style,
            searchScope: data.searchScope ?? "document",
            archiveName: data.archiveName,
            selectedDocumentIds: data.selectedDocumentIds,
            enableWebSearch: data.enableWebSearch ?? false,
            aiPersona: data.aiPersona ?? "general",
            aiModel: data.aiModel,
            provider: data.provider,
            conversationHistory: data.conversationHistory,
            priorQuestions: data.priorQuestions,
            modelRoute: data.modelRoute,
            reasoningEffort: data.reasoningEffort,
            chatMode: data.chatMode,
            stream: data.stream,
            embeddingIndexKey: data.embeddingIndexKey,
            thinkingMode: data.thinkingMode ?? false,
            attachments: data.attachments,
            passages: data.passages,
            agentKey: data.agentKey ?? null,
        };
    });

export type AttachmentPayload = z.infer<typeof AttachmentPayloadSchema>;

export const ChatHistoryAddSchema = z.object({
    documentId: z.number().int().positive(V.documentIdPositive),
    question: z.string().min(1, V.questionRequired),
    documentTitle: z.string().min(1, V.documentTitleRequired),
    response: z.string().min(1, V.responseRequired),
    pages: z.array(z.number().int().positive()).optional(),
});

export const ChatHistoryFetchSchema = z.object({
    documentId: z.number().int().positive(V.documentIdPositive),
});

export const DeleteDocumentSchema = z.object({
    docId: z.string().min(1, V.documentIdRequired),
});

export const CategorySchema = z.object({
    name: z.string().min(1, V.categoryNameRequired).max(256, V.categoryNameTooLong),
    companyId: z.string().min(1, V.companyIdRequired),
});

export const ApproveEmployeeSchema = z.object({
    employeeId: z.number().int().positive(V.employeeIdPositive),
    companyId: z.string().min(1, V.companyIdRequired),
});

export const UploadDocumentSchema = z.object({
    documentName: z.string().min(1, V.documentNameRequired).max(256, V.documentNameTooLong).trim(),
    documentUrl: z.string().url(V.documentUrlInvalid).max(2048, V.documentUrlTooLong).trim(),
    documentCategory: z
        .string()
        .min(1, V.documentCategoryRequired)
        .max(256, V.documentCategoryTooLong)
        .trim(),
    enableOCR: z.boolean().optional(),
});

export const UpdateCompanySchema = z
    .object({
        // Optional: Bring your own keys saves credentials alone.
        name: z
            .string()
            .min(1, V.companyNameRequired)
            .max(256, V.companyNameTooLong)
            .trim()
            .optional(),
        description: z.string().max(5000, V.descriptionTooLong).trim().optional().nullable(),
        industry: z.string().max(256, V.industryTooLong).trim().optional().nullable(),
        embeddingIndexKey: z
            .string()
            .max(128, V.embeddingIndexKeyTooLong)
            .trim()
            .optional()
            .nullable(),
        embeddingOpenAIApiKey: z
            .string()
            .max(5000, V.openAiKeyTooLong)
            .trim()
            .optional()
            .nullable(),
        /** The OpenAI-compatible embeddings endpoint the key above belongs to. */
        embeddingOpenAIBaseUrl: z
            .string()
            .max(1024, V.embeddingsUrlTooLong)
            .trim()
            .optional()
            .nullable(),
        embeddingHuggingFaceApiKey: z
            .string()
            .max(5000, V.huggingFaceKeyTooLong)
            .trim()
            .optional()
            .nullable(),
        embeddingOllamaBaseUrl: z
            .string()
            .max(1024, V.ollamaUrlTooLong)
            .trim()
            .optional()
            .nullable(),
        embeddingOllamaModel: z
            .string()
            .max(256, V.ollamaModelTooLong)
            .trim()
            .optional()
            .nullable(),
        employerPasskey: z.string().max(256, V.employerPasskeyTooLong).trim().optional(),
        employeePasskey: z.string().max(256, V.employeePasskeyTooLong).trim().optional(),
        numberOfEmployees: z
            .string()
            .trim()
            .regex(/^\d*$/, V.employeeCountDigits)
            .max(9, V.employeeCountTooLong)
            .optional(),
        useUploadThing: z.boolean().optional(),
    })
    .transform(data => ({
        name: data.name,
        description: data.description,
        industry: data.industry,
        embeddingIndexKey:
            data.embeddingIndexKey == null
                ? data.embeddingIndexKey
                : data.embeddingIndexKey.trim()
                  ? data.embeddingIndexKey.trim()
                  : null,
        embeddingOpenAIApiKey:
            data.embeddingOpenAIApiKey == null
                ? data.embeddingOpenAIApiKey
                : data.embeddingOpenAIApiKey.trim()
                  ? data.embeddingOpenAIApiKey.trim()
                  : null,
        embeddingOpenAIBaseUrl:
            data.embeddingOpenAIBaseUrl == null
                ? data.embeddingOpenAIBaseUrl
                : data.embeddingOpenAIBaseUrl.trim()
                  ? data.embeddingOpenAIBaseUrl.trim()
                  : null,
        embeddingHuggingFaceApiKey:
            data.embeddingHuggingFaceApiKey == null
                ? data.embeddingHuggingFaceApiKey
                : data.embeddingHuggingFaceApiKey.trim()
                  ? data.embeddingHuggingFaceApiKey.trim()
                  : null,
        embeddingOllamaBaseUrl:
            data.embeddingOllamaBaseUrl == null
                ? data.embeddingOllamaBaseUrl
                : data.embeddingOllamaBaseUrl.trim()
                  ? data.embeddingOllamaBaseUrl.trim()
                  : null,
        embeddingOllamaModel:
            data.embeddingOllamaModel == null
                ? data.embeddingOllamaModel
                : data.embeddingOllamaModel.trim()
                  ? data.embeddingOllamaModel.trim()
                  : null,
        employerPasskey: data.employerPasskey,
        employeePasskey: data.employeePasskey,
        numberOfEmployees:
            data.numberOfEmployees && data.numberOfEmployees !== "" ? data.numberOfEmployees : "0",
        useUploadThing: data.useUploadThing,
    }));

// Schema for updating just the upload preference (lighter endpoint)
export const UpdateUploadPreferenceSchema = z.object({
    useUploadThing: z.boolean(),
});

// ============================================================================
// Signup & Auth Schemas
// ============================================================================

export const EmployerCompanySignupSchema = z.object({
    companyName: z.string().min(1, V.companyNameRequired).max(256).trim(),
    name: z.string().min(1, V.userNameRequired).max(256).trim(),
    email: z.string().email(V.validEmailRequired),
    numberOfEmployees: z.string().max(9).optional().default("0"),
    embeddingIndexKey: z.string().trim().optional(),
    embeddingOpenAIApiKey: z.string().nullish(),
    embeddingOpenAIBaseUrl: z.string().max(1024).nullish(),
    embeddingHuggingFaceApiKey: z.string().nullish(),
    embeddingOllamaBaseUrl: z.string().nullish(),
    embeddingOllamaModel: z.string().nullish(),
});

export const JoinWithInviteSchema = z.object({
    name: z.string().trim().min(1, V.nameRequired).max(256),
    email: z.string().trim().toLowerCase().email(V.validEmailRequired),
    inviteCode: z.string().trim().min(1, V.inviteCodeRequired).max(64),
});

// ============================================================================
// Workspace membership, roles, groups, and access
// ============================================================================

const RoleSlugSchema = z.string().trim().min(1, V.roleRequired).max(64);
const EmailSchema = z.string().trim().toLowerCase().email(V.validEmailRequired);
const NameSchema = z.string().trim().min(1, V.nameRequired).max(120);
const DescriptionSchema = z.string().trim().max(2000).nullable().optional();
const PositiveIdSchema = z.number().int().positive();

export const UpdateMemberSchema = z
    .object({
        role: RoleSlugSchema.optional(),
        status: z.enum(["active", "suspended"]).optional(),
    })
    .refine(v => v.role !== undefined || v.status !== undefined, {
        message: V.roleOrStatus,
    });

export const TransferOwnershipSchema = z.object({
    userId: PositiveIdSchema,
});

export const CreateInvitationSchema = z.object({
    email: EmailSchema,
    role: RoleSlugSchema,
    groupIds: z.array(PositiveIdSchema).max(50).optional(),
});

export const AcceptInvitationSchema = z
    .object({
        token: z.string().trim().min(1).max(256).optional(),
        invitationId: PositiveIdSchema.optional(),
        name: z.string().trim().min(1).max(256).optional(),
    })
    .refine(v => v.token !== undefined || v.invitationId !== undefined, {
        message: V.tokenOrInvitation,
    });

export const CreateJoinLinkSchema = z.object({
    role: RoleSlugSchema,
    expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
    maxUses: z.number().int().min(1).max(10_000).nullable().optional(),
    requiresApproval: z.boolean().optional(),
});

export const UpdateJoinLinkSchema = z
    .object({
        role: RoleSlugSchema.optional(),
        requiresApproval: z.boolean().optional(),
    })
    .refine(v => v.role !== undefined || v.requiresApproval !== undefined, {
        message: V.nothingToChange,
    });

export const AcceptJoinLinkSchema = z.object({
    code: z.string().trim().min(1, V.joinCodeRequired).max(64),
    name: z.string().trim().min(1).max(256).optional(),
    email: EmailSchema.optional(),
});

export const CreateGroupSchema = z.object({
    name: NameSchema,
    description: DescriptionSchema,
});

export const UpdateGroupSchema = z
    .object({
        name: NameSchema.optional(),
        description: DescriptionSchema,
    })
    .refine(v => v.name !== undefined || v.description !== undefined, {
        message: V.nameOrDescription,
    });

export const GroupMembersSchema = z.object({
    userIds: z.array(PositiveIdSchema).min(1).max(500),
});

const PermissionListSchema = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length);

export const CreateRoleSchema = z.object({
    name: NameSchema,
    description: DescriptionSchema,
    permissions: PermissionListSchema,
});

export const UpdateRoleSchema = z
    .object({
        name: NameSchema.optional(),
        description: DescriptionSchema,
        permissions: PermissionListSchema.optional(),
    })
    .refine(
        v => v.name !== undefined || v.description !== undefined || v.permissions !== undefined,
        { message: V.nothingToChange }
    );

export const DeleteRoleSchema = z.object({
    reassignTo: RoleSlugSchema.optional(),
});

const GrantInputSchema = z.object({
    principalType: z.enum(PRINCIPAL_TYPES),
    principalId: z.string().trim().min(1).max(64),
    level: z.enum(GRANT_LEVELS),
});

export const FolderAccessSchema = z.object({
    visibility: z.enum(FOLDER_VISIBILITIES),
    grants: z.array(GrantInputSchema).max(200),
});

export const DocumentAccessSchema = z.object({
    restricted: z.boolean(),
    grants: z.array(GrantInputSchema).max(200),
});

export const WorkspaceSettingsPatchSchema = z
    .object({
        auditRetentionDays: z.number().int().min(1).max(3650).nullable().optional(),
    })
    .refine(v => v.auditRetentionDays !== undefined, {
        message: V.nothingToChange,
    });

export const AuditQuerySchema = z.object({
    cursor: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    action: z.string().trim().min(1).max(64).optional(),
    actor: z.string().trim().min(1).max(256).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    format: z.enum(["json", "csv"]).optional(),
});

// ============================================================================
// Notes Schemas
// ============================================================================

/**
 * Tiptap JSON is a recursive tree; we accept any JSON-serializable value and
 * let the client be the authority on shape. Server stores it verbatim.
 */
const TiptapJsonSchema: z.ZodType<unknown> = z.any();

const QuoteSelectorSchema = z.object({
    exact: z.string().max(10_000),
    prefix: z.string().max(2000).optional(),
    suffix: z.string().max(2000).optional(),
});

const AnchorSchema = z.object({
    type: z.enum(["pdf", "docx", "media", "image", "code", "markdown", "text"]),
    // `primary` is format-specific — validated loosely so future primaries
    // don't require a schema bump. Client controls the per-format shape.
    primary: z.any().optional(),
    quote: QuoteSelectorSchema,
    chunkIdAtCreate: z.number().int().optional(),
});

export const CreateNoteSchema = z
    .object({
        documentId: z.string().optional(),
        versionId: z.union([z.number().int().positive(), z.string()]).optional(),
        title: z.string().max(512).optional(),
        content: z.string().max(50_000).optional(),
        contentRich: TiptapJsonSchema.optional(),
        contentMarkdown: z.string().max(100_000).optional(),
        anchor: AnchorSchema.optional(),
        anchorStatus: z.enum(["resolved", "drifted", "orphaned"]).optional(),
        tags: z.array(z.string().max(128)).max(50).optional(),
    })
    .refine(
        data =>
            [data.title, data.content, data.contentMarkdown, data.contentRich].some(value =>
                Boolean(value)
            ),
        {
            message: V.noteContentRequired,
        }
    );

export const UpdateNoteSchema = z.object({
    title: z.string().max(512).optional(),
    content: z.string().max(50_000).optional(),
    contentRich: TiptapJsonSchema.optional(),
    contentMarkdown: z.string().max(100_000).optional(),
    anchor: AnchorSchema.optional(),
    anchorStatus: z.enum(["resolved", "drifted", "orphaned"]).optional(),
    tags: z.array(z.string().max(128)).max(50).optional(),
});

// ============================================================================
// Document Tracking Schema
// ============================================================================

export const TrackDocumentViewSchema = z.object({
    documentId: z.number().int().positive(V.documentIdPositive),
});

// ============================================================================
// Company Schemas
// ============================================================================

export const CompanyOnboardingSchema = z.object({
    /** "acme.com" or a full URL; anything that is not a web address is ignored. */
    website: z.string().max(2048).trim().optional(),
    description: z.string().max(5000).trim().optional(),
    /** What the company is building and for whom. */
    idea: z.string().max(5000).trim().optional(),
    industry: z.string().max(256).trim().optional(),
});

// ============================================================================
// Storage Schemas
// ============================================================================

export const PresignUploadSchema = z
    .object({
        filename: z.string().optional(),
        fileName: z.string().optional(),
        contentType: z.string().min(1, V.contentTypeRequired),
    })
    .refine(data => [data.filename, data.fileName].some(value => Boolean(value)), {
        message: V.fileNameRequired,
    });

// ============================================================================
// Voice Schemas
// ============================================================================

/**
 * Matches CLOUD_TTS_MAX_INPUT_BYTES. Measured in BYTES, not characters: the
 * synthesis API counts UTF-8, so a 5,000-character limit would let non-ASCII
 * text pass validation and then fail at the provider. Duplicated as a literal
 * rather than imported because this module is on the client bundle's path.
 */
const TTS_MAX_INPUT_BYTES = 5000;

export const TextToSpeechSchema = z.object({
    text: z
        .string()
        .min(1, V.textRequired)
        .refine(
            value => new TextEncoder().encode(value).length <= TTS_MAX_INPUT_BYTES,
            v("textTooLong", { bytes: String(TTS_MAX_INPUT_BYTES) })
        ),
    voiceId: z.string().optional(),
    languageCode: z.string().optional(),
});

// ============================================================================
// AI Chatbot Schemas
// ============================================================================

export const CreateChatSchema = z.object({
    title: z.string().min(1, V.titleFieldRequired).max(512),
    agentMode: z.enum(["autonomous", "interactive", "assisted"]).optional().default("interactive"),
    visibility: z.enum(["public", "private"]).optional().default("private"),
    aiStyle: z
        .enum(["concise", "detailed", "academic", "bullet-points"])
        .optional()
        .default("concise"),
    aiPersona: z
        .enum(["general", "learning-coach", "financial-expert", "legal-expert", "math-reasoning"])
        .optional()
        .default("general"),
    documentId: z.union([z.string(), z.number()]).optional(),
});

export const UpdateChatSchema = z.object({
    title: z.string().min(1).max(512).optional(),
    status: z.enum(["active", "archived", "deleted"]).optional(),
    agentMode: z.enum(["autonomous", "interactive", "assisted"]).optional(),
    visibility: z.enum(["public", "private"]).optional(),
    aiStyle: z.enum(["concise", "detailed", "academic", "bullet-points"]).optional(),
    aiPersona: z
        .enum(["general", "learning-coach", "financial-expert", "legal-expert", "math-reasoning"])
        .optional(),
});

export const CreateMessageSchema = z.object({
    chatId: z.string().min(1, V.chatIdRequired),
    role: z.enum(["user", "assistant", "system", "tool"]),
    content: z.unknown(),
    messageType: z
        .enum(["text", "tool_call", "tool_result", "thinking"])
        .optional()
        .default("text"),
    parentMessageId: z.string().min(1).optional(),
});

export const CreateVoteSchema = z.object({
    chatId: z.string().min(1, V.chatIdRequired),
    messageId: z.string().min(1, V.messageIdRequired),
    isUpvoted: z.boolean(),
    feedback: z.string().max(2000).optional(),
});

export const CreateTaskSchema = z.object({
    chatId: z.string().min(1, V.chatIdRequired),
    description: z.string().min(1, V.descriptionFieldRequired).max(2000),
    objective: z.string().min(1, V.objectiveRequired).max(2000),
    priority: z.number().int().min(0).max(100).optional().default(0),
    metadata: z.unknown().optional(),
});

export const UpdateTaskSchema = z.object({
    status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional(),
    result: z.unknown().optional(),
    metadata: z.unknown().optional(),
    completedAt: z.union([z.string().datetime(), z.date()]).optional(),
});

export const CreateToolCallSchema = z.object({
    messageId: z.string().min(1, V.messageIdRequired),
    taskId: z.string().min(1).optional(),
    toolName: z.string().min(1, V.toolNameRequired),
    toolInput: z.unknown(),
});

export const UpdateToolCallSchema = z.object({
    toolOutput: z.unknown().optional(),
    status: z.enum(["pending", "running", "completed", "failed"]).optional(),
    errorMessage: z.string().max(5000).optional(),
    executionTimeMs: z.number().int().min(0).optional(),
});

export const CreateMemorySchema = z.object({
    chatId: z.string().min(1, V.chatIdRequired),
    memoryType: z.enum(["short_term", "long_term", "working", "episodic"]),
    key: z.string().min(1, V.keyRequired).max(512),
    value: z.unknown(),
    importance: z.number().int().min(0).max(10).optional().default(5),
    embedding: z.array(z.number()).optional(),
    expiresAt: z.union([z.string().datetime(), z.date()]).optional(),
});

export const CreateExecutionStepSchema = z.object({
    taskId: z.string().min(1, V.taskIdRequired),
    stepNumber: z.number().int().min(0),
    stepType: z.enum(["reasoning", "planning", "execution", "evaluation", "decision"]),
    description: z.string().min(1, V.descriptionFieldRequired).max(5000),
    reasoning: z.string().max(10000).optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
});

export const UpdateExecutionStepSchema = z.object({
    status: z.enum(["pending", "in_progress", "completed", "failed", "skipped"]).optional(),
    output: z.unknown().optional(),
    reasoning: z.string().max(10000).optional(),
});

// ============================================================================
// Mindmap (the diagramming app)
// ============================================================================

/**
 * The document body is validated on the client by `parseDoc`, which already
 * has to tolerate documents written by older builds. A second, stricter copy
 * of the shape here would reject files the editor can happily open, so the API
 * only asserts "a JSON object" and lets the parser normalise it.
 */
const MindmapDocSchema = z.record(z.unknown());

export const CreateMindmapSchema = z.object({
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(2000).optional(),
    templateId: z.string().min(1).max(64).optional(),
    folder: z.string().min(1).max(256).optional(),
    doc: MindmapDocSchema.optional(),
});

export const UpdateMindmapSchema = z
    .object({
        title: z.string().min(1).max(300).optional(),
        description: z.string().max(2000).nullable().optional(),
        folder: z.string().min(1).max(256).optional(),
        starred: z.boolean().optional(),
        doc: MindmapDocSchema.optional(),
        thumbnail: z.string().max(2_000_000).nullable().optional(),
        /**
         * Revision the client last saw. A mismatch means another tab saved in
         * the meantime, so the write is rejected with 409 instead of silently
         * overwriting the newer document.
         */
        baseRevision: z.number().int().min(0).optional(),
        /** Also write a version-history snapshot for this save. */
        snapshot: z.boolean().optional(),
        snapshotLabel: z.string().max(200).optional(),
        /** Bring the map back out of the trash. */
        restore: z.boolean().optional(),
    })
    .refine(data => Object.keys(data).length > 0, { message: V.noFieldsToUpdate });

export const PublishMindmapSchema = z.object({
    /** Folder in the Sources library to file the exported document under. */
    category: z.string().min(1).max(256).optional(),
    /**
     * Accepted and ignored. Older editors sent their own rendering of the
     * map; the server now renders the outline from the stored document, so
     * what enters the retrieval corpus is what is actually saved.
     */
    markdown: z.string().max(5_000_000).optional(),
});

// ============================================================================
// Claude artifacts (imported pages, diagrams, and snippets)
// ============================================================================

export const ImportArtifactSchema = z
    .object({
        title: z.string().min(1).max(300).optional(),
        description: z.string().max(2000).optional(),
        folder: z.string().min(1).max(256).optional(),
        /** Provenance — usually a claude.ai share link. Kept even for pastes. */
        sourceUrl: z.string().url().max(2048).optional(),
        /** The artifact body, when pasting or uploading a file. */
        content: z.string().min(1).max(MAX_ARTIFACT_BYTES).optional(),
        /** How the body arrived, for provenance display; `url` is set server-side. */
        importMethod: z.enum(["paste", "upload"]).optional(),
        /** Explicit type; detected from the body when omitted. */
        artifactType: z.enum(ARTIFACT_TYPES).optional(),
        /** Fetch the body from `sourceUrl` server-side instead of sending it. */
        fetchFromUrl: z.boolean().optional(),
    })
    .refine(data => data.content !== undefined || (data.fetchFromUrl && data.sourceUrl), {
        message: V.artifactContentRequired,
    });

export const UpdateArtifactSchema = z
    .object({
        title: z.string().min(1).max(300).optional(),
        description: z.string().max(2000).nullable().optional(),
        folder: z.string().min(1).max(256).optional(),
        starred: z.boolean().optional(),
        sourceUrl: z.string().url().max(2048).nullable().optional(),
        artifactType: z.enum(ARTIFACT_TYPES).optional(),
        /** Replace the body (re-derives size, hash, and search text). */
        content: z.string().min(1).max(MAX_ARTIFACT_BYTES).optional(),
        /** Bring the artifact back out of the trash. */
        restore: z.boolean().optional(),
    })
    .refine(data => Object.keys(data).length > 0, { message: V.noFieldsToUpdate });

// ---------------------------------------------------------------------------
// Workspace chat sessions (sidebar History)
// ---------------------------------------------------------------------------

/**
 * One stored turn. `citations` and `attachments` travel as opaque JSON: they
 * are the UI's own render payload (`ThreadReference`, `EphemeralAttachment`),
 * replayed verbatim when the session is reopened, and pinning their shape here
 * would mean a schema change every time a citation gains a field. They are
 * bounded instead of parsed — an array cap plus the text cap is what keeps a
 * session row from becoming a dumping ground.
 */
export const ChatSendPayloadSchema = z.object({
    recallText: z.string().max(120_000).optional(),
    origin: z.enum(["user", "attachment", "plan-implementation"]).optional(),
    text: z.string().max(120_000),
    refs: z.array(z.string().max(64)).max(200),
    attachments: z
        .array(
            z.object({
                id: z.string().max(128),
                name: z.string().max(512),
                mimeType: z.string().max(256),
                size: z
                    .number()
                    .nonnegative()
                    .max(50 * 1024 * 1024),
                url: z.string().url().max(4096),
                kind: z.enum(["image", "text"]),
            })
        )
        .max(100),
    webSearch: z.boolean(),
    thinking: z.boolean(),
    agentKey: z.string().max(64).nullable(),
    modelRoute: z.enum(["default", "fast", "reasoning", "vision"]).optional(),
    reasoningEffort: z.string().max(64).optional(),
    chatMode: z.enum(["default", "plan"]).optional(),
    followUp: z.enum(["queue", "interrupt"]).optional(),
    modelRoutes: z
        .array(z.enum(["default", "fast", "reasoning", "vision"]))
        .max(4)
        .optional(),
    threadRefs: z.array(z.string().min(1).max(64)).max(20).optional(),
    /** Selected passages (`ChatPassage`), so a saved or queued turn keeps them. */
    passages: z
        .array(
            z.object({
                sourceId: z.string().min(1).max(64),
                documentId: z.number().int().positive().optional(),
                title: z.string().min(1).max(MAX_PASSAGE_TITLE_CHARS),
                page: z.number().int().positive().optional(),
                text: z.string().min(1).max(MAX_PASSAGE_CHARS),
            })
        )
        .max(MAX_PASSAGES)
        .optional(),
});

export const ChatQueueSchema = z
    .object({
        revision: z.number().int().nonnegative(),
        items: z
            .array(z.object({ id: z.string().min(1).max(128), send: ChatSendPayloadSchema }))
            .max(50),
    })
    .refine(data => new Set(data.items.map(item => item.id)).size === data.items.length, {
        message: V.queueIdsUnique,
    });
export const ClaimChatQueueSchema = z.object({
    revision: z.number().int().nonnegative(),
    id: z.string().min(1).max(128),
});
export const TruncateSessionSchema = z.object({
    keepCount: z.number().int().nonnegative(),
    expectedCount: z.number().int().nonnegative(),
});

export const SessionMessageSchema = z.object({
    role: z.enum(["user", "assistant"]),
    text: z.string().max(MAX_SESSION_MESSAGE_CHARS),
    refs: z.array(z.string().max(64)).max(200).optional(),
    // One per cited source: an answer about every attached file cites each one.
    citations: z.array(z.unknown()).max(100).optional(),
    attachments: z.array(z.unknown()).max(100).optional(),
    model: z.string().max(120).nullable().optional(),
    tokens: z.number().int().nonnegative().nullable().optional(),
    /** Agent handle that produced (assistant) or was addressed by (user) the turn. */
    agentKey: z.string().max(64).nullable().optional(),
    metadata: z
        .object({
            forkedFromSessionId: z.string().max(128).optional(),
            /** Kept only when it copies an asker the server already recorded. */
            askedBy: z.string().max(256).optional(),
            intent: z.enum(["queued", "interrupt"]).optional(),
            id: z.string().max(128).optional(),
            status: z.enum(["complete", "stopped", "error"]).optional(),
            reasoning: z.string().max(MAX_SESSION_MESSAGE_CHARS).optional(),
            elapsedMs: z.number().nonnegative().optional(),
            steps: z
                .array(
                    z.object({
                        id: z.string().min(1).max(64),
                        label: z.string().max(500),
                        detail: z.string().max(500).optional(),
                        state: z.enum(["active", "done"]),
                        startMs: z.number().nonnegative().optional(),
                        endMs: z.number().nonnegative().optional(),
                    })
                )
                .max(MAX_TURN_STEPS)
                .optional(),
            thoughtMs: z.number().nonnegative().optional(),
            send: ChatSendPayloadSchema.optional(),
            tokenBreakdown: z
                .object({
                    inputTokens: z.number().nonnegative(),
                    outputTokens: z.number().nonnegative(),
                })
                .optional(),
            chunksAnalyzed: z.number().nonnegative().optional(),
            webSources: z
                .array(z.object({ title: z.string().max(500), url: z.string().url().max(2000) }))
                .max(20)
                .optional(),
            createdSources: z
                .array(
                    z.object({
                        documentId: z.number().int().positive(),
                        title: z.string().max(300),
                        folder: z.string().max(300),
                    })
                )
                .max(5)
                .optional(),
        })
        .optional(),
});

const SessionAgentKeySchema = z.string().max(64).nullable().optional();

export const CreateSessionSchema = z.object({
    title: z.string().min(1).max(300).optional(),
    messages: z.array(SessionMessageSchema).min(1).max(MAX_SESSION_APPEND),
    contextSourceIds: z.array(z.string().max(64)).max(200).optional(),
    continuation: z
        .object({ title: z.string().max(300), context: z.string().max(20_000) })
        .nullable()
        .optional(),
    /** The agent the chat is held with. Null = the default assistant. */
    agentKey: SessionAgentKeySchema,
});

export const AppendSessionMessagesSchema = z.object({
    messages: z.array(SessionMessageSchema).min(1).max(MAX_SESSION_APPEND),
    contextSourceIds: z.array(z.string().max(64)).max(200).optional(),
    agentKey: SessionAgentKeySchema,
});

export const UpdateSessionSchema = z
    .object({
        title: z.string().min(1).max(300).optional(),
        agentKey: SessionAgentKeySchema,
    })
    .refine(data => Object.keys(data).length > 0, { message: V.noFieldsToUpdate });

/**
 * Chat sharing (ADR-014): people, groups or roles at `view`, plus "Everyone at
 * <workspace>" as `general`. Chats have no other level.
 */
export const ChatSharingSchema = z.object({
    general: z.enum(["private", "workspace"]),
    grants: z
        .array(
            z.object({
                principalType: z.enum(PRINCIPAL_TYPES),
                principalId: z.string().trim().min(1).max(64),
                level: z.literal("view").default("view"),
            })
        )
        .max(200),
});

/** One person's organisation of one chat: pin, archive, mark read. */
export const SessionStateSchema = z
    .object({
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
        seen: z.literal(true).optional(),
    })
    .refine(data => data.pinned !== undefined || data.archived !== undefined || data.seen, {
        message: V.noFieldsToUpdate,
    });

/** The caller's pinned chats, top first. */
export const PinOrderSchema = z.object({
    ids: z.array(z.string().min(1).max(64)).max(500),
});

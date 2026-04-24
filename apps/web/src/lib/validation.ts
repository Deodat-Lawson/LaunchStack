import { z } from "zod";
import { NextResponse } from "next/server";
import {
  AIModelTypes,
  LLMProviders,
  isModelAllowedForProvider,
  type AIModelType,
  type LLMProvider,
} from "~/app/api/agents/documentQ&A/services/types";

export const createErrorResponse = (message: string, status = 400) => {
  return NextResponse.json(
    {
      success: false,
      error: "Validation Error",
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
export const serverError = (message = "Internal server error", status = 500) => {
  return NextResponse.json({ success: false, error: message }, { status });
};

export const validateRequestBody = async <T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; response: NextResponse }> => {
  try {
    const body = await request.json() as unknown;
    const validatedData = schema.parse(body);
    return { success: true, data: validatedData };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors
        .map((err) => `${err.path.join(".")}: ${err.message}`)
        .join(", ");
      return {
        success: false,
        response: createErrorResponse(`Invalid request data: ${errorMessage}`),
      };
    }
    return {
      success: false,
      response: createErrorResponse("Invalid JSON format"),
    };
  }
};

export const DocumentIdSchema = z.object({
  documentId: z.number().int().positive("Document ID must be a positive integer"),
});

export const UserIdSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
});

export const CompanyIdSchema = z.object({
  companyId: z.string().min(1, "Company ID is required"),
});

export const PredictiveAnalysisSchema = z.object({
  documentId: z.number().int().positive("Document ID must be a positive integer"),
  analysisType: z
    .enum(["contract", "financial", "technical", "compliance", "general"])
    .optional(),
  includeRelatedDocs: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  forceRefresh: z.boolean().optional(),
}).transform((data) => ({
  documentId: data.documentId,
  analysisType: data.analysisType ?? "general" as const,
  includeRelatedDocs: data.includeRelatedDocs ?? false,
  timeoutMs: data.timeoutMs ?? 30000,
  forceRefresh: data.forceRefresh ?? false,
}));

const aiPersonaOptions = ["general", "learning-coach", "financial-expert", "legal-expert", "math-reasoning"] as const;
const aiModelOptions = AIModelTypes;
const providerOptions = LLMProviders;

function assertProviderModelCombination(
  provider: LLMProvider,
  model: AIModelType | undefined,
  ctx: z.RefinementCtx,
) {
  if (model && !isModelAllowedForProvider(provider, model)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["aiModel"],
      message: `Model \"${String(model)}\" is not available for provider \"${String(provider)}\"`,
    });
  }
}

const AttachmentPayloadSchema = z.object({
  url: z.string().url("Attachment url must be a valid URL"),
  name: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(256),
  kind: z.enum(["image", "text"]),
});

export const QuestionSchema = z
  .object({
    documentId: z.number().int().positive().optional(),
    companyId: z.number().int().positive().optional(),
    question: z.string().min(1, "Question is required"),
    style: z.enum(["concise", "detailed", "academic", "bullet-points"]).optional(),
    searchScope: z.enum(["document", "company", "archive", "selected"]).optional(),
    archiveName: z.string().optional(),
    // Document IDs for the "selected" scope — a user-picked subset of docs in
    // the sidebar. The route handler verifies every ID belongs to the caller's
    // company before running the multi-doc search.
    selectedDocumentIds: z.array(z.number().int().positive()).optional(),
    enableWebSearch: z.boolean().optional().default(false),
    aiPersona: z.enum(aiPersonaOptions).optional(),
    aiModel: z.enum(aiModelOptions).optional(),
    provider: z.enum(providerOptions).default("openai"),
    conversationHistory: z.string().optional(),
    embeddingIndexKey: z.string().min(1).optional(),
    thinkingMode: z.boolean().optional().default(false),
    // Ephemeral per-turn attachments (NOT indexed as Sources). Images are sent
    // as multimodal content blocks on vision-capable models; text files are
    // inlined into the prompt. Capped at 5 to bound context growth.
    attachments: z.array(AttachmentPayloadSchema).max(5).optional(),
  })
  .superRefine((data, ctx) => {
    assertProviderModelCombination(data.provider, data.aiModel, ctx);
  })
  .transform((data) => {
    return {
      documentId: data.documentId,
      companyId: data.companyId,
      question: data.question,
      style: data.style ?? "concise",
      searchScope: data.searchScope ?? "document",
      archiveName: data.archiveName,
      selectedDocumentIds: data.selectedDocumentIds,
      enableWebSearch: data.enableWebSearch ?? false,
      aiPersona: data.aiPersona ?? "general",
      aiModel: data.aiModel,
      provider: data.provider,
      conversationHistory: data.conversationHistory,
      embeddingIndexKey: data.embeddingIndexKey,
      thinkingMode: data.thinkingMode ?? false,
      attachments: data.attachments,
    };
  });

export type AttachmentPayload = z.infer<typeof AttachmentPayloadSchema>;

export const ChatHistoryAddSchema = z.object({
  documentId: z.number().int().positive("Document ID must be a positive integer"),
  question: z.string().min(1, "Question is required"),
  documentTitle: z.string().min(1, "Document title is required"),
  response: z.string().min(1, "Response is required"),
  pages: z.array(z.number().int().positive()).optional(),
});

export const ChatHistoryFetchSchema = z.object({
  documentId: z.number().int().positive("Document ID must be a positive integer"),
});

export const DeleteDocumentSchema = z.object({
  docId: z.string().min(1, "Document ID is required"),
});

export const CategorySchema = z.object({
  name: z.string().min(1, "Category name is required").max(256, "Category name is too long"),
  companyId: z.string().min(1, "Company ID is required"),
});

export const ApproveEmployeeSchema = z.object({
  employeeId: z.number().int().positive("Employee ID must be a positive integer"),
  companyId: z.string().min(1, "Company ID is required"),
});

export const UploadDocumentSchema = z.object({
  userId: z.string().min(1, "User ID is required").max(256, "User ID is too long").trim(),
  documentName: z.string().min(1, "Document name is required").max(256, "Document name is too long").trim(),
  documentUrl: z.string().url("Document URL must be a valid URL").max(2048, "Document URL is too long").trim(),
  documentCategory: z.string().min(1, "Document category is required").max(256, "Document category is too long").trim(),
  enableOCR: z.boolean().optional(),
});

export const UpdateCompanySchema = z.object({
  name: z.string().min(1, "Company name is required").max(256, "Company name is too long").trim(),
  description: z.string().max(5000, "Description is too long").trim().optional().nullable(),
  industry: z.string().max(256, "Industry is too long").trim().optional().nullable(),
  embeddingIndexKey: z.string().max(128, "Embedding index key is too long").trim().optional().nullable(),
  embeddingOpenAIApiKey: z.string().max(5000, "OpenAI API key is too long").trim().optional().nullable(),
  embeddingHuggingFaceApiKey: z.string().max(5000, "Hugging Face API key is too long").trim().optional().nullable(),
  embeddingOllamaBaseUrl: z.string().max(1024, "Ollama base URL is too long").trim().optional().nullable(),
  embeddingOllamaModel: z.string().max(256, "Ollama model is too long").trim().optional().nullable(),
  employerPasskey: z.string().max(256, "Employer passkey is too long").trim().optional(),
  employeePasskey: z.string().max(256, "Employee passkey is too long").trim().optional(),
  numberOfEmployees: z
    .string()
    .trim()
    .regex(/^\d*$/, "Number of employees must contain only digits")
    .max(9, "Number of employees is too long")
    .optional(),
  useUploadThing: z.boolean().optional(),
}).transform((data) => ({
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
  numberOfEmployees: data.numberOfEmployees && data.numberOfEmployees !== "" ? data.numberOfEmployees : "0",
  useUploadThing: data.useUploadThing,
}));

// Schema for updating just the upload preference (lighter endpoint)
export const UpdateUploadPreferenceSchema = z.object({
  useUploadThing: z.boolean(),
});

export const EmployeeAuthSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  companyPasskey: z.string().min(1, "Company passkey is required"),
});

export const EmployerAuthSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  companyPasskey: z.string().min(1, "Company passkey is required"),
});

// ============================================================================
// RLM (Recursive Language Model) Query Schema
// ============================================================================

const semanticTypeOptions = [
  "narrative",
  "procedural",
  "tabular",
  "legal",
  "financial",
  "technical",
  "reference",
] as const;

const prioritizeOptions = ["start", "end", "relevance"] as const;

/**
 * Schema for RLM-style hierarchical document queries
 * Extends QuestionSchema with cost-aware retrieval options
 */
// ============================================================================
// Signup & Auth Schemas
// ============================================================================

export const EmployerCompanySignupSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  companyName: z.string().min(1, "Company name is required").max(256).trim(),
  name: z.string().min(1, "User name is required").max(256).trim(),
  email: z.string().email("Valid email is required"),
  numberOfEmployees: z.string().max(9).optional().default("0"),
  embeddingIndexKey: z.string().trim().optional(),
  embeddingOpenAIApiKey: z.string().nullish(),
  embeddingHuggingFaceApiKey: z.string().nullish(),
  embeddingOllamaBaseUrl: z.string().nullish(),
  embeddingOllamaModel: z.string().nullish(),
});

export const EmployerSignupSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  name: z.string().min(1, "Name is required").max(256).trim(),
  email: z.string().email("Valid email is required"),
  employerPasskey: z.string().min(1, "Employer passkey is required"),
  companyName: z.string().min(1, "Company name is required").max(256).trim(),
});

export const EmployeeSignupSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  name: z.string().min(1, "Name is required").max(256).trim(),
  email: z.string().email("Valid email is required"),
  employeePasskey: z.string().min(1, "Employee passkey is required"),
  companyName: z.string().min(1, "Company name is required").max(256).trim(),
});

export const JoinWithInviteSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  name: z.string().min(1, "Name is required").max(256).trim(),
  email: z.string().email("Valid email is required"),
  inviteCode: z.string().min(1, "Invite code is required").trim(),
});

// ============================================================================
// Employee Management Schemas
// ============================================================================

export const ApproveEmployeeByIdSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
});

export const RemoveEmployeeSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
});

// ============================================================================
// Invite Code Schemas
// ============================================================================

export const GenerateInviteCodeSchema = z.object({
  role: z.enum(["employer", "employee"], {
    errorMap: () => ({ message: "Role must be 'employer' or 'employee'" }),
  }),
});

export const ValidateInviteCodeSchema = z.object({
  code: z.string().min(1, "Invite code is required").trim(),
});

export const DeactivateInviteCodeSchema = z.object({
  codeId: z.number().int().positive("Code ID must be a positive integer"),
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
    companyId: z.string().optional(),
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
    (data) =>
      Boolean(
        data.title || data.content || data.contentMarkdown || data.contentRich,
      ),
    {
      message:
        "At least one of title, content, contentMarkdown, or contentRich is required",
    },
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
  documentId: z.number().int().positive("Document ID must be a positive integer"),
});

// ============================================================================
// Company Schemas
// ============================================================================

export const CompanyOnboardingSchema = z.object({
  description: z.string().max(5000).trim().optional(),
  industry: z.string().max(256).trim().optional(),
});

export const CompanyMetadataExtractSchema = z.object({
  debug: z.boolean().optional().default(false),
  force: z.boolean().optional().default(false),
});

// ============================================================================
// Storage Schemas
// ============================================================================

export const PresignUploadSchema = z.object({
  filename: z.string().optional(),
  fileName: z.string().optional(),
  contentType: z.string().min(1, "contentType is required"),
}).refine((data) => data.filename || data.fileName, {
  message: "filename or fileName is required",
});

// ============================================================================
// Voice Schemas
// ============================================================================

export const TextToSpeechSchema = z.object({
  text: z.string().min(1, "Text is required").max(10000),
  voiceId: z.string().optional(),
  modelId: z.string().optional(),
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
  useSpeakerBoost: z.boolean().optional(),
});

// ============================================================================
// AI Chatbot Schemas
// ============================================================================

export const CreateChatSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  title: z.string().min(1, "title is required").max(512),
  agentMode: z.enum(["autonomous", "interactive", "assisted"]).optional().default("interactive"),
  visibility: z.enum(["public", "private"]).optional().default("private"),
  aiStyle: z.enum(["concise", "detailed", "academic", "bullet-points"]).optional().default("concise"),
  aiPersona: z.enum(["general", "learning-coach", "financial-expert", "legal-expert", "math-reasoning"]).optional().default("general"),
  documentId: z.union([z.string(), z.number()]).optional(),
});

export const UpdateChatSchema = z.object({
  title: z.string().min(1).max(512).optional(),
  status: z.enum(["active", "archived", "deleted"]).optional(),
  agentMode: z.enum(["autonomous", "interactive", "assisted"]).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  aiStyle: z.enum(["concise", "detailed", "academic", "bullet-points"]).optional(),
  aiPersona: z.enum(["general", "learning-coach", "financial-expert", "legal-expert", "math-reasoning"]).optional(),
});

export const CreateMessageSchema = z.object({
  chatId: z.string().min(1, "chatId is required"),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.unknown(),
  messageType: z.enum(["text", "tool_call", "tool_result", "thinking"]).optional().default("text"),
  parentMessageId: z.string().optional(),
});

export const CreateVoteSchema = z.object({
  chatId: z.string().min(1, "chatId is required"),
  messageId: z.string().min(1, "messageId is required"),
  isUpvoted: z.boolean(),
  feedback: z.string().max(2000).optional(),
});

export const CreateTaskSchema = z.object({
  chatId: z.string().min(1, "chatId is required"),
  description: z.string().min(1, "description is required").max(2000),
  objective: z.string().min(1, "objective is required").max(2000),
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
  messageId: z.string().min(1, "messageId is required"),
  taskId: z.string().optional(),
  toolName: z.string().min(1, "toolName is required"),
  toolInput: z.unknown(),
});

export const UpdateToolCallSchema = z.object({
  toolOutput: z.unknown().optional(),
  status: z.enum(["pending", "running", "completed", "failed"]).optional(),
  errorMessage: z.string().max(5000).optional(),
  executionTimeMs: z.number().int().min(0).optional(),
});

export const CreateMemorySchema = z.object({
  chatId: z.string().min(1, "chatId is required"),
  memoryType: z.enum(["short_term", "long_term", "working", "episodic"]),
  key: z.string().min(1, "key is required").max(512),
  value: z.unknown(),
  importance: z.number().int().min(0).max(10).optional().default(5),
  embedding: z.array(z.number()).optional(),
  expiresAt: z.union([z.string().datetime(), z.date()]).optional(),
});

export const CreateExecutionStepSchema = z.object({
  taskId: z.string().min(1, "taskId is required"),
  stepNumber: z.number().int().min(0),
  stepType: z.enum(["reasoning", "planning", "execution", "evaluation", "decision"]),
  description: z.string().min(1, "description is required").max(5000),
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
// RLM (Recursive Language Model) Query Schema
// ============================================================================

export const RLMQuestionSchema = z
  .object({
    documentId: z.number().int().positive("Document ID must be a positive integer"),
    question: z.string().min(1, "Question is required"),
    // Standard options
    style: z.enum(["concise", "detailed", "academic", "bullet-points"]).optional(),
    enableWebSearch: z.boolean().optional().default(false),
    aiPersona: z.enum(aiPersonaOptions).optional(),
    aiModel: z.enum(aiModelOptions).optional(),
    provider: z.enum(providerOptions).default("openai"),
    conversationHistory: z.string().optional(),
    embeddingIndexKey: z.string().min(1).optional(),
    // RLM-specific options
    maxTokens: z.number().int().min(500).max(100000).optional(),
    includeOverview: z.boolean().optional(),
    includePreviews: z.boolean().optional(),
    semanticTypes: z.array(z.enum(semanticTypeOptions)).optional(),
    prioritize: z.enum(prioritizeOptions).optional(),
    pageRange: z
      .object({
        start: z.number().int().min(0),
        end: z.number().int().min(0),
      })
      .refine((data) => data.end >= data.start, {
        message: "pageRange.end must be >= pageRange.start",
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    assertProviderModelCombination(data.provider, data.aiModel, ctx);
  })
  .transform((data) => {
    return {
      documentId: data.documentId,
      question: data.question,
      style: data.style ?? "concise",
      enableWebSearch: data.enableWebSearch ?? false,
      aiPersona: data.aiPersona ?? "general",
      aiModel: data.aiModel,
      provider: data.provider,
      conversationHistory: data.conversationHistory,
      embeddingIndexKey: data.embeddingIndexKey,
      maxTokens: data.maxTokens ?? 4000,
      includeOverview: data.includeOverview ?? true,
      includePreviews: data.includePreviews ?? false,
      semanticTypes: data.semanticTypes,
      prioritize: data.prioritize ?? "relevance",
      pageRange: data.pageRange,
    };
  });

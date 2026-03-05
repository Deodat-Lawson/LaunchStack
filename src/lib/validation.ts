import { z } from "zod";
import { NextResponse } from "next/server";

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
const aiModelOptions = ["gpt-4o", "gpt-5.2", "gpt-5.1", "gpt-5-nano", "gpt-5-mini", "claude-sonnet-4", "claude-opus-4.5", "gemini-2.5-flash", "gemini-3-flash", "gemini-3-pro"] as const;

export const QuestionSchema = z.object({
  documentId: z.number().int().positive().optional(),
  companyId: z.number().int().positive().optional(),
  question: z.string().min(1, "Question is required"),
  style: z.enum(["concise", "detailed", "academic", "bullet-points"]).optional(),
  searchScope: z.enum(["document", "company"]).optional(),
  enableWebSearch: z.boolean().optional().default(false),
  aiPersona: z.enum(aiPersonaOptions).optional(),
  aiModel: z.enum(aiModelOptions).optional(),
  conversationHistory: z.string().optional(),
}).transform((data) => ({
  documentId: data.documentId,
  companyId: data.companyId,
  question: data.question,
  style: data.style ?? "concise" as const,
  searchScope: data.searchScope ?? "document" as const,
  enableWebSearch: data.enableWebSearch ?? false,
  aiPersona: data.aiPersona ?? "general",
  aiModel: data.aiModel ?? "gpt-4o" as const,
  conversationHistory: data.conversationHistory,
}));

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
export const RLMQuestionSchema = z.object({
  documentId: z.number().int().positive("Document ID must be a positive integer"),
  question: z.string().min(1, "Question is required"),
  // Standard options
  style: z.enum(["concise", "detailed", "academic", "bullet-points"]).optional(),
  enableWebSearch: z.boolean().optional().default(false),
  aiPersona: z.enum(aiPersonaOptions).optional(),
  aiModel: z.enum(aiModelOptions).optional(),
  conversationHistory: z.string().optional(),
  // RLM-specific options
  maxTokens: z.number().int().min(500).max(100000).optional(),
  includeOverview: z.boolean().optional(),
  includePreviews: z.boolean().optional(),
  semanticTypes: z.array(z.enum(semanticTypeOptions)).optional(),
  prioritize: z.enum(prioritizeOptions).optional(),
  pageRange: z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  }).refine((data) => data.end >= data.start, {
    message: "pageRange.end must be >= pageRange.start",
  }).optional(),
}).transform((data) => ({
  documentId: data.documentId,
  question: data.question,
  style: data.style ?? "concise" as const,
  enableWebSearch: data.enableWebSearch ?? false,
  aiPersona: data.aiPersona ?? "general",
  aiModel: data.aiModel ?? "gpt-4o" as const,
  conversationHistory: data.conversationHistory,
  maxTokens: data.maxTokens ?? 4000,
  includeOverview: data.includeOverview ?? true,
  includePreviews: data.includePreviews ?? false,
  semanticTypes: data.semanticTypes,
  prioritize: data.prioritize ?? "relevance" as const,
  pageRange: data.pageRange,
}));

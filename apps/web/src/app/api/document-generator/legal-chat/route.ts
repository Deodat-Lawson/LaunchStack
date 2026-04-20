import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel } from "~/lib/models";
import { db } from "~/server/db";
import { users } from "@launchstack/core/db/schema";
import { companyMetadata } from "@launchstack/core/db/schema/company-metadata";
import { TEMPLATE_REGISTRY } from "~/lib/legal-templates/template-service";
import type { CompanyMetadataJSON } from "~/lib/tools/company-metadata/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// ─── Request schema ────────────────────────────────────────────────────────────

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const LegalChatSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  accumulatedFields: z.record(z.coerce.string()).optional(),
});

// ─── Template summary for the LLM ─────────────────────────────────────────────

function buildTemplateSummary(): string {
  return Object.values(TEMPLATE_REGISTRY)
    .map(
      (t) =>
        `- id: "${t.id}" | name: "${t.name}" | description: "${t.description}" | fields: ${t.fields.length} (required: ${t.fields.filter((f) => f.required).length})`
    )
    .join("\n");
}

function buildFieldList(templateId: string): string {
  const template = TEMPLATE_REGISTRY[templateId];
  if (!template) return "";
  return template.fields
    .map((f) => {
      let desc = `- key: "${f.key}" | label: "${f.label}" | type: ${f.type} | required: ${f.required}`;
      if (f.options) desc += ` | options: [${f.options.join(", ")}]`;
      return desc;
    })
    .join("\n");
}

// ─── Company metadata helper ───────────────────────────────────────────────────

function extractCompanyDefaults(
  meta: CompanyMetadataJSON | null
): Record<string, string> {
  if (!meta) return {};
  const defaults: Record<string, string> = {};
  const c = meta.company;
  if (c?.name?.value) defaults.company_name = c.name.value;
  if (c?.headquarters?.value) {
    defaults.company_address = c.headquarters.value;
    defaults.governing_law_jurisdiction = c.headquarters.value;
  }
  return defaults;
}

// ─── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(
  templateSummary: string,
  companyDefaults: Record<string, string>
): string {
  const defaultsNote =
    Object.keys(companyDefaults).length > 0
      ? `\nCompany defaults (pre-filled, mention these are pre-filled when relevant):\n${JSON.stringify(companyDefaults, null, 2)}`
      : "";

  return `You are a legal document assistant that helps users select the right legal template and collect the information needed to generate it.

AVAILABLE TEMPLATES:
${templateSummary}
${defaultsNote}

YOUR JOB:
1. Understand the user's intent from their natural language description.
2. Recommend one or more matching templates. If multiple fit, list the top candidates (max 3) ranked by relevance.
3. If no template is a good fit, suggest the closest alternative and explain why.
4. Once a template is confirmed, collect missing required fields through conversation. Ask for at most 2-3 RELATED fields per message (e.g. "Investor Name" and "Investor Address" together is fine). NEVER list all remaining fields at once — this overwhelms the user and causes ambiguous answers. Fields that share units or types (e.g. two dollar amounts like Investment Amount and Valuation Cap) must ALWAYS be asked separately with clear labels so answers are unambiguous.
5. When you have all required fields, indicate readiness to generate.
6. If the user changes their mind about a template mid-conversation, smoothly switch to the new template while preserving any field values that have the same key in the new template.

RESPONSE FORMAT:
You must respond with valid JSON matching this exact structure:
{
  "message": "Your conversational response to the user (supports markdown formatting)",
  "phase": "recommending" | "confirmed" | "collecting" | "ready",
  "recommendedTemplates": [
    {
      "templateId": "template_id",
      "confidence": 0.0 to 1.0,
      "reason": "One sentence on why this fits"
    }
  ],
  "selectedTemplateId": null | "template_id",
  "extractedFields": { "field_key": "value" },
  "missingRequiredFields": ["field_key1", "field_key2"]
}

PHASE DEFINITIONS:
- "recommending": You've identified potential templates but user hasn't confirmed one yet.
- "confirmed": User just confirmed a template. You should start asking for missing fields.
- "collecting": A template is selected, you're gathering field values through conversation.
- "ready": All required fields are collected. Include a summary in your message.

RULES:
- Be concise and professional. Don't overwhelm the user.
- Use markdown in the "message" field for formatting (bullets, bold, etc.).
- CRITICAL: When referring to fields, you MUST use the exact field labels provided in the FIELD DETAILS section below. Never invent or paraphrase field names.
- CRITICAL: When extracting field values, you MUST use the exact field keys (e.g. "company_name", not "Company Name") in the extractedFields object.
- For select fields, present the exact options as listed. The user must pick one of them.
- For date fields, accept natural language ("today", "next Monday") and convert to YYYY-MM-DD.
- If the user provides information that maps to multiple fields, extract all of them.
- Always include ALL previously extracted fields in extractedFields (accumulate, never drop).
- Company defaults should be included in extractedFields from the start.
- When a user says something like "use this one" or "yes, that one" or "the first one", treat it as confirming the top recommended template.
- If the user wants to switch templates, carry over any extractedFields whose keys exist in the new template.
- Do NOT summarize or list already-collected fields in your message. The user can see them in a sidebar. Only ask about fields that are still missing.
- When the user provides a value for a specific field (e.g. "Pro Rata Rights: no"), map it directly to the correct field key without asking for clarification.`;
}

// ─── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    let body: unknown;
    try {
      body = (await request.json()) as unknown;
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const parsed = LegalChatSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid input",
          errors: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    // Fetch user's company
    const [requestingUser] = await db
      .select()
      .from(users)
      .where(eq(users.userId, userId))
      .limit(1);

    if (!requestingUser) {
      return NextResponse.json(
        { success: false, message: "User not found" },
        { status: 404 }
      );
    }

    const companyId = Number(requestingUser.companyId);

    // Fetch company metadata for pre-filling
    let companyDefaults: Record<string, string> = {};
    if (!Number.isNaN(companyId)) {
      const [metaRow] = await db
        .select({ metadata: companyMetadata.metadata })
        .from(companyMetadata)
        .where(eq(companyMetadata.companyId, BigInt(companyId)))
        .limit(1);

      if (metaRow?.metadata) {
        companyDefaults = extractCompanyDefaults(
          metaRow.metadata as CompanyMetadataJSON
        );
      }
    }

    // Build conversation for the LLM
    const templateSummary = buildTemplateSummary();
    const systemPrompt = buildSystemPrompt(templateSummary, companyDefaults);

    // Include field details when a template has been selected in prior messages
    const lastAssistantMsg = [...parsed.data.messages]
      .reverse()
      .find((m) => m.role === "assistant");

    let fieldContext = "";
    if (lastAssistantMsg) {
      try {
        const lastResponse = JSON.parse(lastAssistantMsg.content) as {
          selectedTemplateId?: string | null;
        };
        if (lastResponse.selectedTemplateId) {
          fieldContext = `\n\nFIELD DETAILS FOR SELECTED TEMPLATE "${lastResponse.selectedTemplateId}" (use these EXACT labels and keys):\n${buildFieldList(lastResponse.selectedTemplateId)}`;
        }
      } catch {
        // Not JSON - ignore
      }
    }

    // Build LangChain messages with proper role mapping
    const langchainMessages = [
      new SystemMessage(systemPrompt + fieldContext),
      ...parsed.data.messages.map((m) =>
        m.role === "user"
          ? new HumanMessage(m.content)
          : new AIMessage(m.content)
      ),
    ];

    // Inject accumulated fields as a separate system-context message after conversation
    // (kept out of the main system prompt to limit prompt-injection surface from client data)
    const clientFields = parsed.data.accumulatedFields;
    if (clientFields && Object.keys(clientFields).length > 0) {
      // Sanitize: only keep string key/value pairs, strip control characters
      const sanitized: Record<string, string> = {};
      for (const [key, value] of Object.entries(clientFields)) {
        if (typeof key === "string" && typeof value === "string") {
          sanitized[key.slice(0, 100)] = value.slice(0, 1000);
        }
      }
      if (Object.keys(sanitized).length > 0) {
        langchainMessages.push(
          new HumanMessage(
            `[SYSTEM CONTEXT] Already collected field values (include these in extractedFields, do NOT ask for them again):\n${JSON.stringify(sanitized)}`
          )
        );
      }
    }

    const chat = getChatModel("gpt-4o");
    const response = await chat.invoke(langchainMessages);
    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Try to parse as JSON, fall back to wrapping in a message
    let responseData: Record<string, unknown>;
    try {
      // Strip markdown code fences if present
      const cleaned = content
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/\n?```\s*$/i, "")
        .trim();
      responseData = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      responseData = {
        message: content,
        phase: "recommending",
        recommendedTemplates: [],
        selectedTemplateId: null,
        extractedFields: {},
        missingRequiredFields: [],
      };
    }

    // Enrich recommended templates with registry metadata
    const recommendedTemplates = (
      responseData.recommendedTemplates as Array<{
        templateId: string;
        confidence: number;
        reason: string;
      }>
    )?.map((rec) => {
      const template = TEMPLATE_REGISTRY[rec.templateId];
      return {
        ...rec,
        name: template?.name ?? rec.templateId,
        description: template?.description ?? "",
        fieldCount: template?.fields.length ?? 0,
        requiredFieldCount:
          template?.fields.filter((f) => f.required).length ?? 0,
        requiredFieldLabels: template
          ? template.fields.filter((f) => f.required).map((f) => f.label)
          : [],
      };
    }) ?? [];

    return NextResponse.json({
      success: true,
      data: {
        ...responseData,
        recommendedTemplates,
        companyDefaults,
      },
    });
  } catch (error) {
    const errMessage =
      error instanceof Error ? error.message : String(error);
    console.error("[legal-chat] POST error:", error);

    const hint =
      !process.env.OPENAI_API_KEY &&
      errMessage.toLowerCase().includes("openai")
        ? " (Ensure OPENAI_API_KEY is set in .env)"
        : "";

    return NextResponse.json(
      {
        success: false,
        message: "Failed to process legal chat",
        error: errMessage + hint,
      },
      { status: 500 }
    );
  }
}

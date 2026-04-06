import { NextResponse } from "next/server";
import { auth } from "~/lib/auth-server";
import { z } from "zod";
import {
  generateDocument,
  TEMPLATE_REGISTRY,
} from "~/lib/legal-templates/template-service";
import { buildEditorSections } from "~/lib/legal-templates/section-builders";

export const runtime = "nodejs";

const GenerateSchema = z.object({
  templateId: z.string(),
  data: z.record(z.string()),
  format: z.enum(["docx", "json"]).default("json"),
});

export async function GET() {
  const templates = Object.values(TEMPLATE_REGISTRY).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    fields: t.fields,
  }));
  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const parsed = GenerateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request", details: parsed.error.errors },
        { status: 400 }
      );
    }

    const { templateId, data, format } = parsed.data;

    const template = TEMPLATE_REGISTRY[templateId];
    if (!template) {
      return NextResponse.json(
        { success: false, error: `Unknown template: ${templateId}` },
        { status: 400 }
      );
    }

    const result = generateDocument(templateId, data);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: result.errors },
        { status: 422 }
      );
    }

    if (format === "docx") {
      return new NextResponse(result.document ? new Uint8Array(result.document) : null, {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${result.filename}"`,
        },
      });
    }

    const sections = buildEditorSections(template, data);
    const docxBase64 = result.document
      ? result.document.toString("base64")
      : null;

    return NextResponse.json({
      success: true,
      templateId,
      title: template.name,
      sections,
      docxBase64,
      filename: result.filename,
    });
  } catch (error) {
    console.error("Legal document generation error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

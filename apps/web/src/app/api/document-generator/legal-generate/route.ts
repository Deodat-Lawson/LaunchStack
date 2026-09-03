import { NextResponse } from "next/server";
import { z } from "zod";
import { TEMPLATE_REGISTRY, buildEditorSections } from "@launchstack/pipelines/legal-templates";
import { generateDocument } from "@launchstack/pipelines/legal-templates/template-service";
import { RenderingServiceError } from "@launchstack/document-conversion-engine";
import { getGotenbergClient } from "~/server/rendering";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export const runtime = "nodejs";
// "pdf" adds a LibreOffice round trip through Gotenberg on top of templating.
export const maxDuration = 60;

const GenerateSchema = z.object({
    templateId: z.string(),
    data: z.record(z.string()),
    format: z.enum(["docx", "pdf", "json"]).default("json"),
});

export async function GET() {
    const templates = Object.values(TEMPLATE_REGISTRY).map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        fields: t.fields,
    }));
    return NextResponse.json({ templates });
}

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const body: unknown = await request.json();
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
                {
                    success: false,
                    error: "Validation failed",
                    details: result.errors,
                    fieldErrors: result.fieldErrors ?? {},
                },
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

        // The generated DOCX rendered to PDF by Gotenberg's LibreOffice
        // (ADR-009). No fallback here — a legal document with approximated
        // layout is worse than an honest 503, unlike the free-form export.
        if (format === "pdf") {
            if (!result.document) {
                return NextResponse.json(
                    { success: false, error: "Template produced no document" },
                    { status: 500 }
                );
            }
            const gotenberg = getGotenbergClient();
            if (!gotenberg) {
                return NextResponse.json(
                    {
                        success: false,
                        error: "service_not_configured",
                        message:
                            "PDF rendering is not configured. Set GOTENBERG_SERVICE_URL (and " +
                            "its basic-auth pair), or download the document as DOCX instead.",
                    },
                    { status: 503 }
                );
            }
            try {
                const { pdf } = await gotenberg.officeToPdf({
                    file: result.document,
                    filename: result.filename,
                });
                const pdfName = result.filename.replace(/\.docx$/i, ".pdf");
                return new NextResponse(new Uint8Array(pdf), {
                    status: 200,
                    headers: {
                        "Content-Type": "application/pdf",
                        "Content-Disposition": `attachment; filename="${pdfName}"`,
                    },
                });
            } catch (err) {
                if (err instanceof RenderingServiceError) {
                    const status =
                        err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 502;
                    const trace = err.trace ? ` (trace ${err.trace})` : "";
                    return NextResponse.json(
                        {
                            success: false,
                            error: "rendering_failed",
                            message: `${err.detail}${trace}`,
                        },
                        { status }
                    );
                }
                throw err;
            }
        }

        const sections = buildEditorSections(template, data);
        const docxBase64 = result.document ? result.document.toString("base64") : null;

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
                message: "Failed to generate legal document",
            },
            { status: 500 }
        );
    }
}

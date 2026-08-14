import { NextResponse } from "next/server";

import {
  generateTemplate,
  reviewTemplate,
} from "@launchstack/features/email-pipeline";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/email-pipeline/generate
 * Generates a company-grounded outreach template for the active company and
 * reviews it with an LLM. Body: { goal? }. No emails are sent.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    let body: { goal?: string };
    try {
      body = (await request.json()) as { goal?: string };
    } catch {
      body = {};
    }

    const companyId = Number(ctx.data.companyId);

    const { template, companyContext } = await generateTemplate({
      companyId,
      goal: body.goal,
    });
    const review = await reviewTemplate({ template, companyContext });

    return NextResponse.json({ success: true, data: { template, review } });
  } catch (error) {
    console.error("[email-pipeline/generate] failed:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to generate email template",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  generateTemplate,
  reviewTemplate,
} from "@launchstack/features/email-pipeline";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  goal: z.string().max(2000).optional(),
});

/**
 * POST /api/email-pipeline/generate
 * Generates a company-grounded outreach template for the active company and
 * reviews it with an LLM. Body: { goal? }. No emails are sent.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      json = {};
    }
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid input",
          errors: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const companyId = Number(ctx.data.companyId);

    const { template, companyContext } = await generateTemplate({
      companyId,
      goal: parsed.data.goal,
    });
    const review = await reviewTemplate({ template, companyContext });

    return NextResponse.json({ success: true, data: { template, review } });
  } catch (error) {
    console.error("[email-pipeline/generate] failed:", error);
    return NextResponse.json(
      { success: false, message: "Failed to generate email template" },
      { status: 500 },
    );
  }
}

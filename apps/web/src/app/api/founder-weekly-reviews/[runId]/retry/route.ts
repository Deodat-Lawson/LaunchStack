import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { getActiveCompanyContext } from "~/lib/active-workspace";
import { retryRunWithDispatch } from "~/server/founder-weekly-review/dispatch-service";
import { safeFounderWeeklyReviewError, safeRun } from "~/server/founder-weekly-review/http";
import { inngest } from "~/server/inngest/client";
const RetrySchema = z.object({ requestKey: z.string().min(1).max(128) });
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { userId } = await auth(); if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = RetrySchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try { const context = await getActiveCompanyContext(userId); const { runId } = await params;
    const { run } = await retryRunWithDispatch({ actor: { externalUserId: userId, internalUserId: context.userId, companyId: context.companyId, role: context.role }, runId, requestKey: parsed.data.requestKey });
    await inngest.send({ name: "founder-weekly-review/dispatch.requested", data: {} });
    return NextResponse.json({ run: safeRun(run) }, { status: 202 });
  } catch (error) { return safeFounderWeeklyReviewError(error); }
}

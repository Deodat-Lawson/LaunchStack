import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getActiveCompanyContext } from "~/lib/active-workspace";
import { FounderWeeklyReviewUserService } from "@launchstack/features/founder-weekly-review";
import { safeFounderWeeklyReviewError, safeRun } from "~/server/founder-weekly-review/http";
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { userId } = await auth(); if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const context = await getActiveCompanyContext(userId); const { runId } = await params;
    const run = await new FounderWeeklyReviewUserService().getRun({ externalUserId: userId, internalUserId: context.userId, companyId: context.companyId, role: context.role }, runId);
    return NextResponse.json({ run: safeRun(run) });
  } catch (error) { return safeFounderWeeklyReviewError(error); }
}

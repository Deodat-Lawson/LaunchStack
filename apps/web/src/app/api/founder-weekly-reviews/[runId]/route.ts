import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { productionFounderWeeklyReviewActorResolver } from "~/server/founder-weekly-review/actor-resolver";
import { FounderWeeklyReviewUserService } from "@launchstack/features/founder-weekly-review";
import { safeFounderWeeklyReviewError, safeRun } from "~/server/founder-weekly-review/http";
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { userId } = await auth(); if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const actor = await productionFounderWeeklyReviewActorResolver.resolve(userId); const { runId } = await params;
    const run = await new FounderWeeklyReviewUserService().getRun(actor, runId);
    return NextResponse.json({ run: safeRun(run) });
  } catch (error) { return safeFounderWeeklyReviewError(error); }
}

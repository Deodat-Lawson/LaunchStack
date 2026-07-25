import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { getActiveCompanyContext } from "~/lib/active-workspace";
import { unavailableFounderWeeklyReviewEvidenceCollector } from "~/server/founder-weekly-review/evidence-collector";
import { createRunWithDispatch } from "~/server/founder-weekly-review/dispatch-service";
import { safeFounderWeeklyReviewError, safeRun } from "~/server/founder-weekly-review/http";
import { inngest } from "~/server/inngest/client";

const CreateSchema = z.object({ requestKey: z.string().min(1).max(128), reportingPeriod: z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), workspaceTimezone: z.string().min(1).max(128), founderContext: z.string().max(4000).optional() });

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const context = await getActiveCompanyContext(userId);
    const evidenceSnapshot = await unavailableFounderWeeklyReviewEvidenceCollector.collectFounderWeeklyReviewEvidence({ companyId: context.companyId, reportingPeriod: parsed.data.reportingPeriod, workspaceTimezone: parsed.data.workspaceTimezone, founderContext: parsed.data.founderContext });
    const { run } = await createRunWithDispatch({ actor: { externalUserId: userId, internalUserId: context.userId, companyId: context.companyId, role: context.role }, requestKey: parsed.data.requestKey, reportingPeriod: parsed.data.reportingPeriod, evidenceSnapshot });
    await inngest.send({ name: "founder-weekly-review/dispatch.requested", data: {} });
    return NextResponse.json({ run: safeRun(run) }, { status: 202 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "evidence_collector_unavailable") return NextResponse.json({ error: "Generation unavailable" }, { status: 503 });
    return safeFounderWeeklyReviewError(error);
  }
}

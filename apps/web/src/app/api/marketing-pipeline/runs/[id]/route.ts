// GET /api/marketing-pipeline/runs/[id]?after=<n> — a run's status, the progress
//   events after cursor n, and its result once completed. Polling a run whose
//   inline executor went away resumes it from its checkpoints.
import type { NextRequest } from "next/server";

import { getMarketingRun } from "@launchstack/pipelines/marketing/runs";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { fail, ok } from "~/server/api/responses";
import { resumeIfStalled } from "~/server/marketing/executor";
import { toRunView } from "~/server/marketing/run-view";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "growth.server.marketing");
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const { id } = await params;
        const run = await getMarketingRun(id, ctx.data.companyId);
        if (!run) return fail(t("runNotFound"), 404);
        resumeIfStalled(run);
        const after = Number.parseInt(request.nextUrl.searchParams.get("after") ?? "0", 10);
        return ok({ run: toRunView(run, Number.isFinite(after) ? after : 0, locale) });
    } catch (error) {
        console.error("[marketing-run] GET run error:", error);
        return fail(t("runReadFailed"), 500);
    }
}

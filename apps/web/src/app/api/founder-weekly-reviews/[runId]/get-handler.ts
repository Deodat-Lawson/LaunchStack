/**
 * Factory for the run GET handler, in its own module because Next.js route
 * files may only export route fields — the factory is exported for
 * dependency-injected tests (read-retry-route.test.ts).
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import type { FounderWeeklyReviewUserService } from "@launchstack/features/founder-weekly-review";
import type { FounderWeeklyReviewActorResolver } from "~/server/founder-weekly-review/actor-resolver";
import { safeFounderWeeklyReviewError, safeRun } from "~/server/founder-weekly-review/http";

export interface FounderWeeklyReviewGetRouteDependencies {
    actorResolver: Pick<FounderWeeklyReviewActorResolver, "resolve">;
    getRun: (
        actor: Parameters<FounderWeeklyReviewUserService["getRun"]>[0],
        runId: string
    ) => ReturnType<FounderWeeklyReviewUserService["getRun"]>;
}

export function createFounderWeeklyReviewGetHandler(deps: FounderWeeklyReviewGetRouteDependencies) {
    return async function GET(
        _request: Request,
        { params }: { params: Promise<{ runId: string }> }
    ) {
        const { userId } = await auth();
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        try {
            const actor = await deps.actorResolver.resolve(userId);
            const { runId } = await params;
            const run = await deps.getRun(actor, runId);
            return NextResponse.json({ run: safeRun(run) });
        } catch (error) {
            return safeFounderWeeklyReviewError(error);
        }
    };
}

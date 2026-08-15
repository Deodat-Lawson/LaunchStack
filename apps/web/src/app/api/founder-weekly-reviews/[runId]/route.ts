import { FounderWeeklyReviewUserService } from "@launchstack/features/founder-weekly-review";
import { productionFounderWeeklyReviewActorResolver } from "~/server/founder-weekly-review/actor-resolver";
import { createFounderWeeklyReviewGetHandler } from "./get-handler";

export const GET = createFounderWeeklyReviewGetHandler({
    actorResolver: productionFounderWeeklyReviewActorResolver,
    getRun: (actor, runId) => new FounderWeeklyReviewUserService().getRun(actor, runId),
});

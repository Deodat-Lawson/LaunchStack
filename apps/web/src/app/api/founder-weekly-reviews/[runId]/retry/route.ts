import { productionFounderWeeklyReviewActorResolver } from "~/server/founder-weekly-review/actor-resolver";
import { retryRunWithDispatch } from "~/server/founder-weekly-review/dispatch-service";
import { inngest } from "~/server/inngest/client";
import { founderWeeklyReviewRetries } from "~/server/founder-weekly-review/observability";
import { createFounderWeeklyReviewRetryPostHandler } from "./retry-handler";

export const POST = createFounderWeeklyReviewRetryPostHandler({
    actorResolver: productionFounderWeeklyReviewActorResolver,
    retryRunWithDispatch,
    sendDispatchRequested: () =>
        inngest.send({ name: "founder-weekly-review/dispatch.requested", data: {} }),
    incrementRetry: () => founderWeeklyReviewRetries.inc(),
});

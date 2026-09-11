import { FounderWeeklyReviewRepository } from "@launchstack/pipelines/founder-weekly-review";
import { productionFounderWeeklyReviewActorResolver } from "~/server/founder-weekly-review/actor-resolver";
import { createRunWithDispatch } from "~/server/founder-weekly-review/dispatch-service";
import { inngest } from "~/server/inngest/client";
import { founderWeeklyReviewRunsCreated } from "~/server/founder-weekly-review/observability";
import {
    createFounderWeeklyReviewPostHandler,
    type FounderWeeklyReviewRouteDependencies,
} from "./create-handler";

const productionDependencies: FounderWeeklyReviewRouteDependencies = {
    actorResolver: productionFounderWeeklyReviewActorResolver,
    repository: {
        getByCompanyAndRequestKey: (companyId, requestKey) =>
            new FounderWeeklyReviewRepository().getByCompanyAndRequestKey(companyId, requestKey),
    },
    createRunWithDispatch,
    sendDispatchRequested: () =>
        inngest.send({ name: "founder-weekly-review/dispatch.requested", data: {} }),
    recordRunCreated: () => founderWeeklyReviewRunsCreated.inc(),
};
export const POST = createFounderWeeklyReviewPostHandler(productionDependencies);

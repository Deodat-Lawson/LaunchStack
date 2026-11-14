/**
 * `report` — the one-call v1 report over the finished world, which must be
 * the world the last checkpoint recorded. Finishes the run.
 */
import { buildReportRequest, parseReport } from "@launchstack/simulation";

import { stateHash } from "../hash";
import type { Stage } from "../stage";

export const reportStage: Stage = async ctx => {
    const world = ctx.run.world;
    if (!world) throw new Error("The run has no world");
    const last = (await ctx.artifacts.checkpoints()).sort((a, b) => b.round - a.round)[0];
    if (!last || last.round !== world.round || last.stateHash !== stateHash(world))
        throw new Error("The run's world does not match its last checkpoint");
    const reply = await ctx.model.complete(buildReportRequest(world));
    const report = parseReport(reply.text, world);
    if (!report) throw new Error("The report could not be read");
    return {
        output: { headline: report.headline, rounds: world.round },
        run: { report, status: "done", finishedAt: ctx.ports.now() },
    };
};

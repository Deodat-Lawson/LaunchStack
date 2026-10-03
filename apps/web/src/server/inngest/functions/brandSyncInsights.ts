/**
 * Brand read-back: every six hours, read each workspace's published posts'
 * numbers, its channels' followers and the comments on recent posts from
 * LinkedIn and Bluesky. Six hours keeps one LinkedIn Page well inside the
 * development tier's 500 calls a day; "Sync now" covers the moments between.
 *
 * One step per workspace, so a slow or failing network for one workspace
 * neither holds up nor repeats the others when Inngest retries a step.
 */
import { listBrandSyncWorkspaces, syncBrandWorkspace } from "~/server/brand/sync";

import { inngest } from "../client";

export const brandSyncInsightsCron = inngest.createFunction(
    { id: "brand-sync-insights", name: "Brand: read back numbers and comments", retries: 0 },
    { cron: "17 */6 * * *" },
    async ({ step }) => {
        const workspaces = await step.run("list-workspaces", async () =>
            (await listBrandSyncWorkspaces()).map(id => id.toString())
        );
        let errors = 0;
        for (const id of workspaces) {
            const summary = await step.run(`sync-${id}`, async () => {
                const out = await syncBrandWorkspace(BigInt(id), new Date());
                return { posts: out.posts, comments: out.comments, errors: out.errors };
            });
            errors += summary.errors.length;
        }
        return { workspaces: workspaces.length, errors };
    }
);

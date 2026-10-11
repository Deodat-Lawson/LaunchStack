/**
 * Brand read-back: every six hours, read each workspace's published posts'
 * numbers, its channels' followers and the comments on recent posts from
 * LinkedIn and Bluesky. Six hours keeps one LinkedIn Page well inside the
 * development tier's 500 calls a day; "Sync now" covers the moments between.
 */
import { syncAllBrandWorkspaces } from "~/server/brand/sync";

import { inngest } from "../client";

export const brandSyncInsightsCron = inngest.createFunction(
    { id: "brand-sync-insights", name: "Brand: read back numbers and comments", retries: 0 },
    { cron: "17 */6 * * *" },
    async ({ step }) => step.run("sync", () => syncAllBrandWorkspaces(new Date()))
);

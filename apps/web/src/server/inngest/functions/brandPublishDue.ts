/**
 * The Brand scheduler: every minute, publish every post whose time has come.
 * Each row is claimed with one conditional update before its network is
 * called, so this cron and the web app's own due-check never post twice.
 */
import { publishDueBrandPosts } from "@launchstack/pipelines/marketing/posts";

import { inngest } from "../client";

export const brandPublishDueCron = inngest.createFunction(
    { id: "brand-publish-due", name: "Brand: publish scheduled posts", retries: 0 },
    { cron: "* * * * *" },
    async ({ step }) => {
        const result = await step.run("publish-due", async () => {
            const out = await publishDueBrandPosts({ now: new Date(), limit: 50 });
            return {
                published: out.published.map(p => p.id),
                failed: out.failed.map(p => p.id),
                skipped: out.skipped,
            };
        });
        return result;
    }
);

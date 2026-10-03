/**
 * The Brand scheduler: every minute, publish every post whose time has come,
 * including posts whose retry time after a transient failure has arrived.
 * Each row is claimed with one conditional update before its network is
 * called, so this cron and a "Publish overdue" click never post twice.
 * Retries are per row (attempts, next_attempt_at), not per cron invocation.
 */
import { publishDueBrandPosts } from "@launchstack/pipelines/marketing/posts";

import { inngest } from "../client";
import { publishForWorkspace } from "~/server/brand/publish";

export const brandPublishDueCron = inngest.createFunction(
    { id: "brand-publish-due", name: "Brand: publish scheduled posts", retries: 0 },
    { cron: "* * * * *" },
    async ({ step }) => {
        const result = await step.run("publish-due", async () => {
            const out = await publishDueBrandPosts({
                now: new Date(),
                limit: 50,
                publish: publishForWorkspace,
            });
            return {
                published: out.published.map(p => p.id),
                retrying: out.retrying.map(p => p.id),
                failed: out.failed.map(p => p.id),
                skipped: out.skipped,
            };
        });
        return result;
    }
);

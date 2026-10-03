/**
 * The one way a Brand post reaches a network from this host: resolve the
 * workspace's credential, post, record the outcome. Used by the scheduler
 * on the worker, by "Publish now", and by "Publish overdue"; the pipelines
 * package cannot see workspaces, so it takes this function as its port.
 */
import type { PublishFn } from "@launchstack/pipelines/marketing/posts";
import { publishToPlatform, type PublishResult } from "@launchstack/tools/social-publish";

import { brandPublishTotal } from "~/server/metrics/registry";

import { markBrandAccountRevoked, resolveBrandCredentials } from "./accounts";

function outcome(result: PublishResult): string {
    if (result.success) return "published";
    if (result.authFailed) return "auth_failed";
    if (result.retryable) return "retryable";
    return "failed";
}

export const publishForWorkspace: PublishFn = async post => {
    const resolved = await resolveBrandCredentials(post.companyId, post.platform);
    let result: PublishResult;
    if (resolved.kind === "revoked") {
        result = {
            success: false,
            platform: post.platform,
            error: `${resolved.reason}. Reconnect the account under Accounts.`,
            authFailed: true,
            retryable: false,
        };
    } else if (resolved.kind === "none") {
        result = {
            success: false,
            platform: post.platform,
            error: "This network is not connected for this workspace.",
            authFailed: false,
            retryable: false,
        };
    } else {
        result = await publishToPlatform({
            platform: post.platform,
            message: post.body,
            title: post.title ?? undefined,
            credentials: resolved.kind === "workspace" ? resolved.credentials : undefined,
        });
        if (!result.success && result.authFailed && resolved.kind === "workspace") {
            await markBrandAccountRevoked(
                post.companyId,
                post.platform,
                result.error ?? "The network refused the credential"
            );
        }
    }
    brandPublishTotal.inc({ platform: post.platform, result: outcome(result) });
    return result;
};

/**
 * The one way a Brand post reaches a network from this host: find the
 * workspace channel it goes out as, get a live credential for it, load its
 * images, post, and react to a refused credential by asking for a
 * reconnect. Used by the scheduler on the worker, by Publish now and by
 * Publish overdue; the pipelines package cannot see workspaces, so it takes
 * this function as its port.
 */
import type { PublishFn } from "@launchstack/pipelines/marketing/posts";
import { publishToPlatform, type PublishResult } from "@launchstack/tools/social-publish";

import {
    ChannelUnavailableError,
    getChannelRow,
    markConnectionReconnect,
    NETWORK_LABELS,
    parseDeploymentChannelId,
    refusedSignInReason,
    resolveChannelTarget,
} from "./channels";
import { deploymentAccountRefusal, mayUseDeploymentAccounts } from "./deployment-accounts";
import { BrandMediaError, loadPublishMedia } from "./media";

export const publishForWorkspace: PublishFn = async post => {
    const fail = (error: string, extra: Partial<PublishResult> = {}): PublishResult => ({
        success: false,
        platform: post.platform,
        error,
        ...extra,
    });

    let media;
    try {
        media = await loadPublishMedia(post.companyId, post.media);
    } catch (error) {
        if (error instanceof BrandMediaError) return fail(error.message);
        // Storage down is worth another try.
        return fail(error instanceof Error ? error.message : String(error), { retryable: true });
    }

    // Posts from before channels, and the deployment's own account — which
    // belongs to one workspace. Asked again here, not only at compose time:
    // a post scheduled before a second workspace joined must not go out as
    // the first one.
    if (post.channelId === null || parseDeploymentChannelId(post.channelId)) {
        if (!(await mayUseDeploymentAccounts(post.companyId)))
            return fail(deploymentAccountRefusal(NETWORK_LABELS[post.platform]));
        return publishToPlatform({
            platform: post.platform,
            message: post.body,
            title: post.title ?? undefined,
            media,
        });
    }

    const channel = await getChannelRow(post.companyId, post.channelId);
    if (!channel)
        return fail("This channel was disconnected. Pick another channel and publish again.");
    if (channel.platform !== post.platform)
        return fail("This post's channel is on another network.");

    let target;
    try {
        target = await resolveChannelTarget(channel);
    } catch (error) {
        if (error instanceof ChannelUnavailableError) {
            return fail(error.message, {
                authFailed: error.reconnect,
                retryable: !error.reconnect,
            });
        }
        return fail(error instanceof Error ? error.message : String(error), { retryable: true });
    }

    const result = await publishToPlatform({
        platform: post.platform,
        message: post.body,
        title: post.title ?? undefined,
        target,
        media,
    });
    if (!result.success && result.authFailed) {
        const reason = refusedSignInReason(channel.platform);
        await markConnectionReconnect(channel.connectionId, reason);
        return { ...result, error: `${reason} (${result.error ?? "authorization failed"})` };
    }
    return result;
};

/**
 * Slack wiring for this deployment.
 *
 * Both halves are optional and independent: `SLACK_BOT_TOKEN` enables posting
 * meeting turns into a channel, `SLACK_SIGNING_SECRET` enables accepting
 * events back. A deployment with only the token gets a read-only mirror, which
 * is a perfectly reasonable configuration — so neither is treated as implying
 * the other.
 */

import { HttpSlackClient, type SlackClient } from "@launchstack/core/collab";
import { env } from "~/env";

const globalForSlack = globalThis as unknown as { __collabSlackClient?: SlackClient | null };

/** Returns null when no bot token is configured. */
export function getSlackClient(): SlackClient | null {
    if (globalForSlack.__collabSlackClient !== undefined) {
        return globalForSlack.__collabSlackClient;
    }
    const botToken = env.server.SLACK_BOT_TOKEN;
    globalForSlack.__collabSlackClient = botToken ? new HttpSlackClient({ botToken }) : null;
    return globalForSlack.__collabSlackClient;
}

export function getSlackSigningSecret(): string | null {
    return env.server.SLACK_SIGNING_SECRET ?? null;
}

export interface SlackIntegrationStatus {
    /** Outbound mirroring is possible. */
    canPost: boolean;
    /** Inbound events can be verified, so humans can steer from Slack. */
    canReceive: boolean;
    /** What an operator still has to configure. */
    missing: string[];
}

export function getSlackStatus(): SlackIntegrationStatus {
    const canPost = Boolean(env.server.SLACK_BOT_TOKEN);
    const canReceive = Boolean(env.server.SLACK_SIGNING_SECRET);
    const missing: string[] = [];
    if (!canPost) missing.push("SLACK_BOT_TOKEN");
    if (!canReceive) missing.push("SLACK_SIGNING_SECRET");
    return { canPost, canReceive, missing };
}

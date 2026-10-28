import "server-only";

/**
 * Tells the operator's chat that a report arrived — one line in Slack or
 * Discord, with a link to it in Triage.
 *
 * The line carries the kind, a bug's severity, the title and the link, and
 * nothing else: no body, no context, no screenshots. Those can hold whatever
 * was on the reporter's screen, and a channel is read by more people than the
 * triagers the report was filed for. The link opens behind the app's own
 * sign-in and access check.
 *
 * `FEEDBACK_WEBHOOK_URL` is a secret (anyone holding it can post to the
 * channel), so it is never logged. Discord's hosts get `{ content }`; anything
 * else gets Slack's `{ text }`, which most chat webhooks also accept. Sending
 * is fire-and-forget after the report is stored: it has 5 seconds, never
 * throws, and a failure is a log line, not a failed report.
 */

import type { BugSeverity, FeedbackKind } from "~/lib/feedback/contract";
import { feedbackReportHref } from "~/lib/feedback/contract";

export interface WebhookReport {
    id: number;
    kind: FeedbackKind;
    title: string;
    severity: BugSeverity | null;
}

export const WEBHOOK_TIMEOUT_MS = 5_000;

const SEVERITY_LABEL: Record<BugSeverity, string> = {
    blocking: "Blocking",
    annoying: "Annoying",
    cosmetic: "Cosmetic",
};

const DISCORD_HOSTS = ["discord.com", "discordapp.com"];

/** The configured URL, or null when it is unset or not an http(s) URL. */
export function feedbackWebhookUrl(raw = process.env.FEEDBACK_WEBHOOK_URL): URL | null {
    const value = raw?.trim();
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:" ? url : null;
    } catch {
        return null;
    }
}

export function isDiscordWebhook(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return DISCORD_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));
}

/** One line, so a title cannot start a paragraph of its own. */
function oneLine(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

/** Slack reads `<…>` as links and mentions (`<!channel>`) and `&` as an entity. */
function slackEscape(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** `New bug (Blocking): Upload fails — https://…` */
export function feedbackWebhookLine(
    report: WebhookReport,
    origin: string,
    discord: boolean
): string {
    const what =
        report.kind === "bug"
            ? report.severity
                ? `New bug (${SEVERITY_LABEL[report.severity]})`
                : "New bug"
            : "New feature request";
    const title = discord ? oneLine(report.title) : slackEscape(oneLine(report.title));
    const link = `${origin.replace(/\/+$/, "")}${feedbackReportHref(report.id, "triage")}`;
    return `${what}: ${title} — ${link}`;
}

export type FeedbackWebhookPayload =
    | { content: string; allowed_mentions: { parse: [] } }
    | { text: string };

export function feedbackWebhookPayload(
    url: URL,
    report: WebhookReport,
    origin: string
): FeedbackWebhookPayload {
    if (isDiscordWebhook(url)) {
        // No @everyone / role / user pings, whatever the title says.
        return {
            content: feedbackWebhookLine(report, origin, true),
            allowed_mentions: { parse: [] },
        };
    }
    return { text: feedbackWebhookLine(report, origin, false) };
}

/** Posts the line. Resolves whether or not it worked; never throws. */
export async function sendFeedbackWebhook(
    report: WebhookReport,
    origin: string,
    options: { url?: URL | null; fetchImpl?: typeof fetch } = {}
): Promise<boolean> {
    const url = options.url === undefined ? feedbackWebhookUrl() : options.url;
    if (!url) return false;
    const doFetch = options.fetchImpl ?? fetch;
    try {
        const response = await doFetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(feedbackWebhookPayload(url, report, origin)),
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
            redirect: "error",
        });
        if (!response.ok) {
            console.warn(
                `[feedback webhook] report ${report.id}: the webhook answered ${response.status}`
            );
            return false;
        }
        return true;
    } catch (error) {
        const reason = error instanceof Error ? error.name : "unknown error";
        console.warn(`[feedback webhook] report ${report.id}: not delivered (${reason})`);
        return false;
    }
}

/** Sends in the background; the caller's response does not wait for the channel. */
export function queueFeedbackWebhook(report: WebhookReport, origin: string): void {
    void sendFeedbackWebhook(report, origin).catch(() => undefined);
}

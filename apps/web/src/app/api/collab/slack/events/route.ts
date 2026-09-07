/**
 * Slack Events API receiver.
 *
 * Point a Slack app's Event Subscriptions URL at this route and subscribe to
 * `message.channels` (and `message.groups` for private channels). Inbound
 * human messages land in the matching meeting channel, and the `!` commands
 * let someone run the meeting from Slack.
 *
 * Two things matter here and are easy to get wrong:
 *
 * 1. The signature is computed over the *raw* body. Parsing and re-serializing
 *    changes key order and whitespace, and verification then fails for reasons
 *    that look like a wrong secret.
 * 2. Slack retries anything it does not get a 2xx for within three seconds and
 *    treats a slow reply as a failure. So the reply goes out as soon as the
 *    event is recognised; the bridge's own de-duplication makes the retry
 *    harmless if one slips through.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { verifySlackRequest, type SlackEventEnvelope } from "@launchstack/collab";
import { collabMeeting } from "~/server/db/schema";
import { db } from "~/server/db";
import { getMeetingBridge, getMeetingRuntime } from "~/server/collab/runtime";
import { getSlackSigningSecret } from "~/server/collab/slack";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const signingSecret = getSlackSigningSecret();
    if (!signingSecret) {
        return NextResponse.json(
            { error: "Slack events are not enabled. Set SLACK_SIGNING_SECRET." },
            { status: 503 }
        );
    }

    const rawBody = await request.text();
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
    });

    const verified = verifySlackRequest({ signingSecret, rawBody, headers });
    if (!verified.ok) {
        return NextResponse.json({ error: `Rejected: ${verified.reason}` }, { status: 401 });
    }

    let envelope: SlackEventEnvelope;
    try {
        envelope = JSON.parse(rawBody) as SlackEventEnvelope;
    } catch {
        return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
    }

    if (envelope.type === "url_verification") {
        return NextResponse.json({ challenge: envelope.challenge });
    }

    const slackChannelId = envelope.event?.channel;
    if (!slackChannelId) return NextResponse.json({ ok: true });

    // Route to the most recent meeting mirroring this Slack channel. A finished
    // meeting still accepts messages into its channel — the transcript stays
    // open even when the agents have stopped.
    const [row] = await db
        .select()
        .from(collabMeeting)
        .where(eq(collabMeeting.slackChannelId, slackChannelId))
        .orderBy(collabMeeting.createdAt)
        .limit(1);

    if (!row) return NextResponse.json({ ok: true, ignored: "no_meeting_for_channel" });

    // Loading the runtime is what attaches the bridge in this process.
    await getMeetingRuntime(row.id, row.companyId);
    const bridge = getMeetingBridge(row.id);
    if (!bridge) return NextResponse.json({ ok: true, ignored: "mirror_disabled" });

    try {
        const result = await bridge.handleEvent(envelope);
        return NextResponse.json(result.responseBody ?? { ok: true });
    } catch (err) {
        console.error("[collab:slack] event handling failed:", err);
        // Answering 200 stops Slack retrying an event we will fail again anyway.
        return NextResponse.json({ ok: true, error: "handler_failed" });
    }
}

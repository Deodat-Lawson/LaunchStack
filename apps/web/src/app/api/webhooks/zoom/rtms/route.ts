import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { CallNotesWorkItems } from "@launchstack/features/call-notes";

import { env } from "~/env";
import {
    verifyZoomWebhook,
    zoomEndpointValidationResponse,
} from "~/server/call-notes/zoom-webhook";
import { getEngine } from "~/server/engine";

export const runtime = "nodejs";

const ACCEPTED_ZOOM_EVENTS: Record<string, true> = {
    "endpoint.url_validation": true,
    "meeting.rtms_started": true,
    "meeting.rtms_stopped": true,
    "meeting.rtms_interrupted": true,
    "rtms.concurrency_near_limit": true,
    "rtms.concurrency_limited": true,
};

const ZoomWebhookSchema = z.object({
    event: z.string().min(1).max(128),
    event_ts: z.number().int().nonnegative().optional(),
    payload: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request): Promise<Response> {
    const secret = env.server.ZOOM_WEBHOOK_SECRET;
    const companyId = env.server.CALL_NOTES_DEMO_COMPANY_ID;
    if (!secret || !companyId) {
        return NextResponse.json({ error: "Zoom webhook is not configured" }, { status: 503 });
    }

    const rawBody = await request.text();
    const verification = verifyZoomWebhook({
        rawBody,
        secret,
        headers: {
            signature: request.headers.get("x-zm-signature"),
            timestamp: request.headers.get("x-zm-request-timestamp"),
        },
    });
    if (!verification.ok) {
        return NextResponse.json({ error: "Invalid Zoom webhook signature" }, { status: 401 });
    }

    let parsedBody: unknown;
    try {
        parsedBody = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: "Invalid Zoom webhook body" }, { status: 400 });
    }
    const parsed = ZoomWebhookSchema.safeParse(parsedBody);
    if (!parsed.success || !ACCEPTED_ZOOM_EVENTS[parsed.data.event]) {
        return NextResponse.json({ error: "Unsupported Zoom webhook event" }, { status: 400 });
    }

    if (parsed.data.event === "endpoint.url_validation") {
        const plainToken = z.string().min(1).safeParse(parsed.data.payload.plainToken);
        if (!plainToken.success) {
            return NextResponse.json({ error: "Invalid Zoom endpoint challenge" }, { status: 400 });
        }
        return NextResponse.json(zoomEndpointValidationResponse(plainToken.data, secret));
    }

    const bodyHash = createHash("sha256").update(rawBody).digest("hex");
    const workItems = new CallNotesWorkItems(getEngine().db);
    await workItems.enqueue({
        companyId,
        kind: "provider_event",
        idempotencyKey: `zoom_webhook_${bodyHash}`,
        payload: {
            source: "zoom_webhook",
            event: parsed.data.event,
            eventTs: parsed.data.event_ts ?? null,
            payload: parsed.data.payload,
            receivedAt: new Date().toISOString(),
        },
    });

    return new Response(null, { status: 204 });
}

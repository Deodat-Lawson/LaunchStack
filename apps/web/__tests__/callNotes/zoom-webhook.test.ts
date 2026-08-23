import { createHmac } from "node:crypto";

const mockEnqueue = jest.fn();

jest.mock("~/env", () => ({
    env: {
        server: {
            ZOOM_WEBHOOK_SECRET: "zoom-webhook-secret",
            CALL_NOTES_DEMO_COMPANY_ID: "42",
        },
    },
}));

jest.mock("~/server/engine", () => ({
    getEngine: () => ({ db: {} }),
}));

jest.mock("@launchstack/features/call-notes", () => ({
    CallNotesWorkItems: class {
        enqueue = mockEnqueue;
    },
}));

import { POST } from "~/app/api/webhooks/zoom/rtms/route";
import {
    verifyZoomWebhook,
    zoomEndpointValidationResponse,
} from "~/server/call-notes/zoom-webhook";

const secret = "zoom-webhook-secret";

function signedRequest(body: Record<string, unknown>): Request {
    const rawBody = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = `v0=${createHmac("sha256", secret)
        .update(`v0:${timestamp}:${rawBody}`)
        .digest("hex")}`;
    return new Request("http://localhost/api/webhooks/zoom/rtms", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-zm-request-timestamp": timestamp,
            "x-zm-signature": signature,
        },
        body: rawBody,
    });
}

describe("Zoom webhook edge", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockEnqueue.mockResolvedValue({ id: "work-1" });
    });

    it("verifies the exact raw body and rejects stale signatures", () => {
        const rawBody = JSON.stringify({ event: "meeting.rtms_started", payload: {} });
        const timestamp = "1000";
        const signature = `v0=${createHmac("sha256", secret)
            .update(`v0:${timestamp}:${rawBody}`)
            .digest("hex")}`;

        expect(
            verifyZoomWebhook({
                rawBody,
                secret,
                headers: { signature, timestamp },
                nowSeconds: 1_001,
            })
        ).toEqual({ ok: true, timestampSeconds: 1_000 });
        expect(
            verifyZoomWebhook({
                rawBody,
                secret,
                headers: { signature, timestamp },
                nowSeconds: 2_000,
            })
        ).toEqual({ ok: false, reason: "stale_timestamp" });
    });

    it("answers Zoom endpoint validation without persisting work", async () => {
        const response = await POST(
            signedRequest({
                event: "endpoint.url_validation",
                payload: { plainToken: "plain-token" },
            })
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(
            zoomEndpointValidationResponse("plain-token", secret)
        );
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it("persists an idempotent RTMS webhook before acknowledging", async () => {
        const response = await POST(
            signedRequest({
                event: "meeting.rtms_started",
                event_ts: 123,
                payload: {
                    meeting_uuid: "meeting-uuid",
                    rtms_stream_id: "stream-id",
                    server_urls: "wss://zoom.invalid",
                },
            })
        );

        expect(response.status).toBe(204);
        expect(mockEnqueue).toHaveBeenCalledWith(
            expect.objectContaining({
                companyId: "42",
                kind: "provider_event",
                idempotencyKey: expect.stringMatching(/^zoom_webhook_[a-f0-9]{64}$/),
                payload: expect.objectContaining({
                    source: "zoom_webhook",
                    event: "meeting.rtms_started",
                }),
            })
        );
    });

    it("rejects unsupported events even when correctly signed", async () => {
        const response = await POST(signedRequest({ event: "meeting.created", payload: {} }));
        expect(response.status).toBe(400);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });
});

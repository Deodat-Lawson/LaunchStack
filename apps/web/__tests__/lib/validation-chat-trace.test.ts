/**
 * A saved answer keeps its thinking trace: the steps it showed and how long
 * it thought. zod strips unknown keys, so a schema without these fields would
 * silently drop them and a reloaded chat would lose its "Thought for 4s".
 */

import {
    ChatQueueSchema,
    ChatSendPayloadSchema,
    QuestionSchema,
    SessionMessageSchema,
} from "~/lib/validation";
import { MAX_TURN_STEPS } from "~/lib/chat-turns";

const STEP = {
    id: "search",
    label: "Found 5 passages in 1 source",
    detail: "Globex MSA 2026.pdf",
    state: "done" as const,
    startMs: 80,
    endMs: 930,
};

function turn(metadata: Record<string, unknown>) {
    return { role: "assistant" as const, text: "Answer.", metadata };
}

describe("SessionMessageSchema thinking trace", () => {
    it("round-trips steps and the first-word time", () => {
        const steps = [STEP, { id: "think", label: "Thinking", state: "active", startMs: 990 }];
        const parsed = SessionMessageSchema.parse(turn({ steps, thoughtMs: 3100 }));
        expect(parsed.metadata).toEqual({ steps, thoughtMs: 3100 });
    });

    it.each([
        ["too many steps", { steps: Array.from({ length: MAX_TURN_STEPS + 1 }, () => STEP) }],
        ["an unknown state", { steps: [{ ...STEP, state: "running" }] }],
        ["an empty id", { steps: [{ ...STEP, id: "" }] }],
        ["an oversized label", { steps: [{ ...STEP, label: "x".repeat(501) }] }],
        ["a negative time", { thoughtMs: -1 }],
    ])("rejects %s", (_label, metadata) => {
        expect(SessionMessageSchema.safeParse(turn(metadata)).success).toBe(false);
    });
});

describe("SessionMessageSchema stored attachments", () => {
    it.each([null, "https://example.test/a", {}, { url: 12 }, { url: "" }])(
        "rejects an attachment without an authorizable URL: %p",
        attachment => {
            expect(
                SessionMessageSchema.safeParse({
                    role: "user",
                    text: "See this",
                    attachments: [attachment],
                }).success
            ).toBe(false);
        }
    );

    it("preserves the exact URL and the existing render payload", () => {
        const attachment = {
            id: "a1",
            url: "https://s3.example/files/%61.png",
            name: "a.png",
            mimeType: "image/png",
            kind: "image",
            size: 20,
        };
        expect(
            SessionMessageSchema.parse({ role: "user", text: "", attachments: [attachment] })
                .attachments
        ).toEqual([attachment]);
    });
});

describe("canonical stored attachment URL round trips", () => {
    const attachment = (url: string) => ({
        id: "owned-file",
        url,
        name: "owned.png",
        mimeType: "image/png",
        kind: "image" as const,
        size: 20,
    });
    const send = (url: string) => ({
        text: "Ask again",
        refs: [],
        attachments: [attachment(url)],
        webSearch: false,
        thinking: false,
        agentKey: null,
    });

    it.each(["/api/files/7", "/api/files/123456789", "https://s3.example/files/owned.png"])(
        "accepts persisted URL %s in queue echoes, claimed sends, replay metadata and Ask again",
        url => {
            const payload = send(url);
            expect(ChatSendPayloadSchema.parse(payload)).toEqual(payload);
            expect(
                ChatQueueSchema.parse({ revision: 1, items: [{ id: "queue", send: payload }] })
                    .items[0]!.send
            ).toEqual(payload);
            expect(
                SessionMessageSchema.parse({
                    role: "user",
                    text: payload.text,
                    metadata: { send: payload },
                }).metadata?.send
            ).toEqual(payload);
            expect(
                QuestionSchema.parse({ question: payload.text, attachments: [attachment(url)] })
                    .attachments?.[0]?.url
            ).toBe(url);
        }
    );

    it.each([
        "api/files/7",
        "./api/files/7",
        "/api/files/7/",
        "/api/files/7?download=1",
        "/api/files/7#preview",
        "/api/files/unused/../7",
        "/api/files/%37",
        "/api/files/x",
        "/api/files/7\u0001",
        "/api/files/7\n",
        "/api/files/7\r",
        "/api/files/7\u2028",
        "/another/path",
        "//example.com/api/files/7",
        "/api/files/9007199254740993",
    ])("does not widen relative attachment validation to %j", url => {
        expect(ChatSendPayloadSchema.safeParse(send(url)).success).toBe(false);
        expect(
            QuestionSchema.safeParse({ question: "Ask again", attachments: [attachment(url)] })
                .success
        ).toBe(false);
    });
});

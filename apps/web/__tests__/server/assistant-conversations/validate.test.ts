/**
 * The caller is a model: every refusal names the field and what would be
 * accepted, so the next call can fix it.
 */

import { ConversationSaveError } from "~/server/assistant-conversations/types";
import {
    formatTurnTime,
    normalizeConversationInput,
} from "~/server/assistant-conversations/validate";

const OK_MESSAGES = [{ role: "user", content: "Hello" }];

function refusal(input: Parameters<typeof normalizeConversationInput>[0]): ConversationSaveError {
    try {
        normalizeConversationInput(input);
    } catch (error) {
        expect(error).toBeInstanceOf(ConversationSaveError);
        return error as ConversationSaveError;
    }
    throw new Error("expected a refusal");
}

describe("normalizeConversationInput", () => {
    it("accepts a well-formed conversation and normalises it", () => {
        const conv = normalizeConversationInput({
            title: "  Launch\n plan  ",
            messages: [
                {
                    role: "user",
                    content: "\r\n  Hi there\r\nsecond line \n",
                    timestamp: "2026-10-16T09:05:00Z",
                },
                { role: "assistant", content: "Hello\u0000!" },
            ],
            conversationId: 42,
            assistant: "gemini",
            model: "  gemini-3-pro \n",
        });
        expect(conv).toEqual({
            title: "Launch plan",
            messages: [
                { role: "user", content: "Hi there\nsecond line", at: "2026-10-16 09:05" },
                { role: "assistant", content: "Hello!", at: null },
            ],
            conversationId: 42,
            assistant: "gemini",
            model: "gemini-3-pro",
        });
    });

    it.each([
        [
            "an empty title",
            { title: "   ", messages: OK_MESSAGES },
            /title must be 1–200 characters/,
        ],
        ["a missing title", { messages: OK_MESSAGES }, /title must be 1–200 characters/],
        ["a 201-character title", { title: "t".repeat(201), messages: OK_MESSAGES }, /got 201/],
        ["no messages", { title: "T", messages: [] }, /between 1 and 2000 messages \(got 0\)/],
        [
            "messages that are not a list",
            { title: "T", messages: "hi" },
            /messages must be an array/,
        ],
        [
            "too many messages",
            { title: "T", messages: Array.from({ length: 2001 }, () => OK_MESSAGES[0]) },
            /got 2001\)\. Save the most relevant part/,
        ],
        [
            "a system message",
            { title: "T", messages: [{ role: "system", content: "x" }] },
            /messages\[0\]\.role must be "user" or "assistant" \(got "system"\)/,
        ],
        [
            "a missing role",
            { title: "T", messages: [OK_MESSAGES[0], { content: "x" }] },
            /messages\[1\]\.role must be "user" or "assistant" \(got null\)/,
        ],
        [
            "an empty message",
            { title: "T", messages: [{ role: "assistant", content: " \n\t " }] },
            /messages\[0\]\.content is empty/,
        ],
        [
            "a non-string message",
            { title: "T", messages: [{ role: "user", content: 7 }] },
            /messages\[0\]\.content must be a string/,
        ],
        [
            "a message over 200k characters",
            { title: "T", messages: [{ role: "user", content: "x".repeat(200_001) }] },
            /messages\[0\]\.content is 200,001 characters; the limit is 200,000/,
        ],
        [
            "a message that is not an object",
            { title: "T", messages: ["hello"] },
            /messages\[0\] must be an object/,
        ],
        [
            "an unknown assistant",
            { title: "T", messages: OK_MESSAGES, assistant: "copilot" },
            /assistant must be one of claude, chatgpt, gemini, other/,
        ],
        [
            "a non-string model",
            { title: "T", messages: OK_MESSAGES, model: 5 },
            /model must be a string/,
        ],
        [
            "a bad conversationId",
            { title: "T", messages: OK_MESSAGES, conversationId: -3 },
            /conversationId must be the positive integer an earlier save_conversation call returned/,
        ],
        [
            "a fractional conversationId",
            { title: "T", messages: OK_MESSAGES, conversationId: 1.5 },
            /conversationId must be the positive integer/,
        ],
    ])("refuses %s as invalid", (_label, input, message) => {
        const error = refusal(input);
        expect(error.code).toBe("invalid");
        expect(error.message).toMatch(message);
    });

    it("accepts a 200-character title and exactly 2000 messages", () => {
        const conv = normalizeConversationInput({
            title: "t".repeat(200),
            messages: Array.from({ length: 2000 }, () => OK_MESSAGES[0]),
        });
        expect(conv.messages).toHaveLength(2000);
        expect(conv.conversationId).toBeNull();
        expect(conv.assistant).toBeNull();
        expect(conv.model).toBeNull();
    });
});

describe("formatTurnTime", () => {
    it("keeps the wall-clock time of an ISO timestamp", () => {
        expect(formatTurnTime("2026-10-16T09:05:59.123-07:00")).toBe("2026-10-16 09:05");
    });
    it("shows other parseable dates in UTC", () => {
        expect(formatTurnTime("Fri, 16 Oct 2026 09:05:00 GMT")).toBe("2026-10-16 09:05 UTC");
    });
    it("drops what does not parse instead of refusing the save", () => {
        expect(formatTurnTime("half past nine")).toBeNull();
        expect(formatTurnTime(12345)).toBeNull();
        expect(formatTurnTime(undefined)).toBeNull();
    });
});

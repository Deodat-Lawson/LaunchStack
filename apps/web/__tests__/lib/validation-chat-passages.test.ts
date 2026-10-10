/**
 * Selected passages travel beside the question: the chat endpoint accepts
 * them, and a saved or queued turn keeps them (zod strips unknown keys, so a
 * schema without the field would silently drop them).
 */

import { QuestionSchema, SessionMessageSchema } from "~/lib/validation";
import { MAX_PASSAGE_CHARS, MAX_PASSAGES } from "~/lib/chat-passages";

const PASSAGE = { documentId: 7, title: "Annual Report", page: 4, text: "Revenue grew 12%." };

describe("QuestionSchema passages", () => {
    it("passes passages through the transform", () => {
        const parsed = QuestionSchema.parse({ question: "why?", passages: [PASSAGE] });
        expect(parsed.passages).toEqual([PASSAGE]);
    });

    it("accepts a passage without a document or page", () => {
        const parsed = QuestionSchema.parse({
            question: "why?",
            passages: [{ title: "Pasted", text: "Some text." }],
        });
        expect(parsed.passages).toEqual([{ title: "Pasted", text: "Some text." }]);
    });

    it.each([
        ["too many", Array.from({ length: MAX_PASSAGES + 1 }, () => PASSAGE)],
        ["empty text", [{ ...PASSAGE, text: "" }]],
        ["oversized text", [{ ...PASSAGE, text: "x".repeat(MAX_PASSAGE_CHARS + 1) }]],
        ["empty title", [{ ...PASSAGE, title: "" }]],
        ["non-positive page", [{ ...PASSAGE, page: 0 }]],
        ["fractional document id", [{ ...PASSAGE, documentId: 1.5 }]],
    ])("rejects %s", (_label, passages) => {
        expect(QuestionSchema.safeParse({ question: "why?", passages }).success).toBe(false);
    });
});

describe("SessionMessageSchema send.passages", () => {
    it("round-trips a saved turn's passages intact", () => {
        const passages = [{ sourceId: "doc-7", ...PASSAGE }];
        const message = {
            role: "user" as const,
            text: "why?",
            metadata: {
                send: {
                    text: "why?",
                    refs: ["doc-7"],
                    attachments: [],
                    webSearch: false,
                    thinking: false,
                    agentKey: null,
                    passages,
                },
            },
        };
        const parsed = SessionMessageSchema.parse(message);
        expect(parsed.metadata?.send?.passages).toEqual(passages);
        expect(JSON.parse(JSON.stringify(parsed))).toEqual(message);
    });

    it("rejects a saved passage without its source id", () => {
        const result = SessionMessageSchema.safeParse({
            role: "user",
            text: "why?",
            metadata: {
                send: {
                    text: "why?",
                    refs: [],
                    attachments: [],
                    webSearch: false,
                    thinking: false,
                    agentKey: null,
                    passages: [PASSAGE],
                },
            },
        });
        expect(result.success).toBe(false);
    });
});

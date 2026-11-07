import { CreateMessageSchema, CreateToolCallSchema, QuestionSchema } from "~/lib/validation";

describe("source mentions on a question", () => {
    it("accepts a chip's ref and the document it maps to, and passes them through", () => {
        const result = QuestionSchema.safeParse({
            question: "See [Source: Map](#launchstack-source-m7)",
            searchScope: "selected",
            selectedDocumentIds: [12],
            sourceMentions: [{ ref: "m7", documentId: 12 }],
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.sourceMentions).toEqual([{ ref: "m7", documentId: 12 }]);
        }
    });

    it("leaves the field absent when the client sends none", () => {
        const result = QuestionSchema.safeParse({ question: "hello", searchScope: "none" });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.sourceMentions).toBeUndefined();
    });

    it("rejects an empty ref, a non-positive document id and more than 100 mentions", () => {
        const base = { question: "q", searchScope: "none" };
        expect(
            QuestionSchema.safeParse({ ...base, sourceMentions: [{ ref: "", documentId: 1 }] })
                .success
        ).toBe(false);
        expect(
            QuestionSchema.safeParse({ ...base, sourceMentions: [{ ref: "d1", documentId: 0 }] })
                .success
        ).toBe(false);
        expect(
            QuestionSchema.safeParse({
                ...base,
                sourceMentions: Array.from({ length: 101 }, (_, i) => ({
                    ref: `d${i + 1}`,
                    documentId: i + 1,
                })),
            }).success
        ).toBe(false);
    });
});

describe("AI Chat identifier validation", () => {
    it("rejects an empty optional parent message id", () => {
        const result = CreateMessageSchema.safeParse({
            chatId: "chat-1",
            role: "assistant",
            content: "hello",
            parentMessageId: "",
        });

        expect(result.success).toBe(false);
    });

    it("rejects an empty optional task id", () => {
        const result = CreateToolCallSchema.safeParse({
            messageId: "message-1",
            taskId: "",
            toolName: "search",
            toolInput: {},
        });

        expect(result.success).toBe(false);
    });

    it("still accepts omitted optional parent identifiers", () => {
        expect(
            CreateMessageSchema.safeParse({
                chatId: "chat-1",
                role: "assistant",
                content: "hello",
            }).success
        ).toBe(true);
        expect(
            CreateToolCallSchema.safeParse({
                messageId: "message-1",
                toolName: "search",
                toolInput: {},
            }).success
        ).toBe(true);
    });
});

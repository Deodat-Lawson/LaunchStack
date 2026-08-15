import { CreateMessageSchema, CreateToolCallSchema } from "~/lib/validation";

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

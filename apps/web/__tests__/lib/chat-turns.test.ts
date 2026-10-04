import { conversationContext, deriveRecallPrompt } from "~/lib/chat-turns";
test("ordinary conversation includes both roles, omits failed answers, and carries imported context", () => {
    expect(
        conversationContext(
            [
                { role: "user", text: "Paris" },
                { role: "assistant", text: "France" },
                { role: "assistant", text: "Provider failure", status: "error" },
            ],
            "Imported history"
        )
    ).toBe("Imported history\n\nUser: Paris\n\nAssistant: France");
});
test("history budget keeps recent context and empty conversations have no fabricated history", () => {
    expect(
        conversationContext(
            [
                { role: "user", text: "Older" },
                { role: "assistant", text: "Newest" },
            ],
            undefined,
            6
        )
    ).toBe("Newest");
    expect(conversationContext([])).toBeUndefined();
});

test("recall removes machine context and quote records while keeping typed lead and trail", () => {
    const text =
        "My opening question\n\n> Quoted answer\n> another line\n\n[Source message](#chat-message-123)\n\nMy actual reply [Source: Policy](#launchstack-source-d1) [Conversation: Planning](#launchstack-thread-1)";
    expect(deriveRecallPrompt({ role: "user", text })).toBe(
        "My opening question\n\nMy actual reply"
    );
});
test("synthetic attachment and plan submissions never appear in recall", () => {
    for (const origin of ["attachment", "plan-implementation"] as const)
        expect(
            deriveRecallPrompt({
                role: "user",
                text: "Synthetic",
                send: {
                    text: "Synthetic",
                    origin,
                    refs: [],
                    attachments: [],
                    webSearch: false,
                    thinking: false,
                    agentKey: null,
                },
            })
        ).toBeUndefined();
    expect(deriveRecallPrompt({ role: "assistant", text: "Answer" })).toBeUndefined();
});
test("recall uses original typed text and strips attachment context without restoring files", () => {
    const file = {
        id: "file",
        name: "note.txt",
        url: "https://files.test/note",
        kind: "text" as const,
        mimeType: "text/plain",
        size: 10,
    };
    expect(
        deriveRecallPrompt({
            role: "user",
            text: "Expanded",
            send: {
                text: "Expanded",
                recallText: "Please inspect [note.txt](https://files.test/note)",
                origin: "user",
                refs: [],
                attachments: [file],
                webSearch: false,
                thinking: false,
                agentKey: null,
            },
        })
    ).toBe("Please inspect");
});

/** Persisted chat controls contain no provider credentials or executable instructions. */
export interface ChatSendPayload {
    text: string;
    recallText?: string;
    origin?: "user" | "attachment" | "plan-implementation";
    refs: string[];
    attachments: {
        id: string;
        name: string;
        mimeType: string;
        size: number;
        url: string;
        kind: "image" | "text";
    }[];
    webSearch: boolean;
    thinking: boolean;
    agentKey: string | null;
    modelRoute?: "default" | "fast" | "reasoning" | "vision";
    reasoningEffort?: string;
    chatMode?: "default" | "plan";
    followUp?: "queue" | "interrupt";
    modelRoutes?: ("default" | "fast" | "reasoning" | "vision")[];
    threadRefs?: string[];
}

export interface ChatSendResult {
    success: boolean;
    failedModelRoutes?: ("default" | "fast" | "reasoning" | "vision")[];
}

export interface ChatTurnMetadata {
    forkedFromSessionId?: string;
    intent?: "queued" | "interrupt";
    id?: string;
    status?: "complete" | "stopped" | "error";
    reasoning?: string;
    elapsedMs?: number;
    send?: ChatSendPayload;
    tokenBreakdown?: { inputTokens: number; outputTokens: number };
    chunksAnalyzed?: number;
}

export interface ChatQueueItem {
    id: string;
    send: ChatSendPayload;
}

/** Preserve recent complete context for ordinary and imported conversations alike. */
export function conversationContext(
    messages: { role: "user" | "assistant"; text: string; status?: string }[],
    imported?: string,
    maxChars = 60_000
): string | undefined {
    const context = [
        imported,
        ...messages
            .filter(m => m.status !== "error")
            .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`),
    ]
        .filter(Boolean)
        .join("\n\n");
    return context ? context.slice(-maxChars) : undefined;
}

/** Recall only what the person typed, without stale machine context or synthetic sends. */
export function deriveRecallPrompt(message: {
    role: "user" | "assistant";
    text: string;
    send?: ChatSendPayload;
}): string | undefined {
    if (message.role !== "user" || (message.send?.origin && message.send.origin !== "user"))
        return undefined;
    let text = message.send?.recallText ?? message.send?.text ?? message.text;
    text = text.replace(
        /\[(?:Source|Conversation|Folder):[^\]]*\]\(#launchstack-(?:source|thread|folder)-[^)]+\)/g,
        ""
    );
    // Only a machine provenance link identifies quoted context in plain text.
    // A person can type ordinary Markdown blockquotes, which recall must preserve.
    text = text.replace(
        /(?:^|\n)(?:[ \t]*>[^\n]*(?:\n|$))+\s*\[(?:Source message|Quoted context)\]\(#(?:chat-message-[^)]+|launchstack-quoted-context)\)/g,
        "\n"
    );
    text = text.replace(/\[Source message\]\(#chat-message-[^)]+\)/g, "");
    for (const file of message.send?.attachments ?? []) {
        const label = `[${file.name}](${file.url})`;
        text = text.split(label).join("");
    }
    text = text.replace(/\n{3,}/g, "\n\n").trim();
    return text || undefined;
}

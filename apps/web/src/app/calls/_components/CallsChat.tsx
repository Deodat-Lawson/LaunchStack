"use client";

import { ArrowUp, AudioLines, Minus, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type FormEvent,
    type KeyboardEvent,
} from "react";

import type { CallSnapshot } from "@launchstack/features/call-notes";

import MarkdownMessage from "~/app/_components/MarkdownMessage";
import type { CallChatStreamEvent } from "~/lib/call-chat-stream";

import styles from "./CallsChat.module.css";

type ChatMessage = {
    id: string;
    role: "user" | "assistant";
    text: string;
};

type ChatResponse = {
    message?: string;
    error?: string;
};

type SubmitOptions = {
    recordUser?: boolean;
};

type CallChatProps = {
    snapshot: CallSnapshot;
    open: boolean;
    onOpen: () => void;
    onClose: () => void;
    onShowTranscript: () => void;
};

export type CallsChatProps = { snapshot: null } | CallChatProps;

function responseError(data: ChatResponse, status?: number): string {
    return (
        data.message ??
        data.error ??
        (status
            ? `Request failed with status ${status}.`
            : "The AI assistant did not return an answer.")
    );
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

export function CallsChat(props: CallsChatProps) {
    if (props.snapshot === null) {
        return (
            <aside className={`${styles.dock} ${styles.homeDock}`} aria-label="Calls assistant">
                <Link
                    href="/employer/documents"
                    className={`${styles.composer} ${styles.homeComposer}`}
                    aria-label="Open workspace assistant"
                >
                    <span>Ask anything</span>
                    <span className={styles.assistantLink}>
                        <Sparkles size={14} /> Open assistant
                    </span>
                </Link>
            </aside>
        );
    }
    return <CallChat key={props.snapshot.id} {...props} />;
}

function CallChat({ snapshot, open, onOpen, onClose, onShowTranscript }: CallChatProps) {
    const [draft, setDraft] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isSending, setIsSending] = useState(false);
    const [streamingText, setStreamingText] = useState("");
    const [error, setError] = useState<string | null>(null);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const conversationBodyRef = useRef<HTMLDivElement>(null);
    const conversationContentRef = useRef<HTMLDivElement>(null);
    const followTail = useRef(true);
    const activeControllerRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);
    const sendingRef = useRef(false);
    const requestSequenceRef = useRef(0);
    const lastQuestionRef = useRef<string | null>(null);

    const snapshotKey = snapshot.id;
    const placeholder = "Ask about this call";

    useEffect(() => {
        requestSequenceRef.current += 1;
        activeControllerRef.current?.abort();
        activeControllerRef.current = null;
        sendingRef.current = false;
        setDraft("");
        setMessages([]);
        setStreamingText("");
        setError(null);
        setIsSending(false);
        lastQuestionRef.current = null;
    }, [snapshotKey]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestSequenceRef.current += 1;
            activeControllerRef.current?.abort();
            activeControllerRef.current = null;
            sendingRef.current = false;
        };
    }, []);

    const resizeInput = useCallback(() => {
        const element = textareaRef.current;
        if (!element) return;
        element.style.height = "auto";
        element.style.height = `${element.scrollHeight}px`;
    }, []);

    useLayoutEffect(() => {
        resizeInput();
    }, [draft, resizeInput]);

    useLayoutEffect(() => {
        const element = textareaRef.current;
        if (!element) return;
        let width = element.clientWidth;
        const observer = new ResizeObserver(() => {
            if (element.clientWidth === width) return;
            width = element.clientWidth;
            resizeInput();
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [resizeInput]);

    const followConversation = useCallback(() => {
        const body = conversationBodyRef.current;
        if (body && followTail.current) body.scrollTop = body.scrollHeight;
    }, []);

    useLayoutEffect(() => {
        followConversation();
    }, [open, messages, streamingText, isSending, error, followConversation]);

    useLayoutEffect(() => {
        const body = conversationBodyRef.current;
        const content = conversationContentRef.current;
        if (!body || !content) return;

        // Follow rendered growth too, including streamed Markdown and late layout changes.
        const observer = new ResizeObserver(followConversation);
        observer.observe(body);
        observer.observe(content);
        return () => observer.disconnect();
    }, [open, followConversation]);

    const submitQuestion = useCallback(
        async (questionInput: string, options: SubmitOptions = {}) => {
            const question = questionInput.trim();
            if (!question) return;

            if (sendingRef.current) return;

            const recordUser = options.recordUser !== false;
            const priorMessages =
                recordUser || messages.at(-1)?.role !== "user" ? messages : messages.slice(0, -1);
            const controller = new AbortController();
            const requestId = ++requestSequenceRef.current;
            activeControllerRef.current = controller;
            sendingRef.current = true;
            followTail.current = true;
            setIsSending(true);
            onOpen();
            setError(null);
            setStreamingText("");
            lastQuestionRef.current = question;
            if (recordUser) {
                setMessages(previous => [
                    ...previous,
                    { id: `${requestId}-user`, role: "user", text: question },
                ]);
                setDraft("");
            }

            try {
                const response = await fetch(
                    `/api/call-notes/${encodeURIComponent(snapshot.id)}/chat`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        signal: controller.signal,
                        body: JSON.stringify({
                            question,
                            history: priorMessages.map(message => ({
                                role: message.role,
                                content: message.text,
                            })),
                        }),
                    }
                );

                if (!response.ok) {
                    const data = (await response.json().catch(() => ({}))) as ChatResponse;
                    throw new Error(responseError(data, response.status));
                }
                if (
                    !response.body ||
                    !response.headers.get("content-type")?.includes("text/event-stream")
                ) {
                    throw new Error("The AI assistant did not return an answer stream.");
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                let answer = "";
                let completed = false;
                try {
                    while (!completed) {
                        const { done, value } = await reader.read();
                        if (!mountedRef.current || requestId !== requestSequenceRef.current) return;
                        if (done) throw new Error("The answer was interrupted. Please try again.");
                        buffer += decoder.decode(value, { stream: true });
                        const frames = buffer.split("\n\n");
                        buffer = frames.pop() ?? "";
                        for (const frame of frames) {
                            if (!frame.startsWith("data: ")) continue;
                            const event = JSON.parse(frame.slice(6)) as CallChatStreamEvent;
                            if (event.type === "error") throw new Error(event.message);
                            if (event.type === "delta" && typeof event.text === "string") {
                                answer += event.text;
                                setStreamingText(answer);
                            } else if (event.type === "done" && typeof event.text === "string") {
                                const text = event.text.trim();
                                if (!text)
                                    throw new Error("The AI assistant returned an empty answer.");
                                setMessages(previous => [
                                    ...previous,
                                    { id: `${requestId}-assistant`, role: "assistant", text },
                                ]);
                                setStreamingText("");
                                lastQuestionRef.current = null;
                                completed = true;
                                break;
                            }
                        }
                    }
                } finally {
                    await reader.cancel().catch(() => undefined);
                    reader.releaseLock();
                }
            } catch (requestError) {
                if (
                    !mountedRef.current ||
                    requestId !== requestSequenceRef.current ||
                    isAbortError(requestError)
                ) {
                    return;
                }
                setError(
                    requestError instanceof Error
                        ? requestError.message
                        : "The AI assistant could not answer this question."
                );
            } finally {
                if (requestId === requestSequenceRef.current) {
                    activeControllerRef.current = null;
                    sendingRef.current = false;
                    if (mountedRef.current) setIsSending(false);
                }
            }
        },
        [messages, snapshot, onOpen]
    );

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void submitQuestion(draft);
    };

    const handleDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
    };

    const retry = () => {
        const question = lastQuestionRef.current;
        if (!question) return;
        void submitQuestion(question, { recordUser: false });
    };

    return (
        <aside
            className={`${styles.dock} ${styles.noteDock}`}
            aria-label={`Ask about ${snapshot.title}`}
            data-open={open}
        >
            <section
                className={styles.conversation}
                aria-label="AI conversation"
                aria-hidden={!open}
                ref={element => {
                    if (element) element.inert = !open;
                }}
            >
                <header className={styles.conversationHeader}>
                    <button
                        type="button"
                        className={styles.conversationClose}
                        aria-label="Show transcript"
                        onClick={onShowTranscript}
                    >
                        <AudioLines size={18} />
                    </button>
                    <span className={styles.conversationTitle}>AI chat</span>
                    <button
                        type="button"
                        className={styles.conversationClose}
                        aria-label="Close conversation"
                        onClick={onClose}
                    >
                        <Minus size={18} />
                    </button>
                </header>
                <div
                    ref={conversationBodyRef}
                    className={styles.conversationBody}
                    role="log"
                    aria-live="polite"
                    tabIndex={0}
                    onScroll={event => {
                        const body = event.currentTarget;
                        followTail.current =
                            body.scrollHeight - body.scrollTop - body.clientHeight <= 2;
                    }}
                    onWheel={event => {
                        if (event.deltaY < 0) followTail.current = false;
                    }}
                >
                    <div ref={conversationContentRef} className={styles.conversationContent}>
                        {messages.length === 0 && !isSending && !error ? (
                            <div className={styles.emptyState}>
                                <strong>Ask about the visible call context</strong>
                                <span>
                                    Answers use this call&apos;s visible note and transcript only.
                                </span>
                            </div>
                        ) : null}
                        {messages.map(message => (
                            <article
                                className={`${styles.message} ${
                                    message.role === "user"
                                        ? styles.messageUser
                                        : styles.messageAssistant
                                }`}
                                key={message.id}
                            >
                                <div className={styles.messageMeta}>
                                    <span className={styles.messageIcon} aria-hidden="true">
                                        {message.role === "user" ? "You" : <Sparkles size={12} />}
                                    </span>
                                    <span>{message.role === "user" ? "You" : "Launchstack"}</span>
                                </div>
                                {message.role === "assistant" ? (
                                    <MarkdownMessage
                                        content={message.text}
                                        className={styles.markdown}
                                    />
                                ) : (
                                    <p className={styles.messageText}>{message.text}</p>
                                )}
                            </article>
                        ))}
                        {streamingText ? (
                            <article className={`${styles.message} ${styles.messageAssistant}`}>
                                <div className={styles.messageMeta}>
                                    <span className={styles.messageIcon} aria-hidden="true">
                                        <Sparkles size={12} />
                                    </span>
                                    <span>
                                        {error ? "Launchstack · Incomplete answer" : "Launchstack"}
                                    </span>
                                </div>
                                <MarkdownMessage
                                    content={streamingText}
                                    className={styles.markdown}
                                />
                            </article>
                        ) : null}
                        {isSending ? (
                            <div className={styles.pending} role="status">
                                <LoaderCircle size={14} className={styles.spinner} />
                                <span>
                                    {streamingText ? "Answering…" : "Thinking about this call…"}
                                </span>
                            </div>
                        ) : null}
                        {error ? (
                            <div className={styles.error} role="alert">
                                <span>{error}</span>
                                {lastQuestionRef.current ? (
                                    <button type="button" className={styles.retry} onClick={retry}>
                                        <RotateCcw size={12} />
                                        Try again
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </div>
            </section>

            <div className={styles.composer}>
                <button
                    type="button"
                    data-chat-trigger
                    className={styles.chatTrigger}
                    aria-label="Open AI chat"
                    aria-hidden={open}
                    tabIndex={open ? -1 : 0}
                    onClick={onOpen}
                >
                    {messages.length ? "Continue chat" : draft || "Ask about this call"}
                </button>
                <form
                    className={styles.composerForm}
                    onSubmit={handleSubmit}
                    aria-hidden={!open}
                    ref={element => {
                        if (element) element.inert = !open;
                    }}
                >
                    <textarea
                        ref={textareaRef}
                        className={styles.input}
                        rows={1}
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        onKeyDown={handleDraftKeyDown}
                        placeholder={placeholder}
                        aria-label={placeholder}
                        disabled={isSending}
                    />
                    <div className={styles.composerActions}>
                        <button
                            type="submit"
                            className={`${styles.send} ${!draft.trim() ? styles.sendHidden : ""}`}
                            aria-label="Send message"
                            title="Send message"
                            disabled={!draft.trim() || isSending}
                        >
                            <ArrowUp size={16} />
                        </button>
                    </div>
                </form>
            </div>
        </aside>
    );
}

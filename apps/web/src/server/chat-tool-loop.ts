/**
 * One chat answer with tools the model may call.
 *
 * The model decides. Its first call is the answer whenever it needs no tool:
 * nothing runs before it and no second request follows, so a question that
 * needs no tool costs what it cost before tools existed. When it does call
 * one, the tool runs, its result joins the conversation and the model goes
 * again — at most `maxToolRounds` times, then once more with tools switched
 * off (`tool_choice: "none"`), so every turn ends in an answer.
 *
 * Tools travel as standard Chat Completions function definitions, so any
 * OpenAI-compatible endpoint can host them — no vendor-hosted tool, nothing
 * tied to one provider. An endpoint that refuses the tools (HTTP 400/422 on
 * the first request, before anything streamed) is asked again without them:
 * offering tools to a model that turns out not to take them costs a retry,
 * not the answer.
 *
 * Streaming is per round: text and reasoning deltas reach the caller as they
 * arrive, whichever round produced them.
 */

import {
    AIMessage,
    HumanMessage,
    ToolMessage,
    type AIMessageChunk,
    type BaseMessage,
} from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { addTokenUsage, normalizeTokenUsage, type ChatTokenUsage } from "@launchstack/llm";

import { throwIfChatAborted } from "~/lib/chat-stream";
import { EVIDENCE_REVIEW_REMINDER, TOOLS_UNAVAILABLE_REMINDER } from "~/lib/ai/chat-instructions";

export interface ChatTool {
    name: string;
    /** Shown to the model: when to call it and what comes back. */
    description: string;
    /** JSON Schema for the arguments, sent to the model as written. */
    parameters: Record<string, unknown>;
    /** What the chat shows while this call runs, e.g. `Searching the web for "…"`. */
    describe(args: unknown): string;
    /**
     * The result text handed back to the model. A throw becomes an error
     * result. A long call may report progress ("Reading 37 sources… 12
     * done"), which replaces the `describe` text in the chat.
     */
    run(args: unknown, signal: AbortSignal, progress?: (status: string) => void): Promise<string>;
}

export interface ToolCallRecord {
    name: string;
    args: unknown;
    ms: number;
    ok: boolean;
}

export interface AnswerWithToolsOptions {
    chat: BaseChatModel;
    messages: BaseMessage[];
    tools: readonly ChatTool[];
    /** Retrieved passages or attachments were supplied before any tool call. */
    hasInitialEvidence?: boolean;
    signal: AbortSignal;
    /** Present when the answer streams. */
    stream?: {
        onText(delta: string): void;
        onReasoning(delta: string): void;
    };
    /** A tool call started (its `describe` text), or the model resumed ("generating"). */
    onStatus?: (status: string) => void;
    /** Rounds in which the model may call tools before it must answer (default 3). */
    maxToolRounds?: number;
}

export interface AnswerWithToolsResult {
    /**
     * The final round's streamed text: the answer. Text a model writes beside
     * a tool call ("Let me look that up") streams while the tool runs but is
     * not part of it. Empty when not streaming.
     */
    finalText: string;
    /** The final round's message content (the answer when not streaming). */
    finalContent: unknown;
    /** Summed across every model call. */
    usage: ChatTokenUsage;
    /** Model calls made. 1 when no tool was called. */
    modelCalls: number;
    toolCalls: ToolCallRecord[];
}

/** Calls the model may make in one round; more than this is a runaway. */
const MAX_CALLS_PER_ROUND = 4;

/** Built-in tools that inspect sources; an attempt may return no evidence. */
const EVIDENCE_TOOLS = new Set([
    "list_sources",
    "search_sources",
    "read_source",
    "ask_each",
    "search_web",
    "fetch_page",
]);

/** Said before a round in which the model may no longer call tools. */
export const OUT_OF_TOOL_ROUNDS =
    "Answer now, from what the tool results above show; do not call another tool. If they did not have what was asked, say what you looked at and what was missing.";

/** The endpoint rejected the request itself — here, the tools it was offered. */
function isRequestRefusal(error: unknown): boolean {
    const status = (error as { status?: unknown } | null)?.status;
    return status === 400 || status === 422;
}

/** Extract only public reasoning deltas; raw provider payloads never leave the server. */
function rawReasoningDelta(value: unknown): string | undefined {
    if (!value || typeof value !== "object") return undefined;
    const choices: unknown = (value as Record<string, unknown>).choices;
    if (!Array.isArray(choices)) return undefined;
    const first: unknown = choices[0];
    if (!first || typeof first !== "object") return undefined;
    const delta: unknown = (first as Record<string, unknown>).delta;
    if (!delta || typeof delta !== "object") return undefined;
    const fields = delta as Record<string, unknown>;
    const reasoning = fields.reasoning_content ?? fields.reasoning;
    return typeof reasoning === "string" ? reasoning : undefined;
}

function contentText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .map((part: unknown) => {
            if (typeof part === "string") return part;
            if (!part || typeof part !== "object") return "";
            const block = part as { type?: unknown; text?: unknown };
            return block.type === "text" && typeof block.text === "string" ? block.text : "";
        })
        .join("");
}

interface RoundCall {
    id: string;
    name: string;
    args: unknown;
    /** Set when the model's arguments were not valid JSON. */
    invalid?: string;
}

function readToolCalls(message: unknown, round: number): RoundCall[] {
    const fields = message as { tool_calls?: unknown; invalid_tool_calls?: unknown };
    const calls: RoundCall[] = [];
    const valid: unknown[] = Array.isArray(fields.tool_calls) ? fields.tool_calls : [];
    const invalid: unknown[] = Array.isArray(fields.invalid_tool_calls)
        ? fields.invalid_tool_calls
        : [];
    for (const raw of [...valid, ...invalid] as Array<Record<string, unknown>>) {
        if (typeof raw?.name !== "string" || !raw.name) continue;
        const isInvalid = invalid.includes(raw);
        calls.push({
            id: typeof raw.id === "string" && raw.id ? raw.id : `call_${round}_${calls.length + 1}`,
            name: raw.name,
            args: isInvalid ? {} : (raw.args ?? {}),
            ...(isInvalid ? { invalid: "The tool arguments were not valid JSON." } : {}),
        });
    }
    return calls;
}

/** A tool call as the endpoint sent it, provider fields included. */
type WireToolCall = Record<string, unknown> & { id?: unknown; extra_content?: unknown };

/**
 * The model's tool-calling turn, as it goes back to the model next round.
 *
 * Gemini 3 on Google's own OpenAI-compatible endpoint signs every call
 * (`extra_content.google.thought_signature`) and refuses the next request
 * with a 400 when a call comes back unsigned. LangChain rebuilds the wire
 * calls from the parsed ones and drops the field, so when the endpoint's own
 * records carry one they go back as they came: with no parsed `tool_calls`,
 * LangChain sends `additional_kwargs.tool_calls` verbatim.
 */
function toolCallTurn(content: string, calls: RoundCall[], message: unknown): AIMessage {
    const parsed = calls.map(call => ({
        id: call.id,
        name: call.name,
        args: (call.args ?? {}) as Record<string, unknown>,
    }));
    const wire: unknown = (message as { additional_kwargs?: { tool_calls?: unknown } })
        .additional_kwargs?.tool_calls;
    const records = Array.isArray(wire) ? (wire as WireToolCall[]) : [];
    const sent = calls.map(call => records.find(record => record?.id === call.id));
    if (sent.some(record => !record) || !sent.some(record => record?.extra_content)) {
        return new AIMessage({ content, tool_calls: parsed });
    }
    const turn = new AIMessage({
        content,
        tool_calls: parsed,
        additional_kwargs: {
            // A streamed call's `index` places its chunks; it is not part of the call.
            tool_calls: sent.map(record =>
                Object.fromEntries(Object.entries(record!).filter(([key]) => key !== "index"))
            ) as unknown as NonNullable<AIMessage["additional_kwargs"]["tool_calls"]>,
        },
    });
    // Built with the parsed calls (else LangChain re-parses the records and
    // warns), then cleared so the records go out as sent.
    turn.tool_calls = [];
    return turn;
}

export async function answerWithTools(
    options: AnswerWithToolsOptions
): Promise<AnswerWithToolsResult> {
    const { chat, tools, signal, stream, onStatus } = options;
    const maxToolRounds = options.maxToolRounds ?? 3;
    const byName = new Map(tools.map(tool => [tool.name, tool]));
    const specs = tools.map(tool => ({
        type: "function" as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));
    const offered = tools.length > 0 && typeof chat.bindTools === "function";
    let withTools = offered ? chat.bindTools!(specs) : null;
    let toolsUnavailable = tools.length > 0 && !offered;
    let reviewEvidence = Boolean(options.hasInitialEvidence);
    let answerNow = false;
    const conversation = [...options.messages];
    const toolCalls: ToolCallRecord[] = [];
    let usage: ChatTokenUsage = {};
    let streamedText = "";
    let modelCalls = 0;
    /** Set when a round after a tool call came back with no text: one more, tools off. */
    let mustAnswer = false;

    /** One model call; text and reasoning stream out as they arrive. */
    const callModel = async (
        model: Pick<BaseChatModel, "stream" | "invoke">
    ): Promise<{ message: AIMessageChunk | AIMessage; roundText: string }> => {
        modelCalls += 1;
        // Reminders belong to this request, not to the stored history. One
        // fresh copy stays nearest generation even across later write calls.
        const requestMessages = [...conversation];
        if (reviewEvidence) requestMessages.push(new HumanMessage(EVIDENCE_REVIEW_REMINDER));
        if (toolsUnavailable) requestMessages.push(new HumanMessage(TOOLS_UNAVAILABLE_REMINDER));
        if (answerNow) requestMessages.push(new HumanMessage(OUT_OF_TOOL_ROUNDS));
        if (!stream) {
            const message = (await model.invoke(requestMessages, { signal })) as AIMessage;
            return { message, roundText: contentText(message.content) };
        }
        let combined: AIMessageChunk | undefined;
        let roundText = "";
        for await (const chunk of await model.stream(requestMessages, { signal })) {
            throwIfChatAborted(signal);
            const wireReasoning = rawReasoningDelta(chunk.additional_kwargs?.__raw_response);
            // Do not retain opaque provider metadata in the final chunk.
            delete chunk.additional_kwargs.__raw_response;
            combined = combined ? combined.concat(chunk) : chunk;
            const text = contentText(chunk.content);
            if (text) {
                // A later round's text starts a new paragraph.
                const lead = !roundText && streamedText && !/\s$/.test(streamedText);
                const delta = lead ? `\n\n${text}` : text;
                roundText += text;
                streamedText += delta;
                stream.onText(delta);
            }
            const reasoning =
                chunk.additional_kwargs?.reasoning_content ??
                chunk.additional_kwargs?.reasoning ??
                wireReasoning;
            if (typeof reasoning === "string" && reasoning) stream.onReasoning(reasoning);
            if (Array.isArray(chunk.content)) {
                for (const block of chunk.content) {
                    if (typeof block !== "object" || !block) continue;
                    if (block.type === "reasoning" || block.type === "thinking") {
                        const delta: unknown = block.text ?? block.thinking;
                        if (typeof delta === "string" && delta) stream.onReasoning(delta);
                    }
                }
            }
        }
        if (!combined) throw new Error("The model stream ended without a response.");
        return { message: combined, roundText };
    };

    for (let round = 0; ; round++) {
        throwIfChatAborted(signal);
        const mayCall = Boolean(withTools) && round < maxToolRounds && !mustAnswer;
        // Out of tool rounds: say so. `tool_choice: "none"` alone is not
        // enough for every endpoint — some ignore it, the model calls a tool
        // anyway, and with that call dropped the answer comes back empty.
        answerNow = Boolean(withTools) && !mayCall;
        // After the last tool round the tools stay declared (the history
        // holds tool messages) but the model may not call them.
        const model = withTools
            ? mayCall
                ? withTools
                : chat.bindTools!(specs, { tool_choice: "none" })
            : chat;

        let message: AIMessageChunk | AIMessage;
        let roundText: string;
        try {
            ({ message, roundText } = await callModel(model));
        } catch (error) {
            throwIfChatAborted(signal);
            if (!(round === 0 && withTools && !streamedText && isRequestRefusal(error)))
                throw error;
            console.warn("[chat-tools] The endpoint refused the tools; answering without them.");
            withTools = null;
            toolsUnavailable = true;
            ({ message, roundText } = await callModel(chat));
        }
        throwIfChatAborted(signal);
        usage = addTokenUsage(usage, normalizeTokenUsage(message));

        const calls =
            mayCall && withTools ? readToolCalls(message, round).slice(0, MAX_CALLS_PER_ROUND) : [];
        if (calls.length === 0) {
            // A model can read a tool result and stop without a word (all its
            // output spent on reasoning). Every turn ends in an answer, so it
            // is asked once more, with the tools off.
            const said = stream ? roundText : contentText(message.content);
            if (!said.trim() && mayCall && toolCalls.length > 0) {
                mustAnswer = true;
                continue;
            }
            return {
                finalText: stream ? roundText : "",
                finalContent: message.content,
                usage,
                modelCalls,
                toolCalls,
            };
        }

        conversation.push(toolCallTurn(roundText, calls, message));
        for (const call of calls) {
            throwIfChatAborted(signal);
            const tool = byName.get(call.name);
            const started = Date.now();
            let content: string;
            let ok = false;
            if (call.invalid) {
                content = call.invalid;
            } else if (!tool) {
                content = `Unknown tool "${call.name}". Available: ${[...byName.keys()].join(", ")}.`;
            } else {
                if (EVIDENCE_TOOLS.has(call.name)) reviewEvidence = true;
                onStatus?.(tool.describe(call.args));
                try {
                    content = await tool.run(call.args, signal, status => onStatus?.(status));
                    ok = true;
                } catch (error) {
                    throwIfChatAborted(signal);
                    content = `Tool failed: ${error instanceof Error ? error.message : String(error)}`;
                }
            }
            toolCalls.push({ name: call.name, args: call.args, ms: Date.now() - started, ok });
            conversation.push(
                new ToolMessage({
                    tool_call_id: call.id,
                    name: call.name,
                    content,
                    status: ok ? "success" : "error",
                })
            );
        }
        onStatus?.("generating");
    }
}

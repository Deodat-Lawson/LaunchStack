/**
 * Agent-loop contract (design: Repo Explainer Rebuild rev 4, §3.4 — the one
 * primitive this codebase lacked).
 *
 * Deliberately small: a loop, bound tools, two hard caps, an abort signal,
 * and a schema-validated final result. No persistence, no resume, no
 * dynamic tool registration — if the runner ever needs those, adopt a
 * framework instead of growing this (design alternative C).
 */

import type { z } from "zod";

import type { ChatTokenUsage } from "../usage";

export interface AgentToolResult {
    content: string;
    isError?: boolean;
}

export interface AgentToolContext {
    signal?: AbortSignal;
}

export interface AgentToolDefinition<In = unknown> {
    name: string;
    /** Shown to the model — write it like documentation, it is. */
    description: string;
    inputSchema: z.ZodType<In>;
    // Method syntax on purpose: TS keeps method parameters bivariant, so an
    // AgentToolDefinition<Specific> stays assignable into the catalog's
    // AgentToolDefinition<unknown>[] — the schema restores the type at runtime.
    run(input: In, context: AgentToolContext): Promise<AgentToolResult> | AgentToolResult;
}

/** Identity helper that infers `In` from the schema, so `run` gets a typed
 * input without the tool author writing the generic twice. */
export function defineAgentTool<In>(tool: AgentToolDefinition<In>): AgentToolDefinition<In> {
    return tool;
}

/** What the model port receives per tool: name, docs, JSON Schema. */
export interface AgentToolSpec {
    name: string;
    description: string;
    jsonSchema: unknown;
}

export interface AgentToolCall {
    id: string;
    name: string;
    arguments: unknown;
}

export type AgentTranscriptItem =
    | { role: "user"; text: string }
    | { role: "assistant"; text: string; toolCalls: AgentToolCall[] }
    | { role: "tool"; callId: string; name: string; content: string; isError: boolean };

export interface AgentModelResponse {
    text: string;
    toolCalls: AgentToolCall[];
    usage?: ChatTokenUsage;
    modelId?: string;
}

/**
 * The model side of the loop. Implementations: the LangChain adapter for
 * production, a scripted fake for tests.
 */
export interface AgentModelPort {
    respond(input: {
        system: string;
        transcript: readonly AgentTranscriptItem[];
        tools: readonly AgentToolSpec[];
        signal?: AbortSignal;
    }): Promise<AgentModelResponse>;
}

export interface AgentRunResult<T> {
    output: T;
    /** Model calls made, including the one that submitted. */
    turns: number;
    usage: ChatTokenUsage;
    modelId?: string;
    transcript: AgentTranscriptItem[];
}

export class AgentStepLimitError extends Error {
    override readonly name = "AgentStepLimitError";
    constructor(
        public readonly maxTurns: number,
        public readonly usage: ChatTokenUsage
    ) {
        super(`Agent did not submit a result within ${maxTurns} turns`);
    }
}

export class AgentBudgetExceededError extends Error {
    override readonly name = "AgentBudgetExceededError";
    constructor(
        public readonly tokenBudget: number,
        public readonly usage: ChatTokenUsage
    ) {
        super(`Agent exceeded its token budget of ${tokenBudget}`);
    }
}

export class AgentAbortedError extends Error {
    override readonly name = "AgentAbortedError";
    constructor() {
        super("Agent run aborted");
    }
}

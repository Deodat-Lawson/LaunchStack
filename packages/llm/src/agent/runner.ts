/**
 * The agent loop. Protocol: the model works by calling tools; it finishes by
 * calling the auto-added `submit_result` tool, whose input schema IS the
 * caller's final schema. A schema-invalid submission comes back to the model
 * as a tool error (bounded by the same turn cap) — the structured-output
 * one-repair discipline, generalized to a loop with hard ceilings.
 *
 * Guarantees:
 * - never more than `maxTurns` model calls,
 * - never past `tokenBudget` (endpoint-reported usage when present, a
 *   deliberately conservative character estimate when absent — a silent
 *   endpoint must not disable the ceiling),
 * - tool crashes are contained as error results, never thrown,
 * - the abort signal is honored between turns and handed to every tool.
 */

import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { ChatTokenUsage } from "../usage";
import { addTokenUsage } from "../usage";
import type {
    AgentModelPort,
    AgentModelResponse,
    AgentRunResult,
    AgentToolCall,
    AgentToolDefinition,
    AgentToolSpec,
    AgentTranscriptItem,
} from "./types";
import { AgentAbortedError, AgentBudgetExceededError, AgentStepLimitError } from "./types";

export const SUBMIT_TOOL_NAME = "submit_result";

const MAX_TOOL_CALLS_PER_TURN = 8;
const MAX_TOOL_RESULT_CHARS = 30_000;
/** Chars-per-token divisor for the fallback estimate. */
const ESTIMATE_CHARS_PER_TOKEN = 4;
/** Flat per-turn output allowance in the fallback estimate. */
const ESTIMATE_OUTPUT_TOKENS = 700;

export interface RunAgentOptions<T> {
    system: string;
    user: string;
    tools: readonly AgentToolDefinition[];
    finalSchema: z.ZodType<T>;
    finalToolDescription?: string;
    /** Hard cap on model calls. */
    maxTurns: number;
    /** Hard cap on total tokens across the run. */
    tokenBudget?: number;
    signal?: AbortSignal;
    onTurn?: (info: { turn: number; toolCalls: string[]; usage: ChatTokenUsage }) => void;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw new AgentAbortedError();
}

function transcriptChars(system: string, transcript: readonly AgentTranscriptItem[]): number {
    let total = system.length;
    for (const item of transcript) {
        if (item.role === "tool") total += item.content.length;
        else total += item.text.length;
    }
    return total;
}

function estimateTurnUsage(
    system: string,
    transcript: readonly AgentTranscriptItem[]
): ChatTokenUsage {
    const inputTokens = Math.ceil(transcriptChars(system, transcript) / ESTIMATE_CHARS_PER_TOKEN);
    return {
        inputTokens,
        outputTokens: ESTIMATE_OUTPUT_TOKENS,
        totalTokens: inputTokens + ESTIMATE_OUTPUT_TOKENS,
    };
}

function clip(content: string): string {
    return content.length > MAX_TOOL_RESULT_CHARS
        ? `${content.slice(0, MAX_TOOL_RESULT_CHARS)}\n… (result truncated)`
        : content;
}

export function toToolSpecs(
    tools: readonly AgentToolDefinition[],
    finalSchema: z.ZodType<unknown>,
    finalToolDescription: string
): AgentToolSpec[] {
    return [
        ...tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            jsonSchema: zodToJsonSchema(tool.inputSchema, tool.name),
        })),
        {
            name: SUBMIT_TOOL_NAME,
            description: finalToolDescription,
            jsonSchema: zodToJsonSchema(finalSchema, SUBMIT_TOOL_NAME),
        },
    ];
}

export async function runAgent<T>(
    port: AgentModelPort,
    options: RunAgentOptions<T>
): Promise<AgentRunResult<T>> {
    const {
        system,
        tools,
        finalSchema,
        maxTurns,
        tokenBudget,
        signal,
        finalToolDescription = "Submit your final result. Call this exactly once, when you are done.",
    } = options;

    if (maxTurns < 1) throw new RangeError("maxTurns must be at least 1");
    const byName = new Map(tools.map(tool => [tool.name, tool]));
    if (byName.has(SUBMIT_TOOL_NAME)) {
        throw new RangeError(`"${SUBMIT_TOOL_NAME}" is reserved for the runner`);
    }

    const specs = toToolSpecs(tools, finalSchema, finalToolDescription);
    const transcript: AgentTranscriptItem[] = [{ role: "user", text: options.user }];
    let usage: ChatTokenUsage = {};
    let modelId: string | undefined;

    for (let turn = 1; turn <= maxTurns; turn++) {
        throwIfAborted(signal);
        if (tokenBudget !== undefined && (usage.totalTokens ?? 0) >= tokenBudget) {
            throw new AgentBudgetExceededError(tokenBudget, usage);
        }

        let response: AgentModelResponse;
        try {
            // Snapshot: the port must never observe later mutations of the
            // live transcript array.
            response = await port.respond({
                system,
                transcript: [...transcript],
                tools: specs,
                signal,
            });
        } catch (error) {
            if (signal?.aborted) throw new AgentAbortedError();
            throw error;
        }

        const turnUsage =
            response.usage?.totalTokens !== undefined
                ? response.usage
                : estimateTurnUsage(system, transcript);
        usage = addTokenUsage(usage, turnUsage);
        modelId = response.modelId ?? modelId;

        const calls = response.toolCalls.slice(0, MAX_TOOL_CALLS_PER_TURN);
        transcript.push({ role: "assistant", text: response.text, toolCalls: calls });
        options.onTurn?.({ turn, toolCalls: calls.map(call => call.name), usage });

        if (calls.length === 0) {
            transcript.push({
                role: "user",
                text:
                    "You must work through tool calls. Call one of the available tools, " +
                    `or call ${SUBMIT_TOOL_NAME} with your final result when you are done.`,
            });
            continue;
        }

        for (const call of calls) {
            throwIfAborted(signal);
            if (call.name === SUBMIT_TOOL_NAME) {
                const parsed = finalSchema.safeParse(call.arguments);
                if (parsed.success) {
                    return { output: parsed.data, turns: turn, usage, modelId, transcript };
                }
                transcript.push(toolError(call, formatZodIssues(parsed.error)));
                continue;
            }

            const tool = byName.get(call.name);
            if (!tool) {
                transcript.push(
                    toolError(
                        call,
                        `Unknown tool "${call.name}". Available: ${[...byName.keys(), SUBMIT_TOOL_NAME].join(", ")}.`
                    )
                );
                continue;
            }

            const input = tool.inputSchema.safeParse(call.arguments);
            if (!input.success) {
                transcript.push(toolError(call, formatZodIssues(input.error)));
                continue;
            }

            try {
                const result = await tool.run(input.data, { signal });
                transcript.push({
                    role: "tool",
                    callId: call.id,
                    name: call.name,
                    content: clip(result.content),
                    isError: result.isError ?? false,
                });
            } catch (error) {
                if (signal?.aborted) throw new AgentAbortedError();
                transcript.push(
                    toolError(
                        call,
                        `Tool failed: ${error instanceof Error ? error.message : String(error)}`
                    )
                );
            }
        }
    }

    throw new AgentStepLimitError(maxTurns, usage);
}

function toolError(call: AgentToolCall, message: string): AgentTranscriptItem {
    return {
        role: "tool",
        callId: call.id,
        name: call.name,
        content: clip(message),
        isError: true,
    };
}

function formatZodIssues(error: z.ZodError): string {
    const issues = error.issues
        .slice(0, 8)
        .map(issue => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("\n");
    return `Invalid arguments:\n${issues}`;
}

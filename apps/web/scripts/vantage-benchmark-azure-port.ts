/** Benchmark-only Azure Responses adapter. One port instance belongs to one agent run. */
import type { AgentModelPort } from "@launchstack/llm";
import { z } from "zod";

export function azureResponsesEndpoint(endpoint: string): string {
    const url = new URL(endpoint);
    if (
        url.protocol !== "https:" ||
        !/^[a-z0-9-]+\.openai\.azure\.com$/i.test(url.hostname) ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash ||
        !["/", "/openai/v1", "/openai/v1/"].includes(url.pathname)
    )
        throw new Error("benchmark_azure_endpoint_invalid");
    return url.origin + "/openai/v1/responses";
}

const count = z.number().int().nonnegative().optional();
const responseSchema = z.object({
    status: z.literal("completed"),
    model: z.string().optional(),
    output: z.array(z.object({ type: z.string() }).passthrough()),
    usage: z
        .object({
            input_tokens: count,
            output_tokens: count,
            total_tokens: count,
            output_tokens_details: z.object({ reasoning_tokens: count }).optional(),
        })
        .optional(),
});
const callSchema = z.object({
    type: z.literal("function_call"),
    call_id: z.string().min(1),
    name: z.string().min(1),
    arguments: z.string(),
});
const messageSchema = z.object({
    type: z.literal("message"),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
});

export function createAzureResponsesAgentPort(options: {
    endpoint: string;
    apiKey: string;
    deployment: string;
    reasoningEffort: "high";
    operatorInstructions?: string;
    fetch?: typeof fetch;
}): AgentModelPort {
    const endpoint = azureResponsesEndpoint(options.endpoint);
    if (
        !options.apiKey ||
        !/^[A-Za-z0-9][\w.-]*$/.test(options.deployment) ||
        options.reasoningEffort !== "high"
    )
        throw new Error("benchmark_azure_configuration_invalid");
    const invoke = options.fetch ?? globalThis.fetch;
    let history: unknown[] = [];
    let consumed = 0;
    let prefix = "";
    let instructions: string | undefined;
    return {
        async respond(input) {
            input.signal?.throwIfAborted();
            if (
                instructions !== undefined &&
                (instructions !== input.system ||
                    JSON.stringify(input.transcript.slice(0, consumed)) !== prefix)
            )
                throw new Error("benchmark_azure_transcript_changed");
            const additions: unknown[] = [];
            for (const item of input.transcript.slice(consumed)) {
                if (item.role === "user") additions.push({ role: "user", content: item.text });
                if (item.role === "tool")
                    additions.push({
                        type: "function_call_output",
                        call_id: item.callId,
                        output: item.content,
                    });
                // Azure's original output items already contain assistant messages and calls.
                if (item.role === "assistant" && consumed === 0)
                    throw new Error("benchmark_azure_requires_fresh_transcript");
            }
            const next = [...history, ...additions];
            const response = await invoke(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json", "api-key": options.apiKey },
                signal: input.signal,
                body: JSON.stringify({
                    model: options.deployment,
                    instructions: options.operatorInstructions
                        ? input.system + "\n\n" + options.operatorInstructions
                        : input.system,
                    reasoning: { effort: options.reasoningEffort },
                    max_output_tokens: 6000,
                    store: false,
                    include: ["reasoning.encrypted_content"],
                    input: next,
                    tools: input.tools.map(tool => ({
                        type: "function",
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.jsonSchema,
                        strict: false,
                    })),
                }),
            });
            if (!response.ok) throw new Error("benchmark_azure_responses_http_" + response.status);
            const parsed = responseSchema.safeParse(await response.json());
            if (!parsed.success) throw new Error("benchmark_azure_responses_incomplete_or_invalid");
            const result = parsed.data;
            const toolCalls = result.output
                .filter(item => item.type === "function_call")
                .map(item => {
                    const call = callSchema.safeParse(item);
                    if (!call.success) throw new Error("benchmark_azure_function_call_invalid");
                    let args: unknown;
                    try {
                        args = JSON.parse(call.data.arguments);
                    } catch {
                        throw new Error("benchmark_azure_function_arguments_invalid");
                    }
                    return { id: call.data.call_id, name: call.data.name, arguments: args };
                });
            for (const item of result.output) {
                if (item.type === "reasoning" && typeof item.encrypted_content !== "string")
                    throw new Error("benchmark_azure_encrypted_reasoning_missing");
                if (!["reasoning", "function_call", "message"].includes(item.type))
                    throw new Error("benchmark_azure_output_type_invalid");
            }
            const text = result.output
                .filter(item => item.type === "message")
                .flatMap(item =>
                    messageSchema
                        .parse(item)
                        .content.filter(part => part.type === "output_text")
                        .map(part => part.text ?? "")
                )
                .join("\n");
            // Preserve opaque reasoning and function-call items verbatim, as required
            // for stateless continuation. Never use previous_response_id with store:false.
            history = [...next, ...result.output];
            consumed = input.transcript.length;
            prefix = JSON.stringify(input.transcript);
            instructions = input.system;
            return {
                text,
                toolCalls,
                modelId: result.model ?? options.deployment,
                usage: result.usage
                    ? {
                          inputTokens: result.usage.input_tokens,
                          outputTokens: result.usage.output_tokens,
                          totalTokens: result.usage.total_tokens,
                          reasoningTokens: result.usage.output_tokens_details?.reasoning_tokens,
                      }
                    : undefined,
            };
        },
    };
}

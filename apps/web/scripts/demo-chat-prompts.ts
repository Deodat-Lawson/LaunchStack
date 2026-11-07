/**
 * Offline demonstration of the real chat prompt and tool-loop code.
 * Scripted model turns verify delivery/mechanics, not LLM answer quality.
 * No network, database, model endpoint or credentials are used.
 */
import assert from "node:assert/strict";

import { AIMessageChunk, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { getSystemPrompt } from "../src/app/api/agents/documentQ&A/services/prompts";
import {
    CHAT_CORE_INSTRUCTIONS,
    EVIDENCE_REVIEW_REMINDER,
    TOOLS_UNAVAILABLE_REMINDER,
} from "../src/lib/ai/chat-instructions";
import { RESPONSE_STYLES } from "../src/lib/ai/styles";
import { answerWithTools, OUT_OF_TOOL_ROUNDS } from "../src/server/chat-tool-loop";
import type { ChatTool } from "../src/server/chat-tool-loop";

type Turn = AIMessageChunk[] | Error;
interface RecordedCall {
    messages: BaseMessage[];
    tools?: unknown[];
    options?: Record<string, unknown>;
}

function scriptedModel(turns: Turn[]) {
    const calls: RecordedCall[] = [];
    let cursor = 0;
    const next = () => {
        const turn = turns[cursor++];
        assert.ok(turn, "The real loop made more model calls than the fixture permits.");
        if (turn instanceof Error) throw turn;
        return turn;
    };
    const runnable = (tools?: unknown[], options?: Record<string, unknown>) => ({
        async invoke(messages: BaseMessage[]) {
            calls.push({ messages: [...messages], tools, options });
            return next().reduce((combined, chunk) => combined.concat(chunk));
        },
        async *stream(messages: BaseMessage[]) {
            calls.push({ messages: [...messages], tools, options });
            for (const chunk of next()) yield chunk;
        },
    });
    const plain = runnable();
    const model = {
        invoke: plain.invoke,
        stream: async (messages: BaseMessage[]) => plain.stream(messages),
        bindTools: (tools: unknown[], options?: Record<string, unknown>) => {
            const bound = runnable(tools, options);
            return {
                invoke: bound.invoke,
                stream: async (messages: BaseMessage[]) => bound.stream(messages),
            };
        },
    };
    return { chat: model as unknown as BaseChatModel, calls };
}

const text = (content: string) =>
    new AIMessageChunk({
        content,
        usage_metadata: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
    });

const call = (name: string, args: Record<string, unknown>, id: string) =>
    new AIMessageChunk({
        content: "",
        tool_call_chunks: [
            { name, args: JSON.stringify(args), id, index: 0, type: "tool_call_chunk" },
        ],
        usage_metadata: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
    });

const messages = (question: string) => [
    new SystemMessage(getSystemPrompt("balanced")),
    new HumanMessage(question),
];

function reminders(request: RecordedCall, reminder = EVIDENCE_REVIEW_REMINDER): number {
    return request.messages.filter(
        message => typeof message.content === "string" && message.content.includes(reminder)
    ).length;
}

function fixtureTool(name: string, run: ChatTool["run"]): ChatTool {
    return {
        name,
        description: "Offline synthetic evidence fixture",
        parameters: { type: "object", properties: {} },
        describe: () => `Running ${name} fixture`,
        run,
    };
}

async function main() {
    console.log("LaunchStack chat prompt demonstration");
    console.log(
        "Deterministic delivery/mechanics only; scripted responses are not an LLM quality evaluation."
    );
    console.log("All content is synthetic. No API, database or paid model calls.\n");

    const styles = Object.keys(RESPONSE_STYLES);
    for (const style of styles) {
        const prompt = getSystemPrompt(style);
        assert.ok(prompt.includes(CHAT_CORE_INSTRUCTIONS), `${style} bypasses the shared core`);
        assert.equal(prompt.split(CHAT_CORE_INSTRUCTIONS).length - 1, 1);
    }
    assert.match(
        CHAT_CORE_INSTRUCTIONS,
        /explicit output requirements and the agent's output contract take precedence over general response-style preferences/
    );
    console.log(`PASS Shared core and role/format precedence rule present: ${styles.join(", ")}.`);

    let executed = 0;
    const direct = scriptedModel([[text("Synthetic direct response.")]]);
    const unused = fixtureTool("search_web", async () => {
        executed++;
        return "unused";
    });
    const directResult = await answerWithTools({
        chat: direct.chat,
        messages: messages("Compute 17 × 23."),
        tools: [unused],
        signal: new AbortController().signal,
    });
    assert.equal(directResult.modelCalls, 1);
    assert.equal(executed, 0);
    assert.equal(reminders(direct.calls[0]!), 0);
    console.log("PASS Direct question: 1 model call, 0 executed tools, 0 evidence reminders.");

    const supplied = scriptedModel([[text("Synthetic response from supplied evidence.")]]);
    await answerWithTools({
        chat: supplied.chat,
        messages: [
            ...messages("What does the supplied policy say?"),
            new HumanMessage("Synthetic policy: safety training is due within 30 days."),
        ],
        tools: [],
        hasInitialEvidence: true,
        signal: new AbortController().signal,
    });
    assert.equal(supplied.calls.length, 1);
    assert.equal(reminders(supplied.calls[0]!), 1);
    console.log(
        "PASS Supplied evidence: review reminder reaches the first call without adding a model call."
    );

    const queries: string[] = [];
    const search = fixtureTool("search_web", async args => {
        const query = String((args as { query: string }).query);
        queries.push(query);
        return queries.length === 1
            ? "No results for the first synthetic query."
            : "[Source 1] Synthetic release notice\nURL: https://example.invalid/release\nA relevant excerpt exists.";
    });
    const read = fixtureTool(
        "fetch_page",
        async () =>
            "[Source 1] Synthetic release notice\nThe supported rollout date is November 3. Exceptions require approval."
    );
    const research = scriptedModel([
        [call("search_web", { query: "synthetic product announcement" }, "search-1")],
        [call("search_web", { query: "synthetic rollout release notice" }, "search-2")],
        [call("fetch_page", { url: "https://example.invalid/release" }, "read-1")],
        [text("Synthetic final response.")],
    ]);
    const researchResult = await answerWithTools({
        chat: research.chat,
        messages: messages("Research the rollout date and exceptions."),
        tools: [search, read],
        maxToolRounds: 3,
        signal: new AbortController().signal,
    });
    const counts = research.calls.map(request => reminders(request));
    assert.deepEqual(counts, [0, 1, 1, 1]);
    assert.equal(new Set(queries).size, 2);
    assert.deepEqual(
        researchResult.toolCalls.map(tool => tool.name),
        ["search_web", "search_web", "fetch_page"]
    );
    assert.deepEqual(research.calls.at(-1)?.options, { tool_choice: "none" });
    assert.ok(
        research.calls.at(-1)?.messages.some(message => message.content === OUT_OF_TOOL_ROUNDS)
    );
    console.log(
        `PASS Search → refine → full read: ${researchResult.modelCalls} model calls; review counts ${counts.join(" → ")}; tool budget enforced.`
    );

    const failure = scriptedModel([
        [call("search_sources", { query: "synthetic policy" }, "failed-search")],
        [text("Synthetic limitation response.")],
    ]);
    const failing = fixtureTool("search_sources", async () => {
        throw new Error("Synthetic source outage");
    });
    const failureResult = await answerWithTools({
        chat: failure.chat,
        messages: messages("Find the internal policy."),
        tools: [failing],
        signal: new AbortController().signal,
    });
    assert.equal(failureResult.toolCalls[0]?.ok, false);
    assert.ok(
        failure.calls[1]?.messages.some(
            message =>
                typeof message.content === "string" &&
                message.content.includes("Synthetic source outage")
        )
    );
    assert.equal(reminders(failure.calls[1]!), 1);
    console.log(
        "PASS Failed evidence access: error is visible to the model; one conditional review reminder remains."
    );

    const refusal = Object.assign(new Error("Synthetic endpoint refuses tools"), { status: 400 });
    const fallback = scriptedModel([refusal, [text("Synthetic fallback response.")]]);
    await answerWithTools({
        chat: fallback.chat,
        messages: messages("Inspect a source."),
        tools: [unused],
        signal: new AbortController().signal,
    });
    assert.equal(fallback.calls.length, 2);
    assert.equal(fallback.calls[1]?.tools, undefined);
    assert.equal(reminders(fallback.calls[1]!, TOOLS_UNAVAILABLE_REMINDER), 1);
    assert.equal(reminders(fallback.calls[1]!), 0);
    console.log(
        "PASS Endpoint refusal: plain retry receives an explicit tools-unavailable correction."
    );

    const streamed = scriptedModel([
        [call("read_source", { id: "d1" }, "stream-read")],
        [text("Synthetic streamed "), text("response.")],
    ]);
    const deltas: string[] = [];
    await answerWithTools({
        chat: streamed.chat,
        messages: messages("Read the synthetic source."),
        tools: [fixtureTool("read_source", async () => "Synthetic source evidence.")],
        stream: { onText: delta => deltas.push(delta), onReasoning: () => undefined },
        signal: new AbortController().signal,
    });
    assert.deepEqual(
        streamed.calls.map(request => reminders(request)),
        [0, 1]
    );
    assert.equal(deltas.join(""), "Synthetic streamed response.");
    console.log("PASS Streaming: same evidence guidance, with the original text stream preserved.");

    if (process.argv.includes("--show-prompt")) {
        console.log("\n--- Actual balanced system prompt ---\n");
        console.log(getSystemPrompt("balanced"));
        console.log("\n--- Actual evidence reminder ---\n");
        console.log(EVIDENCE_REVIEW_REMINDER);
    }
    console.log("\nPASS All offline demonstration assertions completed.");
}

await main();

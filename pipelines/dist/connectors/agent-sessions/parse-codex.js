/**
 * Codex rollout parser.
 *
 * A rollout file interleaves two recordings of the same conversation: the
 * model-facing `response_item` stream (messages, reasoning, tool calls) and
 * the UI-facing `event_msg` stream (user_message / agent_message events plus
 * progress noise). Importing both would duplicate every turn, so the parser
 * prefers `response_item` and only falls back to the event stream for a role
 * the response stream never recorded — older CLI versions logged some turns
 * only as events.
 */
import { TOOL_INPUT_MAX_CHARS, TOOL_RESULT_MAX_CHARS, truncateText, } from "./types.js";
/** event_msg payload types that are progress noise, not conversation. */
const METADATA_EVENT_TYPES = new Set([
    "token_count",
    "task_started",
    "task_complete",
    "thread_settings_applied",
    "web_search_begin",
    "web_search_end",
    "exec_command_begin",
    "exec_command_end",
    "turn_diff",
    "plan_update",
    "notification",
]);
function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : null;
}
function asString(value) {
    return typeof value === "string" && value.length > 0 ? value : null;
}
/**
 * Message and tool-output content arrives either as a plain string, as an
 * array of `{type: "input_text" | "output_text" | "text", text}` blocks, or —
 * for tool outputs — as a string that itself JSON-encodes such an array.
 */
export function extractCodexText(content) {
    if (typeof content === "string") {
        const trimmed = content.trim();
        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
            try {
                return extractCodexText(JSON.parse(trimmed));
            }
            catch {
                return content;
            }
        }
        return content;
    }
    if (Array.isArray(content)) {
        const parts = [];
        for (const block of content) {
            const record = asRecord(block);
            if (!record)
                continue;
            const text = asString(record.text);
            if (text)
                parts.push(text);
        }
        return parts.join("\n");
    }
    const record = asRecord(content);
    if (record) {
        const text = asString(record.text) ?? asString(record.output);
        if (text)
            return text;
    }
    return "";
}
export function parseCodexSession(raw) {
    const dropped = { thinking: 0, sidechain: 0, metadata: 0, unknown: 0, malformed: 0 };
    const lines = [];
    for (const line of raw.split("\n")) {
        if (line.trim().length === 0)
            continue;
        let record;
        try {
            record = asRecord(JSON.parse(line));
        }
        catch {
            dropped.malformed += 1;
            continue;
        }
        const type = record ? asString(record.type) : null;
        if (!record || !type) {
            dropped.malformed += 1;
            continue;
        }
        lines.push({
            type,
            payload: asRecord(record.payload) ?? {},
            at: asString(record.timestamp),
        });
    }
    // The response stream wins over the event stream wherever it recorded the
    // same role; detect what it recorded before building segments.
    let responseHasUser = false;
    let responseHasAssistant = false;
    for (const line of lines) {
        if (line.type !== "response_item")
            continue;
        if (asString(line.payload.type) !== "message")
            continue;
        const role = asString(line.payload.role);
        if (role === "user")
            responseHasUser = true;
        if (role === "assistant")
            responseHasAssistant = true;
    }
    const segments = [];
    let sessionId = null;
    let projectPath = null;
    let startedAt = null;
    let endedAt = null;
    for (const line of lines) {
        if (line.at) {
            startedAt ??= line.at;
            endedAt = line.at;
        }
        if (line.type === "session_meta") {
            sessionId ??= asString(line.payload.id) ?? asString(line.payload.session_id);
            projectPath ??= asString(line.payload.cwd);
            continue;
        }
        if (line.type === "turn_context") {
            projectPath ??= asString(line.payload.cwd);
            continue;
        }
        if (line.type === "world_state") {
            dropped.metadata += 1;
            continue;
        }
        if (line.type === "response_item") {
            const payloadType = asString(line.payload.type);
            if (payloadType === "message") {
                const role = asString(line.payload.role);
                const text = extractCodexText(line.payload.content).trim();
                if (role === "user" || role === "assistant") {
                    if (text.length > 0) {
                        segments.push({ kind: role, text, at: line.at ?? undefined });
                    }
                }
                else {
                    // developer / system prompts are harness scaffolding.
                    dropped.metadata += 1;
                }
            }
            else if (payloadType === "reasoning") {
                dropped.thinking += 1;
            }
            else if (payloadType === "custom_tool_call" || payloadType === "function_call") {
                const input = asString(line.payload.input) ?? asString(line.payload.arguments) ?? "";
                segments.push({
                    kind: "tool-call",
                    name: asString(line.payload.name) ?? "tool",
                    summary: truncateText(input.replace(/\s+/g, " ").trim(), TOOL_INPUT_MAX_CHARS),
                });
            }
            else if (payloadType === "custom_tool_call_output" ||
                payloadType === "function_call_output") {
                const text = extractCodexText(line.payload.output).trim();
                if (text.length > 0) {
                    segments.push({
                        kind: "tool-result",
                        text: truncateText(text, TOOL_RESULT_MAX_CHARS),
                    });
                }
            }
            else if (payloadType === "web_search_call") {
                dropped.metadata += 1;
            }
            else {
                dropped.unknown += 1;
            }
            continue;
        }
        if (line.type === "event_msg") {
            const payloadType = asString(line.payload.type);
            if (payloadType === "user_message") {
                if (responseHasUser)
                    dropped.metadata += 1;
                else {
                    const text = asString(line.payload.message)?.trim();
                    if (text)
                        segments.push({ kind: "user", text, at: line.at ?? undefined });
                }
            }
            else if (payloadType === "agent_message") {
                if (responseHasAssistant)
                    dropped.metadata += 1;
                else {
                    const text = asString(line.payload.message)?.trim();
                    if (text)
                        segments.push({ kind: "assistant", text, at: line.at ?? undefined });
                }
            }
            else if (payloadType === "agent_reasoning") {
                dropped.thinking += 1;
            }
            else if (payloadType && METADATA_EVENT_TYPES.has(payloadType)) {
                dropped.metadata += 1;
            }
            else {
                dropped.unknown += 1;
            }
            continue;
        }
        dropped.unknown += 1;
    }
    return {
        tool: "codex",
        sessionId,
        title: null,
        projectPath,
        gitBranch: null,
        startedAt,
        endedAt,
        segments,
        dropped,
    };
}
//# sourceMappingURL=parse-codex.js.map
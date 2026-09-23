/**
 * The agent definition file: markdown with a YAML front matter block.
 *
 * This is the interchange format the coding harnesses settled on — an
 * OpenCode agent is `.opencode/agents/<name>.md`, a Claude Code subagent is
 * `.claude/agents/<name>.md`, a Hermes skill is a `SKILL.md` — and it is what
 * makes an agent portable: a file you can diff, review, paste into a chat, or
 * carry to another workspace. Launchstack reads and writes the same shape, so
 * an agent leaves as the file it could have been written as.
 *
 * ```md
 * ---
 * name: finance
 * displayName: Dana
 * role: Finance partner
 * description: Guards margin and cash; asks what a decision costs.
 * mode: all
 * model: reasoning
 * style: detailed
 * temperature: 0.3
 * autonomy: propose
 * tools:
 *   web: false
 * color: oklch(0.6 0.15 30)
 * ---
 * You guard the margin. …
 * ```
 *
 * The parser reads the subset of YAML those files actually use — scalar keys,
 * booleans, numbers, and one level of nested map — and nothing else, on
 * purpose: a dependency-free parser is one the browser can run too.
 */

import {
    AGENT_TOOL_IDS,
    coerceAgentDefinition,
    deniedTools,
    type AgentDefinition,
} from "./definition";

export interface ParsedAgentFile {
    definition: AgentDefinition;
    /** Keys in the front matter this format does not understand. */
    unknownKeys: string[];
}

export class AgentFileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AgentFileError";
    }
}

type Scalar = string | number | boolean | null;
type FrontMatter = Record<string, Scalar | Record<string, Scalar>>;

function parseScalar(raw: string): Scalar {
    const value = raw.trim();
    if (value === "") return null;
    if (value === "null" || value === "~") return null;
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    const quoted = /^(["'])(.*)\1$/.exec(value);
    if (quoted) return quoted[2]!;
    return value;
}

/** Splits `---\n…\n---\nbody` and reads the front matter block. */
function splitFrontMatter(text: string): { matter: FrontMatter; body: string } {
    const normalized = text.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
    const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/.exec(normalized);
    if (!match) throw new AgentFileError("Missing front matter: the file must start with ---");

    const matter: FrontMatter = {};
    let nested: { key: string; map: Record<string, Scalar> } | null = null;
    for (const rawLine of match[1]!.split("\n")) {
        if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
        const indented = /^\s+/.test(rawLine);
        const line = rawLine.trim();
        const colon = line.indexOf(":");
        if (colon <= 0) throw new AgentFileError(`Cannot read front matter line: "${line}"`);
        const key = line.slice(0, colon).trim();
        const rest = line.slice(colon + 1);

        if (indented) {
            if (!nested) throw new AgentFileError(`Unexpected indented line: "${line}"`);
            nested.map[key] = parseScalar(rest);
            continue;
        }
        if (rest.trim() === "") {
            nested = { key, map: {} };
            matter[key] = nested.map;
            continue;
        }
        nested = null;
        matter[key] = parseScalar(rest);
    }
    return { matter, body: match[2]!.trim() };
}

const KNOWN_KEYS = new Set([
    "name",
    "key",
    "displayName",
    "display_name",
    "role",
    "description",
    "mode",
    "model",
    "route",
    "style",
    "temperature",
    "maxTurnChars",
    "max_turn_chars",
    "autonomy",
    "tools",
    "color",
    "accent",
    "node",
    "nodeId",
]);

/** Reads a definition file. Throws `AgentFileError` with a line a person can act on. */
export function parseAgentFile(text: string): ParsedAgentFile {
    const { matter, body } = splitFrontMatter(text);
    const scalar = (key: string): Scalar | undefined => {
        const value = matter[key];
        return value !== null && typeof value === "object" ? undefined : value;
    };

    const key = scalar("name") ?? scalar("key");
    if (typeof key !== "string" || !key.trim()) {
        throw new AgentFileError("Front matter needs a `name:` — the agent's handle");
    }
    if (!body)
        throw new AgentFileError(
            "The body under the front matter is the system prompt; it is empty"
        );

    const tools = matter.tools;
    const toolPolicy: Record<string, unknown> = {};
    if (tools && typeof tools === "object") {
        for (const id of AGENT_TOOL_IDS) {
            if (typeof tools[id] === "boolean") toolPolicy[id] = tools[id];
        }
    }

    const definition = coerceAgentDefinition({
        key,
        displayName: scalar("displayName") ?? scalar("display_name") ?? key,
        role: scalar("role") ?? "",
        description: scalar("description") ?? "",
        systemPrompt: body,
        mode: scalar("mode"),
        tools: toolPolicy,
        style: scalar("style"),
        route: scalar("model") ?? scalar("route"),
        temperature: scalar("temperature"),
        maxTurnChars: scalar("maxTurnChars") ?? scalar("max_turn_chars"),
        accent: scalar("color") ?? scalar("accent"),
        autonomy: scalar("autonomy"),
        nodeId: scalar("node") ?? scalar("nodeId"),
    });
    if (!definition.role) definition.role = definition.displayName;

    return {
        definition,
        unknownKeys: Object.keys(matter).filter(k => !KNOWN_KEYS.has(k)),
    };
}

function yamlScalar(value: string): string {
    // Quote anything YAML would misread: leading symbols, colons, hashes, or
    // values that look like other types.
    if (
        value === "" ||
        /^[\s"'#&*!|>%@`{}[\],?-]/.test(value) ||
        /[:#]/.test(value) ||
        /^(true|false|null|~|-?\d+(\.\d+)?)$/i.test(value)
    ) {
        return JSON.stringify(value);
    }
    return value;
}

/** Writes a definition as the file it could have been authored as. */
export function serializeAgentFile(agent: AgentDefinition): string {
    const lines = ["---", `name: ${yamlScalar(agent.key)}`];
    lines.push(`displayName: ${yamlScalar(agent.displayName)}`);
    lines.push(`role: ${yamlScalar(agent.role)}`);
    if (agent.description) lines.push(`description: ${yamlScalar(agent.description)}`);
    lines.push(`mode: ${agent.mode}`);
    if (agent.route) lines.push(`model: ${agent.route}`);
    if (agent.style) lines.push(`style: ${agent.style}`);
    if (agent.temperature !== null) lines.push(`temperature: ${agent.temperature}`);
    if (agent.maxTurnChars !== null) lines.push(`maxTurnChars: ${agent.maxTurnChars}`);
    if (agent.autonomy) lines.push(`autonomy: ${agent.autonomy}`);
    const denied = deniedTools(agent.tools);
    if (denied.length > 0) {
        lines.push("tools:");
        for (const id of denied) lines.push(`  ${id}: false`);
    }
    if (agent.accent) lines.push(`color: ${yamlScalar(agent.accent)}`);
    if (agent.nodeId) lines.push(`node: ${yamlScalar(agent.nodeId)}`);
    lines.push("---", "", agent.systemPrompt.trim(), "");
    return lines.join("\n");
}

/** `finance.agent.md` — the filename a definition downloads as. */
export function agentFileName(agent: Pick<AgentDefinition, "key">): string {
    return `${agent.key}.agent.md`;
}

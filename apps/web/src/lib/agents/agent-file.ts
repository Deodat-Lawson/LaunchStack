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
 *   - retrieval
 *   - reasoning
 * color: oklch(0.6 0.15 30)
 * avatar: /agents/finance.jpg
 * ---
 * You guard the margin. …
 * ```
 *
 * The parser reads the subset of YAML those files actually use — scalar keys,
 * booleans, numbers, a list of scalars, and one level of nested map — and
 * nothing else, on purpose: a dependency-free parser is one the browser can
 * run too. `tools:` accepts both a list (this file, Claude Code) and the
 * OpenCode map of booleans.
 */

import { coerceAgentDefinition, enabledTools, type AgentDefinition } from "./definition";

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
type FrontMatter = Record<string, Scalar | Scalar[] | Record<string, Scalar>>;

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
    let nested: { key: string; map: Record<string, Scalar>; list: Scalar[] } | null = null;
    for (const rawLine of match[1]!.split("\n")) {
        if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
        const indented = /^\s+/.test(rawLine);
        const line = rawLine.trim();

        // A list item under the open key: `  - retrieval`.
        if (indented && line.startsWith("- ")) {
            if (!nested) throw new AgentFileError(`Unexpected list item: "${line}"`);
            nested.list.push(parseScalar(line.slice(2)));
            matter[nested.key] = nested.list;
            continue;
        }

        const colon = line.indexOf(":");
        if (colon <= 0) throw new AgentFileError(`Cannot read front matter line: "${line}"`);
        const key = line.slice(0, colon).trim();
        const rest = line.slice(colon + 1);

        if (indented) {
            if (!nested) throw new AgentFileError(`Unexpected indented line: "${line}"`);
            nested.map[key] = parseScalar(rest);
            matter[nested.key] = nested.map;
            continue;
        }
        if (rest.trim() === "") {
            nested = { key, map: {}, list: [] };
            matter[key] = nested.map;
            continue;
        }
        nested = null;
        // Inline list: `tools: retrieval, web` (Claude Code's spelling).
        if (key === "tools" && rest.includes(",")) {
            matter[key] = rest.split(",").map(item => parseScalar(item));
            continue;
        }
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
    "avatar",
    "avatarUrl",
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

    // `tools` arrives as a list, an inline list, or the OpenCode map; the
    // registry's normaliser reads all three. Absent means every tool.
    const tools = "tools" in matter ? matter.tools : undefined;

    const definition = coerceAgentDefinition({
        key,
        displayName: scalar("displayName") ?? scalar("display_name") ?? key,
        role: scalar("role") ?? "",
        description: scalar("description") ?? "",
        systemPrompt: body,
        mode: scalar("mode"),
        tools,
        style: scalar("style"),
        route: scalar("model") ?? scalar("route"),
        temperature: scalar("temperature"),
        maxTurnChars: scalar("maxTurnChars") ?? scalar("max_turn_chars"),
        accent: scalar("color") ?? scalar("accent"),
        avatarUrl: scalar("avatar") ?? scalar("avatarUrl"),
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
    if (agent.tools !== null) {
        lines.push("tools:");
        for (const id of enabledTools(agent.tools)) lines.push(`  - ${id}`);
    }
    if (agent.accent) lines.push(`color: ${yamlScalar(agent.accent)}`);
    if (agent.avatarUrl) lines.push(`avatar: ${yamlScalar(agent.avatarUrl)}`);
    if (agent.nodeId) lines.push(`node: ${yamlScalar(agent.nodeId)}`);
    lines.push("---", "", agent.systemPrompt.trim(), "");
    return lines.join("\n");
}

/** `finance.agent.md` — the filename a definition downloads as. */
export function agentFileName(agent: Pick<AgentDefinition, "key">): string {
    return `${agent.key}.agent.md`;
}

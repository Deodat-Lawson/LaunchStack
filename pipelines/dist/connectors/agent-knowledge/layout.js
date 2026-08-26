/**
 * Declarative map of where Claude Code and Codex keep durable knowledge.
 *
 * Both tools store two very different kinds of files under the same roots:
 * knowledge the user authored (instructions, agents, commands, skills,
 * memories, prompts) and machine state (session transcripts, caches, OAuth
 * tokens, sqlite journals). Only the first kind belongs in a knowledge base,
 * so discovery is allowlist-driven: an entry here is the *only* way a file
 * can be picked up. Anything not named below is invisible to the connector.
 */
export const CLAUDE_CODE_LAYOUT = {
    toolId: "claude-code",
    label: "Claude Code",
    globalRoot: ".claude",
    globalEntries: [
        { path: "CLAUDE.md", kind: "instructions", target: "file" },
        { path: "agents", kind: "agent", target: "dir", recursive: true },
        { path: "commands", kind: "command", target: "dir", recursive: true },
        { path: "skills", kind: "skill", target: "dir", recursive: true },
        { path: "memory", kind: "memory", target: "dir", recursive: true },
        { path: "MEMORY.md", kind: "memory", target: "file" },
        { path: "output-styles", kind: "output-style", target: "dir", recursive: true },
        // Per-project memory lives at `projects/<slug>/memory/`. The sibling
        // `<slug>/*.jsonl` session transcripts are the reason this is a
        // `nested` entry and not a recursive walk of `projects/`.
        { path: "projects", kind: "memory", target: "nested", nested: "memory" },
        { path: "settings.json", kind: "config", target: "file", config: true },
    ],
    projectEntries: [
        { path: "CLAUDE.md", kind: "instructions", target: "file" },
        { path: "CLAUDE.local.md", kind: "instructions", target: "file" },
        { path: ".claude/CLAUDE.md", kind: "instructions", target: "file" },
        { path: ".claude/agents", kind: "agent", target: "dir", recursive: true },
        { path: ".claude/commands", kind: "command", target: "dir", recursive: true },
        { path: ".claude/skills", kind: "skill", target: "dir", recursive: true },
        { path: ".claude/memory", kind: "memory", target: "dir", recursive: true },
        { path: ".claude/output-styles", kind: "output-style", target: "dir", recursive: true },
        { path: ".claude/settings.json", kind: "config", target: "file", config: true },
    ],
};
export const CODEX_LAYOUT = {
    toolId: "codex",
    label: "Codex",
    globalRoot: ".codex",
    globalEntries: [
        { path: "AGENTS.md", kind: "instructions", target: "file" },
        { path: "instructions.md", kind: "instructions", target: "file" },
        { path: "prompts", kind: "prompt", target: "dir", recursive: true },
        { path: "memories", kind: "memory", target: "dir", recursive: true },
        { path: "config.toml", kind: "config", target: "file", config: true },
    ],
    projectEntries: [
        { path: "AGENTS.md", kind: "instructions", target: "file" },
        { path: ".codex/AGENTS.md", kind: "instructions", target: "file" },
        { path: ".codex/prompts", kind: "prompt", target: "dir", recursive: true },
        { path: ".codex/memories", kind: "memory", target: "dir", recursive: true },
    ],
};
export const TOOL_LAYOUTS = [CLAUDE_CODE_LAYOUT, CODEX_LAYOUT];
export function layoutFor(toolId) {
    const layout = TOOL_LAYOUTS.find(candidate => candidate.toolId === toolId);
    if (!layout) throw new Error(`Unknown agent tool: ${toolId}`);
    return layout;
}
/** Text-ish extensions a knowledge file may carry. */
export const KNOWLEDGE_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt"]);
/** Extensions only readable when `includeConfig` is on. */
export const CONFIG_EXTENSIONS = new Set([".json", ".toml", ".yaml", ".yml"]);
/**
 * Names that must never be read, whatever the extension says. These sit
 * inside allowlisted roots, so the allowlist alone would not stop them.
 */
export const DENIED_FILENAMES = new Set([
    ".credentials.json",
    "auth.json",
    "credentials.json",
    ".env",
    ".env.local",
    "settings.local.json",
    "history.jsonl",
    "id_rsa",
    "id_ed25519",
]);
/** Filename patterns that read as secret material. */
export const DENIED_FILENAME_PATTERNS = [
    /^\.env(\..+)?$/i,
    /\.(pem|key|p12|pfx|keystore)$/i,
    /(^|[-_.])(secret|secrets|token|tokens|credential|credentials)([-_.]|$)/i,
];
/** Directory names never descended into, at any depth. */
export const DENIED_DIRECTORIES = new Set([
    ".git",
    "node_modules",
    "__pycache__",
    "cache",
    "caches",
    "logs",
    "tmp",
    ".tmp",
    "sessions",
    "archived_sessions",
    "projects",
    "shell-snapshots",
    "file-history",
    "paste-cache",
    "downloads",
    "backups",
    "session-env",
    "ipc",
    "daemon",
    "todos",
    "statsig",
    "browser",
    "generated_images",
    "computer-use",
    "node_repl",
]);
export function isDeniedFilename(name) {
    const lower = name.toLowerCase();
    if (DENIED_FILENAMES.has(lower)) return true;
    return DENIED_FILENAME_PATTERNS.some(pattern => pattern.test(lower));
}
export function isDeniedDirectory(name) {
    return DENIED_DIRECTORIES.has(name.toLowerCase());
}
//# sourceMappingURL=layout.js.map

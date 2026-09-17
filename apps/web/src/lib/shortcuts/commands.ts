/**
 * The keyboard command registry.
 *
 * Shortcuts used to be five `if` branches in the workspace shell and a set
 * of decorative labels in the feature list that no handler honoured (⌘D,
 * ⌘R and ⌘W are the browser's own). Now every command is declared once with
 * a default, the shell dispatches from this list, and a member may remap any
 * of them in Settings → Shortcuts. The labels come from the same list, so a
 * shortcut shown in the UI is a shortcut that works.
 *
 * Keys are stored as a canonical string: modifiers in a fixed order joined
 * with `+`, then the key. `Mod` is ⌘ on macOS and Ctrl elsewhere, so one
 * default serves both. The mindmap editor keeps its own map (its tool keys
 * are single letters that only make sense with a canvas focused).
 */

export type ShortcutWhen = "always" | "outside-input";

export interface ShortcutCommand {
    id: string;
    label: string;
    description: string;
    defaultKeys: string;
    /** `outside-input` commands never fire while typing in a field. */
    when: ShortcutWhen;
}

export const SHORTCUT_COMMANDS: readonly ShortcutCommand[] = [
    {
        id: "palette.toggle",
        label: "Jump to anything",
        description: "Open the command palette: sources, features, settings.",
        defaultKeys: "Mod+K",
        when: "always",
    },
    {
        id: "source.add",
        label: "Add a source",
        description: "Open the Add source dialog.",
        defaultKeys: "Mod+U",
        when: "always",
    },
    {
        id: "studio.toggle",
        label: "Open or close the Studio",
        description: "The drawer of features on the right.",
        defaultKeys: "Mod+J",
        when: "always",
    },
    {
        id: "rail.toggle",
        label: "Show or hide the sidebar",
        description: "The sources and history rail.",
        defaultKeys: "Mod+\\",
        when: "always",
    },
    {
        id: "search.focus",
        label: "Focus search",
        description: "Put the cursor in the knowledge search box.",
        defaultKeys: "/",
        when: "outside-input",
    },
    {
        id: "feature.draft",
        label: "Open Draft",
        description: "Generate a new document with AI.",
        defaultKeys: "Mod+Shift+D",
        when: "always",
    },
    {
        id: "feature.rewrite",
        label: "Open Rewrite",
        description: "Improve existing content.",
        defaultKeys: "Mod+Shift+E",
        when: "always",
    },
    {
        id: "feature.workflows",
        label: "Open Workflows",
        description: "Automate recurring tasks across your sources.",
        defaultKeys: "Mod+Shift+F",
        when: "always",
    },
    {
        id: "feature.notes",
        label: "Open Notebook",
        description: "Freeform notes that span every source.",
        defaultKeys: "Mod+Shift+N",
        when: "always",
    },
    {
        id: "feature.meetings",
        label: "Open Meetings",
        description: "Agents working an objective in a channel you can join.",
        defaultKeys: "Mod+Shift+M",
        when: "always",
    },
    {
        id: "settings.open",
        label: "Open Settings",
        description: "The config panel.",
        defaultKeys: "Mod+,",
        when: "always",
    },
];

export const SHORTCUT_COMMANDS_BY_ID: ReadonlyMap<string, ShortcutCommand> = new Map(
    SHORTCUT_COMMANDS.map(command => [command.id, command])
);

/** Feature ids the palette and the Studio menu label with a shortcut. */
export const FEATURE_COMMAND_IDS: Readonly<Record<string, string>> = {
    draft: "feature.draft",
    rewrite: "feature.rewrite",
    workflows: "feature.workflows",
    notes: "feature.notes",
    meetings: "feature.meetings",
};

/** Member overrides: command id → keys, or null to unbind. */
export type ShortcutBindings = Record<string, string | null>;

const MODIFIER_ORDER = ["Mod", "Ctrl", "Alt", "Shift"] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

export interface ParsedKeys {
    modifiers: Set<Modifier>;
    key: string;
}

/** Split a stored string. Returns null when it is not a usable binding. */
export function parseKeys(keys: string): ParsedKeys | null {
    const parts = keys.split("+").map(part => part.trim());
    if (parts.length === 0) return null;
    const key = parts[parts.length - 1]!;
    if (!key) return null;
    const modifiers = new Set<Modifier>();
    for (const part of parts.slice(0, -1)) {
        if ((MODIFIER_ORDER as readonly string[]).includes(part)) modifiers.add(part as Modifier);
        else return null;
    }
    return { modifiers, key: normalizeKeyName(key) };
}

function normalizeKeyName(key: string): string {
    if (key === " " || key.toLowerCase() === "space") return "Space";
    if (key.length === 1) return key.toUpperCase();
    return key;
}

/** Canonical form: fixed modifier order, upper-case single keys. */
export function canonicalKeys(keys: string): string | null {
    const parsed = parseKeys(keys);
    if (!parsed) return null;
    const mods = MODIFIER_ORDER.filter(m => parsed.modifiers.has(m));
    return [...mods, parsed.key].join("+");
}

/** The binding a keydown event represents, or null for a bare modifier press. */
export function keysFromEvent(
    event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
    platform: "mac" | "other" = detectPlatform()
): string | null {
    const key = event.key;
    if (key === "Meta" || key === "Control" || key === "Alt" || key === "Shift") return null;
    const mods: Modifier[] = [];
    const modPressed = platform === "mac" ? event.metaKey : event.ctrlKey;
    if (modPressed) mods.push("Mod");
    // On macOS Ctrl is a distinct modifier; elsewhere it *is* Mod.
    if (platform === "mac" && event.ctrlKey) mods.push("Ctrl");
    if (event.altKey) mods.push("Alt");
    if (event.shiftKey) mods.push("Shift");
    return [...mods, normalizeKeyName(key)].join("+");
}

export function eventMatches(
    event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
    keys: string,
    platform: "mac" | "other" = detectPlatform()
): boolean {
    const canonical = canonicalKeys(keys);
    if (!canonical) return false;
    const pressed = keysFromEvent(event, platform);
    if (!pressed) return false;
    return pressed === canonical;
}

export function detectPlatform(): "mac" | "other" {
    if (typeof navigator === "undefined") return "other";
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "") ? "mac" : "other";
}

const MAC_GLYPHS: Record<string, string> = {
    Mod: "⌘",
    Ctrl: "⌃",
    Alt: "⌥",
    Shift: "⇧",
    Enter: "↩",
    Escape: "⎋",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Backspace: "⌫",
};

const OTHER_NAMES: Record<string, string> = {
    Mod: "Ctrl",
    Ctrl: "Ctrl",
    Alt: "Alt",
    Shift: "Shift",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
};

/** "⌘⇧D" on a Mac, "Ctrl+Shift+D" elsewhere. */
export function formatKeys(keys: string, platform: "mac" | "other" = detectPlatform()): string {
    const canonical = canonicalKeys(keys);
    if (!canonical) return keys;
    const parts = canonical.split("+");
    if (platform === "mac") return parts.map(part => MAC_GLYPHS[part] ?? part).join("");
    return parts.map(part => OTHER_NAMES[part] ?? part).join("+");
}

/** Effective keys per command after member overrides. A null override unbinds. */
export function resolveBindings(
    overrides: ShortcutBindings | null | undefined
): Map<string, string | null> {
    const out = new Map<string, string | null>();
    for (const command of SHORTCUT_COMMANDS) {
        const override = overrides?.[command.id];
        if (override === null) out.set(command.id, null);
        else if (typeof override === "string" && canonicalKeys(override)) {
            out.set(command.id, canonicalKeys(override));
        } else out.set(command.id, canonicalKeys(command.defaultKeys));
    }
    return out;
}

/** Command ids that share a binding, keyed by the binding. */
export function findConflicts(bindings: Map<string, string | null>): Map<string, string[]> {
    const byKeys = new Map<string, string[]>();
    for (const [id, keys] of bindings) {
        if (!keys) continue;
        const list = byKeys.get(keys) ?? [];
        list.push(id);
        byKeys.set(keys, list);
    }
    const conflicts = new Map<string, string[]>();
    for (const [keys, ids] of byKeys) if (ids.length > 1) conflicts.set(keys, ids);
    return conflicts;
}

/**
 * The command a keydown should run, given the effective bindings and whether
 * the event started inside a text field. Returns null when nothing matches.
 */
export function commandForEvent(
    event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
    bindings: Map<string, string | null>,
    options: { inInput: boolean; platform?: "mac" | "other" }
): ShortcutCommand | null {
    const pressed = keysFromEvent(event, options.platform ?? detectPlatform());
    if (!pressed) return null;
    for (const command of SHORTCUT_COMMANDS) {
        const keys = bindings.get(command.id);
        if (!keys || keys !== pressed) continue;
        if (command.when === "outside-input" && options.inInput) continue;
        return command;
    }
    return null;
}

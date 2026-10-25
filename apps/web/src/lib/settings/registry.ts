/**
 * The settings registry: every simple setting declared once.
 *
 * A declaration says what the setting is called, which section owns it, what
 * people might type to find it, which scopes may hold a value, who may write
 * the workspace-level ones, how to validate it, and how the generic row
 * renders it. From that one list the panel gets search, `#key` deep links,
 * read-only rows for people without the permission, one validating API, and
 * an audit trail — instead of building each five times.
 *
 * Rich sections (People, Company profile, Processing, Models) keep their own
 * components and simply do not register rows. The registry earns its keep on
 * the long tail of toggles and selects.
 *
 * Dependency-free apart from zod, so client components and route handlers
 * share it. Secrets are never registry-backed: this list is read back to the
 * browser verbatim.
 */

import { z } from "zod";

import type { Permission } from "~/lib/authz/permissions";
import {
    AGENT_AUTONOMY_LEVELS,
    AGENT_AUTONOMY_META,
    DEFAULT_AGENT_AUTONOMY,
} from "~/lib/agents/autonomy";
import { AGENT_STYLE_IDS } from "~/lib/agents/definition";
import { DEFAULT_LOCALE, LOCALE_CODES, LOCALES } from "~/i18n/locales";

import type { SettingControl, SettingOption, SettingsSectionId, StoredScope } from "./types";

export interface SettingDefinition<T = unknown> {
    key: string;
    /** Where the row lives, and where `#key` lands. */
    section: SettingsSectionId;
    /**
     * Where the workspace-scope row is drawn, when that is not `section`. Set
     * when the personal row belongs with the other You preferences but the
     * workspace default is policy for admins.
     */
    workspaceSection?: SettingsSectionId;
    /** Row label. Short. */
    label: string;
    /** What it does, one sentence. */
    description: string;
    /** What changing it costs — shown above the control, not in a toast afterwards. */
    consequence?: string;
    /** What people call it. Matched by search alongside the label and description. */
    aliases: readonly string[];
    /** Stored scopes that may hold a value for this setting. */
    scopes: readonly StoredScope[];
    /** Needed to write the workspace or folder value. Null: anyone with a membership. */
    permission: Permission | null;
    schema: z.ZodType<T>;
    default: T;
    control: SettingControl;
    /**
     * Placed by hand, so `SectionRows` leaves it out: a feature surface renders
     * it, or its row is drawn somewhere specific (once per scope). Still
     * searchable, and `#key` still lands on `section`.
     */
    custom?: boolean;
    /** Lives in a legacy column, joined in by the server's bindings rather than `settings_values`. */
    bound?: boolean;
}

const RETENTION_DAYS_OPTIONS = [
    { value: null, key: "forever", label: "Keep forever" },
    { value: 30, key: "days30", label: "30 days" },
    { value: 90, key: "days90", label: "90 days" },
    { value: 180, key: "days180", label: "180 days" },
    { value: 365, key: "days365", label: "One year" },
] as const;

const TRASH_DAYS_OPTIONS = [
    { value: null, key: "untilDeleted", label: "Keep until deleted by hand" },
    { value: 7, key: "days7", label: "7 days" },
    { value: 30, key: "days30", label: "30 days" },
    { value: 90, key: "days90", label: "90 days" },
] as const;

/** Declared as a plain array so each entry keeps its own value type. */
export const SETTINGS: readonly SettingDefinition[] = [
    // ------------------------------------------------------------------
    // You
    // ------------------------------------------------------------------
    {
        key: "appearance.language",
        section: "appearance",
        label: "Language",
        description:
            "The language of menus, buttons and messages. Assistants answer in it too, unless you write in another one.",
        aliases: ["language", "translation", "chinese", "english", "locale", "语言", "中文"],
        scopes: ["member"],
        permission: null,
        schema: z.enum(LOCALE_CODES),
        // Stored only once the person picks one: until then the browser's
        // own languages decide (src/i18n/locales.ts).
        default: DEFAULT_LOCALE,
        control: {
            kind: "select",
            options: LOCALES.map(locale => ({ value: locale.code, label: locale.nativeName })),
        },
        // Drawn by LanguageRow, which shows the language the page is in.
        custom: true,
    },
    {
        key: "appearance.theme",
        section: "appearance",
        label: "Theme",
        description: "Light, dark, or whatever your system is using.",
        aliases: ["dark mode", "light mode", "colour", "color", "night"],
        scopes: ["member"],
        permission: null,
        schema: z.enum(["system", "light", "dark"]),
        // Dark, like the landing site and the sign-in screens: "system" here
        // flipped people to light the moment they entered a workspace.
        default: "dark",
        control: {
            kind: "radio",
            options: [
                { value: "system", label: "System", description: "Follows your OS setting." },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
            ],
        },
    },
    {
        key: "appearance.density",
        section: "appearance",
        label: "Density",
        description: "How much fits on screen. Compact tightens spacing and type in lists.",
        aliases: ["compact", "spacing", "font size", "text size", "zoom"],
        scopes: ["member"],
        permission: null,
        schema: z.enum(["comfortable", "compact"]),
        default: "comfortable",
        control: {
            kind: "radio",
            options: [
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
            ],
        },
    },
    {
        key: "appearance.reducedMotion",
        section: "appearance",
        label: "Motion",
        description: "Animations and transitions across the app.",
        aliases: ["animation", "reduce motion", "transitions", "accessibility"],
        scopes: ["member"],
        permission: null,
        schema: z.enum(["system", "reduce", "allow"]),
        default: "system",
        control: {
            kind: "select",
            options: [
                {
                    value: "system",
                    label: "Follow system",
                    description: "Honours your OS reduce-motion setting.",
                },
                { value: "reduce", label: "Reduce", description: "Turns animations off." },
                { value: "allow", label: "Allow" },
            ],
        },
    },
    {
        key: "chat.responseStyle",
        section: "appearance",
        label: "Answer style of the default assistant",
        description:
            "How Launchstack answers when no agent is picked in the composer. An agent brings its own style, so this never applies to one.",
        aliases: [
            "response style",
            "balanced",
            "concise",
            "detailed",
            "academic",
            "organized",
            "answer length",
            "tone",
        ],
        // Two rows, one per scope: each person's own choice under Appearance,
        // and the workspace default (what everyone else gets) under Agents and
        // autonomy, which only admins see. `#chat.responseStyle` lands on the
        // personal row, because everyone can reach that one.
        workspaceSection: "agents",
        scopes: ["workspace", "member"],
        permission: "settings.manage",
        schema: z.enum(AGENT_STYLE_IDS),
        default: "balanced",
        control: {
            kind: "select",
            options: [
                {
                    value: "balanced",
                    label: "Balanced",
                    description:
                        "Length matches the question: a line for a lookup, a full answer for a how or why.",
                },
                {
                    value: "concise",
                    label: "Concise",
                    description: "Short and direct: the answer first, no filler.",
                },
                {
                    value: "detailed",
                    label: "Detailed",
                    description: "Comprehensive, with context and background.",
                },
                {
                    value: "academic",
                    label: "Academic",
                    description: "Analytical and precise, formal structure.",
                },
                {
                    value: "organized",
                    label: "Organized",
                    description: "Sections and bullets, built to scan.",
                },
            ],
        },
        custom: true,
    },
    {
        key: "shortcuts.bindings",
        section: "shortcuts",
        label: "Keyboard shortcuts",
        description: "Which keys run which commands. Yours alone; other members keep their own.",
        aliases: ["keybindings", "hotkeys", "keys", "remap", "command palette"],
        scopes: ["member"],
        permission: null,
        schema: z.record(z.string(), z.string().nullable()),
        default: {},
        control: { kind: "text" },
        custom: true,
    },
    {
        key: "privacy.productAnalytics",
        section: "privacy",
        label: "Product analytics",
        description:
            "Whether page views from your browser count toward the hosted product's usage analytics. Off the hosted service nothing is sent regardless.",
        aliases: ["telemetry", "tracking", "vercel analytics", "opt out"],
        scopes: ["member"],
        permission: null,
        schema: z.boolean(),
        default: true,
        control: { kind: "switch" },
    },

    // ------------------------------------------------------------------
    // Workspace
    // ------------------------------------------------------------------
    {
        key: "workspace.auditRetentionDays",
        section: "people",
        label: "Keep audit events for",
        description: "How long the audit log is kept.",
        consequence: "Older events are deleted. Export a CSV first if you need a permanent copy.",
        aliases: ["audit retention", "audit log", "retention", "history"],
        scopes: ["workspace"],
        permission: "settings.manage",
        schema: z.number().int().min(1).max(3650).nullable(),
        default: null,
        control: { kind: "select", options: RETENTION_DAYS_OPTIONS },
        bound: true,
    },
    {
        key: "agents.defaultAutonomy",
        section: "agents",
        label: "Default autonomy for agents",
        description:
            "How much an agent with no level of its own may do unattended. Each agent can be set lower or higher on its card.",
        consequence:
            "Lowering this can stop meetings from mirroring to Slack or running on their own until the room's agents are raised again.",
        aliases: ["autonomy", "permission mode", "supervised", "unattended", "agent access"],
        scopes: ["workspace"],
        permission: "settings.manage",
        schema: z.enum(AGENT_AUTONOMY_LEVELS),
        default: DEFAULT_AGENT_AUTONOMY,
        control: {
            kind: "radio",
            options: AGENT_AUTONOMY_LEVELS.map(level => ({
                value: level,
                label: AGENT_AUTONOMY_META[level].label,
                description: AGENT_AUTONOMY_META[level].description,
            })),
        },
    },

    // ------------------------------------------------------------------
    // Workspace data
    // ------------------------------------------------------------------
    {
        key: "usage.pricePerMillionTokens",
        section: "usage",
        label: "Price per million tokens",
        description:
            "What a million ledger tokens cost you, in your currency. Used only to estimate spend on this page; leave 0 to show tokens alone.",
        aliases: ["cost", "pricing", "spend", "budget", "dollars"],
        scopes: ["workspace"],
        permission: "settings.manage",
        schema: z.number().min(0).max(100_000),
        default: 0,
        control: { kind: "number", min: 0, step: 0.01, unit: "per 1M tokens" },
    },
    {
        key: "usage.lowBalanceThreshold",
        section: "usage",
        label: "Low balance warning",
        description: "The balance below which this page and the balance chip warn.",
        aliases: ["low balance", "warning", "threshold", "credits"],
        scopes: ["workspace"],
        permission: "settings.manage",
        schema: z.number().int().min(0).max(1_000_000_000),
        default: 500_000,
        control: { kind: "number", min: 0, step: 10_000, unit: "tokens" },
    },
    {
        key: "retention.trashDays",
        section: "archive",
        label: "Empty the trash after",
        description: "Trashed maps and artifacts older than this are removed for good.",
        consequence:
            "Applied the next time the archive is opened. A removed item cannot be restored.",
        aliases: ["trash", "retention", "purge", "auto delete", "archive"],
        scopes: ["workspace"],
        permission: "settings.manage",
        schema: z.number().int().min(1).max(3650).nullable(),
        default: null,
        control: { kind: "select", options: TRASH_DAYS_OPTIONS },
    },
    {
        key: "labs.predictiveGaps",
        section: "labs",
        label: "Predictive gaps",
        description:
            "Lists missing exhibits, schedules and compliance gaps across your documents. The analysis exists; the screen that shows it does not yet, so this only surfaces the entry in the palette.",
        aliases: ["audit", "gaps", "compliance", "predictive analysis", "experimental"],
        scopes: ["workspace"],
        permission: "settings.manage",
        schema: z.boolean(),
        default: false,
        control: { kind: "switch" },
    },
];

export const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDefinition> = new Map(
    SETTINGS.map(definition => [definition.key, definition])
);

export function getSetting(key: string): SettingDefinition | undefined {
    return SETTINGS_BY_KEY.get(key);
}

export function isSettingKey(value: unknown): value is string {
    return typeof value === "string" && SETTINGS_BY_KEY.has(value);
}

export function settingsForSection(section: SettingsSectionId): SettingDefinition[] {
    return SETTINGS.filter(definition => definition.section === section);
}

/**
 * The words a reader sees for a setting, when they differ from the English
 * declared here (`useSettingCopier` in ./useSettings gives the translated ones).
 */
export interface SettingSearchCopy {
    label: string;
    description: string;
}

/**
 * The stable message key of an option (`settings.registry.<key>.options.<this>`):
 * its declared `key`, or its value when that is a string, camel-cased
 * (`landing_ai` → `landingAi`). Null for a value that names nothing.
 */
export function settingOptionKey(option: SettingOption): string | null {
    if (option.key) return option.key;
    if (typeof option.value !== "string" || !option.value) return null;
    const key = option.value.replace(/[_-]+([a-z0-9])/gi, (_, c: string) => c.toUpperCase());
    return /^[A-Za-z][A-Za-z0-9]*$/.test(key) ? key : null;
}

/**
 * Ranked search over labels, aliases, keys and descriptions. Empty query → nothing.
 *
 * `copy` adds the words the reader sees (their language's label and
 * description), matched alongside the English ones and the aliases — someone
 * reading Chinese types Chinese.
 */
export function searchSettings(
    query: string,
    limit = 8,
    copy?: (definition: SettingDefinition) => SettingSearchCopy
): SettingDefinition[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored: Array<{ definition: SettingDefinition; score: number; label: string }> = [];
    for (const definition of SETTINGS) {
        const shown = copy?.(definition);
        const labels = [definition.label.toLowerCase()];
        const descriptions = [definition.description.toLowerCase()];
        if (shown) {
            labels.push(shown.label.toLowerCase());
            descriptions.push(shown.description.toLowerCase());
        }
        const key = definition.key.toLowerCase();
        let score = 0;
        if (labels.some(label => label === q) || key === q) score = 100;
        else if (labels.some(label => label.startsWith(q))) score = 80;
        else if (definition.aliases.some(alias => alias.toLowerCase() === q)) score = 75;
        else if (labels.some(label => label.includes(q)) || key.includes(q)) score = 60;
        else if (definition.aliases.some(alias => alias.toLowerCase().includes(q))) score = 50;
        else if (descriptions.some(description => description.includes(q))) score = 30;
        if (score > 0) scored.push({ definition, score, label: shown?.label ?? definition.label });
    }
    scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    return scored.slice(0, limit).map(entry => entry.definition);
}

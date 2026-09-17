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

import type { SettingControl, SettingsSectionId, StoredScope } from "./types";

export interface SettingDefinition<T = unknown> {
    key: string;
    section: SettingsSectionId;
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
    /** A feature surface renders this one; the generic row is not used. Still searchable. */
    custom?: boolean;
    /** Lives in a legacy column, joined in by the server's bindings rather than `settings_values`. */
    bound?: boolean;
}

const RETENTION_DAYS_OPTIONS = [
    { value: null, label: "Keep forever" },
    { value: 30, label: "30 days" },
    { value: 90, label: "90 days" },
    { value: 180, label: "180 days" },
    { value: 365, label: "One year" },
] as const;

const TRASH_DAYS_OPTIONS = [
    { value: null, label: "Keep until deleted by hand" },
    { value: 7, label: "7 days" },
    { value: 30, label: "30 days" },
    { value: 90, label: "90 days" },
] as const;

/** Declared as a plain array so each entry keeps its own value type. */
export const SETTINGS: readonly SettingDefinition[] = [
    // ------------------------------------------------------------------
    // You
    // ------------------------------------------------------------------
    {
        key: "appearance.theme",
        section: "appearance",
        label: "Theme",
        description: "Light, dark, or whatever your system is using.",
        aliases: ["dark mode", "light mode", "colour", "color", "night"],
        scopes: ["member"],
        permission: null,
        schema: z.enum(["system", "light", "dark"]),
        default: "system",
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
        key: "workspace.joinPolicy",
        section: "people",
        label: "When someone uses a join link",
        description: "Whether they wait for approval or join with the link's role immediately.",
        aliases: ["join policy", "approval", "join links", "invite", "open workspace"],
        scopes: ["workspace"],
        permission: "settings.manage",
        schema: z.enum(["approval", "open"]),
        default: "approval",
        control: {
            kind: "radio",
            options: [
                {
                    value: "approval",
                    label: "Approval required",
                    description: "They wait on the pending list until an admin approves them.",
                },
                {
                    value: "open",
                    label: "Anyone with a link joins immediately",
                    description:
                        "They get the link's role the moment they use it. Revoke links you no longer trust.",
                },
            ],
        },
        bound: true,
    },
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
    {
        key: "documents.uploadStorage",
        section: "documents",
        label: "Where uploaded files are stored",
        description: "The storage that receives new uploads. Existing files stay where they are.",
        aliases: ["storage", "uploadthing", "blob", "s3", "upload preference"],
        scopes: ["workspace"],
        permission: "settings.manage",
        schema: z.enum(["cloud", "database"]),
        default: "cloud",
        control: {
            kind: "radio",
            options: [
                {
                    value: "cloud",
                    label: "UploadThing",
                    description: "Needs UPLOADTHING_TOKEN on the server.",
                },
                {
                    value: "database",
                    label: "Blob / database",
                    description: "The server's own storage.",
                },
            ],
        },
        bound: true,
    },
    {
        key: "documents.defaultProcessingMethod",
        section: "documents",
        label: "Default processing method",
        description:
            "What a new upload is processed with unless the person uploading picks otherwise.",
        aliases: ["ocr", "processing", "docling", "azure", "landing ai", "datalab"],
        scopes: ["workspace", "folder"],
        permission: "settings.manage",
        schema: z.enum(["standard", "auto", "azure", "landing_ai", "datalab", "docling"]),
        default: "standard",
        control: {
            kind: "select",
            options: [
                {
                    value: "standard",
                    label: "Standard",
                    description: "No OCR. For text-based PDFs.",
                },
                { value: "auto", label: "Auto", description: "Pick the best method per document." },
                { value: "azure", label: "Azure OCR" },
                { value: "landing_ai", label: "Landing AI" },
                { value: "datalab", label: "Datalab" },
                { value: "docling", label: "Docling" },
            ],
        },
    },
    {
        key: "documents.defaultFolder",
        section: "documents",
        label: "Default folder for new uploads",
        description: "Pre-selected in the upload dialog. Leave blank for Unfiled.",
        aliases: ["folder", "category", "destination", "where documents land"],
        scopes: ["workspace"],
        permission: "settings.manage",
        schema: z.string().max(256),
        default: "",
        control: { kind: "text", placeholder: "Unfiled" },
    },
    {
        key: "documents.createNativeGoogleDoc",
        section: "documents",
        label: "Create new documents as Google Docs",
        description:
            "When Drive linking is on, the Add source dialog opens on Google Doc instead of a local file.",
        aliases: ["google docs", "drive", "create", "native doc"],
        scopes: ["workspace"],
        permission: "settings.manage",
        schema: z.boolean(),
        default: false,
        control: { kind: "switch" },
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

/** Ranked search over labels, aliases, keys and descriptions. Empty query → nothing. */
export function searchSettings(query: string, limit = 8): SettingDefinition[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored: Array<{ definition: SettingDefinition; score: number }> = [];
    for (const definition of SETTINGS) {
        const label = definition.label.toLowerCase();
        const key = definition.key.toLowerCase();
        let score = 0;
        if (label === q || key === q) score = 100;
        else if (label.startsWith(q)) score = 80;
        else if (definition.aliases.some(alias => alias.toLowerCase() === q)) score = 75;
        else if (label.includes(q) || key.includes(q)) score = 60;
        else if (definition.aliases.some(alias => alias.toLowerCase().includes(q))) score = 50;
        else if (definition.description.toLowerCase().includes(q)) score = 30;
        if (score > 0) scored.push({ definition, score });
    }
    scored.sort(
        (a, b) => b.score - a.score || a.definition.label.localeCompare(b.definition.label)
    );
    return scored.slice(0, limit).map(entry => entry.definition);
}

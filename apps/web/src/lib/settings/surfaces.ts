/**
 * The two places settings live, and where a link into either one lands.
 *
 * - **Settings** is yours alone: Account, Appearance, Shortcuts, and Data and
 *   privacy. A Studio tab, and a page of its own at `/employer/settings`.
 * - **Workspace** is everything else about the workspace, as a Studio tab
 *   with its screens across the top: its own details (General), people and
 *   access, the company profile, agents, integrations, the archive and labs.
 *   Each screen's path is `/<section id>`.
 * - **Models & usage** (the Usage tab, id `usage`) is the workspace's AI and
 *   the workspace's and each person's numbers. Three of its screens draw a
 *   settings section (`USAGE_SECTION_PATHS`): Spending is `usage` — balance,
 *   pricing and per-person limits, a Workspace screen until October 2026 —
 *   and API keys (`/keys`) is `byok`, and Models (`/models`) shows `models`,
 *   both Workspace screens until November 2026.
 *
 * Until October 2026 both were one Settings hub, so every link that exists
 * says `/employer/settings#<something>`: a section alias (`#people`,
 * `#byok`), a registry key (`#usage.pricePerMillionTokens`), or a People tab
 * (`#audit`). `settingsDestination` is the one answer to where such a hash
 * goes now, shared by the workspace shell, the standalone Settings page, the
 * command palette and their tests.
 *
 * No React here: route handlers and redirect pages import it too.
 */

import { SETTINGS } from "./registry";
import { settingsSectionFromHash } from "./sections";
import type { SettingsSectionId } from "./types";
import {
    WORKSPACE_PATH,
    parseToolHref,
    toolTabHref,
    toolTargetFromHref,
} from "~/lib/tool-app/locations";

/** The standalone page of the personal half. */
export const SETTINGS_PATH = "/employer/settings";

/** The Studio id of the Workspace tab. */
export const WORKSPACE_TOOL_ID = "workspace";

/** The Studio id of the Usage tab. */
export const USAGE_TOOL_ID = "usage";

/** Where the `usage` settings section lives now: the Usage tab's Spending screen. */
export const USAGE_SPENDING_PATH = "/spending";

/** Where the `byok` settings section lives now: the Usage tab's API keys screen. */
export const USAGE_KEYS_PATH = "/keys";

/** Where the `models` settings section lives now: the Usage tab's Models screen. */
export const USAGE_MODELS_PATH = "/models";

/** The settings sections the Usage tab draws, and the screen each is on. */
export const USAGE_SECTION_PATHS = {
    usage: USAGE_SPENDING_PATH,
    byok: USAGE_KEYS_PATH,
    models: USAGE_MODELS_PATH,
} as const satisfies Partial<Record<SettingsSectionId, string>>;
export type UsageSectionId = keyof typeof USAGE_SECTION_PATHS;

/** The Usage tab's Overview, where Analytics' old links land. */
const USAGE_HOME_PATH = "/overview";

/** What Settings shows, in rail order. Each is yours alone. */
export const PERSONAL_SECTION_IDS = [
    "account",
    "appearance",
    "shortcuts",
    "privacy",
] as const satisfies readonly SettingsSectionId[];
export type PersonalSectionId = (typeof PERSONAL_SECTION_IDS)[number];

/**
 * The Workspace tab's screens, in the order its bar shows them. (API keys
 * and Models were screens here until they moved to the Usage tab;
 * `~/lib/tool-app/locations` sends their old paths there.)
 */
export const WORKSPACE_SCREEN_IDS = [
    "general",
    "people",
    "company",
    "agents",
    "integrations",
    "archive",
    "labs",
] as const satisfies readonly SettingsSectionId[];
export type WorkspaceScreenId = (typeof WORKSPACE_SCREEN_IDS)[number];

/**
 * The bar's groups, in order, divided by a hairline in one row (the frame
 * switches by group only past eight screens). Their names are
 * `settings.workspaceTab.groups.<id>`.
 */
export const WORKSPACE_SCREEN_GROUPS = [
    { id: "basics", screens: ["general", "people", "company"] },
    { id: "setup", screens: ["agents", "integrations"] },
    { id: "data", screens: ["archive", "labs"] },
] as const satisfies readonly { id: string; screens: readonly WorkspaceScreenId[] }[];
export type WorkspaceScreenGroupId = (typeof WORKSPACE_SCREEN_GROUPS)[number]["id"];

/** Where the Workspace tab opens when nothing names a screen. */
export const WORKSPACE_HOME = "/general";

export function isPersonalSection(id: string): id is PersonalSectionId {
    return (PERSONAL_SECTION_IDS as readonly string[]).includes(id);
}

export function isWorkspaceScreen(id: string): id is WorkspaceScreenId {
    return (WORKSPACE_SCREEN_IDS as readonly string[]).includes(id);
}

export function isUsageSection(id: string): id is UsageSectionId {
    return Object.hasOwn(USAGE_SECTION_PATHS, id);
}

/**
 * The location inside the Workspace tab for a screen. `focus` is what the
 * screen should bring into view: a registry key, which scrolls its row into
 * view, or one of People's tabs (`audit`, `invitations`).
 */
export function workspaceScreenPath(screen: WorkspaceScreenId, focus?: string | null): string {
    return focus ? `/${screen}?focus=${encodeURIComponent(focus)}` : `/${screen}`;
}

/** The screen an app-relative path inside the tab names, or null. "/" is General. */
export function workspaceScreenFromPath(path: string): WorkspaceScreenId | null {
    const { path: clean } = parseToolHref(path);
    if (clean === "/") return "general";
    const [, first = "", ...rest] = clean.split("/");
    return rest.length === 0 && isWorkspaceScreen(first) ? first : null;
}

interface TabLinkOptions {
    /** A registry key the screen brings into view. */
    focus?: string | null;
    /** Rides along on the workspace page itself (`openrouter=connected`, read by API keys). */
    query?: Record<string, string>;
}

/** `toolId`'s tab at `path`, with a focus and the page's own query. */
function tabHref(toolId: string, path: string, options: TabLinkOptions): string {
    const at = options.focus ? `${path}?focus=${encodeURIComponent(options.focus)}` : path;
    const base = toolTabHref(toolId, at);
    const extra = new URLSearchParams(options.query ?? {}).toString();
    return extra ? `${base}&${extra}` : base;
}

/** The link that opens the Workspace tab on a screen. */
export function workspaceHref(screen: WorkspaceScreenId, options: TabLinkOptions = {}): string {
    return tabHref(WORKSPACE_TOOL_ID, `/${screen}`, options);
}

/**
 * The link that opens the Usage tab's Spending screen — the `usage` section —
 * bringing a row into view when `focus` names one.
 */
export function usageHref(focus?: string | null): string {
    return tabHref(USAGE_TOOL_ID, USAGE_SPENDING_PATH, { focus });
}

/**
 * The link that opens Models & usage on Models or API keys (the `models` and
 * `byok` sections). OpenRouter's return leg comes back to API keys with
 * `query: { openrouter: <outcome> }`, which the section reads.
 */
export function modelsUsageHref(screen: "models" | "keys", options: TabLinkOptions = {}): string {
    return tabHref(USAGE_TOOL_ID, screen === "keys" ? USAGE_KEYS_PATH : USAGE_MODELS_PATH, options);
}

/** The link that opens the Usage tab on the screen that draws `section`. */
function usageSectionHref(section: UsageSectionId, focus?: string | null): string {
    if (section === "usage") return usageHref(focus);
    return modelsUsageHref(section === "byok" ? "keys" : "models", { focus });
}

/** People hashes that name its first tab, the member list: nothing to bring into view. */
const PEOPLE_MEMBER_ALIASES = new Set(["people", "members", "team", "employees"]);

/**
 * Hashes that were sections of Settings once and are Studio apps of their
 * own now. Analytics was an app of its own after that, until it folded into
 * the Usage tab.
 */
const MOVED_TO_STUDIO: Record<string, string> = {
    analytics: USAGE_TOOL_ID,
    statistics: USAGE_TOOL_ID,
    stats: USAGE_TOOL_ID,
};

/**
 * Document defaults (`#documents`, and its rows `#documents.defaultFolder`
 * and friends) was a section until its settings were retired. Its links open
 * the Workspace tab where it opens anyway, rather than nowhere.
 */
function isRetiredDocumentsHash(hash: string): boolean {
    return hash === "documents" || hash.startsWith("documents.");
}

export type SettingsDestination =
    /** Settings, on a section of its own (null: wherever it is). `hash` is what to put in the address bar. */
    | { kind: "settings"; section: PersonalSectionId | null; hash: string }
    /** The Workspace tab, at `at` (app-relative), which `href` opens. */
    | { kind: "workspace"; screen: WorkspaceScreenId; at: string; href: string }
    /** Another Studio app (Models & usage), at `at` when it names a place inside it. */
    | { kind: "app"; featureId: string; href: string; at?: string };

/**
 * Where a `/employer/settings#<hash>` link goes now. An empty hash is
 * Settings itself; a hash nothing knows is null, and the caller opens
 * Settings without picking a section rather than guessing.
 */
export function settingsDestination(hash: string): SettingsDestination | null {
    const clean = hash.replace(/^#/, "").trim();
    const lower = clean.toLowerCase();
    if (!lower) return { kind: "settings", section: null, hash: "" };

    // Analytics' hashes open the Overview, wherever the Usage tab was last.
    const app = MOVED_TO_STUDIO[lower];
    if (app)
        return {
            kind: "app",
            featureId: app,
            href: toolTabHref(app, USAGE_HOME_PATH),
            at: USAGE_HOME_PATH,
        };
    if (isRetiredDocumentsHash(lower)) {
        return {
            kind: "workspace",
            screen: "general",
            at: workspaceScreenPath("general"),
            href: workspaceHref("general"),
        };
    }

    const section = settingsSectionFromHash(lower);
    if (!section) return null;
    if (isPersonalSection(section)) return { kind: "settings", section, hash: clean };

    // The hash says more than the screen when it names a row, or one of
    // People's tabs (`#audit`); an alias such as `#byok` only names the screen.
    const row = SETTINGS.find(definition => definition.key.toLowerCase() === lower);
    if (isUsageSection(section)) {
        const href = usageSectionHref(section, row?.key);
        const at = toolTargetFromHref(href)?.at ?? USAGE_SECTION_PATHS[section];
        return { kind: "app", featureId: USAGE_TOOL_ID, href, at };
    }
    if (!isWorkspaceScreen(section)) return null;

    const focus = row
        ? row.key
        : section === "people" && !PEOPLE_MEMBER_ALIASES.has(lower)
          ? lower
          : null;
    const at = workspaceScreenPath(section, focus);
    return { kind: "workspace", screen: section, at, href: workspaceHref(section, { focus }) };
}

/**
 * Which settings section a link opens — a `/employer/settings#…` link, the
 * Workspace tab on one of its screens, or the Usage tab on Spending, Models
 * or API keys — so the palette can offer it only to someone who may see that
 * section. Null for any other link, and for Settings without a section.
 */
export function settingsSectionOfHref(href: string): SettingsSectionId | null {
    let url: URL;
    try {
        url = new URL(href, "http://launchstack.local");
    } catch {
        return null;
    }
    if (url.pathname === SETTINGS_PATH) return settingsSectionFromHash(url.hash);
    if (url.pathname !== WORKSPACE_PATH) return null;
    const target = toolTargetFromHref(href);
    if (target?.toolId === USAGE_TOOL_ID) {
        const { path } = parseToolHref(target.at);
        const entry = Object.entries(USAGE_SECTION_PATHS).find(([, at]) => at === path);
        return entry ? (entry[0] as UsageSectionId) : null;
    }
    if (target?.toolId !== WORKSPACE_TOOL_ID) return null;
    return workspaceScreenFromPath(target.at);
}

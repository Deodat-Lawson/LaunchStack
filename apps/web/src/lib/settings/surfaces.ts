/**
 * The two places settings live, and where a link into either one lands.
 *
 * - **Settings** is yours alone: Account, Appearance, Shortcuts, and Data and
 *   privacy. A Studio tab, and a page of its own at `/employer/settings`.
 * - **Workspace** is everything about the workspace, as a Studio tab with its
 *   screens across the top: its own details (General), people and access,
 *   the company profile, its own keys (Bring your own keys), models, agents,
 *   integrations, usage, the archive and labs. Each screen's path is
 *   `/<section id>`.
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

/** What Settings shows, in rail order. Each is yours alone. */
export const PERSONAL_SECTION_IDS = [
    "account",
    "appearance",
    "shortcuts",
    "privacy",
] as const satisfies readonly SettingsSectionId[];
export type PersonalSectionId = (typeof PERSONAL_SECTION_IDS)[number];

/** The Workspace tab's screens, in the order its bar shows them. */
export const WORKSPACE_SCREEN_IDS = [
    "general",
    "people",
    "company",
    "byok",
    "models",
    "agents",
    "integrations",
    "usage",
    "archive",
    "labs",
] as const satisfies readonly SettingsSectionId[];
export type WorkspaceScreenId = (typeof WORKSPACE_SCREEN_IDS)[number];

/**
 * The bar's groups, in order: ten screens are more than one row holds, so
 * they switch by group. Their names are `settings.workspaceTab.groups.<id>`.
 */
export const WORKSPACE_SCREEN_GROUPS = [
    { id: "basics", screens: ["general", "people", "company"] },
    { id: "setup", screens: ["byok", "models", "agents", "integrations"] },
    { id: "data", screens: ["usage", "archive", "labs"] },
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

/**
 * The link that opens the Workspace tab on a screen. `query` rides along on
 * the workspace page itself (`openrouter=connected`, read by Bring your own
 * keys).
 */
export function workspaceHref(
    screen: WorkspaceScreenId,
    options: { focus?: string | null; query?: Record<string, string> } = {}
): string {
    const base = toolTabHref(WORKSPACE_TOOL_ID, workspaceScreenPath(screen, options.focus));
    const extra = new URLSearchParams(options.query ?? {}).toString();
    return extra ? `${base}&${extra}` : base;
}

/** People hashes that name its first tab, the member list: nothing to bring into view. */
const PEOPLE_MEMBER_ALIASES = new Set(["people", "members", "team", "employees"]);

/** Hashes that were sections of Settings once and are Studio apps of their own now. */
const MOVED_TO_STUDIO: Record<string, string> = {
    analytics: "analytics",
    statistics: "analytics",
    stats: "analytics",
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
    /** Another Studio app (Analytics). */
    | { kind: "app"; featureId: string; href: string };

/**
 * Where a `/employer/settings#<hash>` link goes now. An empty hash is
 * Settings itself; a hash nothing knows is null, and the caller opens
 * Settings without picking a section rather than guessing.
 */
export function settingsDestination(hash: string): SettingsDestination | null {
    const clean = hash.replace(/^#/, "").trim();
    const lower = clean.toLowerCase();
    if (!lower) return { kind: "settings", section: null, hash: "" };

    const app = MOVED_TO_STUDIO[lower];
    if (app) return { kind: "app", featureId: app, href: toolTabHref(app) };
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
    if (!isWorkspaceScreen(section)) return null;

    // The hash says more than the screen when it names a row, or one of
    // People's tabs (`#audit`); an alias such as `#byok` only names the screen.
    const row = SETTINGS.find(definition => definition.key.toLowerCase() === lower);
    const focus = row
        ? row.key
        : section === "people" && !PEOPLE_MEMBER_ALIASES.has(lower)
          ? lower
          : null;
    const at = workspaceScreenPath(section, focus);
    return { kind: "workspace", screen: section, at, href: workspaceHref(section, { focus }) };
}

/**
 * Which settings section a link opens — a `/employer/settings#…` link, or the
 * Workspace tab on one of its screens — so the palette can offer it only to
 * someone who may see that section. Null for any other link, and for
 * Settings without a section.
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
    if (target?.toolId !== WORKSPACE_TOOL_ID) return null;
    return workspaceScreenFromPath(target.at);
}

/**
 * Who may see each Settings section, and who may change it.
 *
 * Settings is open to everyone in a workspace: Account, Appearance and
 * Shortcuts are theirs, whatever their role. Each workspace section carries
 * its own gate instead of the whole hub carrying one: the Settings app used
 * to require `settings.manage`, so a Member who picked "Settings" got
 * nothing at all.
 *
 * Two gates per section, both optional:
 *
 * - `view` — needed to see the section at all. Set only where the section's
 *   own data is refused to everyone else, so the section would be an error
 *   message. Without it the section leaves the rail and the palette, and a
 *   deep link to it says why instead of drawing that error.
 * - `edit` — needed to change anything in it. Without it the section is
 *   read-only: shown, and labelled so, never hidden.
 *
 * Also the one map from a URL hash (`#byok`, `#appearance.theme`) to a
 * section, so a link into Settings and a palette row agree on where it goes.
 *
 * Dependency-free apart from the registry, so the hub, the command palette
 * and their tests share it without the palette loading the hub.
 */

import type { Permission } from "~/lib/authz/permissions";

import { SETTINGS } from "./registry";
import { isSettingsSectionId, type SettingsSectionId } from "./types";

export interface SettingsSectionAccess {
    /** Needed to see the section. Unset: anyone in the workspace. */
    view?: Permission;
    /** Needed to change it. Unset: anyone who can see it. */
    edit?: Permission;
    /** URL hashes that land here, so old deep links keep working. */
    aliases: readonly string[];
}

export const SETTINGS_SECTION_ACCESS: Record<SettingsSectionId, SettingsSectionAccess> = {
    account: {
        aliases: [
            "account",
            "profile",
            "photo",
            "avatar",
            "picture",
            "display name",
            "pronouns",
            "time zone",
            "password",
            "sessions",
            "devices",
            "me",
        ],
    },
    appearance: { aliases: ["appearance", "theme", "dark", "light"] },
    shortcuts: { aliases: ["shortcuts", "keys", "keybindings", "hotkeys"] },
    // Each tab gates its own controls (invite, roles, audit); the member list
    // is the floor. A Guest sees only what is shared with them.
    people: {
        view: "members.view",
        aliases: [
            "people",
            "members",
            "team",
            "employees",
            "invitations",
            "roles",
            "groups",
            "audit",
        ],
    },
    // Everyone reads the profile (agents cite it to everyone) and may rebuild
    // it; the body says so, and withholds the curation actions.
    company: { edit: "settings.manage", aliases: ["company", "metadata", "profile"] },
    // Keys and endpoints. The form would take edits it can never save.
    processing: {
        view: "settings.manage",
        edit: "settings.manage",
        aliases: ["processing", "byok", "embedding", "keys"],
    },
    // Its read is refused outright.
    models: {
        view: "settings.manage",
        edit: "settings.manage",
        aliases: ["models", "routes", "llm", "chat model", "gemini", "openai"],
    },
    // The roster's buttons and the autonomy policy are the admins'. Anyone
    // tries an agent in the Agents app, and anyone who edits documents may
    // change what it says there (lib/agents/roster-access.ts).
    agents: {
        view: "settings.manage",
        edit: "settings.manage",
        aliases: ["agents", "nodes", "roster", "autonomy"],
    },
    // Readable by all: where an upload goes, and how it is processed.
    documents: {
        edit: "settings.manage",
        aliases: ["documents", "upload", "storage", "defaults", "ocr"],
    },
    // Workspace connections. Someone's own Gmail is connected and removed
    // from Add knowledge, not here.
    integrations: {
        view: "connectors.manage",
        edit: "connectors.manage",
        aliases: ["integrations", "slack", "hub", "connections", "drive", "github"],
    },
    // The spend and the archive are refused to anyone else on read.
    usage: {
        view: "analytics.view",
        edit: "settings.manage",
        aliases: ["usage", "costs", "credits", "tokens", "balance", "spend"],
    },
    archive: {
        view: "settings.manage",
        edit: "settings.manage",
        aliases: ["archive", "trash", "retention", "restore", "deleted"],
    },
    privacy: { aliases: ["privacy", "telemetry", "data", "analytics opt out", "gdpr"] },
    // Which unfinished features are on, readable by all.
    labs: {
        edit: "settings.manage",
        aliases: ["labs", "beta", "experimental", "preview"],
    },
};

/** Whether someone holding what `can` answers may see `section` at all. */
export function canSeeSettingsSection(
    section: SettingsSectionId,
    can: (permission: Permission | undefined) => boolean
): boolean {
    return can(SETTINGS_SECTION_ACCESS[section].view);
}

const BY_ALIAS = new Map<string, SettingsSectionId>(
    (
        Object.entries(SETTINGS_SECTION_ACCESS) as [SettingsSectionId, SettingsSectionAccess][]
    ).flatMap(([id, access]) => access.aliases.map(alias => [alias, id] as const))
);

/**
 * Resolves a URL hash to a section id: a section alias, or a registry key
 * (which lands on its section; the row then scrolls itself into view).
 */
export function settingsSectionFromHash(hash: string): SettingsSectionId | null {
    const clean = hash.replace("#", "").toLowerCase();
    const alias = BY_ALIAS.get(clean);
    if (alias) return alias;
    // Hashes arrive lower-cased; registry keys are camelCase.
    const definition = SETTINGS.find(entry => entry.key.toLowerCase() === clean);
    if (definition) return definition.section;
    return isSettingsSectionId(clean) ? clean : null;
}

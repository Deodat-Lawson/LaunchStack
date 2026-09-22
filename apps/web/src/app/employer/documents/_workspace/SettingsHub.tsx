"use client";

/**
 * One settings surface — the config panel.
 *
 * Configuration used to be five screens with five different looks. They are
 * one screen now, and the chrome here is what keeps it one: it owns the page
 * title, the section header and the single action area. Sections are
 * *bodies* — no page shell, no header of their own, no second Save button. A
 * section publishes its primary action (see `settings/contract.ts`) and the
 * chrome renders it in the same place every time.
 *
 * The rail is grouped: **You** holds member-scoped preferences that affect
 * nobody else; **Workspace** holds policy, gated on a permission and shown
 * read-only to everyone else rather than hidden; **Workspace data** holds the
 * expensive and the irreversible, kept together on purpose. Fourteen sections
 * is the ceiling — anything further goes inside one of these, not beside it.
 *
 * Deep links: `#byok`, `#people` and friends still land on a section, and a
 * registry key such as `#appearance.theme` lands on the row itself.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
    Archive,
    Bot,
    Building2,
    Coins,
    Cpu,
    FileText,
    FlaskConical,
    Keyboard,
    Palette,
    Plug,
    ShieldCheck,
    Sparkles,
    User,
    Users,
} from "lucide-react";

import { RailBackLink } from "~/app/employer/_chrome/RailBackLink";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import type { Permission } from "~/lib/authz/permissions";
import { SETTINGS } from "~/lib/settings/registry";
import { isSettingsSectionId, type SettingsSectionId } from "~/lib/settings/types";
import { usePermissions } from "~/lib/use-permissions";
import { cn } from "~/lib/utils";

import { StatusNote } from "./settings/ui";
import type { SettingsSectionActions } from "./settings/contract";

export type { SettingsSectionId } from "~/lib/settings/types";

const load = <
    T extends React.ComponentType<{ onActions?: (a: SettingsSectionActions | null) => void }>,
>(
    loader: () => Promise<T>
) => dynamic(loader, { loading: () => <SectionLoading /> });

const AccountSection = load(() => import("./settings/AccountSection").then(m => m.AccountSection));
const AppearanceSection = load(() =>
    import("./settings/AppearanceSection").then(m => m.AppearanceSection)
);
const ShortcutsSection = load(() =>
    import("./settings/ShortcutsSection").then(m => m.ShortcutsSection)
);
const PeopleAccessSection = load(() =>
    import("./settings/PeopleAccessSection").then(m => m.PeopleAccessSection)
);
const ProcessingSettings = load(() =>
    import("./settings/ProcessingSettings").then(m => m.ProcessingSettings)
);
const ModelsSection = load(() => import("./settings/ModelsSection").then(m => m.ModelsSection));
const AgentsPanel = load(() => import("./collab/AgentsPanel").then(m => m.AgentsPanel));
const DocumentDefaultsSection = load(() =>
    import("./settings/DocumentDefaultsSection").then(m => m.DocumentDefaultsSection)
);
const IntegrationsPanel = load(() =>
    import("./settings/IntegrationsPanel").then(m => m.IntegrationsPanel)
);
const UsageSection = load(() => import("./settings/UsageSection").then(m => m.UsageSection));
const ArchiveSection = load(() => import("./settings/ArchiveSection").then(m => m.ArchiveSection));
const PrivacySection = load(() => import("./settings/PrivacySection").then(m => m.PrivacySection));
const LabsSection = load(() => import("./settings/LabsSection").then(m => m.LabsSection));
const MetadataView = dynamic(
    () => import("~/app/employer/metadata/MetadataView").then(m => m.MetadataView),
    { loading: () => <SectionLoading /> }
);

type GroupId = "you" | "workspace" | "data";

const GROUPS: { id: GroupId; label: string; blurb: string }[] = [
    { id: "you", label: "You", blurb: "Yours alone; changes affect nobody else." },
    { id: "workspace", label: "Workspace", blurb: "Policy for everyone in the workspace." },
    { id: "data", label: "Workspace data", blurb: "The expensive and the irreversible." },
];

interface SectionDef {
    id: SettingsSectionId;
    group: GroupId;
    /** Rail label. Short. */
    label: string;
    /** Rail sub-label. One clause. */
    blurb: string;
    /** Header eyebrow. */
    eyebrow: string;
    /** Header title. Full sentence case. */
    title: string;
    /** Header description. Says what the section is *for*, not what it contains. */
    description: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
    /** Wide sections get the full column; forms stay readable at 840px. */
    wide?: boolean;
    /** URL hashes that land here, so old deep links keep working. */
    aliases: string[];
    /** Needed to change anything here. Without it the section is read-only, never hidden. */
    permission?: Permission;
}

export const SECTIONS: SectionDef[] = [
    {
        id: "account",
        group: "you",
        label: "Account",
        blurb: "Profile, password, sessions",
        eyebrow: "Account",
        title: "Who you are, and where you are signed in",
        description:
            "Your name and sign-in details, the accounts linked to yours, and every browser that currently holds a session.",
        Icon: User,
        aliases: ["account", "profile", "password", "sessions", "devices", "me"],
    },
    {
        id: "appearance",
        group: "you",
        label: "Appearance",
        blurb: "Theme, density, motion",
        eyebrow: "Appearance",
        title: "How the app looks to you",
        description:
            "Three controls, not eleven. Board colours in a mindmap are part of the map, not the theme.",
        Icon: Palette,
        aliases: ["appearance", "theme", "dark", "light"],
    },
    {
        id: "shortcuts",
        group: "you",
        label: "Shortcuts",
        blurb: "Every command and its keys",
        eyebrow: "Shortcuts",
        title: "What the keyboard does",
        description:
            "Every command, its keys, and a place to change them. Yours alone; the mindmap editor keeps its own map while a map is open.",
        Icon: Keyboard,
        aliases: ["shortcuts", "keys", "keybindings", "hotkeys"],
    },
    {
        id: "people",
        group: "workspace",
        label: "People and access",
        blurb: "Members, roles, folders",
        eyebrow: "People",
        title: "Who is in the workspace, and what they can see",
        description:
            "Members and their roles, invitations and join links, groups, custom roles, and the audit log. Who can open a folder is set on the folder itself; roles decide everything else.",
        Icon: Users,
        wide: true,
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
    {
        id: "company",
        group: "workspace",
        label: "Company profile",
        blurb: "Industry, people, markets",
        eyebrow: "Company",
        title: "What the AI knows about your company",
        description:
            "Extracted from your documents and editable by hand. Agents cite this when a meeting needs company context, and generated documents take their house style from it.",
        Icon: Building2,
        wide: true,
        aliases: ["company", "metadata", "profile"],
        permission: "settings.manage",
    },
    {
        id: "processing",
        group: "workspace",
        label: "Processing",
        blurb: "Embedding index and keys",
        eyebrow: "Processing",
        title: "How documents get indexed",
        description:
            "The embedding index behind semantic search, the credentials it uses, and any self-hosted endpoints. Changing the index schedules a reindex of the whole corpus.",
        Icon: Cpu,
        aliases: ["processing", "byok", "embedding", "keys"],
        permission: "settings.manage",
    },
    {
        id: "models",
        group: "workspace",
        label: "Models and routes",
        blurb: "Which model answers what",
        eyebrow: "Models",
        title: "Which model serves each kind of request",
        description:
            "The chat models this deployment is configured with, the route each one serves, and where that behaviour was declared. Read-only here: the configuration file is the source of truth.",
        Icon: Sparkles,
        aliases: ["models", "routes", "llm", "chat model", "gemini", "openai"],
        permission: "settings.manage",
    },
    {
        id: "agents",
        group: "workspace",
        label: "Agents and autonomy",
        blurb: "The roster, and what it may do",
        eyebrow: "Agents",
        title: "Who shows up to a meeting, and how much they may do alone",
        description:
            "Each agent is a seat in a meeting: a name, a role, standing instructions, and a level of autonomy. Agents can run in this app or on another machine you connect.",
        Icon: Bot,
        aliases: ["agents", "nodes", "roster", "autonomy"],
        permission: "settings.manage",
    },
    {
        id: "documents",
        group: "workspace",
        label: "Document defaults",
        blurb: "Storage, processing, destination",
        eyebrow: "Documents",
        title: "What a new document gets unless someone says otherwise",
        description:
            "Where uploads are stored, how they are processed, which folder they land in, and whether Create opens a Google Doc. Folders can override the processing default.",
        Icon: FileText,
        aliases: ["documents", "upload", "storage", "defaults", "ocr"],
        permission: "settings.manage",
    },
    {
        id: "integrations",
        group: "workspace",
        label: "Integrations",
        blurb: "Connections, Slack, remote nodes",
        eyebrow: "Integrations",
        title: "What this workspace connects to",
        description:
            "Workspace connections to Drive, Slack and GitHub; Slack mirroring for meetings; and the hub that remote agent machines dial into. All optional and independent.",
        Icon: Plug,
        aliases: ["integrations", "slack", "hub", "connections", "drive", "github"],
        permission: "connectors.manage",
    },
    {
        id: "usage",
        group: "data",
        label: "Usage and costs",
        blurb: "Balance, burn, estimate",
        eyebrow: "Usage",
        title: "What the workspace is spending",
        description:
            "The token balance, what has been drawing on it and when, and an estimate of cost from a price you set. The numbers exist to inform the two settings on this page.",
        Icon: Coins,
        wide: true,
        aliases: ["usage", "costs", "credits", "tokens", "balance", "spend"],
        permission: "analytics.view",
    },
    {
        id: "archive",
        group: "data",
        label: "Archive and retention",
        blurb: "Trash, retired agents, purge",
        eyebrow: "Archive",
        title: "What has been put away, and when it goes for good",
        description:
            "Trashed maps and artifacts, retired agents and archived channels, with restore and permanent delete. The retention window decides what the trash empties on its own.",
        Icon: Archive,
        wide: true,
        aliases: ["archive", "trash", "retention", "restore", "deleted"],
        permission: "settings.manage",
    },
    {
        id: "privacy",
        group: "data",
        label: "Data and privacy",
        blurb: "What leaves the deployment",
        eyebrow: "Privacy",
        title: "What leaves this deployment, and what stays",
        description:
            "Which outside services see document text, which see only metadata, what is kept and for how long. Read this before trusting the app with something sensitive.",
        Icon: ShieldCheck,
        aliases: ["privacy", "telemetry", "data", "analytics opt out", "gdpr"],
    },
    {
        id: "labs",
        group: "data",
        label: "Labs",
        blurb: "Unfinished, opt-in",
        eyebrow: "Labs",
        title: "Features that are not finished",
        description:
            "Each one says honestly what it does today. Off by default; turning one on affects the whole workspace.",
        Icon: FlaskConical,
        aliases: ["labs", "beta", "experimental", "preview"],
        permission: "settings.manage",
    },
];

const BY_ALIAS = new Map<string, SettingsSectionId>(
    SECTIONS.flatMap(s => s.aliases.map(alias => [alias, s.id] as const))
);

/** Hashes that used to be settings sections and now live in the Studio. */
const MOVED_TO_STUDIO: Record<string, string> = {
    analytics: "/employer/documents?feature=analytics",
    statistics: "/employer/documents?feature=analytics",
    stats: "/employer/documents?feature=analytics",
};

export interface SettingsHubProps {
    /** Inside the workspace shell rather than as a standalone page. */
    embedded?: boolean;
    initialSection?: SettingsSectionId;
}

export function SettingsHub({ embedded = false, initialSection }: SettingsHubProps) {
    const router = useRouter();
    const [section, setSection] = useState<SettingsSectionId>(initialSection ?? "account");
    const [actions, setActions] = useState<SettingsSectionActions | null>(null);
    const { loaded: permissionsLoaded, can } = usePermissions();

    // `/employer/settings#byok`, `#metadata` and friends were all real
    // destinations once; a registry key like `#appearance.theme` is one now.
    // Keep every one of them working rather than quietly dropping people on
    // the first section.
    useEffect(() => {
        if (initialSection) return;
        if (typeof window === "undefined") return;
        const applyHash = () => {
            const hash = window.location.hash.replace("#", "").toLowerCase();
            if (!hash) return;
            const moved = MOVED_TO_STUDIO[hash];
            if (moved) {
                router.replace(moved);
                return;
            }
            const target = settingsSectionFromHash(hash);
            if (target) setSection(target);
        };
        applyHash();
        window.addEventListener("hashchange", applyHash);
        return () => window.removeEventListener("hashchange", applyHash);
    }, [initialSection, router]);

    // A section's published actions belong to that section. Dropping them on
    // every switch stops a stale Save button from outliving the form it saved.
    const selectSection = useCallback((next: SettingsSectionId) => {
        setActions(null);
        setSection(next);
    }, []);

    const registerActions = useCallback((next: SettingsSectionActions | null) => {
        setActions(next);
    }, []);

    const active = useMemo(() => SECTIONS.find(s => s.id === section) ?? SECTIONS[0]!, [section]);
    const readOnly = Boolean(active.permission) && permissionsLoaded && !can(active.permission);

    return (
        <div className={cn("bg-surface text-ink flex min-h-0", embedded ? "h-full" : "h-screen")}>
            <nav
                aria-label="Settings sections"
                className="border-line bg-panel w-[240px] shrink-0 overflow-y-auto border-r px-2.5 py-4"
            >
                {/* Standalone, the way back leads the rail as it does in
                    Documents. Embedded as a Studio tab there is nowhere to go
                    back to — the tab strip is the navigation. */}
                {!embedded && <RailBackLink className="mb-2" />}
                <div className="mono text-ink-3 px-2.5 pb-3 text-[10px] font-bold uppercase tracking-[0.1em]">
                    Settings
                </div>
                {GROUPS.map(group => (
                    <div key={group.id} className="mb-3">
                        <div
                            className="text-ink-3 px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                            title={group.blurb}
                        >
                            {group.label}
                        </div>
                        {SECTIONS.filter(item => item.group === group.id).map(item => {
                            const isActive = item.id === section;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => selectSection(item.id)}
                                    aria-current={isActive ? "page" : undefined}
                                    className={cn(
                                        "mb-0.5 flex w-full items-start gap-2.5 rounded-[9px] px-2.5 py-2 text-left transition-colors",
                                        isActive
                                            ? "bg-brand-soft text-brand-ink"
                                            : "text-ink-2 hover:bg-line-2"
                                    )}
                                >
                                    <item.Icon size={15} className="mt-px shrink-0 opacity-85" />
                                    <span className="min-w-0">
                                        <span
                                            className={cn(
                                                "block text-[13px]",
                                                isActive ? "font-semibold" : "font-medium"
                                            )}
                                        >
                                            {item.label}
                                        </span>
                                        <span className="text-ink-3 mt-px block text-[11px] leading-[1.4]">
                                            {item.blurb}
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                ))}
            </nav>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <SectionHeader definition={active} actions={actions} readOnly={readOnly} />

                <div className="min-h-0 flex-1 overflow-y-auto">
                    <div
                        className={cn(
                            "mx-auto w-full px-7 pb-[72px] pt-6",
                            active.wide ? "max-w-[1200px]" : "max-w-[840px]"
                        )}
                    >
                        <SectionBody id={active.id} onActions={registerActions} />
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * The one header and the one action area. Everything a section wants to offer
 * as a primary action arrives here. A section the viewer may not change gets
 * a Read-only badge and no primary button — the body still renders.
 */
function SectionHeader({
    definition,
    actions,
    readOnly,
}: {
    definition: SectionDef;
    actions: SettingsSectionActions | null;
    readOnly: boolean;
}) {
    const busyLabel = actions?.primaryBusyLabel ?? `${actions?.primaryLabel ?? ""}…`;

    return (
        <header className="border-line bg-panel shrink-0 border-b px-7 pb-4 pt-[18px]">
            <div
                className={cn(
                    "mx-auto flex w-full items-start gap-4",
                    definition.wide ? "max-w-[1200px]" : "max-w-[840px]"
                )}
            >
                <div className="min-w-0 flex-1">
                    <div className="mono text-ink-3 mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em]">
                        {definition.eyebrow}
                        {readOnly && (
                            <Badge
                                variant="secondary"
                                title={`Changing this needs ${definition.permission}. You can see it; you cannot edit it.`}
                            >
                                Read-only
                            </Badge>
                        )}
                    </div>
                    <h1 className="serif text-ink m-0 text-[26px] leading-[1.15] tracking-[-0.02em]">
                        {definition.title}
                    </h1>
                    <p className="text-ink-3 m-0 mt-[7px] max-w-[660px] text-[13px] leading-[1.55]">
                        {definition.description}
                    </p>
                </div>

                {!readOnly && (actions?.secondary ?? actions?.primaryLabel) && (
                    <div className="flex shrink-0 items-center gap-2">
                        {actions?.secondary}
                        {actions?.primaryLabel && (
                            <Button
                                onClick={() => void actions.onPrimary?.()}
                                disabled={actions.busy ?? actions.disabled ?? false}
                                className="px-4 py-[9px]"
                            >
                                {actions.busy ? busyLabel : actions.primaryLabel}
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </header>
    );
}

function SectionBody({
    id,
    onActions,
}: {
    id: SettingsSectionId;
    onActions: (actions: SettingsSectionActions | null) => void;
}) {
    switch (id) {
        case "account":
            return <AccountSection onActions={onActions} />;
        case "appearance":
            return <AppearanceSection onActions={onActions} />;
        case "shortcuts":
            return <ShortcutsSection onActions={onActions} />;
        case "people":
            return <PeopleAccessSection onActions={onActions} />;
        case "company":
            return <MetadataView bare onActions={onActions} />;
        case "processing":
            return <ProcessingSettings onActions={onActions} />;
        case "models":
            return <ModelsSection onActions={onActions} />;
        case "agents":
            return <AgentsPanel onActions={onActions} />;
        case "documents":
            return <DocumentDefaultsSection onActions={onActions} />;
        case "integrations":
            return <IntegrationsPanel onActions={onActions} />;
        case "usage":
            return <UsageSection onActions={onActions} />;
        case "archive":
            return <ArchiveSection onActions={onActions} />;
        case "privacy":
            return <PrivacySection onActions={onActions} />;
        case "labs":
            return <LabsSection onActions={onActions} />;
    }
}

function SectionLoading() {
    return <StatusNote tone="muted">Loading…</StatusNote>;
}

/**
 * Resolves a URL hash to a section id: a section alias, or a registry key
 * (which lands on its section; the row then scrolls itself into view).
 * Exported for the redirect shims.
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

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
 * nobody else; **Workspace** holds policy; **Workspace data** holds the
 * expensive and the irreversible, kept together on purpose. Fourteen sections
 * is the ceiling — anything further goes inside one of these, not beside it.
 *
 * Everyone in the workspace may open Settings. Who sees and who changes each
 * section is `SETTINGS_SECTION_ACCESS`: a section someone may see but not
 * change is read-only, and says so; one whose data is refused to them is left
 * out of the rail, and says why if a link lands on it anyway.
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
import { WorkspaceSwitchCard } from "~/app/employer/_chrome/WorkspaceSwitchCard";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import {
    canSeeSettingsSection,
    SETTINGS_SECTION_ACCESS,
    settingsSectionFromHash,
} from "~/lib/settings/sections";
import { isSettingsSectionId, type SettingsSectionId } from "~/lib/settings/types";
import { usePermissions } from "~/lib/use-permissions";
import { cn } from "~/lib/utils";

import { StatusNote } from "./settings/ui";
import type { SettingsSectionActions } from "./settings/contract";

export type { SettingsSectionId } from "~/lib/settings/types";
// The redirect shims and old tests resolve hashes through the hub.
export { settingsSectionFromHash } from "~/lib/settings/sections";

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
const CompanyProfileView = dynamic(
    () => import("~/components/company-profile/CompanyProfileView").then(m => m.CompanyProfileView),
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
}

export const SECTIONS: SectionDef[] = [
    {
        id: "account",
        group: "you",
        label: "Account",
        blurb: "Profile, photo, password, sessions",
        eyebrow: "Account",
        title: "Who you are, and where you are signed in",
        description:
            "Your profile and photo, how you appear in this workspace, your sign-in details, and every browser that currently holds a session.",
        Icon: User,
    },
    {
        id: "appearance",
        group: "you",
        label: "Appearance",
        blurb: "Theme, density, motion, answers",
        eyebrow: "Appearance",
        title: "How the app looks, and how it answers you",
        description:
            "Four controls, not eleven: three for the screen, one for how the assistant answers. Board colours in a mindmap are part of the map, not the theme.",
        Icon: Palette,
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
    },
    {
        id: "company",
        group: "workspace",
        label: "Company profile",
        blurb: "What your sources prove",
        eyebrow: "Company",
        title: "What your sources can prove",
        description:
            "Read from the sources written by or about your company, each fact with the excerpt that proves it. Agents cite it for company context and Proposals drafts from it. Sources about someone else are set aside, and you can overrule that.",
        Icon: Building2,
        wide: true,
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
    },
    {
        id: "models",
        group: "workspace",
        label: "Models and routes",
        blurb: "Which model answers what",
        eyebrow: "Models",
        title: "Which model serves each kind of request",
        description:
            "Run this workspace on your own provider account, or on the server's default models. The default's routes and models are set in the server's configuration file and shown here read-only.",
        Icon: Sparkles,
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
    },
];

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
    const { loaded: permissionsLoaded, error: permissionsError, roleName, can } = usePermissions();

    // `/employer/settings#byok`, `#metadata` and friends were all real
    // destinations once; a registry key like `#appearance.theme` is one now.
    // Keep every one of them working rather than quietly dropping people on
    // the first section.
    useEffect(() => {
        if (initialSection) return;
        if (typeof window === "undefined") return;
        const applyHash = () => {
            const hash = window.location.hash.replace("#", "").toLowerCase();
            if (!hash) {
                // OpenRouter's return leg (`?feature=settings&openrouter=…#models`)
                // belongs on Models, whose body reads the outcome. The shell's
                // `?feature=` cleanup can drop the hash before this lazy hub
                // mounts, so the parameter alone is enough.
                if (new URLSearchParams(window.location.search).has("openrouter")) {
                    setSection("models");
                }
                return;
            }
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
    // Fails closed: until permissions load, only the ungated sections show.
    // An admin's rail fills in a moment later; a Member never sees a section
    // flash that would only answer with an error.
    const groups = useMemo(
        () =>
            GROUPS.map(group => ({
                ...group,
                sections: SECTIONS.filter(
                    item => item.group === group.id && canSeeSettingsSection(item.id, can)
                ),
            })).filter(group => group.sections.length > 0),
        [can]
    );
    const visible = canSeeSettingsSection(active.id, can);
    // Not when the roles failed to load: an owner would be told changing it
    // isn't part of their role. The server still decides every write.
    const readOnly =
        visible &&
        permissionsLoaded &&
        !permissionsError &&
        !can(SETTINGS_SECTION_ACCESS[active.id].edit);

    // The hub sizes itself by the space it is given, not by the viewport: as a
    // Studio tab it can sit in a split far narrower than the window. Below
    // 640px of its own width (a 240px rail plus room to read) the rail gives
    // way to a section picker above the header, instead of squeezing the
    // section into whatever the rail leaves over. The picker is shown by
    // default and hidden from 640px up, not `hidden` plus a query to show it:
    // another stylesheet on the page also defines `.hidden` and loads later.
    return (
        <div
            className={cn(
                "bg-surface text-ink flex min-h-0 [container-type:inline-size]",
                embedded ? "h-full" : "h-screen"
            )}
        >
            <nav
                aria-label="Settings sections"
                className="border-line bg-panel w-[240px] shrink-0 overflow-y-auto border-r px-2.5 py-4 [@container(max-width:639px)]:hidden"
            >
                {/* Standalone, the way back leads the rail as it does in
                    Documents. Embedded as a Studio tab there is nowhere to go
                    back to — the tab strip is the navigation. */}
                {!embedded && <RailBackLink className="mb-3" />}
                {/* The workspace these settings belong to, and the one place
                    to switch to another — not a back arrow in the Studio. */}
                <WorkspaceSwitchCard className="mb-4" />
                <div className="mono text-ink-3 px-2.5 pb-3 text-[10px] font-bold uppercase tracking-[0.1em]">
                    Settings
                </div>
                {groups.map(group => (
                    <div key={group.id} className="mb-3">
                        <div
                            className="text-ink-3 px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                            title={group.blurb}
                        >
                            {group.label}
                        </div>
                        {group.sections.map(item => {
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
                <div className="border-line bg-panel shrink-0 border-b px-4 py-2.5 [@container(min-width:640px)]:hidden">
                    <Select
                        // A section left out of the picker (a link to one the
                        // viewer may not see) is named by the placeholder.
                        value={visible ? section : ""}
                        onValueChange={next => {
                            if (isSettingsSectionId(next)) selectSection(next);
                        }}
                    >
                        <SelectTrigger aria-label="Settings section" className="w-full">
                            <SelectValue placeholder={active.label} />
                        </SelectTrigger>
                        <SelectContent>
                            {groups.map(group => (
                                <SelectGroup key={group.id}>
                                    <SelectLabel>{group.label}</SelectLabel>
                                    {group.sections.map(item => (
                                        <SelectItem key={item.id} value={item.id}>
                                            {item.label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <SectionHeader definition={active} actions={actions} readOnly={readOnly} />

                <div className="min-h-0 flex-1 overflow-y-auto">
                    <div
                        className={cn(
                            "mx-auto w-full px-7 pb-[72px] pt-6 [@container(max-width:639px)]:px-4",
                            active.wide ? "max-w-[1200px]" : "max-w-[840px]"
                        )}
                    >
                        {visible ? (
                            <SectionBody id={active.id} onActions={registerActions} />
                        ) : (
                            <SectionWithheld
                                label={active.label}
                                loaded={permissionsLoaded}
                                error={permissionsError}
                                roleName={roleName}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * The one header and the one action area. Everything a section wants to offer
 * as a primary action arrives here. A section the viewer may not change gets
 * a Read-only badge and no primary button — the body still renders, and says
 * row by row who may change what.
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
        <header className="border-line bg-panel shrink-0 border-b px-7 pb-4 pt-[18px] [@container(max-width:639px)]:px-4">
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
                                title="You can see this; changing it isn't part of your role."
                            >
                                Read-only
                            </Badge>
                        )}
                    </div>
                    <h1 className="display text-ink m-0 text-[26px] leading-[1.15] tracking-[-0.02em]">
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
                                // Either one disables. `busy ?? disabled` let a
                                // section's `busy: false` hide its `disabled`.
                                disabled={Boolean(actions.busy) || Boolean(actions.disabled)}
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
            return <CompanyProfileView variant="settings" onActions={onActions} />;
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

/**
 * What a link to a section the viewer may not see lands on: the header says
 * where they are, this says why there is nothing under it. Not "isn't part of
 * your role" when the roles failed to load — that would tell an owner the
 * same thing.
 */
function SectionWithheld({
    label,
    loaded,
    error,
    roleName,
}: {
    label: string;
    loaded: boolean;
    error: string | null;
    roleName: string | null;
}) {
    if (!loaded) return <SectionLoading />;
    if (error) return <StatusNote tone="danger">{error}</StatusNote>;
    return (
        <StatusNote tone="muted">
            {label} isn&apos;t part of your role{roleName ? ` (${roleName})` : ""}. Ask an admin if
            you need it.
        </StatusNote>
    );
}

function SectionLoading() {
    return <StatusNote tone="muted">Loading…</StatusNote>;
}

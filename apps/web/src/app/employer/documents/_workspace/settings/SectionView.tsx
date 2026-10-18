"use client";

/**
 * One settings section on screen: its header, its single action area, and
 * its body — the chrome both settings surfaces draw a section in.
 *
 * Settings (yours alone) shows it beside a rail; the Workspace tab shows it
 * under its screens bar. Either way the chrome here owns the eyebrow, the
 * title, the description and the one primary button. Sections are *bodies* —
 * no page shell, no header of their own, no second Save button. A section
 * publishes its primary action (see `./contract`) and the chrome renders it
 * in the same place every time.
 *
 * Who sees and who changes each section is `SETTINGS_SECTION_ACCESS`: a
 * section someone may see but not change is read-only, and says so; one
 * whose data is refused to them says why instead of drawing that error.
 */

import React, { useState } from "react";
import dynamic from "next/dynamic";
import {
    Archive,
    Bot,
    Building2,
    Coins,
    FileText,
    FlaskConical,
    Keyboard,
    Palette,
    Plug,
    ShieldCheck,
    SlidersHorizontal,
    Sparkles,
    User,
    Users,
    type LucideIcon,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { canSeeSettingsSection, SETTINGS_SECTION_ACCESS } from "~/lib/settings/sections";
import type { SettingsSectionId } from "~/lib/settings/types";
import { usePermissions } from "~/lib/use-permissions";
import { cn } from "~/lib/utils";

import type { SettingsSectionActions } from "./contract";
import { StatusNote } from "./ui";

export interface SectionDef {
    id: SettingsSectionId;
    /** Rail label, or the screen's tab in the Workspace bar. Short. */
    label: string;
    /** Rail sub-label. One clause. */
    blurb: string;
    /** Header eyebrow. */
    eyebrow: string;
    /** Header title. Full sentence case. */
    title: string;
    /** Header description. Says what the section is *for*, not what it contains. */
    description: string;
    Icon: LucideIcon;
    /** Wide sections get the full column; forms stay readable at 840px. */
    wide?: boolean;
}

export const SECTION_DEFS: Record<SettingsSectionId, SectionDef> = {
    account: {
        id: "account",
        label: "Account",
        blurb: "Profile, photo, password, sessions",
        eyebrow: "Account",
        title: "Who you are, and where you are signed in",
        description:
            "Your profile and photo, how you appear in this workspace, your sign-in details, and every browser that currently holds a session.",
        Icon: User,
    },
    appearance: {
        id: "appearance",
        label: "Appearance",
        blurb: "Theme, density, motion, answers",
        eyebrow: "Appearance",
        title: "How the app looks, and how it answers you",
        description:
            "Four controls, not eleven: three for the screen, one for how the assistant answers. Board colours in a mindmap are part of the map, not the theme.",
        Icon: Palette,
    },
    shortcuts: {
        id: "shortcuts",
        label: "Shortcuts",
        blurb: "Every command and its keys",
        eyebrow: "Shortcuts",
        title: "What the keyboard does",
        description:
            "Every command, its keys, and a place to change them. Yours alone; the mindmap editor keeps its own map while a map is open.",
        Icon: Keyboard,
    },
    privacy: {
        id: "privacy",
        label: "Data and privacy",
        blurb: "What leaves the deployment",
        eyebrow: "Privacy",
        title: "What leaves this deployment, and what stays",
        description:
            "Which outside services see document text, which see only metadata, what is kept and for how long. Read this before trusting the app with something sensitive.",
        Icon: ShieldCheck,
    },
    general: {
        id: "general",
        label: "General",
        blurb: "Name, URL, description, colour",
        eyebrow: "General",
        title: "What the workspace is called, and how it is known",
        description:
            "Its name, the URL it is listed under, a line on what it does, and the colour of its mark. Everyone in the workspace sees these; admins change them.",
        Icon: SlidersHorizontal,
    },
    people: {
        id: "people",
        label: "People and access",
        blurb: "Members, roles, folders",
        eyebrow: "People",
        title: "Who is in the workspace, and what they can see",
        description:
            "Members and their roles, invitations and join links, groups, custom roles, and the audit log. Who can open a folder is set on the folder itself; roles decide everything else.",
        Icon: Users,
        wide: true,
    },
    company: {
        id: "company",
        label: "Company profile",
        blurb: "What your sources prove",
        eyebrow: "Company",
        title: "What your sources can prove",
        description:
            "Read from the sources written by or about your company, each fact with the excerpt that proves it. Agents cite it for company context and Proposals drafts from it. Sources about someone else are set aside, and you can overrule that.",
        Icon: Building2,
        wide: true,
    },
    models: {
        id: "models",
        label: "Models",
        blurb: "Which model answers what",
        eyebrow: "Models",
        title: "Which model serves each kind of request",
        description:
            "Run this workspace on your own provider account, or on the server's default models. The default's routes and models are set in the server's configuration file and shown here read-only.",
        Icon: Sparkles,
    },
    agents: {
        id: "agents",
        label: "Agents",
        blurb: "The roster, and what it may do",
        eyebrow: "Agents",
        title: "Who shows up to a meeting, and how much they may do alone",
        description:
            "Each agent is a seat in a meeting: a name, a role, standing instructions, and a level of autonomy. Agents can run in this app or on another machine you connect.",
        Icon: Bot,
    },
    documents: {
        id: "documents",
        label: "Document defaults",
        blurb: "Storage, processing, destination",
        eyebrow: "Documents",
        title: "What a new document gets unless someone says otherwise",
        description:
            "Where uploads are stored, how they are processed, which folder they land in, and whether Create opens a Google Doc. Folders can override the processing default.",
        Icon: FileText,
    },
    integrations: {
        id: "integrations",
        label: "Integrations",
        blurb: "Connections, Slack, remote nodes",
        eyebrow: "Integrations",
        title: "What this workspace connects to",
        description:
            "Workspace connections to Drive, Slack and GitHub; Slack mirroring for meetings; and the hub that remote agent machines dial into. All optional and independent.",
        Icon: Plug,
    },
    usage: {
        id: "usage",
        label: "Usage",
        blurb: "Balance, burn, estimate",
        eyebrow: "Usage",
        title: "What the workspace is spending",
        description:
            "The token balance, what has been drawing on it and when, and an estimate of cost from a price you set. The numbers exist to inform the two settings on this page.",
        Icon: Coins,
        wide: true,
    },
    archive: {
        id: "archive",
        label: "Archive",
        blurb: "Trash, retired agents, purge",
        eyebrow: "Archive",
        title: "What has been put away, and when it goes for good",
        description:
            "Trashed maps and artifacts, retired agents and archived channels, with restore and permanent delete. The retention window decides what the trash empties on its own.",
        Icon: Archive,
        wide: true,
    },
    labs: {
        id: "labs",
        label: "Labs",
        blurb: "Unfinished, opt-in",
        eyebrow: "Labs",
        title: "Features that are not finished",
        description:
            "Each one says honestly what it does today. Off by default; turning one on affects the whole workspace.",
        Icon: FlaskConical,
    },
};

type SectionBodyComponent = React.ComponentType<{
    onActions?: (a: SettingsSectionActions | null) => void;
}>;

const load = <T extends SectionBodyComponent>(loader: () => Promise<T>) =>
    dynamic(loader, { loading: () => <SectionLoading /> });

const AccountSection = load(() => import("./AccountSection").then(m => m.AccountSection));
const AppearanceSection = load(() => import("./AppearanceSection").then(m => m.AppearanceSection));
const ShortcutsSection = load(() => import("./ShortcutsSection").then(m => m.ShortcutsSection));
const PrivacySection = load(() => import("./PrivacySection").then(m => m.PrivacySection));
const WorkspaceGeneralSection = load(() =>
    import("./WorkspaceGeneralSection").then(m => m.WorkspaceGeneralSection)
);
const PeopleAccessSection = load(() =>
    import("./PeopleAccessSection").then(m => m.PeopleAccessSection)
);
const ModelsSection = load(() => import("./ModelsSection").then(m => m.ModelsSection));
const AgentsPanel = load(() => import("../collab/AgentsPanel").then(m => m.AgentsPanel));
const DocumentDefaultsSection = load(() =>
    import("./DocumentDefaultsSection").then(m => m.DocumentDefaultsSection)
);
const IntegrationsPanel = load(() => import("./IntegrationsPanel").then(m => m.IntegrationsPanel));
const UsageSection = load(() => import("./UsageSection").then(m => m.UsageSection));
const ArchiveSection = load(() => import("./ArchiveSection").then(m => m.ArchiveSection));
const LabsSection = load(() => import("./LabsSection").then(m => m.LabsSection));
const CompanyProfileView = dynamic(
    () => import("~/components/company-profile/CompanyProfileView").then(m => m.CompanyProfileView),
    { loading: () => <SectionLoading /> }
);

/**
 * A section with its header and body. Keyed by section inside, so what one
 * section published (a Save button) never outlives it into the next.
 */
export function SettingsSectionView({
    id,
    className,
}: {
    id: SettingsSectionId;
    className?: string;
}) {
    return <SectionViewInner key={id} id={id} className={className} />;
}

function SectionViewInner({ id, className }: { id: SettingsSectionId; className?: string }) {
    const definition = SECTION_DEFS[id];
    const [actions, setActions] = useState<SettingsSectionActions | null>(null);
    const { loaded, error, roleName, can } = usePermissions();
    // Fails closed: until permissions load a gated section shows "Loading…",
    // never a body whose data would answer with an error.
    const visible = canSeeSettingsSection(id, can);
    // Not when the roles failed to load: an owner would be told changing it
    // isn't part of their role. The server still decides every write.
    const readOnly = visible && loaded && !error && !can(SETTINGS_SECTION_ACCESS[id].edit);
    const width = definition.wide ? "max-w-[1200px]" : "max-w-[840px]";

    return (
        <div
            data-settings-section={id}
            className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}
        >
            <SectionHeader definition={definition} actions={actions} readOnly={readOnly} />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className={cn("@max-md:px-4 mx-auto w-full px-7 pb-[72px] pt-6", width)}>
                    {visible ? (
                        <SectionBody id={id} onActions={setActions} />
                    ) : (
                        <SectionWithheld
                            label={definition.label}
                            loaded={loaded}
                            error={error}
                            roleName={roleName}
                        />
                    )}
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
        <header className="border-line bg-panel @max-md:px-4 shrink-0 border-b px-7 pb-4 pt-[18px]">
            <div
                className={cn(
                    // Under 520px of its own width the actions go below the
                    // title rather than squeezing it into a column.
                    "@max-sm:flex-col @max-sm:gap-3 mx-auto flex w-full items-start gap-4",
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
                    <h1 className="display text-ink @max-sm:text-[22px] m-0 text-[26px] leading-[1.15] tracking-[-0.02em]">
                        {definition.title}
                    </h1>
                    <p className="text-ink-3 m-0 mt-[7px] max-w-[660px] text-[13px] leading-[1.55]">
                        {definition.description}
                    </p>
                </div>

                {!readOnly && (actions?.secondary ?? actions?.primaryLabel) && (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
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
        case "privacy":
            return <PrivacySection onActions={onActions} />;
        case "general":
            return <WorkspaceGeneralSection onActions={onActions} />;
        case "people":
            return <PeopleAccessSection onActions={onActions} />;
        case "company":
            return <CompanyProfileView variant="settings" onActions={onActions} />;
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

export function SectionLoading() {
    return <StatusNote tone="muted">Loading…</StatusNote>;
}

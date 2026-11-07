"use client";

/**
 * One settings section on screen: its header, its single action area, and
 * its body — the chrome both settings surfaces draw a section in.
 *
 * Settings (yours alone) shows it beside a rail; the Workspace tab shows it
 * under its screens bar. Either way the chrome here owns the title, the
 * description and the one primary button. Sections are *bodies* — no page
 * shell, no header of their own, no second Save button. A section publishes
 * its primary action (see `./contract`) and the chrome renders it in the
 * same place every time.
 *
 * Its words are `settings.sections.<id>`: `label` (the rail, short), `blurb`
 * (the rail's second line, one clause), `title` (the header, sentence case)
 * and `description` (what the section is *for*, not what it contains). The
 * Workspace tab names its screens `settings.workspaceTab.screens.<id>`.
 *
 * Who sees and who changes each section is `SETTINGS_SECTION_ACCESS`: a
 * section someone may see but not change is read-only, and says so; one
 * whose data is refused to them says why instead of drawing that error.
 */

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import {
    Archive,
    Bot,
    Building2,
    Coins,
    FlaskConical,
    KeyRound,
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
    Icon: LucideIcon;
    /** Wide sections get the full column; forms stay readable at 840px. */
    wide?: boolean;
}

export const SECTION_DEFS: Record<SettingsSectionId, SectionDef> = {
    account: { id: "account", Icon: User },
    appearance: { id: "appearance", Icon: Palette },
    shortcuts: { id: "shortcuts", Icon: Keyboard },
    privacy: { id: "privacy", Icon: ShieldCheck },
    general: { id: "general", Icon: SlidersHorizontal },
    people: { id: "people", Icon: Users, wide: true },
    company: { id: "company", Icon: Building2, wide: true },
    byok: { id: "byok", Icon: KeyRound },
    models: { id: "models", Icon: Sparkles },
    agents: { id: "agents", Icon: Bot },
    integrations: { id: "integrations", Icon: Plug },
    usage: { id: "usage", Icon: Coins, wide: true },
    archive: { id: "archive", Icon: Archive, wide: true },
    labs: { id: "labs", Icon: FlaskConical },
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
const KeysSection = load(() => import("./KeysSection").then(m => m.KeysSection));
const ModelsSection = load(() => import("./ModelsSection").then(m => m.ModelsSection));
const AgentsPanel = load(() => import("../collab/AgentsPanel").then(m => m.AgentsPanel));
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
    const t = useTranslations("settings");
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
                            label={t(`sections.${id}.label`)}
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
    const t = useTranslations("settings");
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
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h1 className="display text-ink @max-sm:text-[22px] m-0 text-[26px] leading-[1.15] tracking-[-0.02em]">
                            {t(`sections.${definition.id}.title`)}
                        </h1>
                        {readOnly && (
                            <Badge variant="secondary" title={t("hub.readOnlyTitle")}>
                                {t("hub.readOnly")}
                            </Badge>
                        )}
                    </div>
                    <p className="text-ink-3 m-0 mt-[7px] max-w-[68ch] text-[13px] leading-[1.55]">
                        {t(`sections.${definition.id}.description`)}
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
        case "byok":
            return <KeysSection onActions={onActions} />;
        case "models":
            return <ModelsSection onActions={onActions} />;
        case "agents":
            return <AgentsPanel onActions={onActions} />;
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
    const t = useTranslations("settings.hub");
    if (!loaded) return <SectionLoading />;
    if (error) return <StatusNote tone="danger">{error}</StatusNote>;
    return (
        <StatusNote tone="muted">
            {roleName ? t("withheldWithRole", { label, role: roleName }) : t("withheld", { label })}
        </StatusNote>
    );
}

export function SectionLoading() {
    const tc = useTranslations("common");
    return <StatusNote tone="muted">{tc("status.loading")}</StatusNote>;
}

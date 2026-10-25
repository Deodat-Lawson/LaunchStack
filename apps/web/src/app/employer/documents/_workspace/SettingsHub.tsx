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
const KeysSection = load(() => import("./settings/KeysSection").then(m => m.KeysSection));
const ModelsSection = load(() => import("./settings/ModelsSection").then(m => m.ModelsSection));
const AgentsPanel = load(() => import("./collab/AgentsPanel").then(m => m.AgentsPanel));
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

/** Labels and blurbs: `settings.groups.<id>`. */
const GROUPS: { id: GroupId }[] = [{ id: "you" }, { id: "workspace" }, { id: "data" }];

/**
 * A rail entry. Its words are `settings.sections.<id>`: `label` (rail, short),
 * `blurb` (rail sub-label, one clause), `title` (header, sentence case) and
 * `description` (what the section is *for*, not what it contains).
 */
interface SectionDef {
    id: SettingsSectionId;
    group: GroupId;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
    /** Wide sections get the full column; forms stay readable at 840px. */
    wide?: boolean;
}

export const SECTIONS: SectionDef[] = [
    { id: "account", group: "you", Icon: User },
    { id: "appearance", group: "you", Icon: Palette },
    { id: "shortcuts", group: "you", Icon: Keyboard },
    { id: "people", group: "workspace", Icon: Users, wide: true },
    { id: "company", group: "workspace", Icon: Building2, wide: true },
    { id: "byok", group: "workspace", Icon: KeyRound },
    { id: "models", group: "workspace", Icon: Sparkles },
    { id: "agents", group: "workspace", Icon: Bot },
    { id: "integrations", group: "workspace", Icon: Plug },
    { id: "usage", group: "data", Icon: Coins, wide: true },
    { id: "archive", group: "data", Icon: Archive, wide: true },
    { id: "privacy", group: "data", Icon: ShieldCheck },
    { id: "labs", group: "data", Icon: FlaskConical },
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
    const t = useTranslations("settings");
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
                // OpenRouter's return leg (`?feature=settings&openrouter=…#byok`)
                // belongs on Bring your own keys, whose body reads the outcome. The shell's
                // `?feature=` cleanup can drop the hash before this lazy hub
                // mounts, so the parameter alone is enough.
                if (new URLSearchParams(window.location.search).has("openrouter")) {
                    setSection("byok");
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
                aria-label={t("hub.navLabel")}
                className="border-line bg-panel w-[240px] shrink-0 overflow-y-auto border-r px-2.5 py-4 [@container(max-width:639px)]:hidden"
            >
                {/* Standalone, the way back leads the rail as it does in
                    Documents. Embedded as a Studio tab there is nowhere to go
                    back to — the tab strip is the navigation. */}
                {!embedded && <RailBackLink className="mb-3" />}
                {/* The workspace these settings belong to, and the one place
                    to switch to another — not a back arrow in the Studio. */}
                <WorkspaceSwitchCard className="mb-4" />
                <div className="mono text-ink-3 px-2.5 pb-3 text-[11px] font-bold uppercase tracking-[0.1em]">
                    {t("hub.railTitle")}
                </div>
                {groups.map(group => (
                    <div key={group.id} className="mb-3">
                        <div
                            className="text-ink-3 px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em]"
                            title={t(`groups.${group.id}.blurb`)}
                        >
                            {t(`groups.${group.id}.label`)}
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
                                            {t(`sections.${item.id}.label`)}
                                        </span>
                                        <span
                                            className={cn(
                                                "mt-px block text-[11px] leading-[1.4]",
                                                isActive ? "text-ink-2" : "text-ink-3"
                                            )}
                                        >
                                            {t(`sections.${item.id}.blurb`)}
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
                        <SelectTrigger aria-label={t("hub.pickerLabel")} className="w-full">
                            <SelectValue placeholder={t(`sections.${active.id}.label`)} />
                        </SelectTrigger>
                        <SelectContent>
                            {groups.map(group => (
                                <SelectGroup key={group.id}>
                                    <SelectLabel>{t(`groups.${group.id}.label`)}</SelectLabel>
                                    {group.sections.map(item => (
                                        <SelectItem key={item.id} value={item.id}>
                                            {t(`sections.${item.id}.label`)}
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
                                label={t(`sections.${active.id}.label`)}
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
    const t = useTranslations("settings");
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
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h1 className="display text-ink m-0 text-[26px] leading-[1.15] tracking-[-0.02em]">
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
    const t = useTranslations("settings.hub");
    if (!loaded) return <SectionLoading />;
    if (error) return <StatusNote tone="danger">{error}</StatusNote>;
    return (
        <StatusNote tone="muted">
            {roleName ? t("withheldWithRole", { label, role: roleName }) : t("withheld", { label })}
        </StatusNote>
    );
}

function SectionLoading() {
    const tc = useTranslations("common");
    return <StatusNote tone="muted">{tc("status.loading")}</StatusNote>;
}

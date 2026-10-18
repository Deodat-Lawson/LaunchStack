"use client";

/**
 * Settings — yours alone: Account, Appearance, Shortcuts, and Data and
 * privacy.
 *
 * Settings used to hold the workspace too (people, the company profile,
 * models, agents, document defaults, integrations, usage, the archive,
 * labs). Those are the Workspace tab now, with the workspace's own details
 * beside them; the rail ends with the way there. A section is drawn by
 * `settings/SectionView`, the same chrome the Workspace tab uses, so there is
 * one header, one action area and one read-only rule for both.
 *
 * Deep links: every `/employer/settings#…` that ever worked still lands —
 * `#appearance.theme` on its row here, and `#people`, `#byok` or
 * `#usage.pricePerMillionTokens` on their screen of the Workspace tab
 * (`~/lib/settings/surfaces` decides which).
 */

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Briefcase } from "lucide-react";

import { RailBackLink } from "~/app/employer/_chrome/RailBackLink";
import { WorkspaceSwitchCard } from "~/app/employer/_chrome/WorkspaceSwitchCard";
import { Button } from "~/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import {
    PERSONAL_SECTION_IDS,
    WORKSPACE_TOOL_ID,
    isPersonalSection,
    settingsDestination,
    workspaceHref,
    type PersonalSectionId,
} from "~/lib/settings/surfaces";
import { toolTabHref } from "~/lib/tool-app/locations";
import { cn } from "~/lib/utils";

import { SECTION_DEFS, SettingsSectionView } from "./settings/SectionView";

export type { SettingsSectionId } from "~/lib/settings/types";
export type { PersonalSectionId } from "~/lib/settings/surfaces";
// The redirect shims and old tests resolve hashes through the hub.
export { settingsSectionFromHash } from "~/lib/settings/sections";

/** The sections in the rail, in order. */
export const SECTIONS = PERSONAL_SECTION_IDS.map(id => SECTION_DEFS[id]);

/** Where the rail's last row goes: the Workspace tab, on whatever screen it was last on. */
export const WORKSPACE_TAB_HREF = toolTabHref(WORKSPACE_TOOL_ID);

export interface SettingsHubProps {
    /** Inside the workspace shell rather than as a standalone page. */
    embedded?: boolean;
    initialSection?: PersonalSectionId;
}

export function SettingsHub({ embedded = false, initialSection }: SettingsHubProps) {
    const router = useRouter();
    const [section, setSection] = useState<PersonalSectionId>(initialSection ?? "account");

    // Every `/employer/settings#…` that was ever a destination keeps working:
    // a section or row of Settings lands here, and one that belongs to the
    // workspace now opens the Workspace tab on it.
    useEffect(() => {
        if (initialSection) return;
        if (typeof window === "undefined") return;
        const applyHash = (onMount: boolean) => {
            const hash = window.location.hash.replace(/^#/, "");
            if (!hash) {
                // OpenRouter's old return leg (`?feature=settings&openrouter=…`)
                // belongs on Workspace › Models, which reads the outcome. In
                // the shell, the shell routes it before this hub mounts.
                const outcome = new URLSearchParams(window.location.search).get("openrouter");
                if (outcome && !embedded) {
                    router.replace(workspaceHref("models", { query: { openrouter: outcome } }));
                }
                return;
            }
            const destination = settingsDestination(hash);
            if (!destination) return;
            if (destination.kind === "settings") {
                if (destination.section) setSection(destination.section);
                return;
            }
            // Inside the shell, a hash this hub finds when it mounts may be
            // left over from the Workspace tab, which the shell has already
            // opened; only a link followed from here (a hash change) moves.
            if (embedded && onMount && destination.kind === "workspace") return;
            router.replace(destination.href);
        };
        applyHash(true);
        const onHashChange = () => applyHash(false);
        window.addEventListener("hashchange", onHashChange);
        return () => window.removeEventListener("hashchange", onHashChange);
    }, [embedded, initialSection, router]);

    const selectSection = useCallback((next: PersonalSectionId) => setSection(next), []);

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
                {/* The workspace you are in, and the one place to switch to
                    another — not a back arrow in the Studio. */}
                <WorkspaceSwitchCard className="mb-4" />
                <div className="mono text-ink-3 px-2.5 pb-3 text-[10px] font-bold uppercase tracking-[0.1em]">
                    Settings
                </div>
                <div className="mb-3">
                    <div
                        className="text-ink-3 px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                        title="Yours alone; changes affect nobody else."
                    >
                        You
                    </div>
                    {SECTIONS.map(item => {
                        const isActive = item.id === section;
                        return (
                            <Button
                                key={item.id}
                                type="button"
                                variant="ghost"
                                onClick={() => selectSection(item.id as PersonalSectionId)}
                                aria-current={isActive ? "page" : undefined}
                                className={cn(
                                    "mb-0.5 flex h-auto w-full items-start justify-start gap-2.5 whitespace-normal rounded-[9px] px-2.5 py-2 text-left font-normal",
                                    isActive
                                        ? "bg-brand-soft text-brand-ink hover:bg-brand-soft hover:text-brand-ink"
                                        : "text-ink-2 hover:bg-line-2 hover:text-ink-2 dark:hover:bg-line-2"
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
                            </Button>
                        );
                    })}
                </div>
                <WorkspacePointer />
            </nav>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="border-line bg-panel flex shrink-0 items-center gap-2 border-b px-4 py-2.5 [@container(min-width:640px)]:hidden">
                    <Select
                        value={section}
                        onValueChange={next => {
                            if (isPersonalSection(next)) selectSection(next);
                        }}
                    >
                        <SelectTrigger aria-label="Settings section" className="min-w-0 flex-1">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SECTIONS.map(item => (
                                <SelectItem key={item.id} value={item.id}>
                                    {item.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button asChild variant="outline" size="sm" className="shrink-0">
                        <Link
                            href={WORKSPACE_TAB_HREF}
                            data-testid="settings-open-workspace-compact"
                        >
                            <Briefcase aria-hidden />
                            Workspace
                        </Link>
                    </Button>
                </div>
                <SettingsSectionView id={section} />
            </div>
        </div>
    );
}

/**
 * The one way from Settings to the workspace's settings: they are a tab of
 * their own, and someone who came here for "the settings" should not have to
 * know that.
 */
function WorkspacePointer() {
    return (
        <div className="border-line mx-1 border-t pt-3">
            <div className="text-ink-3 px-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em]">
                Workspace
            </div>
            <Button
                asChild
                variant="ghost"
                className="text-ink-2 hover:bg-line-2 hover:text-ink-2 dark:hover:bg-line-2 flex h-auto w-full items-start justify-start gap-2.5 whitespace-normal rounded-[9px] px-1.5 py-2 text-left font-normal"
            >
                <Link href={WORKSPACE_TAB_HREF} data-testid="settings-open-workspace">
                    <Briefcase size={15} className="mt-px shrink-0 opacity-85" aria-hidden />
                    <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium">Workspace settings</span>
                        <span className="text-ink-3 mt-px block text-[11px] leading-[1.4]">
                            Name, people, models, agents, documents, integrations and usage
                        </span>
                    </span>
                    <ArrowUpRight size={13} className="text-ink-3 mt-0.5 shrink-0" aria-hidden />
                </Link>
            </Button>
        </div>
    );
}

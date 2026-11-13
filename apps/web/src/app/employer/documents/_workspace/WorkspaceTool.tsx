"use client";

/**
 * The Workspace tab: everything about the workspace, with its screens across
 * the top like every other tool.
 *
 * - **Basics** — General (the workspace's name, URL, description, industry,
 *   team size and colour), People and access, Company profile.
 * - **Setup** — Agents, Integrations.
 * - **Data** — Archive, Labs.
 *
 * Three screens moved to Models & usage (`usage/UsageTool`): Usage became its
 * Spending screen in October 2026, and Bring your own keys and Models became
 * its API keys and Models in November. A link to `/usage`, `/byok` or
 * `/models` here, or this tab's memory of one, opens the new place
 * (`movedToolScreen`).
 *
 * Its words are `settings.workspaceTab` (the tab's name, what it is for, its
 * groups and its screens' names) and, inside a screen, `settings.sections`.
 *
 * These were sections of Settings until Settings became yours alone (Account,
 * Appearance, Shortcuts, Data and privacy). Each screen is drawn by
 * `settings/SectionView`, the same chrome Settings uses, and keeps the gate
 * it had there (`SETTINGS_SECTION_ACCESS`): left out of the bar for someone
 * whose role may not see it, read-only for someone who may only read it.
 *
 * A screen can be asked to bring something into view — `/people?focus=audit`
 * opens People on the audit log, `/agents?focus=agents.autonomy` scrolls
 * that row into view. The sections read that from the address bar's
 * hash, as they did in Settings, so the tab writes it there (without a
 * `hashchange`, which Settings would take as a link to follow) and draws the
 * section afresh.
 */

import React, { useEffect, useLayoutEffect, useMemo } from "react";
import { Briefcase } from "lucide-react";
import { useTranslations } from "next-intl";

import {
    ToolFrame,
    ToolMark,
    ToolNotFound,
    type ToolNavGroup,
} from "~/components/tool-app/ToolFrame";
import { ToolNavProvider, useToolNav, type ToolHost } from "~/components/tool-app/nav";
import { canSeeSettingsSection } from "~/lib/settings/sections";
import {
    WORKSPACE_HOME,
    WORKSPACE_SCREEN_GROUPS,
    WORKSPACE_SCREEN_IDS,
    WORKSPACE_TOOL_ID,
    settingsDestination,
    workspaceScreenFromPath,
} from "~/lib/settings/surfaces";
import { movedToolScreen, toolTabHref } from "~/lib/tool-app/locations";
import { usePermissions } from "~/lib/use-permissions";

import { SECTION_DEFS, SettingsSectionView } from "./settings/SectionView";

export { WORKSPACE_SCREEN_GROUPS } from "~/lib/settings/surfaces";

export function WorkspaceTool({ host }: { host?: ToolHost }) {
    return (
        <ToolNavProvider
            toolId={WORKSPACE_TOOL_ID}
            roots={WORKSPACE_SCREEN_IDS}
            home={WORKSPACE_HOME}
            host={host}
        >
            <WorkspaceFrame />
        </ToolNavProvider>
    );
}

function WorkspaceFrame() {
    const t = useTranslations("settings.workspaceTab");
    const { path, search, searchParams, navigate } = useToolNav();
    const { can } = usePermissions();
    const screen = workspaceScreenFromPath(path);
    const focus = searchParams.get("focus");
    useFocusHash(focus);

    // A screen that moved to another tab (Usage, API keys, Models). A link
    // the shell didn't rewrite, or this tab's memory of it, opens it there,
    // its focus kept, and this tab goes home rather than to a page that no
    // longer exists.
    const moved = movedToolScreen(WORKSPACE_TOOL_ID, `${path}${search}`);
    const movedHref = moved ? toolTabHref(moved.toolId, moved.at) : null;
    useEffect(() => {
        if (!movedHref) return;
        navigate(WORKSPACE_HOME, { replace: true });
        navigate(movedHref);
    }, [movedHref, navigate]);

    // Fails closed: until permissions load, only the ungated screens show.
    const groups = useMemo<ToolNavGroup[]>(
        () =>
            WORKSPACE_SCREEN_GROUPS.map(group => ({
                id: group.id,
                label: t(`groups.${group.id}`),
                items: group.screens
                    .filter(id => canSeeSettingsSection(id, can))
                    .map(id => ({
                        to: `/${id}`,
                        label: t(`screens.${id}`),
                        icon: SECTION_DEFS[id].Icon,
                    })),
            })).filter(group => group.items.length > 0),
        [can, t]
    );

    return (
        <ToolFrame
            title={t("title")}
            mark={<ToolMark icon={Briefcase} />}
            groups={groups}
            about={t("about")}
            // A section brings its own header and scrolls its own body.
            fill
        >
            {moved ? null : screen ? (
                <div data-testid="workspace-tool" className="flex h-full min-h-0 flex-col">
                    {/* Afresh for each thing asked for: the sections read the
                        hash when they mount. */}
                    <SettingsSectionView key={`${screen}:${focus ?? ""}`} id={screen} />
                </div>
            ) : (
                <div className="@max-md:px-4 @max-md:pt-4 px-8 pt-6">
                    <ToolNotFound home={WORKSPACE_HOME} homeLabel={t("screens.general")} />
                </div>
            )}
        </ToolFrame>
    );
}

/** A hash the Workspace tab put in the address bar. */
const isWorkspaceHash = (hash: string) => settingsDestination(hash)?.kind === "workspace";

/**
 * Puts the screen's `focus` in the address bar's hash, where a row
 * (`SettingRow`) and People's tabs look for it, before the section's own
 * effects run. A hash the tab put there (`ownHash`) is cleared again on a
 * screen that asks for nothing, so People does not reopen on the audit log
 * next time. The Usage tab's Spending screen uses it the same way.
 */
export function useFocusHash(
    focus: string | null,
    ownHash: (hash: string) => boolean = isWorkspaceHash
) {
    useLayoutEffect(() => {
        const current = window.location.hash.replace(/^#/, "");
        const next = focus ?? "";
        if (current === next) return;
        if (!focus && !ownHash(current)) return;
        const { pathname, search } = window.location;
        window.history.replaceState(
            window.history.state,
            "",
            `${pathname}${search}${next ? `#${next}` : ""}`
        );
    }, [focus, ownHash]);
}

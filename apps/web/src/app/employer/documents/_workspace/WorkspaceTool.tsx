"use client";

/**
 * The Workspace tab: everything about the workspace, with its screens across
 * the top like every other tool.
 *
 * - **Basics** — General (the workspace's name, URL, description, industry,
 *   team size and colour), People and access, Company profile.
 * - **Setup** — Models, Agents, Document defaults, Integrations.
 * - **Data** — Usage, Archive, Labs.
 *
 * These were sections of Settings until Settings became yours alone (Account,
 * Appearance, Shortcuts, Data and privacy). Each screen is drawn by
 * `settings/SectionView`, the same chrome Settings uses, and keeps the gate
 * it had there (`SETTINGS_SECTION_ACCESS`): left out of the bar for someone
 * whose role may not see it, read-only for someone who may only read it.
 *
 * A screen can be asked to bring something into view — `/people?focus=audit`
 * opens People on the audit log, `/usage?focus=usage.pricePerMillionTokens`
 * scrolls that row into view. The sections read that from the address bar's
 * hash, as they did in Settings, so the tab writes it there (without a
 * `hashchange`, which Settings would take as a link to follow) and draws the
 * section afresh.
 */

import React, { useLayoutEffect, useMemo } from "react";
import { Briefcase } from "lucide-react";

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
    WORKSPACE_SCREEN_IDS,
    WORKSPACE_TOOL_ID,
    settingsDestination,
    workspaceScreenFromPath,
    type WorkspaceScreenId,
} from "~/lib/settings/surfaces";
import { usePermissions } from "~/lib/use-permissions";

import { SECTION_DEFS, SettingsSectionView } from "./settings/SectionView";

/** The bar's groups. Ten screens are more than one row holds, so they switch by group. */
export const WORKSPACE_SCREEN_GROUPS: readonly {
    id: string;
    label: string;
    screens: readonly WorkspaceScreenId[];
}[] = [
    { id: "basics", label: "Basics", screens: ["general", "people", "company"] },
    { id: "setup", label: "Setup", screens: ["models", "agents", "documents", "integrations"] },
    { id: "data", label: "Data", screens: ["usage", "archive", "labs"] },
];

const ABOUT =
    "Everything about this workspace: what it is called, who is in it and what they can see, the models and agents it runs, where documents go, what it connects to and what it spends. Your own account, theme and shortcuts are in Settings.";

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
    const { path, searchParams } = useToolNav();
    const { can } = usePermissions();
    const screen = workspaceScreenFromPath(path);
    const focus = searchParams.get("focus");
    useFocusHash(focus);

    // Fails closed: until permissions load, only the ungated screens show.
    const groups = useMemo<ToolNavGroup[]>(
        () =>
            WORKSPACE_SCREEN_GROUPS.map(group => ({
                id: group.id,
                label: group.label,
                items: group.screens
                    .filter(id => canSeeSettingsSection(id, can))
                    .map(id => ({
                        to: `/${id}`,
                        label: SECTION_DEFS[id].label,
                        icon: SECTION_DEFS[id].Icon,
                    })),
            })).filter(group => group.items.length > 0),
        [can]
    );

    return (
        <ToolFrame
            title="Workspace"
            mark={<ToolMark icon={Briefcase} />}
            groups={groups}
            about={ABOUT}
            // A section brings its own header and scrolls its own body.
            fill
        >
            {screen ? (
                <div data-testid="workspace-tool" className="flex h-full min-h-0 flex-col">
                    {/* Afresh for each thing asked for: the sections read the
                        hash when they mount. */}
                    <SettingsSectionView key={`${screen}:${focus ?? ""}`} id={screen} />
                </div>
            ) : (
                <div className="@max-md:px-4 @max-md:pt-4 px-8 pt-6">
                    <ToolNotFound home={WORKSPACE_HOME} homeLabel="General" />
                </div>
            )}
        </ToolFrame>
    );
}

/**
 * Puts the screen's `focus` in the address bar's hash, where a row
 * (`SettingRow`) and People's tabs look for it, before the section's own
 * effects run. A hash this tab put there is cleared again on a screen that
 * asks for nothing, so People does not reopen on the audit log next time.
 */
function useFocusHash(focus: string | null) {
    useLayoutEffect(() => {
        const current = window.location.hash.replace(/^#/, "");
        const next = focus ?? "";
        if (current === next) return;
        if (!focus && settingsDestination(current)?.kind !== "workspace") return;
        const { pathname, search } = window.location;
        window.history.replaceState(
            window.history.state,
            "",
            `${pathname}${search}${next ? `#${next}` : ""}`
        );
    }, [focus]);
}

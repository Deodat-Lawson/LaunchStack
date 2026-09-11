"use client";

/**
 * The contract between the settings chrome and a settings section.
 *
 * Sections used to each bring their own page header and their own primary
 * button, which is why four screens that are all "settings" looked like four
 * different products. Now the chrome owns the header and the action area, and
 * a section *publishes* what its primary action is. There is exactly one save
 * affordance on screen, and it is always in the same place.
 */

import { useEffect } from "react";
import type { ReactNode } from "react";

export interface SettingsSectionActions {
    /** Primary button label. Omit for a read-only section. */
    primaryLabel?: string;
    /** Label while the primary action is running. Defaults to `${primaryLabel}…`. */
    primaryBusyLabel?: string;
    onPrimary?: () => void | Promise<void>;
    busy?: boolean;
    /** Disables the primary button — typically "nothing has changed". */
    disabled?: boolean;
    /** Secondary controls rendered to the left of the primary button. */
    secondary?: ReactNode;
}

export type RegisterSectionActions = (actions: SettingsSectionActions | null) => void;

export interface SettingsSectionProps {
    /**
     * Publishes this section's actions into the chrome. Sections call it from an
     * effect and the chrome clears them on unmount.
     */
    onActions?: RegisterSectionActions;
}

/**
 * Publishes a section's actions for as long as it is mounted.
 *
 * `deps` is the section's own state — the caller decides what makes the action
 * change, because only the section knows whether it is dirty or busy.
 */
export function usePublishedActions(
    onActions: RegisterSectionActions | undefined,
    actions: SettingsSectionActions,
    deps: React.DependencyList
): void {
    useEffect(() => {
        onActions?.(actions);
        return () => onActions?.(null);
        // The section owns the dependency list; `actions` is rebuilt each render
        // and would otherwise loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onActions, ...deps]);
}

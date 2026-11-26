"use client";

/**
 * Whether someone may open a Studio app: one answer for every surface that
 * shows or opens one (the Studio picker, the tab strip, the pane launcher,
 * ⌘K, `?feature=` links, links in from other apps).
 *
 * Two gates, both fail closed:
 *
 * - the app's permission (`requires`), which answers false until the
 *   person's permissions have loaded;
 * - for an app still being built (`beta`), the workspace's beta switch
 *   (`labs.betaApps`, Workspace › Labs), which reads as off until the
 *   settings have loaded and when they fail to.
 *
 * A link can also go to a place still being built inside an app that is not
 * (Growth's Brand screens, `~/lib/tool-app/beta-places`): `canOpenPlace`
 * holds such a link to the same switch.
 *
 * The server holds the same line for the beta apps' APIs
 * (`~/server/beta-apps`), so hiding one here is not the only thing between a
 * workspace and an app it has switched off.
 */

import { useCallback, useMemo } from "react";

import type { Permission } from "~/lib/authz/permissions";
import { BETA_APPS_SETTING } from "~/lib/settings/registry";
import { useSetting } from "~/lib/settings/useSettings";
import { opensBetaPlace } from "~/lib/tool-app/beta-places";
import { TOOL_ALIASES } from "~/lib/tool-app/locations";
import { usePermissions } from "~/lib/use-permissions";

import { resolveStudioFeature, type StudioFeature } from "./types";

type Gated = Pick<StudioFeature, "requires" | "beta">;

/** The rule itself, apart from React, for tests and for callers holding both answers. */
export function canOpenStudioApp(
    feature: Gated | undefined,
    can: (permission: Permission | undefined) => boolean,
    betaOn: boolean
): boolean {
    if (!feature) return false;
    if (feature.beta && !betaOn) return false;
    return can(feature.requires);
}

/**
 * Whether an id or a workspace link may be followed: the app it opens may
 * be opened, and the place in it is not one still being built while the
 * switch is off (the ⌘K row "Brand", a link to Growth › Brand › Accounts).
 * False for what names no app.
 */
export function canOpenStudioPlace(
    idOrHref: string,
    can: (permission: Permission | undefined) => boolean,
    betaOn: boolean
): boolean {
    if (!canOpenStudioApp(studioAppFor(idOrHref), can, betaOn)) return false;
    return betaOn || !opensBetaPlace(idOrHref);
}

/**
 * The Studio app an id or a workspace link opens, aliases included: the ⌘K
 * row "Brand" is Growth at `/brand`, and so is `?feature=marketing`.
 */
export function studioAppFor(idOrHref: string): StudioFeature | undefined {
    let id = idOrHref;
    if (idOrHref.includes("?")) {
        const url = new URL(idOrHref, "http://workspace.invalid");
        if (url.pathname !== "/employer/documents") return undefined;
        id = url.searchParams.get("feature") ?? "";
    }
    return resolveStudioFeature(TOOL_ALIASES[id]?.toolId ?? id);
}

export interface StudioAccess {
    /** Whether this person may open `feature` right now. */
    canOpen: (feature: Gated | undefined) => boolean;
    /** Whether this person may follow a link or ⌘K id into an app right now, its place included. */
    canOpenPlace: (idOrHref: string) => boolean;
    /** The workspace's beta switch. False until the settings have loaded. */
    betaOn: boolean;
    /** Whether the settings answer has come back (or failed), so a link can stop waiting for it. */
    betaLoaded: boolean;
    /** Whether that answer failed: an off switch is then a guess, not the workspace's. */
    betaFailed: boolean;
    /** Whether `feature` is closed only because the beta switch is off (the permission would let it open). */
    closedByBeta: (feature: Gated | undefined) => boolean;
}

export function useStudioAccess(): StudioAccess {
    const { can } = usePermissions();
    const beta = useSetting<boolean>(BETA_APPS_SETTING);
    const betaOn = beta.value === true;
    const betaLoaded = beta.loaded;
    const betaFailed = Boolean(beta.error);
    const canOpen = useCallback(
        (feature: Gated | undefined) => canOpenStudioApp(feature, can, betaOn),
        [can, betaOn]
    );
    const canOpenPlace = useCallback(
        (idOrHref: string) => canOpenStudioPlace(idOrHref, can, betaOn),
        [can, betaOn]
    );
    const closedByBeta = useCallback(
        (feature: Gated | undefined) => Boolean(feature?.beta) && !betaOn && can(feature?.requires),
        [can, betaOn]
    );
    return useMemo(
        () => ({ canOpen, canOpenPlace, betaOn, betaLoaded, betaFailed, closedByBeta }),
        [canOpen, canOpenPlace, betaOn, betaLoaded, betaFailed, closedByBeta]
    );
}

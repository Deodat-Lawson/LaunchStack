/**
 * The server's half of the workspace's beta switch (`labs.betaApps`,
 * Workspace › Labs). While it is off, what is still being built (Vantage,
 * marked `beta` in the Studio registry, and Growth's Brand screens, in
 * `~/lib/tool-app/beta-places`) is hidden in the browser and its APIs refuse
 * here, so a hidden app is off and not just out of sight.
 *
 * Refused: `/api/vantage`, `/api/brand` and `/api/marketing-pipeline`
 * (Brand's campaigns), all through `requireBetaAppContext`. History leaves
 * out Vantage's rows (`server/history`); Scenarios leaves out comments on
 * Brand's posts. Prospects (`/api/prospects`, and `/api/distribution`, its
 * older backend) is for every workspace and is not behind the switch.
 *
 * Not stopped: work the workspace already set going. A post scheduled in
 * Brand still publishes, and the insight sync still runs, because those are
 * Inngest functions acting on the workspace's own earlier decision; turning
 * beta back on shows everything as it was. Nothing is deleted either way.
 */

import { NextResponse } from "next/server";

import { requestLocaleOrDefault } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import {
    requireWorkspaceContext,
    type WorkspaceContextResult,
} from "~/lib/require-workspace-context";
import { BETA_APPS_SETTING } from "~/lib/settings/registry";
import { readWorkspaceSetting } from "~/server/settings/store";

/** The `code` of the refusal, so a client can tell it from a permission 403. */
export const BETA_APPS_OFF_CODE = "beta_apps_off";

/** Whether the workspace has its beta apps on. Off by default. */
export async function betaAppsOn(companyId: bigint): Promise<boolean> {
    return (await readWorkspaceSetting<boolean>(companyId, BETA_APPS_SETTING)) === true;
}

/** The refusal, in the reader's language: 403 with `code: "beta_apps_off"`. */
export async function betaAppsOffResponse(): Promise<NextResponse> {
    const locale = await requestLocaleOrDefault();
    const t = translatorFor(locale, "settings.server.errors");
    return NextResponse.json(
        { error: t("betaAppsOff"), code: BETA_APPS_OFF_CODE },
        { status: 403 }
    );
}

/**
 * `requireWorkspaceContext`, then the beta switch: the context a beta app's
 * route works in, or the response to send instead — the usual 401/403 for
 * who is asking, or the 403 above while the workspace has beta apps off.
 */
export async function requireBetaAppContext(): Promise<WorkspaceContextResult> {
    const result = await requireWorkspaceContext();
    if (!result.success) return result;
    if (!(await betaAppsOn(result.data.companyId))) {
        return { success: false, response: await betaAppsOffResponse() };
    }
    return result;
}

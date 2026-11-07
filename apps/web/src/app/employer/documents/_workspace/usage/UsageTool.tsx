"use client";

/**
 * The Models & usage tab: the workspace's AI and how it is used, modelled on
 * Cursor's team dashboard, with its screens across the top like every other
 * tool.
 *
 * - **Overview** — who was active, what they asked, added and opened, the AI
 *   that took and what it cost, each against the window before; day by day,
 *   by feature, and the people who used the most.
 * - **People** — everyone ranked, with this month's limit; a row opens one
 *   person's numbers.
 * - **Activity** — AI use by day, person, feature and route.
 * - **Documents** — which documents get opened, and by how many people.
 * - **You** — your own numbers beside the workspace median.
 * - **Models** — what Ask's model menu offers (`ModelsScreen`).
 * - **API keys** — the workspace's own API key or OpenRouter account, the
 *   `byok` settings section (Workspace › Bring your own keys until November
 *   2026; Models was a Workspace screen too).
 * - **Spending** — the balance, burn, the ledger, pricing and per-person
 *   limits (Workspace › Usage until October 2026).
 *
 * Everyone may open the tab; what they see is `usageRedirectFor`. With
 * `analytics.view` (Owner and Admin have it) there are the workspace's
 * numbers and its spending. Without it there are You and Models, read-only,
 * and every other path lands on You: a member sees their own numbers and a
 * median, never anyone else's. API keys, and changing what Models offers,
 * take `models.manage` (Owner and Admin again); someone who sees the
 * workspace's numbers without it is sent from API keys to Models. The routes
 * refuse the rest on their own (`/api/usage/*`, `/api/settings/models/*`).
 * The window and the group filter belong to the tab, so they carry from
 * screen to screen (`data.tsx`).
 */

import React, { useEffect, useMemo } from "react";
import {
    Boxes,
    ChartColumn,
    FileText,
    KeyRound,
    LayoutDashboard,
    ListTree,
    UserRound,
    Users,
    Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";

import {
    ToolFrame,
    ToolMark,
    ToolNotFound,
    type ToolNavGroup,
} from "~/components/tool-app/ToolFrame";
import { ToolNavProvider, useToolNav, type ToolHost } from "~/components/tool-app/nav";
import { settingsSectionFromHash } from "~/lib/settings/sections";
import { USAGE_TOOL_ID, isUsageSection } from "~/lib/settings/surfaces";
import { usePermissions } from "~/lib/use-permissions";

import { SettingsSectionView } from "../settings/SectionView";
import { LoadingRows } from "../team/ui";
import { useFocusHash } from "../WorkspaceTool";
import { ActivityScreen } from "./ActivityScreen";
import { UsageFiltersProvider } from "./data";
import { DocumentsScreen } from "./DocumentsScreen";
import { ModelsScreen } from "./ModelsScreen";
import { OverviewScreen } from "./OverviewScreen";
import { PeopleScreen } from "./PeopleScreen";
import { PersonScreen } from "./PersonScreen";
import {
    USAGE_HOME,
    USAGE_ROOTS,
    USAGE_SELF_HOME,
    usagePaths,
    usageRedirectFor,
    usageScreenFor,
} from "./screens";
import { YouScreen } from "./YouScreen";

export function UsageTool({ host }: { host?: ToolHost }) {
    return (
        <ToolNavProvider toolId={USAGE_TOOL_ID} roots={USAGE_ROOTS} home={USAGE_HOME} host={host}>
            <UsageFiltersProvider>
                <UsageFrame />
            </UsageFiltersProvider>
        </ToolNavProvider>
    );
}

/**
 * A hash a section screen put in the address bar: Spending's
 * (`#usage.pricePerMillionTokens`) or API keys'.
 */
const isUsageTabHash = (hash: string) => {
    const section = settingsSectionFromHash(hash);
    return section !== null && isUsageSection(section);
};

function UsageFrame() {
    const t = useTranslations("usage.tool");
    const { path, searchParams, navigate } = useToolNav();
    const { loaded, can } = usePermissions();
    const team = loaded && can("analytics.view");
    const manageModels = loaded && can("models.manage");
    const screen = usageScreenFor(path);
    const focus =
        screen.kind === "spending" || screen.kind === "keys" ? searchParams.get("focus") : null;
    useFocusHash(focus, isUsageTabHash);

    // A screen the person's role may not open sends them to one it may,
    // wherever a link or the tab's memory pointed.
    const redirect = loaded ? usageRedirectFor(screen, { team, manageModels }) : null;
    useEffect(() => {
        if (redirect) navigate(redirect, { replace: true });
    }, [redirect, navigate]);

    const groups = useMemo<ToolNavGroup[]>(() => {
        const all: ToolNavGroup[] = [];
        if (team) {
            all.push({
                id: "workspace",
                items: [
                    { to: usagePaths.overview(), label: t("nav.overview"), icon: LayoutDashboard },
                    { to: usagePaths.people(), label: t("nav.people"), icon: Users },
                    { to: "/activity", label: t("nav.activity"), icon: ListTree },
                    { to: usagePaths.documents(), label: t("nav.documents"), icon: FileText },
                ],
            });
        }
        all.push(
            { id: "you", items: [{ to: usagePaths.you(), label: t("nav.you"), icon: UserRound }] },
            {
                id: "models",
                items: [
                    { to: usagePaths.models(), label: t("nav.models"), icon: Boxes },
                    ...(manageModels
                        ? [{ to: "/keys", label: t("nav.keys"), icon: KeyRound }]
                        : []),
                ],
            }
        );
        if (team) {
            all.push({
                id: "spending",
                items: [{ to: "/spending", label: t("nav.spending"), icon: Wallet }],
            });
        }
        return all;
    }, [t, team, manageModels]);

    let body: React.ReactNode;
    if (!loaded || redirect) {
        body = (
            <div className="mx-auto max-w-[1180px]">
                <LoadingRows flush rows={6} />
            </div>
        );
    } else {
        switch (screen.kind) {
            case "overview":
                body = <OverviewScreen />;
                break;
            case "people":
                body = <PeopleScreen />;
                break;
            case "person":
                body = <PersonScreen key={screen.id} memberId={screen.id} />;
                break;
            case "activity":
                body = <ActivityScreen />;
                break;
            case "documents":
                body = <DocumentsScreen />;
                break;
            case "you":
                body = <YouScreen />;
                break;
            case "models":
                body = <ModelsScreen manage={manageModels} />;
                break;
            case "keys":
                // As Spending: the settings section draws its own header and
                // scrolls its own body. OpenRouter's return leg lands here
                // with `?openrouter=` on the page, which the section reads
                // when it mounts.
                body = (
                    <div data-testid="usage-keys" className="flex h-full min-h-0 flex-col">
                        <SettingsSectionView key={`byok:${focus ?? ""}`} id="byok" />
                    </div>
                );
                break;
            case "spending":
                // The settings section draws its own header and scrolls its own
                // body; afresh for each thing asked for, since it reads the hash
                // when it mounts.
                body = (
                    <div data-testid="usage-spending" className="flex h-full min-h-0 flex-col">
                        <SettingsSectionView key={`usage:${focus ?? ""}`} id="usage" />
                    </div>
                );
                break;
            case "not-found":
                body = (
                    <ToolNotFound
                        home={team ? USAGE_HOME : USAGE_SELF_HOME}
                        homeLabel={team ? t("nav.overview") : t("nav.you")}
                    />
                );
                break;
        }
    }

    // The section screens bring their own header and scroll their own body.
    const fill = loaded && !redirect && (screen.kind === "spending" || screen.kind === "keys");
    return (
        <ToolFrame
            title={t("title")}
            mark={<ToolMark icon={ChartColumn} />}
            // No bar until the role is known, rather than the wrong one.
            groups={loaded ? groups : undefined}
            about={team ? t("about") : t("aboutSelf")}
            fill={fill}
        >
            <div data-testid="usage-tool" className={fill ? "h-full" : undefined}>
                {body}
            </div>
        </ToolFrame>
    );
}

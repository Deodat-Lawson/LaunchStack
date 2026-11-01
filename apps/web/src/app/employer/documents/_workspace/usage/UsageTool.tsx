"use client";

/**
 * The Usage tab: how the workspace uses LaunchStack and its AI, modelled on
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
 * - **Spending** — the balance, burn, the ledger, pricing and per-person
 *   limits (Workspace › Usage until October 2026).
 *
 * Everyone may open the tab. Without `analytics.view` (Owner and Admin have
 * it) there is one screen, You, and every path lands there: a member sees
 * their own numbers and a median, never anyone else's. The routes refuse the
 * rest on their own (`/api/usage/*`). The window and the group filter belong
 * to the tab, so they carry from screen to screen (`data.tsx`).
 */

import React, { useEffect, useMemo } from "react";
import {
    ChartColumn,
    FileText,
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
import { USAGE_TOOL_ID } from "~/lib/settings/surfaces";
import { usePermissions } from "~/lib/use-permissions";

import { SettingsSectionView } from "../settings/SectionView";
import { LoadingRows } from "../team/ui";
import { useFocusHash } from "../WorkspaceTool";
import { ActivityScreen } from "./ActivityScreen";
import { UsageFiltersProvider } from "./data";
import { DocumentsScreen } from "./DocumentsScreen";
import { OverviewScreen } from "./OverviewScreen";
import { PeopleScreen } from "./PeopleScreen";
import { PersonScreen } from "./PersonScreen";
import {
    USAGE_HOME,
    USAGE_ROOTS,
    USAGE_SELF_HOME,
    isTeamScreen,
    usagePaths,
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

/** A hash the Spending screen put in the address bar (`#usage.pricePerMillionTokens`). */
const isSpendingHash = (hash: string) => settingsSectionFromHash(hash) === "usage";

function UsageFrame() {
    const t = useTranslations("usage.tool");
    const { path, searchParams, navigate } = useToolNav();
    const { loaded, can } = usePermissions();
    const team = loaded && can("analytics.view");
    const screen = usageScreenFor(path);
    const focus = screen.kind === "spending" ? searchParams.get("focus") : null;
    useFocusHash(focus, isSpendingHash);

    // Someone who may see only their own numbers has one screen, wherever a
    // link or the tab's memory pointed.
    const redirectToSelf = loaded && !team && screen.kind !== "you";
    useEffect(() => {
        if (redirectToSelf) navigate(USAGE_SELF_HOME, { replace: true });
    }, [redirectToSelf, navigate]);

    const groups = useMemo<ToolNavGroup[]>(
        () => [
            {
                id: "workspace",
                items: [
                    { to: usagePaths.overview(), label: t("nav.overview"), icon: LayoutDashboard },
                    { to: usagePaths.people(), label: t("nav.people"), icon: Users },
                    { to: "/activity", label: t("nav.activity"), icon: ListTree },
                    { to: usagePaths.documents(), label: t("nav.documents"), icon: FileText },
                ],
            },
            {
                id: "you",
                items: [{ to: usagePaths.you(), label: t("nav.you"), icon: UserRound }],
            },
            {
                id: "spending",
                items: [{ to: "/spending", label: t("nav.spending"), icon: Wallet }],
            },
        ],
        [t]
    );

    let body: React.ReactNode;
    if (!loaded || redirectToSelf || (isTeamScreen(screen) && !team)) {
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

    return (
        <ToolFrame
            title={t("title")}
            mark={<ToolMark icon={ChartColumn} />}
            groups={team ? groups : undefined}
            about={team ? t("about") : t("aboutSelf")}
            fill={screen.kind === "spending" && team}
        >
            <div
                data-testid="usage-tool"
                className={screen.kind === "spending" ? "h-full" : undefined}
            >
                {body}
            </div>
        </ToolFrame>
    );
}

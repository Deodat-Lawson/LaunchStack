"use client";

/**
 * Template tool: copy this folder to start a new Studio tool.
 *
 * It is a complete, working tab — five screens on the one frame every tool
 * uses — built only from the kit (`~/components/ui`) and the shared tool
 * pieces (`~/components/tools`, `~/components/tool-app`). Nothing here is
 * styled by hand that the kit already styles. Read apps/web/DESIGN.md for
 * why each piece looks the way it does; the design library (/dev/design)
 * shows it live, in both themes and at every tab width.
 *
 * To make it yours:
 *   1. Copy the folder to `app/employer/tools/<tool>/` (or
 *      `app/employer/documents/_workspace/<tool>/` for a workspace app).
 *   2. Rename the namespace `designTemplate` in `src/i18n/messages/{en,zh-CN}`
 *      to your tool's, and the strings with it.
 *   3. Replace `useContracts()` in data.ts with your API call; keep its shape.
 *   4. Register the tab (tool-app/README.md, "Adding a tool").
 */

import { CalendarClock, FilePlus2, LayoutDashboard, ListChecks, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { ToolNavProvider, useToolPathname, type ToolHost } from "~/components/tool-app/nav";
import {
    ToolFrame,
    ToolMark,
    ToolNotFound,
    type ToolNavGroup,
} from "~/components/tool-app/ToolFrame";

import { ContractActionsProvider } from "./actions";
import { paths, ROOTS } from "./bits";
import { ContractScreen } from "./ContractScreen";
import { ContractsScreen } from "./ContractsScreen";
import { NewScreen } from "./NewScreen";
import { OverviewScreen } from "./OverviewScreen";
import { SettingsScreen } from "./SettingsScreen";

export function RenewalsTool({ host }: { host?: ToolHost }) {
    return (
        <ToolNavProvider toolId="template-renewals" roots={ROOTS} host={host}>
            <ContractActionsProvider>
                <RenewalsFrame />
            </ContractActionsProvider>
        </ToolNavProvider>
    );
}

function RenewalsFrame() {
    const t = useTranslations("designTemplate.tool");
    const path = useToolPathname();
    // The screens are data: the frame draws them as tabs across the top,
    // scrolls them when they do not fit, and folds them into a menu on a phone.
    const groups = useMemo<ToolNavGroup[]>(
        () => [
            {
                id: "renewals",
                items: [
                    {
                        to: paths.overview(),
                        label: t("nav.overview"),
                        icon: LayoutDashboard,
                        exact: true,
                    },
                    { to: paths.contracts(), label: t("nav.contracts"), icon: ListChecks },
                    { to: paths.create(), label: t("nav.new"), icon: FilePlus2 },
                ],
            },
            {
                id: "admin",
                items: [{ to: paths.settings(), label: t("nav.settings"), icon: Settings2 }],
            },
        ],
        [t]
    );
    return (
        <ToolFrame
            title={t("title")}
            mark={<ToolMark icon={CalendarClock} />}
            groups={groups}
            about={t("about")}
        >
            {screenFor(path, t("homeLabel"))}
        </ToolFrame>
    );
}

/** A plain switch over the path, ending in ToolNotFound for anything else. */
function screenFor(path: string, homeLabel: string) {
    if (path === "/") return <OverviewScreen />;
    if (path === "/contracts") return <ContractsScreen />;
    const record = /^\/contracts\/([^/]+)$/.exec(path);
    if (record) return <ContractScreen id={decodeURIComponent(record[1]!)} />;
    if (path === "/new") return <NewScreen />;
    if (path === "/settings") return <SettingsScreen />;
    return <ToolNotFound home={paths.overview()} homeLabel={homeLabel} />;
}

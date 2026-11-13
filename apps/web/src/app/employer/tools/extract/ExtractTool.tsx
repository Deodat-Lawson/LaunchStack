"use client";

import { Plus, Table2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import {
    ToolFrame,
    ToolMark,
    ToolNotFound,
    type ToolNavGroup,
} from "~/components/tool-app/ToolFrame";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { ToolNavProvider, useToolNav, type ToolHost } from "~/components/tool-app/nav";

import { StatusPill } from "./_components/Bits";
import { ExtractProvider, useExtract } from "./_lib/context";
import {
    EXTRACT_HOME,
    EXTRACT_ROOTS,
    extractScreenFor,
    tablePath,
    type ExtractScreen,
} from "./_lib/screens";
import { ListScreen } from "./_screens/ListScreen";
import { NewScreen } from "./_screens/NewScreen";
import { TableScreen } from "./_screens/TableScreen";

/**
 * Extract, as a tab of the workspace: the same fields read out of many
 * documents into one table — a row per document, a cell per field, every
 * value resting on the sentence and page it came from. Two screens across
 * the top (the tables and the form); a table opens from the list at "/t/:id".
 */
export function ExtractTool({ host }: { host?: ToolHost }) {
    return (
        <ToolNavProvider toolId="extract" roots={EXTRACT_ROOTS} home={EXTRACT_HOME} host={host}>
            <ExtractProvider>
                <ExtractFrame />
            </ExtractProvider>
        </ToolNavProvider>
    );
}

function ExtractFrame() {
    const t = useTranslations("extract.tool");
    const { path, search } = useToolNav();
    const { liveTable } = useExtract();
    const screen = extractScreenFor(`${path}${search}`);
    const showingLive = screen.kind === "table" && screen.id === liveTable?.id;
    const groups = useMemo<ToolNavGroup[]>(
        () => [
            {
                id: "extract",
                items: [
                    { to: "/t", label: t("navTables"), icon: Table2 },
                    { to: "/new", label: t("navNew"), icon: Plus, exact: true },
                ],
            },
        ],
        [t]
    );
    return (
        <ToolFrame
            title={t("title")}
            mark={<ToolMark icon={Table2} />}
            groups={groups}
            about={t("about")}
            // A table is a grid that scrolls in both directions under its own
            // sticky header, so it takes the tab's full height.
            fill={screen.kind === "table"}
            status={
                liveTable && !showingLive ? (
                    <ToolLink
                        href={tablePath(liveTable.id)}
                        className="hover:bg-panel-2 focus-visible:ring-brand/50 inline-flex items-center rounded-md px-2 py-1 outline-none focus-visible:ring-2"
                        aria-label={t("liveAria", { title: liveTable.title })}
                    >
                        <StatusPill table={liveTable} />
                    </ToolLink>
                ) : undefined
            }
        >
            <Screen screen={screen} />
        </ToolFrame>
    );
}

function Screen({ screen }: { screen: ExtractScreen }) {
    const t = useTranslations("extract.tool");
    switch (screen.kind) {
        case "list":
            return <ListScreen />;
        case "new":
            // A new deep link (other documents) is a new form.
            return <NewScreen key={screen.docs.join(",")} screen={screen} />;
        case "table":
            return <TableScreen key={screen.id} screen={screen} />;
        case "not-found":
            return <ToolNotFound home="/t" homeLabel={t("title")} />;
    }
}

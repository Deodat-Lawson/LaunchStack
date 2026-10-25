"use client";

import { CalendarCheck, ChartLine, Handshake, Inbox, LifeBuoy, ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { VantageMark } from "~/components/icons/vantage";
import { EmptyState } from "~/components/tools/EmptyState";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { ToolFrame, ToolNotFound, type ToolNavGroup } from "~/components/tool-app/ToolFrame";
import { ToolNavProvider, useToolNav, type ToolHost } from "~/components/tool-app/nav";
import { Button } from "~/components/ui/button";
import { usePermissions } from "~/lib/use-permissions";

import { vantagePath } from "./_lib/paths";
import { VANTAGE_ROOTS, vantageScreenFor, type VantageScreen } from "./_lib/screens";
import { AgendaScreen } from "./_screens/AgendaScreen";
import { CommitmentsScreen } from "./_screens/CommitmentsScreen";
import { EvidenceScreen } from "./_screens/EvidenceScreen";
import { MetricsScreen } from "./_screens/MetricsScreen";
import { OverviewScreen } from "./_screens/OverviewScreen";
import { TriageScreen } from "./_screens/TriageScreen";

/**
 * Vantage, the evidence-backed weekly meeting loop, as a tab of the
 * workspace. It used to be its own route tree under `/employer/tools/vantage`
 * with a layout and a sidebar, so opening it closed every other tab; now the
 * workspace renders this, the tab keeps its own history, and the old URLs
 * redirect here (see `[[...slug]]/page.tsx`).
 */
export function VantageTool({ host }: { host?: ToolHost }) {
    return (
        <ToolNavProvider toolId="vantage" roots={VANTAGE_ROOTS} host={host}>
            <VantageFrame />
        </ToolNavProvider>
    );
}

/**
 * The bar runs in the order the week does: the founder's screens first,
 * then capture. Triage sits apart under "Program": it is the administrator's
 * side of the same table and only reads what the founder chose to share.
 */
type FrameT = ReturnType<typeof useTranslations<"vantage.frame">>;

function screenGroups(t: FrameT, admin: boolean): ToolNavGroup[] {
    const groups: ToolNavGroup[] = [
        {
            id: "week",
            label: t("groups.week"),
            items: [
                { to: vantagePath(""), label: t("nav.thisWeek"), icon: CalendarCheck, exact: true },
                { to: vantagePath("/agenda"), label: t("nav.agenda"), icon: ListChecks },
                { to: vantagePath("/commitments"), label: t("nav.commitments"), icon: Handshake },
            ],
        },
        {
            id: "capture",
            label: t("groups.capture"),
            items: [
                { to: vantagePath("/evidence"), label: t("nav.evidence"), icon: Inbox },
                { to: vantagePath("/metrics"), label: t("nav.metrics"), icon: ChartLine },
            ],
        },
    ];
    if (admin) {
        groups.push({
            id: "program",
            label: t("groups.program"),
            items: [{ to: vantagePath("/program"), label: t("nav.triage"), icon: LifeBuoy }],
        });
    }
    return groups;
}

function VantageFrame() {
    const t = useTranslations("vantage.frame");
    const { path, search } = useToolNav();
    const { can, loaded } = usePermissions();
    const admin = can("settings.manage");
    const groups = useMemo(() => screenGroups(t, admin), [t, admin]);
    const screen = vantageScreenFor(
        `${path}${search}`,
        admin ? "allowed" : loaded ? "denied" : "pending"
    );
    return (
        <ToolFrame title="Vantage" mark={<VantageMark size={15} tile />} groups={groups}>
            <Screen screen={screen} />
        </ToolFrame>
    );
}

function Screen({ screen }: { screen: VantageScreen }) {
    const t = useTranslations("vantage.frame");
    switch (screen.kind) {
        case "overview":
            return <OverviewScreen />;
        case "agenda":
            return <AgendaScreen week={screen.week} />;
        case "commitments":
            return <CommitmentsScreen />;
        case "evidence":
            return <EvidenceScreen />;
        case "metrics":
            return <MetricsScreen />;
        case "triage":
            return <TriageScreen />;
        case "triage-pending":
            return <SkeletonRows rows={4} height={44} className="mx-auto max-w-[1100px]" />;
        case "triage-denied":
            return <TriageDenied />;
        case "not-found":
            return <ToolNotFound home="/" homeLabel={t("nav.thisWeek")} />;
    }
}

/**
 * Triage for someone who cannot manage the workspace. The screen exists —
 * an administrator may well have sent the link — so "this screen does not
 * exist" would be untrue; say whose screen it is instead.
 */
function TriageDenied() {
    const t = useTranslations("vantage.frame");
    const { navigate } = useToolNav();
    return (
        <EmptyState
            className="mx-auto max-w-[1100px]"
            title={t("deniedTitle")}
            body={t("deniedBody")}
            action={
                <Button size="sm" variant="outline" onClick={() => navigate(vantagePath(""))}>
                    {t("goHome")}
                </Button>
            }
        />
    );
}

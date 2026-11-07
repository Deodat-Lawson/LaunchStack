"use client";

/**
 * The Feedback tab: My reports · Ideas · Triage, screens across the top like
 * every tool.
 *
 * The product is in testing, and this is where what testers tell us lives:
 * the bugs they reported and what the team said back, the shared board of
 * feature requests with votes, and — for the instance's operators
 * (`FEEDBACK_ADMIN_EMAILS`) — every report to set a status on and answer.
 *
 * Reporting itself is the dialog (`~/components/feedback`), which opens from
 * anywhere; this tab is where reports are followed up. It has no Studio tile:
 * an instance that names no operator takes no reports, and the tab explains
 * that rather than offering a form nobody reads.
 */

import { useMemo } from "react";
import { Inbox, Lightbulb, MessageSquareText, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { useFeedback } from "~/components/feedback/FeedbackProvider";
import { useLauncherHidden } from "~/components/feedback/FeedbackLauncher";
import { EmptyState } from "~/components/tools/EmptyState";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import {
    ToolFrame,
    ToolMark,
    ToolNotFound,
    type ToolNavGroup,
} from "~/components/tool-app/ToolFrame";
import { ToolNavProvider, useToolPathname, type ToolHost } from "~/components/tool-app/nav";
import { Button } from "~/components/ui/button";
import { FEEDBACK_TOOL_ID } from "~/lib/feedback/contract";

import { FeedbackList } from "./FeedbackList";
import { FeedbackReport } from "./FeedbackReport";
import { FEEDBACK_HOME, FEEDBACK_ROOTS, feedbackPaths, feedbackScreenFor } from "./screens";

export function FeedbackTool({ host }: { host?: ToolHost }) {
    return (
        <ToolNavProvider
            toolId={FEEDBACK_TOOL_ID}
            roots={FEEDBACK_ROOTS}
            home={FEEDBACK_HOME}
            host={host}
        >
            <FeedbackFrame />
        </ToolNavProvider>
    );
}

function FeedbackFrame() {
    const t = useTranslations("feedback.tool");
    const { access, enabled } = useFeedback();
    const path = useToolPathname();
    const triager = access?.triager === true;
    const [launcherHidden, setLauncherHidden] = useLauncherHidden();

    const screens = useMemo<ToolNavGroup[]>(
        () => [
            {
                id: "feedback",
                items: [
                    { to: feedbackPaths.list("mine"), label: t("nav.mine"), icon: Inbox },
                    { to: feedbackPaths.list("ideas"), label: t("nav.ideas"), icon: Lightbulb },
                    ...(triager
                        ? [
                              {
                                  to: feedbackPaths.list("triage"),
                                  label: t("nav.triage"),
                                  icon: ShieldCheck,
                              },
                          ]
                        : []),
                ],
                toolbar:
                    enabled && launcherHidden ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setLauncherHidden(false)}
                            data-testid="feedback-show-launcher"
                        >
                            {t("showButton")}
                        </Button>
                    ) : undefined,
            },
        ],
        [enabled, launcherHidden, setLauncherHidden, t, triager]
    );

    const screen = feedbackScreenFor(path);

    let body: React.ReactNode;
    if (access === null) {
        body = (
            <div className="mx-auto max-w-[1100px]">
                <SkeletonRows rows={4} height={62} />
            </div>
        );
    } else if (!enabled) {
        body = (
            <EmptyState
                className="mx-auto max-w-[1100px]"
                title={t("offTitle")}
                body={t("offBody")}
            />
        );
    } else if (screen.kind === "not-found") {
        body = <ToolNotFound home={FEEDBACK_HOME} homeLabel={t("nav.mine")} />;
    } else if (screen.screen === "triage" && !triager) {
        body = (
            <EmptyState
                className="mx-auto max-w-[1100px]"
                title={t("triageDeniedTitle")}
                body={t("triageDeniedBody")}
            />
        );
    } else if (screen.kind === "report") {
        body = <FeedbackReport key={screen.id} screen={screen.screen} id={screen.id} />;
    } else {
        body = <FeedbackList key={screen.screen} screen={screen.screen} />;
    }

    return (
        <ToolFrame
            title={t("title")}
            mark={<ToolMark icon={MessageSquareText} />}
            groups={enabled ? screens : undefined}
            about={t("about")}
        >
            <div data-testid="feedback-tool">{body}</div>
        </ToolFrame>
    );
}

"use client";

import { Loader2, Rocket, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import {
    ToolFrame,
    ToolMark,
    ToolNotFound,
    type ToolNavGroup,
} from "~/components/tool-app/ToolFrame";
import { ToolNavProvider, useToolPathname, type ToolHost } from "~/components/tool-app/nav";
import { Button } from "~/components/ui/button";
import { useErrorText } from "~/lib/tools/errorText";

import { Notice } from "./_components/ProgramFacts";
import { RunStatus } from "./_components/RunStatus";
import { AcceleratorsProvider, runIsLive, runLabel, useAccelerators } from "./_lib/context";
import { ACCELERATORS_ROOTS, acceleratorsScreenFor } from "./_lib/screens";
import { ApplicationScreen } from "./_screens/ApplicationScreen";
import { ProgramScreen } from "./_screens/ProgramScreen";
import { ProgramsScreen } from "./_screens/ProgramsScreen";

export function AcceleratorsTool({ host }: { host?: ToolHost }) {
    return (
        <ToolNavProvider
            toolId="accelerators"
            roots={ACCELERATORS_ROOTS}
            home="/programs"
            host={host}
        >
            <AcceleratorsProvider storageScope={host?.storageScope}>
                <AcceleratorsFrame />
            </AcceleratorsProvider>
        </ToolNavProvider>
    );
}

function AcceleratorsFrame() {
    const t = useTranslations("accelerators");
    const tName = useTranslations("tools.registry.accelerators");
    const errorText = useErrorText();
    const path = useToolPathname();
    const { home, loading, denied, error, refresh, activeRun } = useAccelerators();
    const groups: ToolNavGroup[] = [
        {
            id: "accelerators",
            items: [{ to: "/programs", label: t("tool.programs"), icon: Rocket }],
        },
    ];
    const screen = acceleratorsScreenFor(path);
    return (
        <ToolFrame
            title={tName("name")}
            mark={<ToolMark icon={Rocket} />}
            groups={groups}
            about={t("tool.about")}
            contentClassName="mx-auto w-full max-w-5xl"
            status={
                !denied && runIsLive(activeRun) ? (
                    <span
                        role="status"
                        className="text-brand inline-flex items-center gap-2 px-2 text-xs"
                    >
                        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                        {t(`run.${runLabel(activeRun?.kind)}`)}
                    </span>
                ) : undefined
            }
        >
            {denied ? (
                <section className="mx-auto flex max-w-xl flex-col items-start gap-4 py-10">
                    <ShieldAlert className="text-ink-3 size-9" />
                    <h1 className="display text-ink text-xl">{t("common.accessTitle")}</h1>
                    <p className="text-ink-2 text-sm leading-relaxed">{t("common.accessBody")}</p>
                    {error != null && (
                        <p role="alert" className="text-danger text-sm">
                            {errorText(error, t("errors.fullAccess"))}
                        </p>
                    )}
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            void refresh().catch(() => undefined);
                        }}
                    >
                        {t("common.retry")}
                    </Button>
                </section>
            ) : loading && !home ? (
                <p role="status" className="text-ink-3 flex items-center gap-2 py-8 text-sm">
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                    {t("common.loading")}
                </p>
            ) : (
                <div className="space-y-6">
                    {error != null && (
                        <Notice danger>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <span>{errorText(error, t("common.loadFailed"))}</span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        void refresh().catch(() => undefined);
                                    }}
                                >
                                    {t("common.retry")}
                                </Button>
                            </div>
                        </Notice>
                    )}
                    {home && (
                        <>
                            {!home.canEdit && <Notice>{t("common.readOnly")}</Notice>}
                            <RunStatus />
                            {screen.kind === "programs" ? (
                                <ProgramsScreen />
                            ) : screen.kind === "program" ? (
                                <ProgramScreen key={screen.id} id={screen.id} />
                            ) : screen.kind === "application" ? (
                                <ApplicationScreen key={screen.id} id={screen.id} />
                            ) : (
                                <ToolNotFound home="/programs" homeLabel={t("tool.programs")} />
                            )}
                        </>
                    )}
                </div>
            )}
        </ToolFrame>
    );
}

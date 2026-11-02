"use client";

import { ArrowRight, Loader2, MapPin, RefreshCw, Sparkles } from "lucide-react";
import Image from "next/image";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { Button } from "~/components/ui/button";
import { useErrorText } from "~/lib/tools/errorText";

import { FitStatus, Notice } from "../_components/ProgramFacts";
import { useAccelerators } from "../_lib/context";
import { programPath } from "../_lib/screens";

export function ProgramsScreen() {
    const t = useTranslations("accelerators");
    const format = useFormatter();
    const locale = useLocale();
    const errorText = useErrorText();
    const { home, runBusy, match, refresh } = useAccelerators();
    const [pending, setPending] = useState(false);
    const pendingRef = useRef(false);
    const [refreshing, setRefreshing] = useState(false);
    const [failure, setFailure] = useState<unknown>(null);
    if (!home) return null;
    const ranked = [...home.programs].sort(
        (left, right) =>
            (right.fitStale ? -1 : (right.fit?.assessment.score ?? -1)) -
                (left.fitStale ? -1 : (left.fit?.assessment.score ?? -1)) ||
            left.program.name.localeCompare(right.program.name, locale)
    );
    const matchPrograms = async () => {
        if (pendingRef.current) return;
        pendingRef.current = true;
        setPending(true);
        setFailure(null);
        try {
            await match();
        } catch (error) {
            setFailure(error);
        } finally {
            pendingRef.current = false;
            setPending(false);
        }
    };
    return (
        <div className="space-y-8">
            <header className="flex flex-wrap items-start justify-between gap-5">
                <div className="max-w-2xl space-y-2">
                    <h1 className="display text-ink text-2xl tracking-tight">{t("home.title")}</h1>
                    <p className="text-ink-2 text-sm leading-relaxed">{t("home.description")}</p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={refreshing}
                    onClick={async () => {
                        setRefreshing(true);
                        try {
                            await refresh();
                        } catch {
                            /* The frame renders load errors. */
                        } finally {
                            setRefreshing(false);
                        }
                    }}
                >
                    <RefreshCw
                        className={
                            refreshing
                                ? "size-3.5 animate-spin motion-reduce:animate-none"
                                : "size-3.5"
                        }
                    />
                    {t("common.refresh")}
                </Button>
            </header>
            <section className="border-brand/20 bg-brand-soft/30 space-y-3 rounded-xl border p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <p className="text-ink-2 max-w-xl text-sm leading-relaxed">
                        {t("home.matchHint")}
                    </p>
                    <Button
                        type="button"
                        disabled={
                            !home.canEdit ||
                            !home.profileReady ||
                            home.programs.length === 0 ||
                            pending ||
                            runBusy
                        }
                        onClick={matchPrograms}
                    >
                        {pending ? (
                            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                        ) : (
                            <Sparkles className="size-4" />
                        )}
                        {pending
                            ? t("home.matching")
                            : t("home.match", { credits: format.number(home.costs.match) })}
                    </Button>
                </div>
                {!home.profileReady && (
                    <p className="text-ink-2 text-sm">{t("home.profileMissing")}</p>
                )}
                {failure != null && (
                    <p role="alert" className="text-danger text-sm">
                        {errorText(failure, t("common.actionFailed"))}
                    </p>
                )}
            </section>
            {ranked.length === 0 ? (
                <Notice>
                    <h2 className="font-medium">{t("home.emptyTitle")}</h2>
                    <p className="mt-1">{t("home.emptyBody")}</p>
                </Notice>
            ) : (
                <div className="space-y-2">
                    {ranked.map(view => (
                        <ToolLink
                            key={view.program.id}
                            href={programPath(view.program.id)}
                            aria-label={view.program.name}
                            className="border-line bg-panel hover:bg-panel-2 focus-visible:ring-brand/50 group flex items-center gap-3 rounded-lg border px-4 py-3 outline-none transition-colors focus-visible:ring-2"
                        >
                            <Image
                                src={view.program.logo.path}
                                alt=""
                                width={40}
                                height={40}
                                className="size-10 shrink-0 rounded-md object-contain"
                            />
                            <div className="min-w-0 flex-1 space-y-1">
                                <h2 className="text-ink group-hover:text-brand break-words text-sm font-semibold">
                                    {view.program.name}
                                </h2>
                                <p className="text-ink-3 flex items-start gap-1.5 text-xs">
                                    <MapPin aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                                    {view.program.location?.text ?? t("home.locationUnknown")}
                                </p>
                            </div>
                            <FitStatus view={view} ring />
                            <ArrowRight
                                aria-hidden="true"
                                className="text-ink-3 hidden size-4 shrink-0 [@container(min-width:600px)]:block"
                            />
                        </ToolLink>
                    ))}
                </div>
            )}
        </div>
    );
}

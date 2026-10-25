"use client";

import { ArrowRight, FileText, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useErrorText } from "~/lib/tools/errorText";

import { FitStatus, Notice } from "../_components/ProgramFacts";
import { useAccelerators } from "../_lib/context";
import { applicationPath, programPath } from "../_lib/screens";

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
            (right.fit?.assessment.score ?? -1) - (left.fit?.assessment.score ?? -1) ||
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
                <div className="grid gap-4 [@container(min-width:750px)]:grid-cols-2">
                    {ranked.map(view => (
                        <article
                            key={view.program.id}
                            className="border-line bg-panel flex flex-col gap-4 rounded-xl border p-5"
                        >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <h2 className="text-ink text-lg font-semibold">
                                    <ToolLink
                                        href={programPath(view.program.id)}
                                        className="hover:text-brand underline-offset-4 hover:underline"
                                    >
                                        {view.program.name}
                                    </ToolLink>
                                </h2>
                                <FitStatus view={view} />
                            </div>
                            <p className="text-ink-2 line-clamp-4 text-sm leading-relaxed">
                                {view.program.description.text}
                            </p>
                            {view.fit?.assessment.reasons[0] && (
                                <p className="text-ink-3 line-clamp-3 text-sm">
                                    {view.fit.assessment.reasons[0]}
                                </p>
                            )}
                            {view.fitStale && (
                                <p className="text-warn text-xs">{t("fit.staleHint")}</p>
                            )}
                            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-1">
                                <Badge variant="outline">{t("home.savedOnly")}</Badge>
                                <Button asChild variant="ghost" size="sm">
                                    <ToolLink href={programPath(view.program.id)}>
                                        {t("common.viewProgram")}
                                        <ArrowRight className="size-3.5" />
                                    </ToolLink>
                                </Button>
                            </div>
                        </article>
                    ))}
                </div>
            )}
            <section className="space-y-4">
                <div className="space-y-1">
                    <h2 className="text-ink text-lg font-semibold">{t("home.applications")}</h2>
                    <p className="text-ink-3 text-sm">{t("home.applicationsHint")}</p>
                </div>
                {home.applications.length === 0 ? (
                    <Notice>{t("home.noApplications")}</Notice>
                ) : (
                    <div className="border-line divide-line divide-y rounded-xl border">
                        {home.applications.map(application => {
                            const editable = application.sections.filter(
                                section =>
                                    section.field.fieldType !== "file" &&
                                    section.field.fieldType !== "video"
                            );
                            const answered = editable.filter(
                                section => Boolean(section.draft?.trim()) && section.draft !== "[]"
                            ).length;
                            return (
                                <div
                                    key={application.id}
                                    className="flex flex-wrap items-center justify-between gap-3 p-4"
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <FileText className="text-ink-3 size-4 shrink-0" />
                                        <div className="min-w-0 space-y-1">
                                            <h3 className="text-ink break-words text-sm font-medium">
                                                {application.title}
                                            </h3>
                                            <p className="text-ink-3 text-xs">
                                                {t("home.answers", {
                                                    answered,
                                                    total: editable.length,
                                                })}
                                            </p>
                                        </div>
                                    </div>
                                    <Button asChild variant="outline" size="sm">
                                        <ToolLink href={applicationPath(application.id)}>
                                            {t("common.openApplication")}
                                            <ArrowRight className="size-3.5" />
                                        </ToolLink>
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
}

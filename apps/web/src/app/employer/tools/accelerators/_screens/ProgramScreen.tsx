"use client";

import { canStartForm } from "@launchstack/pipelines/accelerators/types";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { ToolNotFound } from "~/components/tool-app/ToolFrame";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { useToolRouter } from "~/components/tool-app/nav";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useErrorText } from "~/lib/tools/errorText";

import type { ProgramCycle, ProgramView } from "../api";
import { FitDetails, Narrative, Notice, SourceLinks } from "../_components/ProgramFacts";
import { useAccelerators } from "../_lib/context";
import { applicationPath } from "../_lib/screens";

export function ProgramScreen({ id }: { id: string }) {
    const t = useTranslations("accelerators");
    const format = useFormatter();
    const { home } = useAccelerators();
    const view = home?.programs.find(item => item.program.id === id);
    if (!view) return <ToolNotFound home="/programs" homeLabel={t("tool.programs")} />;
    const program = view.program;
    return (
        <div className="space-y-8">
            <header className="space-y-4">
                <Button asChild variant="ghost" size="sm">
                    <ToolLink href="/programs">
                        <ArrowLeft className="size-3.5" />
                        {t("common.backPrograms")}
                    </ToolLink>
                </Button>
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <h1 className="display text-ink text-2xl tracking-tight">{program.name}</h1>
                    <div className="flex flex-wrap gap-2">
                        <Button asChild variant="outline" size="sm">
                            <a href={program.websiteUrl} target="_blank" rel="noopener noreferrer">
                                {t("common.website")}
                                <ExternalLink className="size-3.5" />
                            </a>
                        </Button>
                        <Button asChild variant="outline" size="sm">
                            <a href={program.applyUrl} target="_blank" rel="noopener noreferrer">
                                {t("common.portal")}
                                <ExternalLink className="size-3.5" />
                            </a>
                        </Button>
                    </div>
                </div>
            </header>
            <Narrative
                title={t("program.description")}
                narrative={program.description}
                sources={program.sources}
            />
            <Narrative
                title={t("program.targetApplicants")}
                narrative={program.targetApplicants}
                sources={program.sources}
            />
            <FitDetails view={view} />
            <section className="space-y-4">
                <h2 className="text-ink text-lg font-semibold">{t("program.cycles")}</h2>
                {program.cycles.length === 0 ? (
                    <Notice>{t("program.noCycles")}</Notice>
                ) : (
                    program.cycles.map(cycle => (
                        <CycleCard key={cycle.id} cycle={cycle} view={view} />
                    ))
                )}
                <p className="text-ink-3 text-xs leading-relaxed">{t("program.submissionNote")}</p>
            </section>
            <section className="space-y-4">
                <h2 className="text-ink text-lg font-semibold">{t("program.sources")}</h2>
                {program.sources.map(source => (
                    <article key={source.id} className="border-line space-y-2 border-l-2 pl-4">
                        <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
                        >
                            {source.title}
                            <ExternalLink className="size-3.5 shrink-0" />
                        </a>
                        <p className="text-ink-3 text-xs">
                            {t("program.checked", {
                                date: format.dateTime(new Date(source.checkedAt), {
                                    dateStyle: "medium",
                                }),
                            })}
                        </p>
                        <blockquote className="text-ink-2 whitespace-pre-wrap text-sm leading-relaxed">
                            {source.quote}
                        </blockquote>
                    </article>
                ))}
            </section>
        </div>
    );
}

function CycleCard({ cycle, view }: { cycle: ProgramCycle; view: ProgramView }) {
    const t = useTranslations("accelerators");
    const format = useFormatter();
    const router = useToolRouter();
    const errorText = useErrorText();
    const { home, start } = useAccelerators();
    const [pending, setPending] = useState(false);
    const pendingRef = useRef(false);
    const [failure, setFailure] = useState<unknown>(null);
    const form = cycle.form;
    const existing = home?.applications.find(
        application => application.programId === view.program.id && application.cycleId === cycle.id
    );
    const allowed = canStartForm(form);
    let deadline = t("program.deadlineUnknown");
    if (cycle.deadlineAt && cycle.deadlineTimezone) {
        deadline = t("program.deadlineTimezone", {
            date: format.dateTime(new Date(cycle.deadlineAt), {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: cycle.deadlineTimezone,
            }),
            timezone: cycle.deadlineTimezone,
        });
    } else if (cycle.dateOnly) {
        deadline = t("program.deadline", {
            date: format.dateTime(new Date(`${cycle.dateOnly}T00:00:00Z`), {
                dateStyle: "medium",
                timeZone: "UTC",
            }),
        });
    } else if (cycle.rolling) deadline = t("program.rolling");
    return (
        <article className="border-line bg-panel space-y-4 rounded-xl border p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                    <h3 className="text-ink text-base font-semibold">{cycle.label}</h3>
                    <p className="text-ink-2 text-sm">{deadline}</p>
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">
                            {t("program.formStatus", {
                                status: t(`program.formStatuses.${form.status}`),
                            })}
                        </Badge>
                        <Badge variant="outline">
                            {t("program.formFields", { count: form.fields.length })}
                        </Badge>
                    </div>
                </div>
                {existing ? (
                    <Button asChild variant="outline" size="sm">
                        <ToolLink href={applicationPath(existing.id)}>
                            {t("common.openApplication")}
                        </ToolLink>
                    </Button>
                ) : (
                    <Button
                        type="button"
                        disabled={!allowed || !home?.canEdit || pending}
                        onClick={async () => {
                            if (pendingRef.current) return;
                            pendingRef.current = true;
                            setPending(true);
                            setFailure(null);
                            try {
                                router.push(
                                    applicationPath((await start(view.program.id, cycle.id)).id)
                                );
                            } catch (error) {
                                setFailure(error);
                            } finally {
                                pendingRef.current = false;
                                setPending(false);
                            }
                        }}
                    >
                        {pending && (
                            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                        )}
                        {pending ? t("program.starting") : t("program.start")}
                    </Button>
                )}
            </div>
            <div className="text-ink-3 flex flex-wrap items-center gap-3 text-xs">
                <a
                    href={form.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand inline-flex items-center gap-1 underline underline-offset-4"
                >
                    {t("program.formSource")}
                    <ExternalLink className="size-3" />
                </a>
                {form.checkedAt && (
                    <span>
                        {t("program.checked", {
                            date: format.dateTime(new Date(form.checkedAt), {
                                dateStyle: "medium",
                            }),
                        })}
                    </span>
                )}
            </div>
            {!allowed && (
                <Notice>
                    {form.status !== "checked" && <p>{t("program.notChecked")}</p>}
                    {!form.supported && <p className="mt-1">{t("program.unsupported")}</p>}
                    {form.fields.length === 0 && <p className="mt-1">{t("program.noFields")}</p>}
                </Notice>
            )}
            {form.limitations.length > 0 && (
                <div className="space-y-1.5">
                    <h4 className="text-ink text-sm font-medium">{t("program.limitations")}</h4>
                    <ul className="text-ink-2 list-disc space-y-1 pl-5 text-sm">
                        {form.limitations.map((limitation, index) => (
                            <li key={index}>{limitation}</li>
                        ))}
                    </ul>
                </div>
            )}
            <SourceLinks ids={cycle.sourceIds} sources={view.program.sources} />
            {failure != null && (
                <p role="alert" className="text-danger text-sm">
                    {errorText(failure, t("common.actionFailed"))}
                </p>
            )}
        </article>
    );
}

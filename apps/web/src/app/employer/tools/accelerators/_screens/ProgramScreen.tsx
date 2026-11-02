"use client";

import { ArrowLeft, ExternalLink } from "lucide-react";
import Image from "next/image";
import { useFormatter, useTranslations } from "next-intl";

import { ToolNotFound } from "~/components/tool-app/ToolFrame";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { Button } from "~/components/ui/button";

import type { ProgramCycle } from "../api";
import { FitDetails, Narrative, Notice } from "../_components/ProgramFacts";
import { useAccelerators } from "../_lib/context";

export function ProgramScreen({ id }: { id: string }) {
    const t = useTranslations("accelerators");
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
                    <div className="flex min-w-0 items-center gap-3">
                        <Image
                            src={program.logo.path}
                            alt=""
                            width={56}
                            height={56}
                            className="size-14 shrink-0 rounded-md object-contain"
                        />
                        <h1 className="display text-ink text-2xl tracking-tight">{program.name}</h1>
                    </div>
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
            <Narrative title={t("program.description")} narrative={program.description} />
            <Narrative title={t("program.targetApplicants")} narrative={program.targetApplicants} />
            <FitDetails view={view} />
            <section className="space-y-4">
                <h2 className="text-ink text-lg font-semibold">{t("program.cycles")}</h2>
                {program.cycles.length === 0 ? (
                    <Notice>{t("program.noCycles")}</Notice>
                ) : (
                    program.cycles.map(cycle => <CycleCard key={cycle.id} cycle={cycle} />)
                )}
                <p className="text-ink-3 text-xs leading-relaxed">{t("program.portalNote")}</p>
            </section>
        </div>
    );
}

function CycleCard({ cycle }: { cycle: ProgramCycle }) {
    const t = useTranslations("accelerators");
    const format = useFormatter();
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
        <article className="border-line bg-panel space-y-2 rounded-xl border p-5">
            <h3 className="text-ink text-base font-semibold">{cycle.label}</h3>
            <p className="text-ink-2 text-sm">{deadline}</p>
        </article>
    );
}

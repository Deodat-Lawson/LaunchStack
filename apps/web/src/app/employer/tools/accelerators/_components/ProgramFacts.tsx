"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import type { ProgramSource, SourcedNarrative } from "../api";

export function SourceLinks({ ids, sources }: { ids: string[]; sources: ProgramSource[] }) {
    const t = useTranslations("accelerators.program");
    return (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {sources
                .filter(source => ids.includes(source.id))
                .map(source => (
                    <a
                        key={source.id}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand inline-flex items-center gap-1 underline underline-offset-4"
                    >
                        {t("sourceLink", { title: source.title })}
                        <ExternalLink className="size-3 shrink-0" />
                    </a>
                ))}
        </div>
    );
}

export function Narrative({
    title,
    narrative,
    sources,
}: {
    title: string;
    narrative: SourcedNarrative;
    sources: ProgramSource[];
}) {
    const t = useTranslations("accelerators.program");
    return (
        <section className="space-y-3">
            <h2 className="text-ink text-base font-semibold">{title}</h2>
            <p className="text-ink-2 whitespace-pre-wrap text-sm leading-relaxed">
                {narrative.text}
            </p>
            <p className="text-ink-3 text-xs">
                {t(narrative.interpretation ? "interpretation" : "sourceSummary")}
            </p>
            <SourceLinks ids={narrative.sourceIds} sources={sources} />
        </section>
    );
}

export function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
    return (
        <div
            role={danger ? "alert" : "status"}
            className={cn(
                "border-line bg-panel-2 text-ink-2 rounded-lg border p-3 text-sm leading-relaxed",
                danger && "border-danger/30 bg-danger/5 text-danger"
            )}
        >
            {children}
        </div>
    );
}

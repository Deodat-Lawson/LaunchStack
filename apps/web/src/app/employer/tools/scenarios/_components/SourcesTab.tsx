"use client";

import { ExternalLink, Lock } from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import { SourceLink } from "~/components/tools/Cite";
import { SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import type { ScenarioDetail, ScenarioSources } from "~/lib/scenarios/types";
import { joinNatural, plural } from "~/lib/tools/format";
import { cn } from "~/lib/utils";

import { SOURCE_KIND_LABEL, isLive } from "~/lib/scenarios/words";

/** "2 files, a search of your files and the company profile". */
function usedWords(used: ScenarioSources): string {
    const parts = [
        used.documentIds.length > 0 && plural(used.documentIds.length, "picked file"),
        used.searchFiles && "a search of your files",
        used.prospects && "prospects",
        used.brandComments && "comments on your posts",
        used.companyProfile && "the company profile",
        used.notes.trim() && "pasted material",
    ].filter((x): x is string => Boolean(x));
    return parts.length ? joinNatural(parts) : "nothing: every person was invented";
}

/**
 * The evidence the people were built from, numbered as they cite it (E1…),
 * with the brief everyone knew. A file this viewer cannot open stays in the
 * list, but says so instead of what it is.
 */
export function SourcesTab({
    run,
    focusSource,
}: {
    run: ScenarioDetail;
    focusSource: string | null;
}) {
    const [highlight, setHighlight] = useState<string | null>(focusSource);
    useEffect(() => {
        if (!focusSource) return;
        setHighlight(focusSource);
        document
            .getElementById(`scenario-source-${focusSource}`)
            ?.scrollIntoView({ block: "center" });
        const timer = window.setTimeout(() => setHighlight(null), 2600);
        return () => window.clearTimeout(timer);
    }, [focusSource]);

    const citedBy = (id: string) => run.people.filter(p => p.sources.includes(id)).length;
    const jump = (id: string) => {
        setHighlight(id);
        document.getElementById(`scenario-source-${id}`)?.scrollIntoView({ block: "center" });
    };

    if (run.sources.length === 0) {
        return isLive(run.status) && run.stage === "gathering" ? (
            <div className="flex flex-col gap-3">
                <p className="text-ink-3 text-[13px]">Gathering sources…</p>
                <SkeletonRows rows={3} height={56} />
            </div>
        ) : (
            <p className="text-ink-3 text-[13px]">
                No sources: every person in this scenario was invented. Built from{" "}
                {usedWords(run.sourcesUsed)}.
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            {run.brief && (
                <section className="max-w-[80ch]">
                    <SectionHeading title="What everyone knew" />
                    <p className="text-ink-2 text-[13.5px] leading-relaxed">
                        {run.brief.split(/(\[E\d+\])/g).map((part, i) => {
                            const m = /^\[(E\d+)\]$/.exec(part);
                            if (!m) return <Fragment key={i}>{part}</Fragment>;
                            return (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => jump(m[1]!)}
                                    className="text-brand-ink focus-visible:ring-brand/50 rounded-sm align-super font-mono text-[10px] leading-none outline-none focus-visible:ring-2"
                                    aria-label={`Source ${m[1]}`}
                                >
                                    {m[1]}
                                </button>
                            );
                        })}
                    </p>
                </section>
            )}
            <section>
                <SectionHeading
                    title="Sources"
                    aside={`Built from ${usedWords(run.sourcesUsed)}`}
                />
                <ol className="border-line bg-panel overflow-hidden rounded-lg border">
                    {run.sources.map(source => {
                        const n = citedBy(source.id);
                        return (
                            <li
                                key={source.id}
                                id={`scenario-source-${source.id}`}
                                className={cn(
                                    "border-line-2 grid grid-cols-[36px_minmax(0,1fr)] gap-2 border-t px-4 py-3 transition-colors first:border-t-0",
                                    highlight === source.id && "bg-brand-soft"
                                )}
                            >
                                <span className="text-ink-3 pt-0.5 font-mono text-[11px] tabular-nums">
                                    {source.id}
                                </span>
                                <div className="min-w-0">
                                    <div className="text-ink-3 text-xs">
                                        {SOURCE_KIND_LABEL[source.kind]}
                                        {n > 0 &&
                                            ` · ${plural(n, "person", "people")} built from it`}
                                    </div>
                                    {source.redacted ? (
                                        <div className="text-ink-2 mt-0.5 inline-flex items-center gap-1.5 text-[13px]">
                                            <Lock className="size-3.5" aria-hidden />A file you
                                            don&apos;t have access to
                                        </div>
                                    ) : (
                                        <>
                                            <div className="mt-0.5 text-[13px]">
                                                {source.href ? (
                                                    <SourceLink
                                                        href={source.href}
                                                        className="text-ink hover:text-brand-ink inline-flex items-center gap-1 font-medium"
                                                    >
                                                        {source.label}
                                                        <ExternalLink
                                                            className="size-3"
                                                            aria-hidden
                                                        />
                                                    </SourceLink>
                                                ) : (
                                                    <span className="text-ink font-medium">
                                                        {source.label}
                                                    </span>
                                                )}
                                            </div>
                                            {source.excerpt && (
                                                <p className="text-ink-2 mt-1 text-xs leading-relaxed">
                                                    “{source.excerpt}”
                                                </p>
                                            )}
                                        </>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            </section>
        </div>
    );
}

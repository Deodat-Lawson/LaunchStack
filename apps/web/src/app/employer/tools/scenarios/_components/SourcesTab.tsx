"use client";

import {
    Building2,
    ExternalLink,
    FileSearch,
    FileText,
    Landmark,
    Lock,
    MessageSquareQuote,
    StickyNote,
    type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useEffect, useState } from "react";

import { SourceLink } from "~/components/tools/Cite";
import { SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import type {
    ScenarioDetail,
    ScenarioPerson,
    ScenarioSource,
    ScenarioSources,
} from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import { isLive, joinLabels, sourceKindLabel, type ScenarioWordsT } from "~/lib/scenarios/words";
import { PersonHoverCard, Portrait } from "./Portrait";

const KIND_ICON: Record<ScenarioSource["kind"], LucideIcon> = {
    document: FileText,
    search: FileSearch,
    prospect: Building2,
    brand_comment: MessageSquareQuote,
    company_profile: Landmark,
    notes: StickyNote,
};

/** Faces shown before "+N". */
const FACES = 4;

type SourcesT = ReturnType<typeof useTranslations<"scenarios.sources">>;

/** "2 files, a search of your files and the company profile". */
function usedWords(t: SourcesT, tw: ScenarioWordsT, used: ScenarioSources): string {
    const parts = [
        used.documentIds.length > 0 && t("used.files", { count: used.documentIds.length }),
        used.searchFiles && t("used.search"),
        used.prospects && t("used.prospects"),
        used.brandComments && t("used.comments"),
        used.companyProfile && t("used.profile"),
        used.notes.trim() && t("used.notes"),
    ].filter((x): x is string => Boolean(x));
    return parts.length ? joinLabels(tw, parts) : t("used.nothing");
}

/**
 * The evidence the people were built from, numbered as they cite it (E1…),
 * with the brief everyone knew. Each piece shows the faces of the people
 * built from it, so a claim of grounding can be followed to a person and
 * back. A file this viewer cannot open stays in the list, but says so
 * instead of what it is.
 */
export function SourcesTab({
    run,
    focusSource,
    onPerson,
}: {
    run: ScenarioDetail;
    focusSource: string | null;
    onPerson: (personId: string) => void;
}) {
    const t = useTranslations("scenarios.sources");
    const tw = useTranslations("scenarios.words");
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

    const citedBy = (id: string) => run.people.filter(p => p.sources.includes(id));
    const jump = (id: string) => {
        setHighlight(id);
        document.getElementById(`scenario-source-${id}`)?.scrollIntoView({ block: "center" });
    };

    if (run.sources.length === 0) {
        return isLive(run.status) && run.stage === "gathering" ? (
            <div className="flex flex-col gap-3">
                <p className="text-ink-3 text-[13px]">{t("gathering")}</p>
                <SkeletonRows rows={3} height={56} />
            </div>
        ) : (
            <p className="text-ink-3 text-[13px]">
                {t("none", { used: usedWords(t, tw, run.sourcesUsed) })}
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            {run.brief && (
                <section className="border-line bg-panel max-w-[80ch] rounded-xl border px-5 py-4">
                    <SectionHeading title={t("brief")} />
                    <p className="text-ink text-[14.5px] leading-relaxed">
                        {run.brief.split(/(\[E\d+\])/g).map((part, i) => {
                            const m = /^\[(E\d+)\]$/.exec(part);
                            if (!m) return <Fragment key={i}>{part}</Fragment>;
                            return (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => jump(m[1]!)}
                                    className="bg-brand-soft text-brand-ink hover:bg-brand/20 focus-visible:ring-brand/50 rounded px-1 py-px align-[1px] font-mono text-[10.5px] leading-none outline-none focus-visible:ring-2"
                                    aria-label={t("sourceAria", { id: m[1]! })}
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
                    title={t("title")}
                    aside={t("builtFrom", { used: usedWords(t, tw, run.sourcesUsed) })}
                />
                <ol className="border-line bg-panel overflow-hidden rounded-xl border">
                    {run.sources.map(source => {
                        const people = citedBy(source.id);
                        const Icon = source.redacted ? Lock : KIND_ICON[source.kind];
                        return (
                            <li
                                key={source.id}
                                id={`scenario-source-${source.id}`}
                                className={cn(
                                    "border-line-2 @max-md:grid-cols-[36px_minmax(0,1fr)] grid grid-cols-[36px_minmax(0,1fr)_auto] gap-x-3.5 gap-y-2.5 border-t px-4 py-3.5 transition-colors first:border-t-0",
                                    highlight === source.id && "bg-brand-soft"
                                )}
                            >
                                <span
                                    aria-hidden
                                    className="border-line bg-panel-2 text-ink-2 flex size-9 items-center justify-center rounded-lg border"
                                >
                                    <Icon className="size-4" />
                                </span>
                                <div className="min-w-0">
                                    <div className="text-ink-3 flex items-center gap-1.5 text-xs">
                                        <span className="font-mono">{source.id}</span>
                                        <span aria-hidden>·</span>
                                        <span>{sourceKindLabel(tw, source.kind)}</span>
                                    </div>
                                    {source.redacted ? (
                                        <div className="text-ink-2 mt-0.5 text-[13.5px]">
                                            {t("redacted")}
                                        </div>
                                    ) : (
                                        <>
                                            <div className="mt-0.5 text-[14px]">
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
                                                <blockquote className="border-line text-ink-2 mt-1.5 border-l-2 pl-3 text-[13px] leading-relaxed">
                                                    {source.excerpt}
                                                </blockquote>
                                            )}
                                        </>
                                    )}
                                </div>
                                {people.length > 0 && (
                                    <BuiltInto
                                        people={people}
                                        onPerson={onPerson}
                                        className="@max-md:col-start-2"
                                    />
                                )}
                            </li>
                        );
                    })}
                </ol>
            </section>
        </div>
    );
}

/** The faces of the people built from one source, each opening the person. */
function BuiltInto({
    people,
    onPerson,
    className,
}: {
    people: ScenarioPerson[];
    onPerson: (personId: string) => void;
    className?: string;
}) {
    const t = useTranslations("scenarios.sources");
    const shown = people.slice(0, FACES);
    const more = people.length - shown.length;
    return (
        <div className={cn("flex flex-col items-end gap-1 @max-md:items-start", className)}>
            <div className="flex items-center -space-x-2">
                {shown.map(person => (
                    <PersonHoverCard key={person.id} person={person}>
                        <button
                            type="button"
                            onClick={() => onPerson(person.id)}
                            aria-label={t("openPerson", { name: person.name })}
                            className="ring-panel focus-visible:ring-brand/60 relative rounded-full outline-none ring-2 transition-transform hover:z-10 hover:-translate-y-0.5 focus-visible:z-10"
                        >
                            <Portrait handle={person.handle} size={30} />
                        </button>
                    </PersonHoverCard>
                ))}
                {more > 0 && (
                    <span className="bg-panel-2 text-ink-2 ring-panel relative flex size-[30px] items-center justify-center rounded-full text-[11px] font-medium tabular-nums ring-2">
                        +{more}
                    </span>
                )}
            </div>
            <span className="text-ink-3 whitespace-nowrap text-xs">
                {t("peopleBuilt", { count: people.length })}
            </span>
        </div>
    );
}

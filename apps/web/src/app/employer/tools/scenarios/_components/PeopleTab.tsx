"use client";

import { FileText, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { ScenarioDetail, ScenarioPerson, ScenarioSource } from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import { atHandle, isLive, sourceKindLabel, type ScenarioWordsT } from "~/lib/scenarios/words";
import { signatureLine } from "../_lib/people";
import { StanceDot, StanceTrail, stanceMove } from "./Bits";
import { Portrait } from "./Portrait";

type Filter = "all" | "grounded" | "invented";

type PeopleT = ReturnType<typeof useTranslations<"scenarios.people">>;

/** "Customer interviews — September.pdf", or "a file you can't open"; "+2" when there are more. */
function provenance(
    t: PeopleT,
    tw: ScenarioWordsT,
    person: ScenarioPerson,
    sources: Map<string, ScenarioSource>
): string {
    const first = sources.get(person.sources[0] ?? "");
    const label = !first
        ? (person.sources[0] ?? "")
        : first.redacted
          ? t("hiddenFile")
          : first.label || sourceKindLabel(tw, first.kind);
    return person.sources.length > 1
        ? t("fromMore", { label, more: person.sources.length - 1 })
        : t("from", { label });
}

/** Where a person comes from, in a line: the record they were built from, or that they were invented. */
export function Provenance({
    person,
    sources,
    className,
}: {
    person: ScenarioPerson;
    sources: Map<string, ScenarioSource>;
    className?: string;
}) {
    const t = useTranslations("scenarios.people");
    const tw = useTranslations("scenarios.words");
    const grounded = person.grounding === "grounded" && person.sources.length > 0;
    return (
        <span
            className={cn(
                "inline-flex min-w-0 items-center gap-1.5 text-xs",
                grounded ? "text-ink-3" : "text-warn-ink",
                className
            )}
        >
            {grounded ? (
                <FileText className="size-3.5 shrink-0" aria-hidden />
            ) : (
                <Sparkles className="size-3.5 shrink-0" aria-hidden />
            )}
            <span className="truncate">
                {grounded ? provenance(t, tw, person, sources) : t("inventedBadge")}
            </span>
        </span>
    );
}

/**
 * The cast: everyone in the run as a persona — a face, who they are, the
 * line they're remembered by, where they ended up and what they were built
 * from (or that they were invented to fill a gap). A card opens the person.
 */
export function PeopleTab({
    run,
    onPerson,
}: {
    run: ScenarioDetail;
    onPerson: (personId: string) => void;
}) {
    const t = useTranslations("scenarios.people");
    const tc = useTranslations("common");
    const [filter, setFilter] = useState<Filter>("all");
    const grounded = run.people.filter(p => p.grounding === "grounded").length;
    const shown = useMemo(
        () => (filter === "all" ? run.people : run.people.filter(p => p.grounding === filter)),
        [run.people, filter]
    );
    const sources = useMemo(() => new Map(run.sources.map(s => [s.id, s])), [run.sources]);

    if (run.people.length === 0) {
        return isLive(run.status) ? (
            <div className="flex flex-col gap-3">
                <p className="text-ink-3 text-[13px]">
                    {run.stage === "casting"
                        ? t("building", { count: run.agents })
                        : t("waitingForSources")}
                </p>
                <SkeletonRows rows={3} height={56} />
            </div>
        ) : (
            <p className="text-ink-3 text-[13px]">{t("nobody")}</p>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-ink-3 text-xs">
                    {t("summary", {
                        count: run.people.length,
                        grounded,
                        invented: run.people.length - grounded,
                    })}
                </span>
                <ToggleGroup
                    type="single"
                    value={filter}
                    onValueChange={v => v && setFilter(v as Filter)}
                    variant="outline"
                    size="sm"
                    aria-label={t("filterLabel")}
                >
                    <ToggleGroupItem value="all" className="px-2.5 text-xs">
                        {tc("status.all")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="grounded" className="px-2.5 text-xs">
                        {t("grounded")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="invented" className="px-2.5 text-xs">
                        {t("invented")}
                    </ToggleGroupItem>
                </ToggleGroup>
            </div>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3.5">
                {shown.map(person => (
                    <li key={person.id}>
                        <PersonaCard
                            person={person}
                            run={run}
                            sources={sources}
                            onOpen={() => onPerson(person.id)}
                        />
                    </li>
                ))}
            </ul>
        </div>
    );
}

function PersonaCard({
    person,
    run,
    sources,
    onOpen,
}: {
    person: ScenarioPerson;
    run: ScenarioDetail;
    sources: Map<string, ScenarioSource>;
    onOpen: () => void;
}) {
    const t = useTranslations("scenarios.people");
    const tw = useTranslations("scenarios.words");
    const line = useMemo(() => signatureLine(person, run.posts), [person, run.posts]);
    return (
        <button
            type="button"
            onClick={onOpen}
            className="border-line bg-panel hover:border-ink-4/60 hover:shadow-2 focus-visible:ring-brand/50 group flex h-full w-full flex-col rounded-xl border text-left outline-none transition-[border-color,box-shadow] duration-150 focus-visible:ring-2"
        >
            <span className="flex min-w-0 items-start gap-3.5 px-4 pt-4">
                <Portrait handle={person.handle} size={56} stance={person.stance} />
                <span className="min-w-0 flex-1 pt-0.5">
                    <span className="text-ink block truncate text-[15px] font-semibold tracking-[-0.01em]">
                        {person.name}
                    </span>
                    <span className="text-ink-2 mt-0.5 line-clamp-2 block text-[13px] leading-snug">
                        {person.role}
                    </span>
                    <span className="text-ink-3 mt-1 block truncate text-xs">
                        {atHandle(person.handle)}
                        <span aria-hidden> · </span>
                        <span className="tabular-nums">
                            {t("followers", { count: person.followers })}
                        </span>
                    </span>
                </span>
            </span>

            <span className="block flex-1 px-4 pb-4 pt-3.5">
                {line ? (
                    <span className="text-ink relative block pl-4 text-[14px] leading-[1.5]">
                        <span
                            aria-hidden
                            className="text-ink-4 absolute -left-0.5 -top-1.5 select-none text-[26px] leading-none"
                        >
                            “
                        </span>
                        <span className="line-clamp-4">{line.text}</span>
                    </span>
                ) : person.lastThought ? (
                    <span className="block">
                        <span className="text-ink-3 block text-xs">{t("keptQuiet")}</span>
                        <span className="text-ink-2 mt-1 line-clamp-3 block text-[13.5px] italic leading-snug">
                            {person.lastThought}
                        </span>
                    </span>
                ) : (
                    <span className="text-ink-3 block text-[13px] italic">{t("readAlong")}</span>
                )}
            </span>

            <span className="border-line-2 flex flex-col gap-1.5 border-t px-4 py-3">
                <span className="flex items-center justify-between gap-3">
                    <span className="text-ink-2 inline-flex min-w-0 items-center gap-1.5 text-xs">
                        <StanceDot stance={person.stance} />
                        <span className="truncate">
                            {stanceMove(tw, person.startStance, person.stance)}
                        </span>
                    </span>
                    <StanceTrail history={person.stanceHistory} width={64} height={16} />
                </span>
                <Provenance person={person} sources={sources} />
            </span>
        </button>
    );
}

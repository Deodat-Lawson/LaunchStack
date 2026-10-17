"use client";

import { useMemo, useState } from "react";

import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Badge } from "~/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { ScenarioDetail, ScenarioPerson } from "~/lib/scenarios/types";
import { plural } from "~/lib/tools/format";

import { isLive } from "~/lib/scenarios/words";
import { Monogram, StanceTrail, stanceMove } from "./Bits";

type Filter = "all" | "grounded" | "invented";

/** "Grounded" when built from records, else said plainly. */
export function GroundingBadge({ person }: { person: ScenarioPerson }) {
    return person.grounding === "grounded" ? (
        <Badge variant="secondary" className="shrink-0">
            Grounded
        </Badge>
    ) : (
        <Badge variant="warn" className="shrink-0">
            Invented to fill a gap
        </Badge>
    );
}

/**
 * Everyone in the run: who they are, whether they come from the workspace's
 * records or were invented to fill a gap, and how their stance moved. A card
 * opens the person.
 */
export function PeopleTab({
    run,
    onPerson,
}: {
    run: ScenarioDetail;
    onPerson: (personId: string) => void;
}) {
    const [filter, setFilter] = useState<Filter>("all");
    const grounded = run.people.filter(p => p.grounding === "grounded").length;
    const shown = useMemo(
        () => (filter === "all" ? run.people : run.people.filter(p => p.grounding === filter)),
        [run.people, filter]
    );

    if (run.people.length === 0) {
        return isLive(run.status) ? (
            <div className="flex flex-col gap-3">
                <p className="text-ink-3 text-[13px]">
                    {run.stage === "casting"
                        ? `Building ${run.agents} people from the sources…`
                        : "People are built once the sources are gathered."}
                </p>
                <SkeletonRows rows={3} height={56} />
            </div>
        ) : (
            <p className="text-ink-3 text-[13px]">Nobody was built for this scenario.</p>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-ink-3 text-xs">
                    {plural(run.people.length, "person", "people")} · {grounded} built from your
                    records · {run.people.length - grounded} invented to fill gaps
                </span>
                <ToggleGroup
                    type="single"
                    value={filter}
                    onValueChange={v => v && setFilter(v as Filter)}
                    variant="outline"
                    size="sm"
                    aria-label="Show"
                >
                    <ToggleGroupItem value="all" className="px-2.5 text-xs">
                        All
                    </ToggleGroupItem>
                    <ToggleGroupItem value="grounded" className="px-2.5 text-xs">
                        Grounded
                    </ToggleGroupItem>
                    <ToggleGroupItem value="invented" className="px-2.5 text-xs">
                        Invented
                    </ToggleGroupItem>
                </ToggleGroup>
            </div>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
                {shown.map(person => (
                    <li key={person.id}>
                        <button
                            type="button"
                            onClick={() => onPerson(person.id)}
                            className="border-line bg-panel hover:bg-panel-2 focus-visible:ring-brand/50 flex h-full w-full flex-col gap-2.5 rounded-lg border p-3.5 text-left outline-none focus-visible:ring-2"
                        >
                            <span className="flex min-w-0 items-start gap-2.5">
                                <Monogram name={person.name} size={34} />
                                <span className="min-w-0 flex-1">
                                    <span className="text-ink block truncate text-[13.5px] font-semibold">
                                        {person.name}
                                    </span>
                                    <span className="text-ink-3 block truncate text-xs">
                                        @{person.handle}
                                    </span>
                                </span>
                            </span>
                            <span className="text-ink-2 line-clamp-2 text-[13px] leading-snug">
                                {person.role}
                            </span>
                            <GroundingBadge person={person} />
                            <span className="mt-auto flex items-center justify-between gap-3">
                                <span className="text-ink-2 min-w-0 truncate text-xs">
                                    {stanceMove(person.startStance, person.stance)}
                                </span>
                                <StanceTrail history={person.stanceHistory} />
                            </span>
                            <span className="text-ink-3 text-xs tabular-nums">
                                {plural(person.posts, "post")} ·{" "}
                                {plural(person.comments, "comment")}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

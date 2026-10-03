"use client";

import { ChevronDown, ChevronUp, MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";

import type { TopicDto } from "../api";
import { fmtDate } from "../_lib/format";
import { BasisTag, EvidenceChips, StatusWord } from "./Primitives";

const ORIGIN_WORD: Record<TopicDto["origin"], string> = {
    ai: "Suggested by the model",
    rules: "Suggested by the rules",
    founder: "Yours",
};

/**
 * One topic, in the six parts the brief requires, each labelled by what it
 * is: observed fact with its sources, interpretation, the decision, the
 * suggested next step, help requested, and what is unknown. The generator's
 * reason for suggesting it is one click away, so rejecting it is informed.
 */
export function TopicCard({
    topic,
    index,
    first,
    last,
    busy,
    onKeep,
    onDismiss,
    onEdit,
    onDecide,
    onMove,
    onShare,
    onDelete,
}: {
    topic: TopicDto;
    index: number;
    first: boolean;
    last: boolean;
    busy: boolean;
    onKeep: () => void;
    onDismiss: () => void;
    onEdit: () => void;
    onDecide: () => void;
    onMove: (dir: -1 | 1) => void;
    onShare: (shared: boolean) => void;
    onDelete: () => void;
}) {
    const [open, setOpen] = useState(topic.status !== "dismissed");
    const [why, setWhy] = useState(false);
    const dismissed = topic.status === "dismissed";
    const decided = Boolean(topic.decision);

    return (
        <article
            className={cn("border-line-2 border-t first:border-t-0", dismissed && "opacity-60")}
            aria-label={topic.title}
        >
            <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                <span className="text-ink-3 w-5 shrink-0 font-mono text-[12px] tabular-nums">
                    {index + 1}
                </span>
                <button
                    type="button"
                    onClick={() => setOpen(o => !o)}
                    aria-expanded={open}
                    className="focus-visible:ring-brand/50 flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2"
                >
                    <span
                        className={cn(
                            "text-ink min-w-0 flex-1 truncate text-[14px] font-medium",
                            dismissed && "line-through"
                        )}
                    >
                        {topic.title}
                    </span>
                    {open ? (
                        <ChevronUp className="text-ink-3 size-3.5 shrink-0" />
                    ) : (
                        <ChevronDown className="text-ink-3 size-3.5 shrink-0" />
                    )}
                </button>
                {decided ? (
                    <StatusWord tone="success">Decided</StatusWord>
                ) : topic.status === "suggested" ? (
                    <StatusWord tone="brand">Suggested</StatusWord>
                ) : dismissed ? (
                    <StatusWord tone="quiet">Dismissed</StatusWord>
                ) : (
                    <StatusWord tone="neutral">Kept</StatusWord>
                )}
                <label className="text-ink-3 hidden items-center gap-1.5 text-[11.5px] sm:inline-flex">
                    <Switch
                        checked={topic.shared}
                        onCheckedChange={onShare}
                        disabled={busy}
                        aria-label="Share this topic"
                    />
                    shared
                </label>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Actions for ${topic.title}`}
                            disabled={busy}
                        >
                            <MoreHorizontal className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {topic.status === "suggested" && (
                            <DropdownMenuItem onSelect={onKeep}>Keep</DropdownMenuItem>
                        )}
                        {dismissed ? (
                            <DropdownMenuItem onSelect={onKeep}>Restore</DropdownMenuItem>
                        ) : (
                            <DropdownMenuItem onSelect={onDismiss}>Dismiss</DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
                        <DropdownMenuItem onSelect={onDecide}>
                            {decided ? "Change the decision" : "Record decision"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onMove(-1)} disabled={first}>
                            Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onMove(1)} disabled={last}>
                            Move down
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onShare(!topic.shared)}>
                            {topic.shared ? "Make private" : "Share with the program"}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-danger" onSelect={onDelete}>
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {open && (
                <div className="flex flex-col gap-3.5 px-4 pb-4 pl-[calc(1rem+2rem)]">
                    <Part label="What happened" basis="observed">
                        {topic.facts.length === 0 ? (
                            <p className="text-ink-3 text-[13px]">No facts recorded.</p>
                        ) : (
                            <ul className="flex flex-col gap-1.5">
                                {topic.facts.map((f, i) => (
                                    <li
                                        key={i}
                                        className="text-ink flex flex-col gap-1 text-[13px] leading-[1.45]"
                                    >
                                        <span>{f.text}</span>
                                        <EvidenceChips refs={f.refs} unsupported={f.unsupported} />
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Part>
                    {topic.conflicts.length > 0 && (
                        <Part label="Conflicting evidence" basis="conflict">
                            <ul className="flex flex-col gap-1.5">
                                {topic.conflicts.map((c, i) => (
                                    <li
                                        key={i}
                                        className="text-ink flex flex-col gap-1 text-[13px]"
                                    >
                                        <span>{c.text}</span>
                                        <EvidenceChips refs={c.refs} />
                                    </li>
                                ))}
                            </ul>
                        </Part>
                    )}
                    {topic.whyItMatters && (
                        <Part label="Why it merits discussion" basis="interpretation">
                            <p className="text-ink-2 max-w-[70ch] text-[13px] leading-[1.45]">
                                {topic.whyItMatters}
                            </p>
                        </Part>
                    )}
                    <Part label="The decision">
                        <p className="text-ink max-w-[70ch] text-[13px] font-medium leading-[1.45]">
                            {topic.decisionQuestion || (
                                <span className="text-ink-3 font-normal">
                                    No decision phrased yet — edit the topic.
                                </span>
                            )}
                        </p>
                        {decided && (
                            <div className="border-success/40 bg-panel-2 mt-2 rounded-md border-l-2 px-3 py-2">
                                <div className="text-ink-3 text-[11.5px]">
                                    Decided {topic.decidedAt ? fmtDate(topic.decidedAt) : ""}
                                </div>
                                <p className="text-ink text-[13px]">{topic.decision}</p>
                            </div>
                        )}
                    </Part>
                    {(topic.proposedNextStep !== "" ||
                        topic.proposedOwner !== null ||
                        topic.proposedDue !== null) && (
                        <Part label="Proposed next step" basis="suggestion">
                            <p className="text-ink-2 max-w-[70ch] text-[13px] leading-[1.45]">
                                {topic.proposedNextStep}
                            </p>
                            <div className="text-ink-3 mt-1 flex flex-wrap gap-x-3 text-[12px]">
                                <span>Owner: {topic.proposedOwner ?? <em>unassigned</em>}</span>
                                <span>
                                    Due:{" "}
                                    {topic.proposedDue ? (
                                        fmtDate(topic.proposedDue)
                                    ) : (
                                        <em>not set</em>
                                    )}
                                </span>
                            </div>
                        </Part>
                    )}
                    {topic.helpRequested && (
                        <Part label="Help requested">
                            <p className="text-ink-2 max-w-[70ch] text-[13px]">
                                {topic.helpRequested}
                            </p>
                            {!topic.shared && (
                                <p className="text-ink-3 mt-1 text-[11.5px]">
                                    Share the topic for the program to see this.
                                </p>
                            )}
                        </Part>
                    )}
                    {topic.unknowns.length > 0 && (
                        <Part label="Unknown" basis="unknown">
                            <ul className="text-ink-2 list-disc pl-4 text-[13px]">
                                {topic.unknowns.map((u, i) => (
                                    <li key={i}>{u}</li>
                                ))}
                            </ul>
                        </Part>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                        {!decided && topic.status === "suggested" && (
                            <Button size="sm" onClick={onKeep} disabled={busy}>
                                Keep
                            </Button>
                        )}
                        {!decided && (
                            <Button
                                size="sm"
                                variant={topic.status === "suggested" ? "outline" : "default"}
                                onClick={onDecide}
                                disabled={busy}
                            >
                                Record decision
                            </Button>
                        )}
                        {!dismissed && !decided && (
                            <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy}>
                                Dismiss
                            </Button>
                        )}
                        {topic.rationale && (
                            <button
                                type="button"
                                onClick={() => setWhy(w => !w)}
                                className="text-ink-3 hover:text-ink focus-visible:ring-brand/50 ml-auto rounded-sm text-[12px] underline-offset-2 outline-none hover:underline focus-visible:ring-2"
                                aria-expanded={why}
                            >
                                {why ? "Hide why" : "Why this topic?"}
                            </button>
                        )}
                    </div>
                    {why && topic.rationale && (
                        <p className="text-ink-3 border-line-2 max-w-[70ch] border-l-2 pl-3 text-[12.5px]">
                            {ORIGIN_WORD[topic.origin]}: {topic.rationale}
                        </p>
                    )}
                </div>
            )}
        </article>
    );
}

function Part({
    label,
    basis,
    children,
}: {
    label: string;
    basis?: "observed" | "interpretation" | "suggestion" | "unknown" | "conflict";
    children: React.ReactNode;
}) {
    return (
        <div>
            <div className="mb-1 flex items-center gap-2">
                <span className="text-ink-3 text-[11.5px] font-medium">{label}</span>
                {basis && <BasisTag basis={basis} />}
            </div>
            {children}
        </div>
    );
}

"use client";

import { CornerDownRight } from "lucide-react";

import { SectionHeading } from "~/components/tools/PageHeader";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "~/components/ui/sheet";
import type { ScenarioDetail, ScenarioInterview } from "~/lib/scenarios/types";
import { plural } from "~/lib/tools/format";

import { atHandle, SOURCE_KIND_LABEL, STANCE_LABEL } from "~/lib/scenarios/words";
import { Monogram, StanceTrail } from "./Bits";
import { AskBox, InterviewThread, askBlockedReason } from "./Interviews";
import { GroundingBadge } from "./PeopleTab";

/**
 * One person: who they are, what they were built from (each source opens in
 * Sources), where they stood round by round, their last private thought,
 * what they posted, and a box to ask them something.
 */
export function PersonSheet({
    run,
    personId,
    interviews,
    onClose,
    onJump,
    onSource,
    onAsk,
}: {
    run: ScenarioDetail;
    personId: string | null;
    interviews: ScenarioInterview[];
    onClose: () => void;
    onJump: (postId: string) => void;
    onSource: (sourceId: string) => void;
    onAsk: (agentId: string, question: string) => Promise<void>;
}) {
    const person = personId ? run.people.find(p => p.id === personId) : undefined;
    const sources = new Map(run.sources.map(s => [s.id, s]));
    const theirPosts = person ? run.posts.filter(p => p.authorId === person.id) : [];
    const theirInterviews = person ? interviews.filter(i => i.agentId === person.id) : [];

    return (
        <Sheet open={Boolean(person)} onOpenChange={open => !open && onClose()}>
            <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[460px]">
                {person && (
                    <>
                        <SheetHeader className="px-6 pb-3 pt-6">
                            <div className="flex items-start gap-3 pr-6">
                                <Monogram name={person.name} size={40} />
                                <div className="min-w-0">
                                    <SheetTitle className="text-ink text-lg font-semibold tracking-[-0.02em]">
                                        {person.name}
                                    </SheetTitle>
                                    <SheetDescription className="text-ink-2 text-[13px]">
                                        {atHandle(person.handle)} · {person.role}
                                    </SheetDescription>
                                </div>
                            </div>
                            <div className="mt-2">
                                <GroundingBadge person={person} />
                            </div>
                        </SheetHeader>
                        <div className="flex flex-col gap-6 px-6 pb-8">
                            <p className="text-ink-2 text-[13.5px] leading-relaxed">{person.bio}</p>

                            {person.interests.length > 0 && (
                                <div>
                                    <SectionHeading title="Cares about" />
                                    <div className="flex flex-wrap gap-1.5">
                                        {person.interests.map(i => (
                                            <span
                                                key={i}
                                                className="border-line text-ink-2 rounded-full border px-2 py-0.5 text-xs"
                                            >
                                                {i}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div>
                                <SectionHeading title="Built from" />
                                {person.sources.length === 0 ? (
                                    <p className="text-ink-3 text-[13px]">
                                        Nothing in your records: this person was invented to fill a
                                        gap.
                                    </p>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5">
                                        {person.sources.map(id => {
                                            const source = sources.get(id);
                                            const label = !source
                                                ? id
                                                : source.redacted
                                                  ? `${id} · A file you don't have access to`
                                                  : `${id} · ${source.label || SOURCE_KIND_LABEL[source.kind]}`;
                                            return (
                                                <button
                                                    key={id}
                                                    type="button"
                                                    onClick={() => onSource(id)}
                                                    className="border-line bg-panel text-ink-2 hover:bg-panel-2 hover:text-ink focus-visible:ring-brand/50 max-w-full truncate rounded-md border px-2 py-1 text-xs outline-none focus-visible:ring-2"
                                                >
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <div>
                                <SectionHeading
                                    title="Stance"
                                    aside={`started ${STANCE_LABEL[person.startStance].toLowerCase()}, now ${STANCE_LABEL[person.stance].toLowerCase()}`}
                                />
                                <StanceTrail
                                    history={person.stanceHistory}
                                    width={200}
                                    height={36}
                                />
                            </div>

                            {person.lastThought && (
                                <div>
                                    <SectionHeading title="Last private thought" />
                                    <blockquote className="border-line text-ink-2 border-l-2 pl-3 text-[13.5px] leading-relaxed">
                                        {person.lastThought}
                                    </blockquote>
                                </div>
                            )}

                            <div>
                                <SectionHeading
                                    title="Posts"
                                    aside={`${plural(person.posts, "post")} · ${plural(person.comments, "comment")}`}
                                />
                                {theirPosts.length === 0 ? (
                                    <p className="text-ink-3 text-[13px]">
                                        Read along without posting.
                                    </p>
                                ) : (
                                    <ul className="border-line bg-panel overflow-hidden rounded-lg border">
                                        {theirPosts.map(post => (
                                            <li
                                                key={post.id}
                                                className="border-line-2 border-t px-3 py-2.5 first:border-t-0"
                                            >
                                                <div className="text-ink-3 flex items-center justify-between gap-2 text-xs">
                                                    <span>
                                                        Round {post.round}
                                                        {post.kind === "repost"
                                                            ? " · reposted"
                                                            : post.kind === "quote"
                                                              ? " · quoted"
                                                              : ""}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => onJump(post.id)}
                                                        className="text-ink-2 hover:text-ink focus-visible:ring-brand/50 inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2"
                                                    >
                                                        <CornerDownRight
                                                            className="size-3"
                                                            aria-hidden
                                                        />
                                                        See in Feed
                                                    </button>
                                                </div>
                                                <p className="text-ink-2 mt-1 line-clamp-3 text-[13px] leading-snug">
                                                    {post.text || post.root?.text}
                                                </p>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            <div className="flex flex-col gap-3">
                                <SectionHeading title={`Ask ${person.name.split(" ")[0]}`} />
                                <InterviewThread
                                    interviews={theirInterviews}
                                    answererName={() => person.name}
                                />
                                <AskBox
                                    agentId={person.id}
                                    blocked={askBlockedReason(run)}
                                    onAsk={onAsk}
                                />
                            </div>
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}

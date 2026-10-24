"use client";

import { CornerDownRight, FileText, Lock, Repeat2, Sparkles } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, useMemo, type ReactNode } from "react";

import { SectionHeading } from "~/components/tools/PageHeader";
import { Badge } from "~/components/ui/badge";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "~/components/ui/sheet";
import type {
    ScenarioDetail,
    ScenarioInterview,
    ScenarioPerson,
    ScenarioWouldPay,
} from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import { STANCE_BG, atHandle, sourceKindLabel, stanceLabel } from "~/lib/scenarios/words";
import { journey, type Said } from "../_lib/people";
import { Shift, StanceTrail } from "./Bits";
import { AskBox, InterviewThread, askBlockedReason } from "./Interviews";
import { PERSONA_TINT, Portrait, personaStyle } from "./Portrait";

/**
 * One person as a profile: a face on a cover in their colour, who they are
 * and their following, what is on their mind now, what they would spend and
 * what holds them back, what they were built from (each source opens in
 * Sources), how they moved round by round with what they said at each turn,
 * and a box to ask them something.
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
    return (
        <Sheet open={Boolean(person)} onOpenChange={open => !open && onClose()}>
            <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[520px]">
                {person && (
                    <Profile
                        run={run}
                        person={person}
                        interviews={interviews}
                        onJump={onJump}
                        onSource={onSource}
                        onAsk={onAsk}
                    />
                )}
            </SheetContent>
        </Sheet>
    );
}

function Profile({
    run,
    person,
    interviews,
    onJump,
    onSource,
    onAsk,
}: {
    run: ScenarioDetail;
    person: ScenarioPerson;
    interviews: ScenarioInterview[];
    onJump: (postId: string) => void;
    onSource: (sourceId: string) => void;
    onAsk: (agentId: string, question: string) => Promise<void>;
}) {
    const t = useTranslations("scenarios.personSheet");
    const tw = useTranslations("scenarios.words");
    const ti = useTranslations("scenarios.interviews");
    const format = useFormatter();
    const sources = new Map(run.sources.map(s => [s.id, s]));
    const steps = useMemo(() => journey(person, run.posts), [person, run.posts]);
    const theirInterviews = interviews.filter(i => i.agentId === person.id);
    const firstName = person.name.split(" ")[0] ?? person.name;
    const invented = person.grounding === "invented" || person.sources.length === 0;

    return (
        <>
            <div
                aria-hidden
                className={cn("h-24 shrink-0", PERSONA_TINT)}
                style={personaStyle(person.handle)}
            />
            <SheetHeader className="px-6 pb-0 pt-0">
                <Portrait handle={person.handle} size={88} className="ring-panel -mt-11 ring-4" />
                <SheetTitle className="text-ink mt-3 text-[20px] font-semibold tracking-[-0.02em]">
                    {person.name}
                </SheetTitle>
                <SheetDescription className="text-ink-3 -mt-1 text-[13px]">
                    {atHandle(person.handle)}
                </SheetDescription>
                <p className="text-ink-2 text-[14px] leading-snug">{person.role}</p>
            </SheetHeader>

            <div className="flex flex-col gap-7 px-6 pb-8 pt-3">
                <div className="flex flex-col gap-3">
                    {person.bio && (
                        <p className="text-ink text-[14px] leading-relaxed">{person.bio}</p>
                    )}
                    <dl className="text-ink-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                        {(
                            [
                                [person.followers, t("followers", { count: person.followers })],
                                [person.following, t("following", { count: person.following })],
                                [person.posts, t("postsCount", { count: person.posts })],
                                [person.comments, t("repliesCount", { count: person.comments })],
                            ] as const
                        ).map(([n, label]) => (
                            <div key={label} className="flex items-baseline gap-1">
                                <dt className="sr-only">{label}</dt>
                                <dd className="text-ink font-semibold tabular-nums">
                                    {format.number(n)}
                                </dd>
                                <span aria-hidden>{label}</span>
                            </div>
                        ))}
                    </dl>
                    {person.interests.length > 0 && (
                        <div className="flex flex-wrap gap-1.5" aria-label={t("caresAbout")}>
                            {person.interests.map(i => (
                                <span
                                    key={i}
                                    className="bg-panel-2 text-ink-2 rounded-full px-2.5 py-0.5 text-xs"
                                >
                                    {i}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {person.lastThought && (
                    <figure className="bg-panel-2 rounded-xl px-4 py-3.5">
                        <figcaption className="text-ink-3 text-xs">
                            {t("onTheirMind", { name: firstName })}
                        </figcaption>
                        <blockquote className="text-ink mt-1.5 text-[14.5px] italic leading-relaxed">
                            {person.lastThought}
                        </blockquote>
                    </figure>
                )}

                <Wallet person={person} />

                <section>
                    <SectionHeading title={t("builtFrom")} />
                    {invented ? (
                        <p className="text-warn inline-flex items-start gap-1.5 text-[13px] leading-snug">
                            <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                            {t("invented")}
                        </p>
                    ) : (
                        <ul className="flex flex-col gap-1.5">
                            {person.sources.map(id => {
                                const source = sources.get(id);
                                return (
                                    <li key={id}>
                                        <button
                                            type="button"
                                            onClick={() => onSource(id)}
                                            className="border-line bg-panel hover:bg-panel-2 focus-visible:ring-brand/50 flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left outline-none focus-visible:ring-2"
                                        >
                                            {source?.redacted ? (
                                                <Lock
                                                    className="text-ink-3 size-3.5 shrink-0"
                                                    aria-hidden
                                                />
                                            ) : (
                                                <FileText
                                                    className="text-ink-3 size-3.5 shrink-0"
                                                    aria-hidden
                                                />
                                            )}
                                            <span className="text-ink min-w-0 flex-1 truncate text-[13px]">
                                                {!source
                                                    ? id
                                                    : source.redacted
                                                      ? t("redacted")
                                                      : source.label ||
                                                        sourceKindLabel(tw, source.kind)}
                                            </span>
                                            <span className="text-ink-3 shrink-0 font-mono text-[11px]">
                                                {id}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>

                <section>
                    <SectionHeading
                        title={t("journey")}
                        aside={
                            <StanceTrail history={person.stanceHistory} width={96} height={18} />
                        }
                    />
                    <ol className="relative">
                        <JourneyRow stance={person.startStance} last={steps.length === 0}>
                            <span className="text-ink-2 text-[13px]">
                                {t("started", {
                                    stance: stanceLabel(tw, person.startStance).toLowerCase(),
                                })}
                            </span>
                        </JourneyRow>
                        {steps.map((step, i) => (
                            <JourneyRow
                                key={step.round}
                                stance={step.stance}
                                last={i === steps.length - 1}
                            >
                                <div className="flex flex-wrap items-baseline gap-x-2">
                                    <span className="text-ink-3 text-xs">
                                        {t("round", { round: step.round })}
                                    </span>
                                    {step.moved && <Shift from={step.from} to={step.stance} />}
                                </div>
                                {step.said.length > 0 && (
                                    <ul className="mt-1.5 flex flex-col gap-2">
                                        {step.said.map(said => (
                                            <SaidItem
                                                key={
                                                    said.kind === "post"
                                                        ? said.post.id
                                                        : said.comment.id
                                                }
                                                said={said}
                                                onJump={onJump}
                                            />
                                        ))}
                                    </ul>
                                )}
                            </JourneyRow>
                        ))}
                    </ol>
                    {person.posts + person.comments === 0 && (
                        <p className="text-ink-3 mt-1 text-[13px]">{t("readAlong")}</p>
                    )}
                </section>

                <section className="flex flex-col gap-3">
                    <SectionHeading title={t("ask", { name: firstName })} />
                    <InterviewThread
                        interviews={theirInterviews}
                        answererName={() => person.name}
                        answerer={() => <Portrait handle={person.handle} size={24} />}
                    />
                    <AskBox agentId={person.id} blocked={askBlockedReason(ti, run)} onAsk={onAsk} />
                </section>
            </div>
        </>
    );
}

/** The same sides as the stance scale: info for yes, danger for no. */
const PAY_BADGE: Record<ScenarioWouldPay, "info" | "secondary" | "danger"> = {
    yes: "info",
    maybe: "secondary",
    no: "danger",
};

/**
 * What they use today, what they can spend, their part in buying, what
 * switching would cost them, whether they'd pay now and what holds them
 * back. Runs cast before people had a wallet show nothing here.
 */
function Wallet({ person }: { person: ScenarioPerson }) {
    const t = useTranslations("scenarios.personSheet.wallet");
    const doubt = person.objection ?? person.firstObjection;
    const today = person.currentSolution?.trim();
    const rows: Array<[string, string]> = [];
    if (today)
        rows.push([
            t("usesToday"),
            /^(nothing|none|n\/a)\.?$/i.test(today) ? t("usesNothing") : today,
        ]);
    if (person.budget) rows.push([t("budget"), t(`budgets.${person.budget}`)]);
    if (person.buyingRole) rows.push([t("buyingRole"), t(`roles.${person.buyingRole}`)]);
    if (person.switchingCost)
        rows.push([t("switchingCost"), t(`switching.${person.switchingCost}`)]);
    if (rows.length === 0 && !person.wouldPay && !doubt) return null;
    return (
        <section className="flex flex-col gap-3">
            <SectionHeading
                className="mb-0"
                title={t("title")}
                aside={
                    person.wouldPay && (
                        <Badge variant={PAY_BADGE[person.wouldPay]}>
                            {t(`wouldPay.${person.wouldPay}`)}
                        </Badge>
                    )
                }
            />
            {rows.length > 0 && (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
                    {rows.map(([label, value]) => (
                        <Fragment key={label}>
                            <dt className="text-ink-3">{label}</dt>
                            <dd className="text-ink min-w-0">{value}</dd>
                        </Fragment>
                    ))}
                </dl>
            )}
            {doubt && (
                <figure className="border-line border-l-2 pl-3">
                    <figcaption className="text-ink-3 text-xs">
                        {person.objection ? t("holdingBack") : t("firstDoubt")}
                    </figcaption>
                    <blockquote className="text-ink mt-1 text-[13.5px] leading-snug">
                        {doubt}
                    </blockquote>
                </figure>
            )}
        </section>
    );
}

/** One stop on the journey: a dot in the stance's colour on a line down the left. */
function JourneyRow({
    stance,
    last,
    children,
}: {
    stance: ScenarioPerson["stance"];
    last: boolean;
    children: ReactNode;
}) {
    return (
        <li className="relative grid grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 pb-4 last:pb-0">
            {!last && (
                <span aria-hidden className="bg-line absolute bottom-0 left-[9.5px] top-3 w-px" />
            )}
            <span
                aria-hidden
                className={cn(
                    "ring-panel relative mt-[5px] size-2.5 justify-self-center rounded-full ring-4",
                    STANCE_BG[stance]
                )}
            />
            <div className="min-w-0">{children}</div>
        </li>
    );
}

function SaidItem({ said, onJump }: { said: Said; onJump: (postId: string) => void }) {
    const t = useTranslations("scenarios.personSheet");
    const text =
        said.kind === "reply"
            ? said.comment.text
            : said.post.text.trim()
              ? said.post.text
              : (said.post.root?.text ?? "");
    const lead =
        said.kind === "reply"
            ? t("repliedTo", { handle: atHandle(said.post.authorHandle) })
            : said.post.kind === "repost"
              ? t("reposted", { handle: atHandle(said.post.root?.authorHandle ?? "") })
              : said.post.kind === "quote"
                ? t("quoted", { handle: atHandle(said.post.root?.authorHandle ?? "") })
                : null;
    return (
        <li className="border-line bg-panel rounded-lg border px-3 py-2.5">
            {lead && (
                <div className="text-ink-3 mb-1 inline-flex items-center gap-1 text-xs">
                    {said.kind === "post" && said.post.kind === "repost" && (
                        <Repeat2 className="size-3" aria-hidden />
                    )}
                    {lead}
                </div>
            )}
            <p className="text-ink line-clamp-4 text-[13.5px] leading-snug">{text}</p>
            <button
                type="button"
                onClick={() => onJump(said.post.id)}
                className="text-ink-3 hover:text-ink focus-visible:ring-brand/50 mt-1.5 inline-flex items-center gap-1 rounded-sm text-xs outline-none focus-visible:ring-2"
            >
                <CornerDownRight className="size-3" aria-hidden />
                {t("seeInFeed")}
            </button>
        </li>
    );
}

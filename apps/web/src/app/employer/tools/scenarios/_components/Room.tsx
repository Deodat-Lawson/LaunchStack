"use client";

import { ArrowDown, ArrowUp, CircleDot, Pause, Play, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "~/components/ui/button";
import { Slider } from "~/components/ui/slider";
import type { ScenarioDetail, ScenarioPerson } from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";
import { STANCE_BG, joinLabels, stanceLabel } from "~/lib/scenarios/words";

import {
    MAX_FACES,
    countsAt,
    movedIn,
    seatLayout,
    seatOrder,
    sidesOf,
    stanceAt,
    type RoomLayout,
} from "../_lib/room";
import { StanceKey } from "./Bits";
import { PersonHoverCard, Portrait } from "./Portrait";
import { PostRef } from "./PostRef";

/** One round a step when the room replays. */
const STEP_MS = 1150;

const SIDES = ["critical", "neutral", "supportive"] as const;
const SIDE_BG: Record<(typeof SIDES)[number], string> = {
    critical: "bg-danger",
    neutral: "bg-ink-4/40",
    supportive: "bg-info",
};

/** The box's width, kept current; 0 until it has been laid out. */
function useWidth<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        setWidth(el.clientWidth);
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(entries => {
            const w = entries[0]?.contentRect.width;
            if (w) setWidth(Math.round(w));
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    return [ref, width] as const;
}

/** The half-circle the seats stand on. */
function Band({ layout, pad }: { layout: RoomLayout; pad: number }) {
    const { cx, cy } = layout;
    const ro = layout.outer + layout.size / 2 + pad;
    const ri = Math.max(8, layout.inner - layout.size / 2 - pad);
    const foot = layout.size / 2 + 2;
    const d = [
        `M ${cx - ro} ${cy + foot}`,
        `L ${cx - ro} ${cy}`,
        `A ${ro} ${ro} 0 0 1 ${cx + ro} ${cy}`,
        `L ${cx + ro} ${cy + foot}`,
        `L ${cx + ri} ${cy + foot}`,
        `L ${cx + ri} ${cy}`,
        `A ${ri} ${ri} 0 0 0 ${cx - ri} ${cy}`,
        `L ${cx - ri} ${cy + foot}`,
        "Z",
    ].join(" ");
    return (
        <svg
            aria-hidden
            className="pointer-events-none absolute left-0 top-0"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
        >
            <path d={d} className="fill-panel-2 stroke-line-2" />
        </svg>
    );
}

/** What each person said in a round, first thing first: a post, else a reply. */
function saidIn(run: ScenarioDetail, round: number): Map<string, string> {
    const out = new Map<string, string>();
    for (const post of run.posts) {
        if (post.round === round && post.authorKind === "agent" && post.text.trim()) {
            if (!out.has(post.authorId)) out.set(post.authorId, post.text);
        }
    }
    for (const post of run.posts) {
        for (const c of post.comments) {
            if (c.round === round && !out.has(c.authorId)) out.set(c.authorId, c.text);
        }
    }
    return out;
}

const firstName = (p: ScenarioPerson) => p.name.split(" ")[0] ?? p.name;

/**
 * The Room: everyone in the run in a seat, critical on the left and
 * supportive on the right, ringed in the colour of where they stand. Pick a
 * round, or replay them, and people change seats as they change their minds;
 * an arrow marks who moved in that round. A face shows what they said then
 * and opens their profile. Arrow keys walk the seats. Big casts are drawn as
 * dots; the People tab lists everyone.
 */
export function Room({
    run,
    onPerson,
    onJump,
}: {
    run: ScenarioDetail;
    onPerson: (personId: string) => void;
    onJump: (postId: string) => void;
}) {
    const t = useTranslations("scenarios.room");
    const tw = useTranslations("scenarios.words");
    const tr = useTranslations("scenarios.report");
    const tp = useTranslations("scenarios.people");
    const people = run.people;
    const total = run.rounds;
    const done = Math.min(run.roundStats.length, total);

    const [round, setRound] = useState(done);
    const [following, setFollowing] = useState(true);
    const [playing, setPlaying] = useState(false);
    // While a run is live, the room keeps up with the latest round unless you picked one.
    useEffect(() => {
        if (following) setRound(done);
    }, [done, following]);
    useEffect(() => {
        if (!playing) return;
        if (round >= done) {
            setPlaying(false);
            setFollowing(true);
            return;
        }
        const timer = window.setTimeout(() => setRound(r => Math.min(done, r + 1)), STEP_MS);
        return () => window.clearTimeout(timer);
    }, [playing, round, done]);
    const pick = (r: number) => {
        setPlaying(false);
        setFollowing(r >= done);
        setRound(Math.max(0, Math.min(done, r)));
    };
    const replay = () => {
        if (playing) {
            setPlaying(false);
            return;
        }
        setFollowing(false);
        setRound(r => (r >= done ? 0 : r));
        setPlaying(true);
    };

    const [box, width] = useWidth<HTMLDivElement>();
    const narrow = width > 0 && width < 520;
    const pad = narrow ? 8 : 12;
    const seats = people.length > 0 ? people.length : run.agents;
    const layout = useMemo(
        () =>
            width > 0 && seats > 0
                ? seatLayout(seats, width, {
                      maxSize: narrow ? 36 : 50,
                      maxRadius: 270,
                      inset: pad,
                      top: pad,
                      // A face wears a ring and its offset (4px a side); dots need only air.
                      gap: seats <= MAX_FACES ? 12 : 2,
                  })
                : null,
        [width, seats, narrow, pad]
    );

    const order = useMemo(() => seatOrder(people, round), [people, round]);
    const sides = sidesOf(countsAt(people, round));
    const movers = useMemo(() => movedIn(people, round), [people, round]);
    const said = useMemo(() => saidIn(run, round), [run, round]);
    const turning = run.report?.turningPoints.find(p => p.round === round) ?? null;
    const events = run.injections.filter(i => i.round === round);
    const markers = useMemo(() => {
        const m = new Map<number, "event" | "turn">();
        for (const p of run.report?.turningPoints ?? []) m.set(p.round, "turn");
        for (const i of run.injections) if (i.round !== null) m.set(i.round, "event");
        return m;
    }, [run.report, run.injections]);
    const postById = useMemo(() => new Map(run.posts.map(p => [p.id, p])), [run.posts]);

    // At the end of a finished run the sides take the report's names for its camps.
    const final = round === total && run.status === "done" && run.report;
    const sideLabel = (side: (typeof SIDES)[number]) =>
        (final ? run.report?.factions.find(f => f.stance === side)?.label : undefined) ??
        tr(`faction.${side}`);

    // Roving focus: the room is one stop on Tab; arrow keys walk the seats.
    const [focusId, setFocusId] = useState<string | null>(null);
    const seatEls = useRef(new Map<string, HTMLButtonElement>());
    const activeId =
        focusId && order.some(p => p.id === focusId) ? focusId : (order[0]?.id ?? null);
    const onSeatKey = (e: KeyboardEvent) => {
        const i = order.findIndex(p => p.id === activeId);
        const step: Record<string, number> = {
            ArrowRight: 1,
            ArrowDown: 1,
            ArrowLeft: -1,
            ArrowUp: -1,
        };
        let next: number | null = null;
        if (e.key in step) next = (i + step[e.key]! + order.length) % order.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = order.length - 1;
        const target = next === null ? undefined : order[next];
        if (!target) return;
        e.preventDefault();
        const id = target.id;
        setFocusId(id);
        seatEls.current.get(id)?.focus();
    };

    const bowlInside = layout !== null && layout.rows > 1 && layout.inner - layout.size / 2 >= 64;
    const bowl = (
        <div className="flex flex-col items-center gap-0.5 text-center">
            <span className="text-ink-3 text-xs">
                {round === 0 ? t("atStart") : t("afterRound", { round })}
            </span>
            <span className="text-ink text-[30px] font-semibold leading-none tracking-[-0.03em]">
                {sides.supportive}
                <span className="text-ink-3 ml-1 text-[15px] font-medium tracking-normal">
                    {t("ofTotal", { total: people.length })}
                </span>
            </span>
            <span className="text-ink-2 text-[13px]">
                {final ? sideLabel("supportive") : t("supportive")}
            </span>
        </div>
    );
    const span = layout ? 2 * (layout.outer + pad) + layout.size : undefined;
    const stopsFit = width > 0 && total <= 15 && width / (total + 1) >= 30;

    return (
        <section
            aria-labelledby="scenario-room-title"
            className="border-line bg-panel @max-sm:px-3.5 @max-sm:pt-4 rounded-2xl border px-6 pb-5 pt-5"
        >
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <h2 id="scenario-room-title" className="text-ink text-[15px] font-semibold">
                    {t("title")}
                </h2>
                <StanceKey />
            </div>

            <div
                ref={box}
                role="group"
                aria-label={
                    people.length === 0
                        ? tp("building", { count: run.agents })
                        : t("summaryAria", {
                              round,
                              supportive: sides.supportive,
                              neutral: sides.neutral,
                              critical: sides.critical,
                          })
                }
                onKeyDown={onSeatKey}
                className="relative mt-2"
                style={{ height: layout?.height ?? 240 }}
            >
                {layout && <Band layout={layout} pad={pad} />}
                {layout && people.length === 0 && (
                    <>
                        {layout.seats.map((seat, i) => (
                            <span
                                key={i}
                                aria-hidden
                                className="border-line bg-panel absolute left-0 top-0 rounded-full border"
                                style={{
                                    width: layout.size,
                                    height: layout.size,
                                    transform: `translate(${seat.x - layout.size / 2}px, ${seat.y - layout.size / 2}px)`,
                                }}
                            />
                        ))}
                        <p
                            className="text-ink-3 absolute inset-x-0 text-center text-[13px]"
                            style={{ bottom: layout.height - layout.cy }}
                        >
                            {run.stage === "casting"
                                ? tp("building", { count: run.agents })
                                : tp("waitingForSources")}
                        </p>
                    </>
                )}
                {layout &&
                    !layout.faces &&
                    order.map((p, i) => {
                        const seat = layout.seats[i];
                        if (!seat) return null;
                        return (
                            <span
                                key={p.id}
                                aria-hidden
                                className={cn(
                                    "absolute left-0 top-0 rounded-full transition-transform duration-[640ms] ease-[cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none",
                                    STANCE_BG[stanceAt(p, round)]
                                )}
                                style={{
                                    width: layout.size - 2,
                                    height: layout.size - 2,
                                    transform: `translate(${seat.x - layout.size / 2 + 1}px, ${seat.y - layout.size / 2 + 1}px)`,
                                }}
                            />
                        );
                    })}
                {layout &&
                    layout.faces &&
                    order.map((p, i) => {
                        const seat = layout.seats[i];
                        if (!seat) return null;
                        const s = layout.size;
                        const stance = stanceAt(p, round);
                        const before = round > 0 ? stanceAt(p, round - 1) : stance;
                        const moved = stance !== before;
                        return (
                            <PersonHoverCard
                                key={p.id}
                                person={p}
                                at={{ round, stance, said: said.get(p.id) ?? null }}
                            >
                                <button
                                    ref={el => {
                                        if (el) seatEls.current.set(p.id, el);
                                        else seatEls.current.delete(p.id);
                                    }}
                                    type="button"
                                    tabIndex={p.id === activeId ? 0 : -1}
                                    onFocus={() => setFocusId(p.id)}
                                    onClick={() => onPerson(p.id)}
                                    aria-label={
                                        round === 0
                                            ? t("seatAtStart", {
                                                  name: p.name,
                                                  stance: stanceLabel(tw, stance),
                                              })
                                            : t("seatAria", {
                                                  name: p.name,
                                                  stance: stanceLabel(tw, stance),
                                                  round,
                                              })
                                    }
                                    className="focus-visible:ring-brand/60 focus-visible:ring-offset-panel absolute left-0 top-0 rounded-full outline-none transition-transform duration-[640ms] ease-[cubic-bezier(0.77,0,0.175,1)] focus-visible:ring-2 focus-visible:ring-offset-[5px] motion-reduce:transition-none"
                                    style={{
                                        width: s,
                                        height: s,
                                        transform: `translate(${seat.x - s / 2}px, ${seat.y - s / 2}px)`,
                                    }}
                                >
                                    <Portrait
                                        handle={p.handle}
                                        size={s}
                                        stance={stance}
                                        className="transition-shadow duration-300"
                                    />
                                    {moved && (
                                        <span
                                            aria-hidden
                                            className={cn(
                                                "ring-panel absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-full ring-2",
                                                stance > before
                                                    ? "bg-info-soft text-info-ink"
                                                    : "bg-danger-soft text-danger-ink"
                                            )}
                                        >
                                            {stance > before ? (
                                                <ArrowUp className="size-3" strokeWidth={2.75} />
                                            ) : (
                                                <ArrowDown className="size-3" strokeWidth={2.75} />
                                            )}
                                        </span>
                                    )}
                                </button>
                            </PersonHoverCard>
                        );
                    })}
                {layout && bowlInside && people.length > 0 && (
                    <div
                        className="pointer-events-none absolute left-1/2 -translate-x-1/2"
                        style={{ bottom: layout.height - layout.cy + 2 }}
                    >
                        {bowl}
                    </div>
                )}
            </div>

            {people.length > 0 && (
                <>
                    {!bowlInside && <div className="mt-3">{bowl}</div>}
                    <div className="mx-auto mt-3 grid grid-cols-3 gap-3" style={{ maxWidth: span }}>
                        {SIDES.map((side, i) => (
                            <div
                                key={side}
                                className={cn(
                                    "flex min-w-0 flex-col gap-0.5",
                                    i === 1 && "items-center text-center",
                                    i === 2 && "items-end text-right"
                                )}
                            >
                                <span className="text-ink inline-flex items-center gap-2 text-[20px] font-semibold tabular-nums tracking-[-0.02em]">
                                    {i === 2 && sides[side]}
                                    <span
                                        aria-hidden
                                        className={cn("size-2.5 rounded-[3px]", SIDE_BG[side])}
                                    />
                                    {i !== 2 && sides[side]}
                                </span>
                                <span className="text-ink-2 text-[13px] leading-snug">
                                    {sideLabel(side)}
                                </span>
                            </div>
                        ))}
                    </div>

                    <div className="border-line-2 @max-sm:grid-cols-1 mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 border-t pt-4">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={replay}
                            disabled={done === 0}
                            className="@max-sm:justify-self-start min-w-[104px]"
                            aria-label={playing ? t("pauseAria") : t("replayAria")}
                        >
                            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
                            {playing ? t("pause") : t("replay")}
                        </Button>
                        {stopsFit ? (
                            <div
                                role="group"
                                aria-label={t("scrubLabel")}
                                className="relative grid"
                                style={{
                                    gridTemplateColumns: `repeat(${total + 1}, minmax(0, 1fr))`,
                                }}
                            >
                                <span
                                    aria-hidden
                                    className="bg-line absolute bottom-[27px] h-0.5 rounded-full"
                                    style={{
                                        left: `${50 / (total + 1)}%`,
                                        right: `${50 / (total + 1)}%`,
                                    }}
                                />
                                <span
                                    aria-hidden
                                    className="bg-brand absolute bottom-[27px] h-0.5 rounded-full transition-[width] duration-[640ms] ease-[cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none"
                                    style={{
                                        left: `${50 / (total + 1)}%`,
                                        width: `${(round / Math.max(1, total)) * (100 - 100 / (total + 1))}%`,
                                    }}
                                />
                                {Array.from({ length: total + 1 }, (_, r) => {
                                    const future = r > done;
                                    const mark = markers.get(r);
                                    return (
                                        <button
                                            key={r}
                                            type="button"
                                            disabled={future}
                                            aria-pressed={r === round}
                                            aria-label={
                                                future
                                                    ? t("notYet", { round: r })
                                                    : r === 0
                                                      ? t("atStart")
                                                      : t("round", { round: r })
                                            }
                                            onClick={() => pick(r)}
                                            className="group flex flex-col items-center gap-1.5 pt-0.5 outline-none disabled:cursor-not-allowed"
                                        >
                                            <span aria-hidden className="flex h-4 items-center">
                                                {mark === "event" ? (
                                                    <Zap className="text-warn-ink size-3.5" />
                                                ) : mark === "turn" ? (
                                                    <CircleDot className="text-brand-ink size-3.5" />
                                                ) : null}
                                            </span>
                                            <span
                                                aria-hidden
                                                className={cn(
                                                    "group-focus-visible:ring-brand/50 relative z-[1] size-3 rounded-full border-2 transition-colors group-focus-visible:ring-2 group-focus-visible:ring-offset-2",
                                                    r === round
                                                        ? "border-brand bg-brand ring-brand-soft ring-4"
                                                        : r < round
                                                          ? "border-brand bg-panel"
                                                          : future
                                                            ? "border-line bg-panel-2"
                                                            : "border-line bg-panel group-hover:border-ink-4"
                                                )}
                                            />
                                            <span
                                                className={cn(
                                                    "text-xs tabular-nums",
                                                    r === round
                                                        ? "text-ink font-semibold"
                                                        : future
                                                          ? "text-ink-4"
                                                          : "text-ink-3"
                                                )}
                                            >
                                                {r === 0 ? t("start") : r}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                <Slider
                                    min={0}
                                    max={Math.max(1, total)}
                                    step={1}
                                    value={[round]}
                                    onValueChange={([v]) => pick(v ?? 0)}
                                    disabled={done === 0}
                                    thumbLabel={t("scrubLabel")}
                                    aria-valuetext={
                                        round === 0 ? t("atStart") : t("round", { round })
                                    }
                                />
                                <div className="text-ink-3 flex justify-between text-xs tabular-nums">
                                    <span>{t("start")}</span>
                                    <span>{t("round", { round: total })}</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div
                        className="text-ink-2 mt-3 min-h-10 max-w-[80ch] text-[13.5px] leading-relaxed"
                        aria-live="polite"
                    >
                        <span className="text-ink font-semibold">
                            {round === 0 ? t("captionStart") : t("captionRound", { round })}
                        </span>{" "}
                        {events.map(e => (
                            <span key={e.id}>{t("captionEvent", { text: e.text })} </span>
                        ))}
                        {turning
                            ? `${turning.text} `
                            : round === 0
                              ? `${t("captionStartCounts", { neutral: sides.neutral, total: people.length })} `
                              : `${t("captionCounts", { supportive: sides.supportive, neutral: sides.neutral, critical: sides.critical })} `}
                        {round > 0 &&
                            (movers.length > 0
                                ? t("captionMoved", {
                                      names: joinLabels(tw, movers.map(firstName)),
                                  })
                                : t("captionNobody"))}
                        {turning && turning.postIds.length > 0 && (
                            <span className="mt-2 flex flex-wrap gap-1.5">
                                {turning.postIds.map(id => (
                                    <PostRef key={id} post={postById.get(id)} onJump={onJump} />
                                ))}
                            </span>
                        )}
                    </div>
                </>
            )}
        </section>
    );
}

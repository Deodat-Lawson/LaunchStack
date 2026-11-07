"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronRight, Minus } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import type { ChatTurnStep } from "~/lib/chat-turns";
import { ChatMarkdown } from "./ChatMarkdown";
import { closeOpenMarkdown } from "./smoothText";
import { currentStep, durationParts, thoughtParts, type DurationParts } from "./turnTrace";
import type { ThreadMessage } from "./types";

/** Ticks once a second while `on`, so live durations move. */
function useNow(on: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!on) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [on]);
    return now;
}

type TraceWords = ReturnType<typeof useTranslations<"chat.trace">>;

/** A step's own words, or, where a shared chat left them out, its kind's. */
function stepLabel(step: ChatTurnStep, t: TraceWords): string {
    if (step.label) return step.label;
    if (step.id === "search") return t("generic.search");
    if (step.id.startsWith("web-")) return t("generic.web");
    if (step.id.startsWith("doc-")) return t("generic.doc");
    if (step.id.startsWith("source-")) return t("generic.source");
    return t("generic.step");
}

function spell(parts: DurationParts, t: TraceWords): string {
    return parts.minutes === undefined
        ? t("seconds", { seconds: parts.seconds })
        : t("minutes", { minutes: parts.minutes, seconds: parts.seconds });
}

function headline(msg: ThreadMessage, liveMs: number | undefined, t: TraceWords): string {
    const streaming = msg.status === "streaming";
    if (streaming && !msg.text) {
        const working = currentStep(msg.steps);
        return working ? stepLabel(working, t) : t("thinking");
    }
    // A turn saved without timings says what happened, not a made-up "1s".
    const ended = msg.elapsedMs ?? msg.thoughtMs;
    if (msg.status === "stopped")
        return ended === undefined
            ? t("stopped")
            : t("stoppedAfter", { duration: spell(thoughtParts(ended), t) });
    if (msg.status === "error")
        return ended === undefined
            ? t("failed")
            : t("failedAfter", { duration: spell(thoughtParts(ended), t) });
    const waited = msg.thoughtMs ?? msg.elapsedMs ?? liveMs;
    return waited === undefined
        ? t("thoughtProcess")
        : t("thoughtFor", { duration: spell(thoughtParts(waited), t) });
}

/** Follows new reasoning text down unless the reader scrolled up to reread. */
function ReasoningText({ text, live }: { text: string; live: boolean }) {
    const box = useRef<HTMLDivElement>(null);
    const pinned = useRef(true);
    useLayoutEffect(() => {
        const el = box.current;
        if (el && live && pinned.current) el.scrollTop = el.scrollHeight;
    }, [text, live]);
    return (
        <div
            ref={box}
            data-testid="trace-reasoning"
            onScroll={e => {
                const el = e.currentTarget;
                pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
            className="border-line text-ink-3 my-1.5 max-h-64 overflow-y-auto border-l pl-3"
        >
            <ChatMarkdown
                text={live ? closeOpenMarkdown(text) : text}
                className="text-[13px] leading-[1.6]"
            />
        </div>
    );
}

function StepRow({
    step,
    live,
    now,
    startedAt,
    last,
    children,
}: {
    step: ChatTurnStep;
    live: boolean;
    now: number;
    startedAt: number | undefined;
    last: boolean;
    children?: React.ReactNode;
}) {
    const t = useTranslations("chat.trace");
    const running = step.state === "active" && live;
    const interrupted = step.state === "active" && !live;
    const duration =
        step.endMs !== undefined && step.startMs !== undefined
            ? step.endMs - step.startMs
            : running && step.startMs !== undefined && startedAt !== undefined
              ? now - startedAt - step.startMs
              : undefined;
    return (
        <li className="relative flex gap-2.5" data-step={step.id} data-state={step.state}>
            <div className="flex w-4 shrink-0 flex-col items-center">
                <span className="flex size-4 items-center justify-center pt-[3px]">
                    {running ? (
                        <Spinner role="presentation" aria-hidden className="text-brand size-3.5" />
                    ) : interrupted ? (
                        <Minus className="text-ink-4 size-3.5" aria-hidden />
                    ) : (
                        <Check className="text-ink-3 size-3.5" aria-hidden />
                    )}
                </span>
                {!last && <span aria-hidden className="bg-line mt-1 w-px flex-1" />}
            </div>
            <div className={cn("min-w-0 flex-1", last ? "pb-0.5" : "pb-3")}>
                <div className="flex items-baseline gap-3">
                    <span className={cn("min-w-0 flex-1", running ? "text-ink" : "text-ink-2")}>
                        {stepLabel(step, t)}
                    </span>
                    {duration !== undefined && duration >= 100 && (
                        <span className="mono text-ink-4 shrink-0 text-[11px] tabular-nums">
                            {spell(durationParts(duration), t)}
                        </span>
                    )}
                </div>
                {step.detail && (
                    <p className="text-ink-3 m-0 mt-0.5 text-[12px] leading-snug">{step.detail}</p>
                )}
                {children}
            </div>
        </li>
    );
}

/**
 * How the answer got there, the way ChatGPT and Claude show it: open while the
 * answer works (each step as it happens, the model's own reasoning when it
 * shares any), folded to "Thought for 4s" once the first word arrives. The
 * reader's own open/close wins over the automatic one.
 */
export function ThinkingTrace({ msg }: { msg: ThreadMessage }) {
    const t = useTranslations("chat.trace");
    const live = msg.status === "streaming";
    const steps = msg.steps ?? [];
    const reasoning = msg.reasoning?.trim() ? msg.reasoning : "";
    const [userOpen, setUserOpen] = useState<boolean | null>(null);
    const now = useNow(live);
    const bodyId = useId();
    const startedAt = msg.createdAt ? Date.parse(msg.createdAt) : undefined;
    const liveMs =
        live && startedAt !== undefined && Number.isFinite(startedAt)
            ? Math.max(0, now - startedAt)
            : undefined;

    const working = live && !msg.text;
    const open = userOpen ?? working;
    const thinkIndex = steps.findIndex(step => step.id === "think");
    const usage = [
        typeof msg.tokens === "number" ? t("tokens", { count: msg.tokens }) : null,
        typeof msg.chunksAnalyzed === "number" && msg.chunksAnalyzed > 0
            ? t("passagesRead", { count: msg.chunksAnalyzed })
            : null,
    ].filter(Boolean);
    // A stored answer with no steps or reasoning (older turns, a non-streamed
    // reply) gets no trace; a stopped one still says it stopped.
    if (!live && steps.length === 0 && !reasoning) {
        return msg.status === "stopped" ? (
            <p className="text-ink-3 m-0 mb-3 text-[13px]">{headline(msg, liveMs, t)}</p>
        ) : null;
    }

    return (
        <Collapsible
            open={open}
            onOpenChange={setUserOpen}
            className="mb-3"
            data-testid="thinking-trace"
            data-working={working ? "true" : "false"}
        >
            <CollapsibleTrigger
                aria-controls={bodyId}
                className="text-ink-3 hover:text-ink-2 group -mx-1 flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-[13px] focus-visible:outline"
            >
                <span
                    aria-live={live ? "polite" : undefined}
                    className={cn("truncate", working && "lsw-thinking-label")}
                >
                    {headline(msg, liveMs, t)}
                </span>
                {working && liveMs !== undefined && liveMs >= 1000 && (
                    <span className="mono text-ink-4 shrink-0 text-[11px] tabular-nums">
                        {spell(thoughtParts(liveMs), t)}
                    </span>
                )}
                <ChevronRight
                    aria-hidden
                    className="size-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-90"
                />
            </CollapsibleTrigger>
            <CollapsibleContent id={bodyId} className="pt-2 text-[13px]">
                {steps.length > 0 && (
                    <ol className="m-0 list-none p-0" aria-label={t("stepsLabel")}>
                        {steps.map((step, i) => (
                            <StepRow
                                key={step.id}
                                step={step}
                                live={live}
                                now={now}
                                startedAt={startedAt}
                                last={i === steps.length - 1}
                            >
                                {i === thinkIndex && reasoning ? (
                                    <ReasoningText text={reasoning} live={live} />
                                ) : null}
                            </StepRow>
                        ))}
                    </ol>
                )}
                {reasoning && thinkIndex < 0 && <ReasoningText text={reasoning} live={live} />}
                {!live && usage.length > 0 && (
                    <p
                        className="mono text-ink-4 m-0 mt-2 text-[11px]"
                        title={
                            msg.tokenBreakdown
                                ? t("tokenBreakdown", {
                                      input: msg.tokenBreakdown.inputTokens,
                                      output: msg.tokenBreakdown.outputTokens,
                                  })
                                : undefined
                        }
                    >
                        {usage.join(" · ")}
                    </p>
                )}
            </CollapsibleContent>
        </Collapsible>
    );
}

/** The pending turn before an answer exists (a send that hasn't reached the runtime). */
export function PendingTrace() {
    const t = useTranslations("chat.trace");
    return (
        <div role="status" className="text-ink-3 mb-7 text-[13px]">
            <span className="lsw-thinking-label">{t("thinking")}</span>
        </div>
    );
}

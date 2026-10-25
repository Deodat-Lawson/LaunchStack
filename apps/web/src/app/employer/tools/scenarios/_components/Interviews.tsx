"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import {
    SCENARIO_LIMITS,
    type ScenarioDetail,
    type ScenarioInterview,
} from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";
import { useErrorText } from "~/lib/tools/errorText";

import { ANALYST_ID } from "../api";

export type InterviewsT = ReturnType<typeof useTranslations<"scenarios.interviews">>;

/** Why nobody can be asked yet, or null when they can. */
export function askBlockedReason(t: InterviewsT, run: ScenarioDetail): string | null {
    if (run.round >= 1) return null;
    if (run.status === "failed" || run.status === "cancelled") return t("blockedStopped");
    return t("blockedWaiting");
}

/** Questions asked and their answers, oldest first; `answerer` puts a face beside each answer. */
export function InterviewThread({
    interviews,
    answererName,
    answerer,
}: {
    interviews: ScenarioInterview[];
    answererName: (agentId: string) => string;
    answerer?: (agentId: string) => ReactNode;
}) {
    const t = useTranslations("scenarios.interviews");
    const format = useFormatter();
    const now = useNow();
    if (interviews.length === 0) return null;
    return (
        <ol className="flex flex-col gap-4">
            {interviews.map(item => (
                <li key={item.id} className="flex flex-col gap-1.5">
                    <div className="bg-panel-2 text-ink self-end rounded-lg px-3 py-2 text-[13px] leading-snug">
                        {item.question}
                    </div>
                    <div className="flex max-w-[72ch] items-start gap-2.5">
                        {answerer?.(item.agentId)}
                        <div className="min-w-0">
                            <div className="text-ink-3 text-xs">
                                {t("answeredBy", {
                                    name: answererName(item.agentId),
                                    when: format.relativeTime(new Date(item.createdAt), now),
                                })}
                            </div>
                            <p className="text-ink-2 mt-0.5 whitespace-pre-wrap text-[13.5px] leading-relaxed">
                                {item.answer}
                            </p>
                        </div>
                    </div>
                </li>
            ))}
        </ol>
    );
}

/** One question to one person (or the analyst). */
export function AskBox({
    agentId,
    blocked,
    onAsk,
    placeholder,
}: {
    agentId: string;
    blocked: string | null;
    onAsk: (agentId: string, question: string) => Promise<void>;
    placeholder?: string;
}) {
    const errorText = useErrorText();
    const t = useTranslations("scenarios.interviews");
    const [question, setQuestion] = useState("");
    const [asking, setAsking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const max = SCENARIO_LIMITS.questionMax;
    const ask = async () => {
        setAsking(true);
        setError(null);
        try {
            await onAsk(agentId, question.trim());
            setQuestion("");
        } catch (e) {
            setError(errorText(e, t("askError")));
        } finally {
            setAsking(false);
        }
    };
    const id = `scenario-ask-${agentId}`;
    return (
        <div className="flex flex-col gap-2">
            <Textarea
                id={id}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && question.trim()) {
                        e.preventDefault();
                        void ask();
                    }
                }}
                rows={2}
                maxLength={max}
                disabled={Boolean(blocked) || asking}
                aria-label={t("questionLabel")}
                placeholder={
                    placeholder ??
                    (agentId === ANALYST_ID ? t("placeholderAnalyst") : t("placeholderPerson"))
                }
                className="text-[13px]"
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(blocked) || asking || !question.trim()}
                    onClick={() => void ask()}
                >
                    {asking && <Spinner className="size-3.5 motion-reduce:animate-none" />}
                    {asking ? t("asking") : t("ask")}
                </Button>
                <span
                    className={cn("text-ink-3 text-xs", error && "text-danger")}
                    role={error ? "alert" : undefined}
                >
                    {error ??
                        blocked ??
                        (agentId === ANALYST_ID ? t("hintAnalyst") : t("hintPerson"))}
                </span>
            </div>
        </div>
    );
}

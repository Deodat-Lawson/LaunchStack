"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import {
    SCENARIO_LIMITS,
    type ScenarioDetail,
    type ScenarioInterview,
} from "~/lib/scenarios/types";
import { relativeTime } from "~/lib/tools/format";
import { cn } from "~/lib/utils";

import { ANALYST_ID } from "../api";

/** Why nobody can be asked yet, or null when they can. */
export function askBlockedReason(run: ScenarioDetail): string | null {
    if (run.round >= 1) return null;
    if (run.status === "failed" || run.status === "cancelled")
        return "This scenario stopped before the first round finished, so there is nobody to ask.";
    return "People can answer once the first round has finished.";
}

/** Questions asked and their answers, oldest first. */
export function InterviewThread({
    interviews,
    answererName,
}: {
    interviews: ScenarioInterview[];
    answererName: (agentId: string) => string;
}) {
    if (interviews.length === 0) return null;
    return (
        <ol className="flex flex-col gap-4">
            {interviews.map(item => (
                <li key={item.id} className="flex flex-col gap-1.5">
                    <div className="bg-panel-2 text-ink self-end rounded-lg px-3 py-2 text-[13px] leading-snug">
                        {item.question}
                    </div>
                    <div className="max-w-[72ch]">
                        <div className="text-ink-3 text-xs">
                            {answererName(item.agentId)} · {relativeTime(item.createdAt)}
                        </div>
                        <p className="text-ink-2 mt-0.5 whitespace-pre-wrap text-[13.5px] leading-relaxed">
                            {item.answer}
                        </p>
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
            setError(e instanceof Error ? e.message : "Could not ask that");
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
                aria-label="Your question"
                placeholder={
                    placeholder ??
                    (agentId === ANALYST_ID
                        ? "Why did the critics soften after round 4?"
                        : "What would change your mind?")
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
                    {asking ? "Asking…" : "Ask"}
                </Button>
                <span
                    className={cn("text-ink-3 text-xs", error && "text-danger")}
                    role={error ? "alert" : undefined}
                >
                    {error ??
                        blocked ??
                        (agentId === ANALYST_ID
                            ? "The analyst has read the whole run and answers about all of it."
                            : "They answer in character, from what they saw in the run.")}
                </span>
            </div>
        </div>
    );
}

"use client";

import { useState } from "react";

import { Label } from "~/components/ui/label";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import type { ScenarioDetail, ScenarioInterview } from "~/lib/scenarios/types";

import { ANALYST_ID } from "../api";
import { AskBox, InterviewThread, askBlockedReason } from "./Interviews";

/**
 * Interview anyone in the run, or the analyst, who has read all of it.
 * Each person keeps their own thread; nobody can answer before the first
 * round has finished.
 */
export function AskTab({
    run,
    interviews,
    interviewsError,
    onAsk,
}: {
    run: ScenarioDetail;
    interviews: ScenarioInterview[];
    interviewsError: string | null;
    onAsk: (agentId: string, question: string) => Promise<void>;
}) {
    const [agentId, setAgentId] = useState<string>(ANALYST_ID);
    const blocked = askBlockedReason(run);
    const people = [...run.people].sort((a, b) => a.name.localeCompare(b.name));
    const nameOf = (id: string) =>
        id === ANALYST_ID ? "The analyst" : (run.people.find(p => p.id === id)?.name ?? "Someone");
    const thread = interviews.filter(i => i.agentId === agentId);
    const asked = new Set(interviews.map(i => i.agentId));

    return (
        <div className="flex max-w-[760px] flex-col gap-5">
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="scenario-ask-who" className="text-ink-2 text-[13px] font-normal">
                    Ask
                </Label>
                <Select value={agentId} onValueChange={setAgentId} disabled={Boolean(blocked)}>
                    <SelectTrigger
                        id="scenario-ask-who"
                        className="h-9 w-full max-w-[360px] text-[13px]"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANALYST_ID}>
                            The analyst{asked.has(ANALYST_ID) ? " · asked" : ""}
                        </SelectItem>
                        {people.length > 0 && (
                            <SelectGroup>
                                <SelectLabel className="text-ink-3 text-xs">People</SelectLabel>
                                {people.map(p => (
                                    <SelectItem key={p.id} value={p.id}>
                                        {p.name} — {p.role}
                                        {asked.has(p.id) ? " · asked" : ""}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        )}
                    </SelectContent>
                </Select>
                <p className="text-ink-3 text-xs">
                    {agentId === ANALYST_ID
                        ? "Questions about the whole run: why something happened, who moved, what would have changed it."
                        : "Questions to one person, who answers from what they saw and posted."}
                </p>
            </div>

            {interviewsError && <p className="text-danger text-xs">{interviewsError}</p>}
            <InterviewThread interviews={thread} answererName={nameOf} />
            <AskBox key={agentId} agentId={agentId} blocked={blocked} onAsk={onAsk} />
        </div>
    );
}

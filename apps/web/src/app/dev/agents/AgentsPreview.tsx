"use client";

import { useEffect, useMemo, useState } from "react";

import { AgentsPane } from "~/app/employer/documents/_workspace/collab/AgentsPane";

import { CollabSimulator, installCollabStub } from "../meetings/simulator";

/**
 * The Agents app over the same simulation: the ten starter agents, the
 * editor (form and file views), import/export, and a playground that
 * answers from each agent's script.
 */
export function AgentsPreview() {
    const sim = useMemo(() => new CollabSimulator(), []);
    const [ready, setReady] = useState(false);
    const [last, setLast] = useState<string | null>(null);
    useEffect(() => {
        const restore = installCollabStub(sim);
        setReady(true);
        return restore;
    }, [sim]);
    if (!ready) return null;
    return (
        <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
            {last && (
                <div
                    className="bg-brand-soft text-brand-ink px-4 py-1.5 text-[12px]"
                    data-testid="last-handoff"
                >
                    {last}
                </div>
            )}
            <div style={{ flex: 1, minHeight: 0 }}>
                <AgentsPane
                    onUseInChat={key => setLast(`Would pick @${key} in the chat composer`)}
                    onStartMeeting={key => setLast(`Would open a new meeting with @${key} seated`)}
                />
            </div>
        </div>
    );
}

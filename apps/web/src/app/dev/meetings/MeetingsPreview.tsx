"use client";

import { useEffect, useMemo, useState } from "react";

import { MeetingsPane } from "~/app/employer/documents/_workspace/collab/MeetingsPane";

import { CollabSimulator, installCollabStub } from "./simulator";

/**
 * The Meetings app over a browser-side simulation of `/api/collab/**`: the
 * dashboard with two seeded meetings (one ended, one live), every workflow
 * card, and a room you can run, pause, take over and read minutes from.
 * `?empty=1` starts with no meetings.
 */
export function MeetingsPreview() {
    const sim = useMemo(() => new CollabSimulator(), []);
    const [ready, setReady] = useState(false);
    useEffect(() => {
        const flags = new URLSearchParams(window.location.search);
        const restore = installCollabStub(sim, { seedMeetings: flags.get("empty") !== "1" });
        setReady(true);
        return restore;
    }, [sim]);
    if (!ready) return null;
    return (
        <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
            <MeetingsPane
                embedded
                onOpenAgents={() => window.alert("Would open Studio → Agents")}
            />
        </div>
    );
}

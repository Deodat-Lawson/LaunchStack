"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
    CALL_NOTES_SCHEMA_VERSION,
    CallSnapshotSchema,
    DetectedCallCandidateSchema,
    type CallSnapshot,
    type DetectedCallCandidate,
} from "@launchstack/features/call-notes";

import { CallsWorkspace } from "./CallsWorkspace";

export function CallsFeature() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [calls, setCalls] = useState<CallSnapshot[]>([]);
    const [candidates, setCandidates] = useState<DetectedCallCandidate[]>([]);
    const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

    const loadCalls = useCallback(async () => {
        try {
            const [callsResponse, detectedResponse] = await Promise.all([
                fetch("/api/call-notes", { cache: "no-store" }),
                fetch("/api/call-notes/detected", { cache: "no-store" }),
            ]);
            if (!callsResponse.ok || !detectedResponse.ok) {
                throw new Error("Calls or detected Calls request failed");
            }
            setCalls(CallSnapshotSchema.array().parse(await callsResponse.json()));
            setCandidates(DetectedCallCandidateSchema.array().parse(await detectedResponse.json()));
            setStatus("ready");
        } catch {
            setStatus("failed");
        }
    }, []);

    const startDetectedCall = useCallback(
        async (candidate: DetectedCallCandidate) => {
            const response = await fetch("/api/call-notes", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
                    requestId: crypto.randomUUID(),
                    kind: "start_capture",
                    provider: "zoom",
                    occurrenceKey: candidate.occurrenceKey,
                    title: candidate.title,
                }),
            });
            if (!response.ok) {
                setStatus("failed");
                return;
            }
            const snapshot = CallSnapshotSchema.parse(await response.json());
            await loadCalls();
            const next = new URLSearchParams(searchParams.toString());
            next.set("feature", "calls");
            next.set("call", snapshot.id);
            router.replace(`${pathname}?${next.toString()}`);
        },
        [loadCalls, pathname, router, searchParams]
    );

    useEffect(() => {
        void loadCalls();
        const interval = window.setInterval(() => void loadCalls(), 2_000);
        return () => window.clearInterval(interval);
    }, [loadCalls]);

    if (status === "loading") {
        return <div role="status">Loading Calls…</div>;
    }
    if (status === "failed") {
        return (
            <section aria-label="Calls unavailable">
                <h2>Calls are unavailable</h2>
                <p>Connect Zoom or retry after the Call Notes services are configured.</p>
                <a href="/api/call-notes/zoom/connect">Connect Zoom</a>
                <button type="button" onClick={() => void loadCalls()}>
                    Retry
                </button>
            </section>
        );
    }
    if (calls.length === 0) {
        return (
            <section aria-label="No calls">
                <h2>{candidates.length > 0 ? "Meeting detected" : "No calls yet"}</h2>
                <p>
                    Connect Zoom and join a disclosed meeting. Capture starts only after you confirm
                    it here.
                </p>
                <a href="/api/call-notes/zoom/connect">Connect Zoom</a>
                {candidates.map(candidate => (
                    <button
                        key={candidate.occurrenceKey}
                        type="button"
                        onClick={() => void startDetectedCall(candidate)}
                    >
                        Start {candidate.title}
                    </button>
                ))}
            </section>
        );
    }

    return (
        <CallsWorkspace
            calls={calls}
            initialSelectedId={searchParams.get("call")}
            onSelectCall={callId => {
                const next = new URLSearchParams(searchParams.toString());
                next.set("feature", "calls");
                next.set("call", callId);
                router.replace(`${pathname}?${next.toString()}`);
            }}
        />
    );
}

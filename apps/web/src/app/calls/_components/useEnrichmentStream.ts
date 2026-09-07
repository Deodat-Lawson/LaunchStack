"use client";

import { useEffect, useState } from "react";
import type { CallSnapshot } from "@launchstack/features/call-notes/contracts";
import {
    EnrichmentStreamEventSchema,
    type EnrichmentPreviewState,
} from "~/lib/call-notes-enrichment-stream";

/** Observe the selected run; generation continues independently of this view. */
export function useEnrichmentStream(
    snapshot: CallSnapshot | undefined,
    requestPending: boolean,
    onSnapshot: (snapshot: CallSnapshot) => void
): EnrichmentPreviewState | undefined {
    const [preview, setPreview] = useState<EnrichmentPreviewState>();
    const callId = snapshot?.id;
    const visible = snapshot?.note != null;
    const run = snapshot?.enrichment;
    const runId = run?.id;
    const active = run?.status === "queued" || run?.status === "generating";

    useEffect(() => {
        if (!visible || !active || !callId || !runId) {
            setPreview(undefined);
            return;
        }
        let listening = true;
        const source = new EventSource(
            `/api/call-notes/${encodeURIComponent(callId)}/enrichment/stream?run=${encodeURIComponent(runId)}`
        );
        const interrupted = (message: string) => {
            if (!listening) return;
            setPreview(previous => ({
                callId,
                runId,
                status: previous?.runId === runId ? previous.status : "queued",
                markdown: previous?.runId === runId ? previous.markdown : "",
                error: message,
            }));
        };
        source.onmessage = event => {
            if (!listening) return;
            let body: unknown;
            try {
                body = JSON.parse(event.data as string);
            } catch {
                interrupted(
                    "Live preview could not be read. The saved proposal will appear when ready."
                );
                return;
            }
            const result = EnrichmentStreamEventSchema.safeParse(body);
            if (!result.success) {
                interrupted(
                    "Live preview could not be read. The saved proposal will appear when ready."
                );
                return;
            }
            const message = result.data;
            if (message.type === "progress") {
                if (message.runId !== runId) return;
                setPreview(previous =>
                    previous?.runId === runId &&
                    previous.markdown === message.markdown &&
                    previous.status === message.status &&
                    !previous.error
                        ? previous
                        : { callId, runId, status: message.status, markdown: message.markdown }
                );
            } else if (message.type === "complete") {
                if (message.snapshot.id !== callId || message.snapshot.enrichment?.id !== runId)
                    return;
                listening = false;
                source.close();
                setPreview(undefined);
                onSnapshot(message.snapshot);
            } else {
                interrupted(message.message);
                listening = false;
                source.close();
            }
        };
        source.onerror = () => {
            interrupted("Live preview interrupted. The saved proposal will appear when ready.");
            // EventSource reconnects automatically and the server replays the
            // latest persisted preview, without starting another generation.
        };
        return () => {
            listening = false;
            source.close();
        };
    }, [callId, runId, visible, active, onSnapshot]);

    if (!visible || !callId) return undefined;
    if (active && run) {
        const current =
            preview?.callId === callId && preview.runId === run.id ? preview : undefined;
        return {
            callId,
            runId: run.id,
            status:
                current?.status === "generating" || run.status === "generating"
                    ? "generating"
                    : "queued",
            markdown: current?.markdown ?? "",
            error: current?.error,
        };
    }
    if (requestPending && run?.status !== "ready") {
        return { callId, runId: null, status: "queued", markdown: "" };
    }
    return undefined;
}

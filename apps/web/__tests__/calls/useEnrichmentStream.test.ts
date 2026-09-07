/** @jest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import type { CallSnapshot } from "@launchstack/features/call-notes/contracts";
import { enrichmentReadyCall } from "~/app/calls/_fixtures/callSnapshots";
import { useEnrichmentStream } from "~/app/calls/_components/useEnrichmentStream";

const ready = enrichmentReadyCall;
const generating: CallSnapshot = {
    ...ready,
    enrichment: {
        ...ready.enrichment!,
        status: "generating",
        proposal: null,
        modelMetadata: null,
        resolvedAt: null,
    },
};

class PreviewSource {
    static instances: PreviewSource[] = [];
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    closed = false;
    constructor(readonly url: string) {
        PreviewSource.instances.push(this);
    }
    close() {
        this.closed = true;
    }
    emit(data: unknown) {
        this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
    }
}

const originalSource = global.EventSource;
beforeEach(() => {
    PreviewSource.instances = [];
    global.EventSource = PreviewSource as unknown as typeof EventSource;
});
afterEach(() => {
    global.EventSource = originalSource;
});

function useHarness(pending = false) {
    const [snapshot, setSnapshot] = useState(generating);
    const preview = useEnrichmentStream(snapshot, pending, setSnapshot);
    return { snapshot, setSnapshot, preview };
}
function progress(markdown: string, runId = generating.enrichment!.id) {
    return { type: "progress", runId, status: "generating", markdown };
}

it("shows provisional chunks before completion without changing the saved note, then hands off to the validated proposal", () => {
    const { result } = renderHook(() => useHarness(true));
    const source = PreviewSource.instances[0]!;
    act(() => source.emit(progress("## Pricing\n\n- Annual")));
    expect(result.current.preview?.markdown).toBe("## Pricing\n\n- Annual");
    expect(result.current.snapshot.enrichment?.proposal).toBeNull();
    expect(result.current.snapshot.note?.contentMarkdown).toBe(generating.note!.contentMarkdown);

    act(() => source.emit({ type: "complete", snapshot: ready }));
    expect(result.current.snapshot.enrichment?.status).toBe("ready");
    expect(result.current.preview).toBeUndefined();
    expect(source.closed).toBe(true);
});

it("discards stale run events when the selected run changes", () => {
    const { result } = renderHook(useHarness);
    const oldSource = PreviewSource.instances[0]!;
    act(() => oldSource.emit(progress("Old provisional text")));
    act(() =>
        result.current.setSnapshot({
            ...generating,
            enrichment: { ...generating.enrichment!, id: "replacement-run" },
        })
    );
    const newSource = PreviewSource.instances[1]!;
    expect(oldSource.closed).toBe(true);
    expect(result.current.preview?.markdown).toBe("");
    act(() => {
        oldSource.emit({ type: "complete", snapshot: ready });
        newSource.emit(progress("Wrong run content"));
    });
    expect(result.current.snapshot.enrichment?.id).toBe("replacement-run");
    expect(result.current.preview?.markdown).toBe("");
    act(() => newSource.emit(progress("Replacement content", "replacement-run")));
    expect(result.current.preview?.markdown).toBe("Replacement content");
});

it("removes visible provisional content when the note is redacted and never revives it from late events", () => {
    const { result } = renderHook(useHarness);
    const source = PreviewSource.instances[0]!;
    act(() => source.emit(progress("Private draft")));
    act(() => result.current.setSnapshot({ ...generating, note: null, enrichment: null }));
    expect(result.current.preview).toBeUndefined();
    expect(source.closed).toBe(true);
    act(() => source.emit({ type: "complete", snapshot: ready }));
    expect(result.current.snapshot.note).toBeNull();
    expect(result.current.preview).toBeUndefined();
});

it("retains received text during a connection interruption and clears the error when streaming resumes", () => {
    const { result } = renderHook(useHarness);
    const source = PreviewSource.instances[0]!;
    act(() => source.emit(progress("## Budget")));
    act(() => source.onerror?.(new Event("error")));
    expect(result.current.preview?.markdown).toBe("## Budget");
    expect(result.current.preview?.error).toBeDefined();
    expect(source.closed).toBe(false);
    act(() => source.emit(progress("## Budget\n\n- Confirm spend.")));
    expect(result.current.preview?.markdown).toBe("## Budget\n\n- Confirm spend.");
    expect(result.current.preview?.error).toBeUndefined();
});

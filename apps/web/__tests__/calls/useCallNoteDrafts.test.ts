/** @jest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { useCallback, useState } from "react";
import type { CallNote, CallSnapshot } from "@launchstack/pipelines/call-notes";
import { useCallNoteDrafts } from "~/app/calls/_components/useCallNoteDrafts";
import { northstarPricingReviewCall } from "~/app/calls/_fixtures/callSnapshots";

const initial = northstarPricingReviewCall;
const id = initial.id;
function content(text: string): Pick<CallNote, "contentRich" | "contentMarkdown"> {
    return {
        contentMarkdown: text,
        contentRich: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        },
    };
}
function saved(text: string, revision = initial.note!.revision + 1): CallSnapshot {
    return { ...initial, note: { ...initial.note!, ...content(text), revision } };
}
type MockResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
function response(body: unknown, status = 200): MockResponse {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}
function useHarness() {
    const [calls, setCalls] = useState([initial]);
    const onSaved = useCallback(
        (snapshot: CallSnapshot) =>
            setCalls(previous =>
                (previous[0]?.note?.revision ?? 0) > (snapshot.note?.revision ?? 0)
                    ? previous
                    : [snapshot]
            ),
        []
    );
    return { ...useCallNoteDrafts(calls, onSaved), calls, setCalls };
}
async function debounce() {
    await act(async () => {
        jest.advanceTimersByTime(650);
    });
}
function body(index: number) {
    const [, options] = (global.fetch as jest.Mock).mock.calls[index] as [string, RequestInit];
    if (typeof options.body !== "string") throw new Error("Expected a serialized note command");
    return JSON.parse(options.body) as Record<string, unknown>;
}

describe("Call note drafts", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        global.fetch = jest.fn();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    it("serializes edits made during a save against the acknowledged revision", async () => {
        let finish!: (value: MockResponse) => void;
        (global.fetch as jest.Mock)
            .mockImplementationOnce(
                () =>
                    new Promise(resolve => {
                        finish = resolve;
                    })
            )
            .mockResolvedValueOnce(response(saved("Second edit", initial.note!.revision + 2)));
        const { result } = renderHook(useHarness);
        act(() => result.current.changeNote(id, content("First edit")));
        await debounce();
        act(() => result.current.changeNote(id, content("Second edit")));
        await debounce();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(result.current.drafts[id]?.contentMarkdown).toBe("Second edit");
        await act(async () => {
            finish(response(saved("First edit")));
        });
        await debounce();
        expect(body(1)).toMatchObject({
            contentMarkdown: "Second edit",
            baseRevision: initial.note!.revision + 1,
        });
        expect(result.current.calls[0]?.note?.contentMarkdown).toBe("Second edit");
        expect(result.current.drafts[id]).toBeUndefined();
    });

    it("replays an uncertain write unchanged before saving newer typing", async () => {
        (global.fetch as jest.Mock)
            .mockRejectedValueOnce(new Error("Connection lost after commit"))
            .mockResolvedValueOnce(response(saved("Committed edit")))
            .mockResolvedValueOnce(response(saved("Newer draft", initial.note!.revision + 2)));
        const { result } = renderHook(useHarness);
        act(() => result.current.changeNote(id, content("Committed edit")));
        await debounce();
        expect(result.current.drafts[id]?.status).toBe("failed");
        act(() => result.current.changeNote(id, content("Newer draft")));
        await debounce();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        await act(async () => {
            result.current.saveNote(id);
        });
        await debounce();
        expect(body(1)).toEqual(body(0));
        expect(body(2)).toMatchObject({
            contentMarkdown: "Newer draft",
            baseRevision: initial.note!.revision + 1,
        });
        expect(result.current.calls[0]?.note?.contentMarkdown).toBe("Newer draft");
        expect(result.current.drafts[id]).toBeUndefined();
    });

    it("preserves a local draft on a newer polled revision until explicit discard", async () => {
        const { result } = renderHook(useHarness);
        act(() => result.current.changeNote(id, content("My unsaved thought")));
        act(() => result.current.setCalls([saved("Other tab's edit")]));
        await debounce();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(result.current.drafts[id]).toMatchObject({
            status: "conflict",
            contentMarkdown: "My unsaved thought",
        });
        act(() => result.current.discardNote(id));
        expect(result.current.drafts[id]).toBeUndefined();
        expect(result.current.calls[0]?.note?.contentMarkdown).toBe("Other tab's edit");
    });

    it("does not rebase or overwrite a server conflict after more typing", async () => {
        (global.fetch as jest.Mock).mockResolvedValue(
            response({ error: "Call Note revision is stale" }, 409)
        );
        const { result } = renderHook(useHarness);
        act(() => result.current.changeNote(id, content("Local draft")));
        await debounce();
        expect(result.current.drafts[id]?.status).toBe("conflict");
        act(() => result.current.changeNote(id, content("Keep this draft")));
        await debounce();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(result.current.drafts[id]).toMatchObject({
            status: "conflict",
            contentMarkdown: "Keep this draft",
        });
    });

    it("keeps newer typing conflicted when another revision wins during an in-flight save", async () => {
        let finish!: (value: MockResponse) => void;
        (global.fetch as jest.Mock).mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finish = resolve;
                })
        );
        const { result } = renderHook(useHarness);
        act(() => result.current.changeNote(id, content("In flight")));
        await debounce();
        act(() => result.current.changeNote(id, content("Keep my newer typing")));
        act(() => result.current.setCalls([saved("Remote winner", initial.note!.revision + 2)]));
        await act(async () => {
            finish(response(saved("In flight")));
        });
        await debounce();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(result.current.drafts[id]).toMatchObject({
            status: "conflict",
            contentMarkdown: "Keep my newer typing",
        });
        expect(result.current.calls[0]?.note?.contentMarkdown).toBe("Remote winner");
    });

    it("flushes pending typing when leaving Calls before the debounce fires", async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(response(saved("Last thought")));
        const { result, unmount } = renderHook(useHarness);
        act(() => result.current.changeNote(id, content("Last thought")));
        await act(async () => {
            unmount();
        });
        expect(body(0)).toMatchObject({
            contentMarkdown: "Last thought",
            baseRevision: initial.note!.revision,
        });
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("cannot write a read-only or redacted note", async () => {
        const { result } = renderHook(useHarness);
        act(() =>
            result.current.setCalls([
                {
                    ...initial,
                    viewerCapabilities: { ...initial.viewerCapabilities, canEditNote: false },
                },
            ])
        );
        act(() => result.current.changeNote(id, content("Not allowed")));
        await debounce();
        expect(result.current.drafts[id]).toBeUndefined();
        act(() => result.current.setCalls([{ ...initial, note: null }]));
        act(() => result.current.changeNote(id, content("Still not allowed")));
        await debounce();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(result.current.drafts[id]).toBeUndefined();
    });
    it("serializes a title edit through the canonical note update command", async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(response(saved("Existing note")));
        const { result } = renderHook(useHarness);

        act(() => result.current.changeTitle(id, "Renamed note"));
        await debounce();

        expect(body(0)).toMatchObject({
            kind: "update_note",
            callId: id,
            title: "Renamed note",
            baseRevision: initial.note!.revision,
        });
    });
});

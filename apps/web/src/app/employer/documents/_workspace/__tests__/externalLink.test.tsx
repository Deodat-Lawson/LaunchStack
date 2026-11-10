/** @jest-environment jsdom */

import { act, renderHook } from "@testing-library/react";

import { driveLinkKey, useDriveChangedOutsideLink } from "../externalLink";

/**
 * The viewer reads a document's outside link once, with the document. Linking
 * or unlinking its Drive copy while it is open changes that link, so the
 * viewer asks the server again then — and only then.
 */

const fetchMock = jest.fn();
const DRIVE_URL = "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit";

function respondWith(rows: Array<{ id: number; externalLink: unknown }>) {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(rows) });
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

type Props = { documentId: number | null; driveKey: string | null; loaded: unknown };

function render(initial: Props) {
    return renderHook(
        ({ documentId, driveKey, loaded }: Props) =>
            useDriveChangedOutsideLink(documentId, driveKey, loaded),
        { initialProps: initial }
    );
}

beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
});

describe("driveLinkKey", () => {
    it("tells unknown, no live copy and a live copy apart", () => {
        expect(driveLinkKey(null)).toBeNull();
        expect(driveLinkKey({ link: null })).toBe("none");
        expect(driveLinkKey({ link: { status: "orphaned", url: DRIVE_URL } })).toBe("none");
        expect(driveLinkKey({ link: { status: "linked", url: DRIVE_URL } })).toBe(
            `linked:${DRIVE_URL}`
        );
    });
});

describe("useDriveChangedOutsideLink", () => {
    const doc = { id: 1 };

    it("asks nothing while the Drive status first arrives", async () => {
        const { result, rerender } = render({ documentId: 5, driveKey: null, loaded: doc });
        rerender({ documentId: 5, driveKey: "none", loaded: doc });
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(result.current).toBeUndefined();
    });

    it("reads the link again when a Drive copy is made", async () => {
        respondWith([{ id: 5, externalLink: { kind: "google-drive", url: DRIVE_URL } }]);
        const { result, rerender } = render({ documentId: 5, driveKey: "none", loaded: doc });
        rerender({ documentId: 5, driveKey: `linked:${DRIVE_URL}`, loaded: doc });
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.current).toEqual({ kind: "google-drive", url: DRIVE_URL });
    });

    it("falls back to what the server says once the copy is unlinked", async () => {
        respondWith([{ id: 5, externalLink: { kind: "file", url: "/api/files/9" } }]);
        const { result, rerender } = render({
            documentId: 5,
            driveKey: `linked:${DRIVE_URL}`,
            loaded: doc,
        });
        rerender({ documentId: 5, driveKey: "none", loaded: doc });
        await flush();
        expect(result.current).toEqual({ kind: "file", url: "/api/files/9" });
    });

    it("gives way to a fresher load of the document, and to another document", async () => {
        respondWith([{ id: 5, externalLink: { kind: "file", url: "/api/files/9" } }]);
        const { result, rerender } = render({
            documentId: 5,
            driveKey: `linked:${DRIVE_URL}`,
            loaded: doc,
        });
        rerender({ documentId: 5, driveKey: "none", loaded: doc });
        await flush();
        expect(result.current).toBeDefined();

        rerender({ documentId: 5, driveKey: "none", loaded: { id: 1, reloaded: true } });
        await flush();
        expect(result.current).toBeUndefined();

        // Opening another document carries the old status for one render;
        // that is not a change on the new one.
        rerender({ documentId: 6, driveKey: "none", loaded: doc });
        rerender({ documentId: 6, driveKey: null, loaded: doc });
        rerender({ documentId: 6, driveKey: `linked:${DRIVE_URL}`, loaded: doc });
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.current).toBeUndefined();
    });

    it("keeps the earlier link when the server cannot be reached", async () => {
        fetchMock.mockRejectedValue(new Error("offline"));
        const { result, rerender } = render({ documentId: 5, driveKey: "none", loaded: doc });
        rerender({ documentId: 5, driveKey: `linked:${DRIVE_URL}`, loaded: doc });
        await flush();
        expect(result.current).toBeUndefined();
    });
});

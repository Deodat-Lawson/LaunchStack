/** @jest-environment jsdom */

import React from "react";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import {
    GoogleDriveBanner,
    driveLinkSummary,
    setDriveBarHidden,
    useDriveBarHidden,
    useDriveLinkStatus,
    type DriveLinkStatus,
} from "../GoogleDriveBanner";

/**
 * The Drive line over a linkable document: it can be hidden from either of
 * its states, and the status it draws from is read by the viewer so the
 * header can offer it back.
 */

const fetchMock = jest.fn();

function respond(body: unknown, statusCode = 200) {
    return Promise.resolve({
        ok: statusCode < 400,
        status: statusCode,
        json: () => Promise.resolve(body),
    });
}

const linked: DriveLinkStatus = {
    connected: true,
    linkable: true,
    link: {
        status: "linked",
        url: "https://docs.google.com/document/d/abc/edit",
        linkedBy: "Ada",
        lastSyncedAt: "2026-10-23T14:05:00",
        fidelityWarning: false,
        lastError: null,
    },
};

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
    fetchMock.mockReset();
});

function renderBanner(status: DriveLinkStatus | null, onHide = jest.fn()) {
    render(
        <GoogleDriveBanner
            documentId={7}
            status={status}
            refresh={() => Promise.resolve()}
            onHide={onHide}
        />
    );
    return onHide;
}

describe("GoogleDriveBanner", () => {
    it("hides a linked document's line", async () => {
        const onHide = renderBanner(linked);
        expect(screen.getByText(/Lives in Google Drive — linked by Ada/)).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Hide Google Drive bar" }));

        expect(onHide).toHaveBeenCalledTimes(1);
    });

    it("hides the offer on an unlinked document", async () => {
        const onHide = renderBanner({ connected: false, linkable: true, link: null });
        expect(screen.getByText(/Connect a Google account/)).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Hide Google Drive bar" }));

        expect(onHide).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["linked", linked],
        ["unlinked", { connected: true, linkable: true, link: null }],
    ])("leads the %s line with the Google Drive logo", (_, status) => {
        renderBanner(status);
        const logo = document.querySelector("img");
        expect(logo).toHaveAttribute("src", "/images/google-drive.svg");
        expect(logo).toHaveAttribute("alt", "");
    });

    it("tells the viewer when Sync now brings a new version, so it can show it", async () => {
        const onSynced = jest.fn();
        render(
            <GoogleDriveBanner
                documentId={7}
                status={linked}
                refresh={() => Promise.resolve()}
                onSynced={onSynced}
                onHide={jest.fn()}
            />
        );

        fetchMock.mockReturnValueOnce(respond({ outcome: { kind: "noop" } }));
        await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
        expect(await screen.findByText("Already up to date.")).toBeInTheDocument();
        expect(onSynced).not.toHaveBeenCalled();

        fetchMock.mockReturnValueOnce(respond({ outcome: { kind: "synced", versionNumber: 4 } }));
        await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
        expect(await screen.findByText(/Synced v4 from Google Drive/)).toBeInTheDocument();
        expect(onSynced).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenLastCalledWith("/api/documents/7/google-docs/sync", {
            method: "POST",
        });
    });

    it("draws nothing for a document Drive cannot hold", () => {
        renderBanner({ connected: true, linkable: false, link: null });
        expect(screen.queryByRole("button", { name: "Hide Google Drive bar" })).toBeNull();
    });
});

describe("driveLinkSummary", () => {
    it("says who linked it and when it last synced", () => {
        expect(driveLinkSummary(linked.link!)).toBe(
            "Lives in Google Drive — linked by Ada · last synced Oct 23, 14:05"
        );
    });

    it("says so when the Drive copy is gone", () => {
        expect(driveLinkSummary({ ...linked.link!, status: "orphaned" })).toBe(
            "The Google Drive copy was deleted or trashed."
        );
    });
});

describe("useDriveLinkStatus", () => {
    it("reads the document's status", async () => {
        fetchMock.mockImplementation(() => respond(linked));
        const { result } = renderHook(() => useDriveLinkStatus(7));

        await waitFor(() => expect(result.current.status).toEqual(linked));
        expect(fetchMock).toHaveBeenCalledWith("/api/documents/7/google-docs/status");
    });

    it("reads nothing without a document", async () => {
        const { result } = renderHook(() => useDriveLinkStatus(null));

        await waitFor(() => expect(result.current.status).toBeNull());
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("drops the last document's status when the document changes", async () => {
        fetchMock.mockImplementation((url: string) =>
            url.includes("/7/") ? respond(linked) : new Promise(() => {})
        );
        const { result, rerender } = renderHook(({ id }) => useDriveLinkStatus(id), {
            initialProps: { id: 7 },
        });
        await waitFor(() => expect(result.current.status).toEqual(linked));

        rerender({ id: 8 });

        expect(result.current.status).toBeNull();
    });
});

describe("useDriveBarHidden", () => {
    afterEach(() => act(() => setDriveBarHidden(false)));

    it("is one choice for every open document, and remembered", () => {
        const first = renderHook(() => useDriveBarHidden());
        const second = renderHook(() => useDriveBarHidden());
        expect(first.result.current).toBe(false);

        act(() => setDriveBarHidden(true));

        expect(first.result.current).toBe(true);
        expect(second.result.current).toBe(true);
        expect(localStorage.getItem("documentViewer.driveBarHidden.v1")).toBe("1");
    });

    it("follows a choice made in another window", () => {
        const { result } = renderHook(() => useDriveBarHidden());

        act(() => {
            window.dispatchEvent(
                new StorageEvent("storage", {
                    key: "documentViewer.driveBarHidden.v1",
                    newValue: "1",
                })
            );
        });

        expect(result.current).toBe(true);
    });
});

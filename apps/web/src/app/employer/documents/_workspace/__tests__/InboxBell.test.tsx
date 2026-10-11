/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { resetPeopleCache } from "~/lib/profile/use-people";

import { INBOX_POLL_MS, InboxBell } from "../team/InboxBell";
import type { InboxEntry } from "../team/api";

/**
 * The inbox bell (ADR-014): a count of what is new, a list of who shared what,
 * and a click that marks it read and opens it. It polls once a minute, but
 * never while the tab is hidden.
 */

const ENTRIES: InboxEntry[] = [
    {
        id: 3,
        kind: "shared",
        actorUserId: "user-ada",
        targetType: "document",
        targetId: "42",
        targetLabel: "Q3 plan.pdf",
        detail: { level: "edit", via: "direct" },
        at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
        read: false,
    },
    {
        id: 2,
        kind: "shared",
        actorUserId: "user-ben",
        targetType: "folder",
        targetId: "7",
        targetLabel: "Finance/Board",
        detail: { level: "view", via: "group", groupName: "Sales team", path: "Finance/Board" },
        at: new Date(Date.now() - 86_400_000).toISOString(),
        read: false,
    },
    {
        id: 1,
        kind: "shared",
        actorUserId: "user-ada",
        targetType: "chat",
        targetId: "s1",
        targetLabel: "Pricing",
        detail: { level: "view", via: "direct" },
        at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        read: true,
    },
];

const PEOPLE = {
    "user-ada": {
        authUserId: "user-ada",
        name: "Ada Lovelace",
        displayName: "Ada",
        avatarUrl: null,
    },
    "user-ben": { authUserId: "user-ben", name: "Ben Ng", displayName: "Ben", avatarUrl: null },
};

const fetchMock = jest.fn();
let inbox: { entries: InboxEntry[]; unread: number };

function urlOf(input: RequestInfo | URL): string {
    return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** jsdom has no `Response`; the callers read `ok`, `status`, `text()` and `json()`. */
function json(body: unknown, status = 200) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve(body),
    });
}

function inboxCalls(): number {
    return fetchMock.mock.calls.filter(
        ([input, init]) =>
            urlOf(input as RequestInfo) === "/api/workspace/notifications" &&
            (init as RequestInit | undefined)?.method === undefined
    ).length;
}

function readCalls(): unknown[] {
    return fetchMock.mock.calls
        .filter(([input]) => urlOf(input as RequestInfo) === "/api/workspace/notifications/read")
        .map(([, init]) => JSON.parse((init as { body: string }).body) as unknown);
}

beforeEach(() => {
    inbox = { entries: ENTRIES.map(e => ({ ...e })), unread: 2 };
    resetPeopleCache();
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url === "/api/workspace/notifications") return json(inbox);
        if (url === "/api/workspace/notifications/read") return json({ success: true });
        if (url.startsWith("/api/profile/people")) return json({ people: PEOPLE });
        return json({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
    });
});

afterEach(() => {
    jest.useRealTimers();
});

async function openInbox() {
    const bell = await screen.findByTestId("inbox-bell");
    fireEvent.click(bell);
    return screen.findByTestId("inbox-popover");
}

describe("InboxBell", () => {
    it("shows the unread count on the bell", async () => {
        render(<InboxBell onOpenTarget={jest.fn()} />);

        expect(await screen.findByTestId("inbox-count")).toHaveTextContent("2");
        expect(screen.getByTestId("inbox-bell")).toHaveAccessibleName("Inbox, 2 unread");
    });

    it("hides the count when nothing is unread", async () => {
        inbox = { entries: [], unread: 0 };
        render(<InboxBell onOpenTarget={jest.fn()} />);

        await waitFor(() => expect(inboxCalls()).toBe(1));
        expect(screen.queryByTestId("inbox-count")).not.toBeInTheDocument();
        expect(screen.getByTestId("inbox-bell")).toHaveAccessibleName("Inbox");
    });

    it("lists who shared what, saying when it came through a group", async () => {
        render(<InboxBell onOpenTarget={jest.fn()} />);
        const popover = await openInbox();

        await waitFor(() =>
            expect(within(popover).getByText("Ada shared “Q3 plan.pdf” with you")).toBeVisible()
        );
        expect(within(popover).getByText("Ben shared “Board” with Sales team")).toBeVisible();
        const rows = within(popover).getAllByTestId("inbox-entry");
        expect(rows.map(r => r.getAttribute("data-unread"))).toEqual(["true", "true", null]);
    });

    it("marks an entry read and opens it on click", async () => {
        const onOpenTarget = jest.fn();
        render(<InboxBell onOpenTarget={onOpenTarget} />);
        const popover = await openInbox();

        fireEvent.click(await within(popover).findByText("Ada shared “Q3 plan.pdf” with you"));

        expect(onOpenTarget).toHaveBeenCalledWith({ type: "document", id: 42 });
        await waitFor(() => expect(readCalls()).toEqual([{ ids: [3] }]));
        expect(await screen.findByTestId("inbox-count")).toHaveTextContent("1");
    });

    it("opens a shared folder by its path", async () => {
        const onOpenTarget = jest.fn();
        render(<InboxBell onOpenTarget={onOpenTarget} />);
        const popover = await openInbox();

        fireEvent.click(await within(popover).findByText("Ben shared “Board” with Sales team"));

        expect(onOpenTarget).toHaveBeenCalledWith({ type: "folder", path: "Finance/Board" });
    });

    it("does not mark an already-read entry again", async () => {
        const onOpenTarget = jest.fn();
        render(<InboxBell onOpenTarget={onOpenTarget} />);
        const popover = await openInbox();

        fireEvent.click(await within(popover).findByText("Ada shared “Pricing” with you"));

        expect(onOpenTarget).toHaveBeenCalledWith({ type: "chat", id: "s1" });
        expect(readCalls()).toEqual([]);
    });

    it("marks everything read", async () => {
        render(<InboxBell onOpenTarget={jest.fn()} />);
        const popover = await openInbox();

        fireEvent.click(await within(popover).findByRole("button", { name: /Mark all read/ }));

        await waitFor(() => expect(readCalls()).toEqual([{}]));
        expect(screen.queryByTestId("inbox-count")).not.toBeInTheDocument();
    });

    it("polls every minute while visible, and not while the tab is hidden", async () => {
        jest.useFakeTimers();
        render(<InboxBell onOpenTarget={jest.fn()} />);
        await act(async () => {
            await Promise.resolve();
        });
        expect(inboxCalls()).toBe(1);

        await act(async () => {
            jest.advanceTimersByTime(INBOX_POLL_MS);
            await Promise.resolve();
        });
        expect(inboxCalls()).toBe(2);

        Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => "hidden",
        });
        await act(async () => {
            jest.advanceTimersByTime(INBOX_POLL_MS * 3);
            await Promise.resolve();
        });
        expect(inboxCalls()).toBe(2);

        // Coming back to the tab asks straight away.
        Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => "visible",
        });
        await act(async () => {
            document.dispatchEvent(new Event("visibilitychange"));
            await Promise.resolve();
        });
        expect(inboxCalls()).toBe(3);
    });

    it("still shows the count for a page opened in a background tab", async () => {
        Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => "hidden",
        });
        jest.useFakeTimers();
        render(<InboxBell onOpenTarget={jest.fn()} />);
        await act(async () => {
            await Promise.resolve();
        });
        expect(inboxCalls()).toBe(1);

        await act(async () => {
            jest.advanceTimersByTime(INBOX_POLL_MS * 2);
            await Promise.resolve();
        });
        expect(inboxCalls()).toBe(1);
    });
});

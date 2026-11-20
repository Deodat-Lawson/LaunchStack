/** @jest-environment jsdom */

/**
 * Switching account in one tab changes who every tab in the browser acts as.
 * A tab whose account changed under it stops behind a dialog it can't
 * dismiss, and only reloads when asked (it may hold unsaved work).
 */

import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

const mockGetSession = jest.fn();
jest.mock("~/lib/auth-client", () => ({
    authClient: { getSession: () => mockGetSession() },
}));
const mockLeave = jest.fn();
jest.mock("~/lib/auth/account-sync", () => ({
    ...jest.requireActual<object>("~/lib/auth/account-sync"),
    leaveAfterAccountChange: (signedOut: boolean) => mockLeave(signedOut),
}));

import { AccountChangeGuard } from "~/components/auth/AccountChangeGuard";
import { announceAccountChange, onAccountChange } from "~/lib/auth/account-sync";

const KEY = "launchstack:account-changed";
const otherTabSays = () =>
    act(() => {
        window.dispatchEvent(
            new StorageEvent("storage", { key: KEY, newValue: `another-tab:${Date.now()}` })
        );
    });
const session = (user: { id: string; name: string; email: string } | null) =>
    mockGetSession.mockResolvedValue({ data: user ? { user, session: {} } : null });

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
});

describe("AccountChangeGuard", () => {
    it("stays out of the way while this tab's account is still the active one", async () => {
        session({ id: "u-ann", name: "Ann", email: "ann@example.com" });
        render(<AccountChangeGuard userId="u-ann" userName="Ann" />);

        otherTabSays();

        await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("stops the tab when another tab switched account, and reloads only when asked", async () => {
        session({ id: "u-bob", name: "Bob", email: "bob@example.com" });
        const user = userEvent.setup();
        render(<AccountChangeGuard userId="u-ann" userName="Ann" />);

        otherTabSays();

        const dialog = await screen.findByRole("dialog");
        expect(dialog).toHaveTextContent("You switched to Bob in another tab");
        expect(dialog).toHaveTextContent("This tab was opened as Ann.");
        expect(mockLeave).not.toHaveBeenCalled();

        // Can't be waved away.
        expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
        await user.keyboard("{Escape}");
        expect(screen.getByRole("dialog")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Reload" }));
        expect(mockLeave).toHaveBeenCalledWith(false);
    });

    it("notices on coming back into view, too (no message needed)", async () => {
        session(null);
        const user = userEvent.setup();
        render(<AccountChangeGuard userId="u-ann" userName="Ann" />);

        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });

        expect(await screen.findByRole("dialog")).toHaveTextContent(
            "You signed out in another tab"
        );
        await user.click(screen.getByRole("button", { name: "Sign in" }));
        expect(mockLeave).toHaveBeenCalledWith(true);
    });

    it("tells the other tabs when it loads, so they check too", () => {
        session({ id: "u-ann", name: "Ann", email: "ann@example.com" });
        render(<AccountChangeGuard userId="u-ann" userName="Ann" />);

        expect(localStorage.getItem(KEY)).toBeTruthy();
    });
});

describe("account-sync", () => {
    it("ignores this tab's own announcement and hears another tab's", () => {
        const listener = jest.fn();
        const stop = onAccountChange(listener);

        announceAccountChange();
        const own = localStorage.getItem(KEY);
        window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: own }));
        expect(listener).not.toHaveBeenCalled();

        window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: "other:1" }));
        expect(listener).toHaveBeenCalledTimes(1);

        window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", newValue: "x" }));
        expect(listener).toHaveBeenCalledTimes(1);
        stop();
    });
});

/** @jest-environment jsdom */

/**
 * The account menu on /workspaces (several accounts in one browser). What it
 * pins:
 * - the current account is shown with a check, every other signed-in account
 *   is one click from being the active one;
 * - "Sign out of <you>" ends only this account while others remain, and
 *   "Sign out of all accounts" appears only when there is more than one;
 * - with one account, signing out is the plain sign-out to /signin;
 * - adding an account is offered until the browser holds the limit.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

type Account = {
    sessionToken: string;
    userId: string;
    name: string;
    email: string;
    image: string | null;
};

const ADA: Account = {
    sessionToken: "tok-ada",
    userId: "u-ada",
    name: "Ada Lovelace",
    email: "ada@example.com",
    image: null,
};
const GRACE: Account = {
    sessionToken: "tok-grace",
    userId: "u-grace",
    name: "Grace Hopper",
    email: "grace@example.com",
    image: null,
};

let mockAccounts: Account[] = [];
const mockSwitch = jest.fn<Promise<void>, [string]>();
const mockSignOutOne = jest.fn<Promise<void>, [string]>();
const mockSignOutAll = jest.fn<Promise<void>, []>();
const mockRemember = jest.fn<Promise<void>, []>();
jest.mock("~/lib/auth-client", () => ({
    authClient: {
        useSession: () => ({
            data: { session: { token: "tok-ada" }, user: { id: "u-ada" } },
        }),
        revokeSession: jest.fn(),
    },
    listDeviceAccounts: () => Promise.resolve(mockAccounts),
    switchDeviceAccount: (token: string) => mockSwitch(token),
    signOutDeviceAccount: (token: string) => mockSignOutOne(token),
    signOutAllDeviceAccounts: () => mockSignOutAll(),
    rememberActiveSession: () => mockRemember(),
}));
const mockReload = jest.fn<void, [string]>();
jest.mock("~/app/workspaces/reload-as", () => ({
    reloadAs: (href: string) => mockReload(href),
}));
jest.mock("sonner", () => ({
    toast: { error: jest.fn(), loading: jest.fn(), dismiss: jest.fn(), success: jest.fn() },
}));

import { AccountMenu } from "~/app/workspaces/AccountMenu";

beforeAll(() => {
    globalThis.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
    mockAccounts = [ADA, GRACE];
    for (const fn of [mockSwitch, mockSignOutOne, mockSignOutAll, mockRemember]) {
        fn.mockReset().mockResolvedValue(undefined);
    }
    mockReload.mockReset();
});

async function openMenu() {
    const user = userEvent.setup();
    render(<AccountMenu account={{ name: ADA.name, email: ADA.email }} photo={null} />);
    const trigger = screen.getByRole("button", { name: /Ada Lovelace, ada@example\.com/ });
    await user.click(trigger);
    await screen.findByRole("menu");
    return user;
}

describe("AccountMenu", () => {
    it("gives the trigger a name that says what it opens", () => {
        render(<AccountMenu account={{ name: ADA.name, email: ADA.email }} photo={null} />);

        expect(
            screen.getByRole("button", {
                name: "Ada Lovelace, ada@example.com: switch or add accounts",
            })
        ).toHaveAttribute("aria-haspopup", "menu");
    });

    it("shows the current account with a check and the other one to switch to", async () => {
        await openMenu();

        const current = screen.getByTestId("account-current");
        expect(current).toHaveTextContent("Ada Lovelace");
        expect(current).toHaveTextContent("ada@example.com");
        expect(current).toHaveTextContent("(current account)");

        const others = await screen.findAllByTestId("account-other");
        expect(others).toHaveLength(1);
        expect(others[0]).toHaveTextContent("Grace Hopper");
        expect(others[0]).toHaveAttribute("role", "menuitem");
    });

    it("switches with one click and reloads the picker as that account", async () => {
        const user = await openMenu();

        await user.click(await screen.findByRole("menuitem", { name: /Grace Hopper/ }));

        await waitFor(() => expect(mockSwitch).toHaveBeenCalledWith("tok-grace"));
        expect(mockReload).toHaveBeenCalledWith("/workspaces");
    });

    it("signs out of just this account while another stays signed in", async () => {
        const user = await openMenu();
        await screen.findByRole("menuitem", { name: /Grace Hopper/ });

        await user.click(screen.getByRole("menuitem", { name: "Sign out of ada@example.com" }));

        await waitFor(() => expect(mockSignOutOne).toHaveBeenCalledWith("tok-ada"));
        expect(mockSignOutAll).not.toHaveBeenCalled();
        expect(mockReload).toHaveBeenCalledWith("/workspaces");
    });

    it("offers signing out of all accounts only when there are several", async () => {
        const user = await openMenu();
        await screen.findByRole("menuitem", { name: /Grace Hopper/ });

        await user.click(screen.getByRole("menuitem", { name: "Sign out of all accounts" }));

        await waitFor(() => expect(mockSignOutAll).toHaveBeenCalled());
        expect(mockReload).toHaveBeenCalledWith("/signin");
    });

    it("with one account: no list, no sign-out-all, and sign-out goes to /signin", async () => {
        mockAccounts = [ADA];
        const user = await openMenu();

        expect(screen.queryByTestId("account-other")).toBeNull();
        expect(screen.queryByRole("menuitem", { name: "Sign out of all accounts" })).toBeNull();

        await user.click(screen.getByRole("menuitem", { name: "Sign out of ada@example.com" }));

        await waitFor(() => expect(mockSignOutAll).toHaveBeenCalled());
        expect(mockSignOutOne).not.toHaveBeenCalled();
        expect(mockReload).toHaveBeenCalledWith("/signin");
    });

    it("adds another account through the sign-in page's add mode", async () => {
        const user = await openMenu();

        await user.click(screen.getByRole("menuitem", { name: "Add another account" }));

        await waitFor(() => expect(mockReload).toHaveBeenCalledWith("/signin?add=1"));
        // The account in hand is remembered first, so the new one can't replace it.
        expect(mockRemember).toHaveBeenCalled();
    });

    it("stops offering to add one at the limit, and says why", async () => {
        mockAccounts = [1, 2, 3, 4, 5].map(n => ({
            ...GRACE,
            userId: n === 1 ? "u-ada" : `u-${n}`,
            sessionToken: `tok-${n}`,
            email: `p${n}@example.com`,
        }));
        await openMenu();
        await screen.findAllByTestId("account-other");

        expect(screen.getByRole("menuitem", { name: "Add another account" })).toHaveAttribute(
            "aria-disabled",
            "true"
        );
        expect(screen.getByText(/signed in to 5 accounts at once/)).toBeInTheDocument();
    });
});

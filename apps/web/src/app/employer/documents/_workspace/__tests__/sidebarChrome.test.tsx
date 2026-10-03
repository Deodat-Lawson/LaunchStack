/** @jest-environment jsdom */

/**
 * The app-wide controls — search, the account — and where they live.
 *
 * They used to sit at the end of the first column's tab strip, so opening a
 * second column moved them to the middle of the screen. They now belong to
 * the sidebar, and a hidden sidebar narrows to a strip that still carries
 * them. These pin that they are reachable from both, and that the account
 * menu still does everything it did.
 */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockSetTheme = jest.fn();
jest.mock("next-themes", () => ({
    useTheme: () => ({ resolvedTheme: "light", setTheme: mockSetTheme }),
}));
jest.mock("~/lib/settings/useSettings", () => ({
    writeSettingValue: jest.fn(() => Promise.resolve()),
}));
jest.mock("../../../_chrome/EmployerWorkspaceSwitcherContext", () => ({
    useEmployerWorkspaceSwitcher: () => ({
        name: "LaunchStack Dev",
        initials: "LD",
        swatch: 1,
        membershipCount: 2,
    }),
}));

import { AccountMenu } from "../AccountMenu";
import { CollapsedRail } from "../CollapsedRail";

/**
 * Open from the keyboard. Radix opens a menu on pointer down, which jsdom's
 * synthetic pointer events do not satisfy; Enter is the same menu, and a real
 * way people open it.
 */
function openMenu(trigger: HTMLElement) {
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("CollapsedRail", () => {
    function setup() {
        const props = {
            onExpand: jest.fn(),
            onOpenPalette: jest.fn(),
            onOpenAdd: jest.fn(),
            accountSlot: <button type="button">account-slot</button>,
        };
        render(<CollapsedRail {...props} />);
        return props;
    }

    it("keeps every app-wide control when the sidebar is hidden", () => {
        setup();
        expect(screen.getByRole("button", { name: "Show sidebar" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Jump to anything" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add knowledge" })).toBeInTheDocument();
        expect(screen.getByText("account-slot")).toBeInTheDocument();
    });

    it("brings the sidebar back, opens the palette, and adds knowledge", () => {
        const props = setup();
        fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
        fireEvent.click(screen.getByRole("button", { name: "Jump to anything" }));
        fireEvent.click(screen.getByRole("button", { name: "Add knowledge" }));
        expect(props.onExpand).toHaveBeenCalled();
        expect(props.onOpenPalette).toHaveBeenCalled();
        expect(props.onOpenAdd).toHaveBeenCalled();
    });
});

describe("AccountMenu", () => {
    function setup(variant: "row" | "avatar" = "row") {
        const props = {
            userName: "Dev Owner",
            userEmail: "owner@launchstack.test",
            onOpenSettings: jest.fn(),
            onSignOut: jest.fn(),
        };
        render(<AccountMenu variant={variant} {...props} />);
        return props;
    }

    it("shows who is signed in on the sidebar's foot", () => {
        setup("row");
        const trigger = screen.getByTestId("account-menu");
        expect(trigger).toHaveTextContent("Dev Owner");
        expect(trigger).toHaveTextContent("owner@launchstack.test");
    });

    it("shows the profile's title in place of the email, and both in the menu", async () => {
        render(
            <AccountMenu
                variant="row"
                userName="Dev Owner"
                userEmail="owner@launchstack.test"
                userTitle="Founder & CEO"
                onOpenSettings={jest.fn()}
            />
        );
        const trigger = screen.getByTestId("account-menu");
        expect(trigger).toHaveTextContent("Founder & CEO");
        expect(trigger).not.toHaveTextContent("owner@launchstack.test");
        openMenu(trigger);
        expect(await screen.findByText("owner@launchstack.test")).toBeInTheDocument();
    });

    it("is the avatar alone in the collapsed strip, and still says whose it is", () => {
        setup("avatar");
        const trigger = screen.getByTestId("account-menu");
        expect(trigger).toHaveTextContent("DO");
        expect(trigger).toHaveAccessibleName("Account: Dev Owner");
    });

    it("offers what the old avatar menu did", async () => {
        setup();
        openMenu(screen.getByTestId("account-menu"));
        for (const label of [
            "Switch to dark theme",
            "Settings",
            "Documentation",
            "Log out",
            "LaunchStack Dev",
        ]) {
            expect(await screen.findByText(label)).toBeInTheDocument();
        }
    });

    it("links to the workspace picker from the workspace row", async () => {
        setup();
        openMenu(screen.getByTestId("account-menu"));
        const row = (await screen.findByText("LaunchStack Dev")).closest("a");
        expect(row).toHaveAttribute("href", "/workspaces");
    });

    it("opens Settings and signs out", async () => {
        const props = setup();
        openMenu(screen.getByTestId("account-menu"));
        fireEvent.click(await screen.findByText("Settings"));
        expect(props.onOpenSettings).toHaveBeenCalled();

        openMenu(screen.getByTestId("account-menu"));
        fireEvent.click(await screen.findByText("Log out"));
        expect(props.onSignOut).toHaveBeenCalled();
    });

    it("switches the theme", async () => {
        setup();
        openMenu(screen.getByTestId("account-menu"));
        fireEvent.click(await screen.findByText("Switch to dark theme"));
        expect(mockSetTheme).toHaveBeenCalledWith("dark");
    });
});

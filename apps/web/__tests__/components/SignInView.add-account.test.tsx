/** @jest-environment jsdom */

/**
 * /signin while already signed in. Plain, it is the loop breaker: an
 * "already signed in" card instead of the form. With `?add=1` (the account
 * menu's "Add another account") it is the form, a note naming the account
 * that stays signed in, and a way back. (Where the sign-in lands — /workspaces
 * as the new account — is a full navigation jsdom can't follow; the browser
 * walk covers it.)
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
    useSearchParams: () => mockParams,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const mockRemember = jest.fn<Promise<void>, []>();
jest.mock("~/lib/auth-client", () => ({
    useAuth: () => ({ isLoaded: true, isSignedIn: true, signOut: jest.fn() }),
    useUser: () => ({ user: { email: "owner@example.com", name: "Owner" }, isLoaded: true }),
    rememberActiveSession: () => mockRemember(),
    oauthFlowRedirect: () => null,
    authClient: {
        getLastUsedLoginMethod: () => null,
        signIn: { email: jest.fn(), social: jest.fn() },
    },
}));
jest.mock("~/app/_components/AuthChrome", () => ({ AuthChrome: () => null }));
jest.mock("~/app/_components/AuthBrandPanel", () => ({ AuthBrandPanel: () => null }));

import { SignInView } from "~/app/signin/SignInView";

beforeAll(() => {
    globalThis.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
    mockRemember.mockReset().mockResolvedValue(undefined);
});

describe("SignInView while signed in", () => {
    it("without the flag: the already-signed-in card, no form", async () => {
        mockParams = new URLSearchParams();
        render(<SignInView socialProviders={[]} />);

        expect(await screen.findByText("You’re already signed in.")).toBeInTheDocument();
        expect(screen.queryByLabelText("Email")).toBeNull();
        expect(mockRemember).not.toHaveBeenCalled();
    });

    it("with add=1 at the account limit: a notice instead of the form", async () => {
        mockParams = new URLSearchParams("add=1");
        render(<SignInView socialProviders={[]} accountLimitReached />);

        expect(
            await screen.findByText(/signed in to 5 accounts, the most one browser keeps/)
        ).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Back to your workspaces" })).toHaveAttribute(
            "href",
            "/workspaces"
        );
        expect(screen.queryByLabelText("Email")).toBeNull();
        expect(screen.queryByRole("link", { name: /Start a free workspace/ })).toBeNull();
        expect(mockRemember).not.toHaveBeenCalled();
    });

    it("the limit doesn't touch a plain sign-in", async () => {
        mockParams = new URLSearchParams();
        render(<SignInView socialProviders={[]} accountLimitReached />);

        expect(await screen.findByText("You’re already signed in.")).toBeInTheDocument();
        expect(screen.queryByText(/the most one browser keeps/)).toBeNull();
    });

    it("with add=1: the form, the stay-signed-in note and a way back", async () => {
        mockParams = new URLSearchParams("add=1");
        render(<SignInView socialProviders={[]} />);

        expect(await screen.findByText("Sign in to another account.")).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent(
            "You'll stay signed in as owner@example.com."
        );
        expect(screen.getByRole("link", { name: "Back to your workspaces" })).toHaveAttribute(
            "href",
            "/workspaces"
        );
        expect(screen.getByLabelText("Email")).toBeInTheDocument();
        expect(screen.queryByText("You’re already signed in.")).toBeNull();
        // The account in hand is remembered before the form can replace it.
        await waitFor(() => expect(mockRemember).toHaveBeenCalled());
        // A brand-new account made from here joins the list too.
        expect(screen.getByRole("link", { name: /Start a free workspace/ })).toHaveAttribute(
            "href",
            "/signup?add=1"
        );
    });
});

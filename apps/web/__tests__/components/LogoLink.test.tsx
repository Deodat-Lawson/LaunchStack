/** @jest-environment jsdom */

/**
 * Where the brand logo leads. Signed in, it is the app's home button and opens
 * the workspace; signed out, it leads to the public site. It used to lead to
 * the public site for everyone, which took members out of the product to a
 * page that can't see their session and asked them to log in again.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockAuth = { isLoaded: true, isSignedIn: false };
const mockUser: { user: { email: string } | null } = { user: null };
jest.mock("~/lib/auth-client", () => ({
    useAuth: () => mockAuth,
    useUser: () => mockUser,
}));
jest.mock("~/components/i18n/LanguageMenu", () => ({ LanguageToggle: () => null }));
jest.mock("~/app/_components/ThemeToggle", () => ({ ThemeToggle: () => null }));
jest.mock("~/components/UserMenu", () => ({ UserMenu: () => null }));

import { AuthChrome } from "~/app/_components/AuthChrome";
import { LogoLink } from "~/components/LogoLink";

function logo() {
    // The header names it twice over (the mark's label, then the wordmark).
    return screen.getByRole("link", { name: /^Launchstack/ });
}

describe("LogoLink", () => {
    it("opens the workspace for someone signed in", () => {
        render(<LogoLink signedIn>Launchstack</LogoLink>);
        expect(logo()).toHaveAttribute("href", "/employer/documents");
    });

    it("leads someone signed out to the public site", () => {
        render(<LogoLink signedIn={false}>Launchstack</LogoLink>);
        expect(logo()).toHaveAttribute("href", "/site");
    });
});

describe("the sign-in header's logo", () => {
    afterEach(() => {
        mockAuth.isLoaded = true;
        mockAuth.isSignedIn = false;
        mockUser.user = null;
    });

    it("leads a signed-out visitor to the public site", () => {
        render(<AuthChrome />);
        expect(logo()).toHaveAttribute("href", "/site");
    });

    it("opens the workspace once the session shows them signed in", () => {
        // /signin's already-signed-in state, the OAuth connect screens and
        // invite links all show this header to members.
        mockAuth.isSignedIn = true;
        mockUser.user = { email: "owner@launchstack.test" };
        render(<AuthChrome />);
        expect(logo()).toHaveAttribute("href", "/employer/documents");
    });

    it("treats a session that is still loading as signed out", () => {
        mockAuth.isLoaded = false;
        mockAuth.isSignedIn = true;
        render(<AuthChrome />);
        expect(logo()).toHaveAttribute("href", "/site");
    });
});

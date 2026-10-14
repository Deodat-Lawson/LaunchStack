/** @jest-environment jsdom */

/**
 * The page a shared link opens (`/join/<code>`, `/invite/<token>`). What it
 * pins:
 * - someone who just signed up or in *from this page* joins with no second
 *   click, and lands in the workspace with a one-time welcome;
 * - someone who merely opens a link while signed in must click Join — a link
 *   alone never joins anyone (another site can link you here, but it can't
 *   write this tab's join intent);
 * - a pending result says so and stays put — it never claims "You're in" or
 *   navigates into a workspace they can't use (the old /signup page did both);
 * - every unusable link gets a sentence the holder can act on;
 * - an invitation fills in, and locks, the address it was sent to.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

const mockAuth = { isLoaded: true, isSignedIn: false, signOut: jest.fn() };
const mockUser: { user: { email: string; name: string } | null } = { user: null };
const mockSignInEmail = jest.fn();
jest.mock("~/lib/auth-client", () => ({
    useAuth: () => mockAuth,
    useUser: () => mockUser,
    authClient: {
        getLastUsedLoginMethod: () => null,
        signIn: { email: (...args: unknown[]) => mockSignInEmail(...args), social: jest.fn() },
        signUp: { email: jest.fn() },
    },
}));
jest.mock("~/app/_components/AuthChrome", () => ({ AuthChrome: () => null }));
jest.mock("~/lib/profile/use-my-profile", () => ({ resetMyProfile: jest.fn() }));
const mockAssign = jest.fn();
jest.mock("~/lib/join-handoff", () => ({
    ...jest.requireActual<object>("~/lib/join-handoff"),
    enterWorkspace: (href: string) => mockAssign(href),
}));

import { JoinLanding } from "~/app/_components/join/JoinLanding";
import { hasJoinIntent, rememberJoinIntent, takeJoinWelcome } from "~/lib/join-handoff";

let calls: { url: string; method: string; body: unknown }[] = [];
let routes: Record<string, { status: number; body: unknown }> = {};

function respond(status: number, body: unknown) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    } as Response);
}

// The sign-in form's checkbox measures itself; jsdom has no ResizeObserver.
beforeAll(() => {
    globalThis.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
    calls = [];
    mockAssign.mockReset();
    mockSignInEmail.mockReset();
    window.sessionStorage.clear();
    mockAuth.isLoaded = true;
    mockAuth.isSignedIn = false;
    mockUser.user = null;
    routes = {
        "/api/workspace/join-links/preview": {
            status: 200,
            body: {
                valid: true,
                workspaceName: "Acme",
                role: "member",
                roleName: "Member",
                requiresApproval: false,
                invitedBy: "Ada Admin",
            },
        },
        "/api/workspace/join-links/accept": {
            status: 200,
            body: {
                success: true,
                status: "active",
                companyId: 5,
                redirectTo: "/employer/documents",
                alreadyMember: false,
            },
        },
    };
    // The page always calls fetch with a string URL and a JSON string body.
    global.fetch = jest.fn((url: string, init?: { method?: string; body?: string }) => {
        calls.push({
            url,
            method: init?.method ?? "GET",
            body: init?.body ? (JSON.parse(init.body) as unknown) : undefined,
        });
        const route = routes[url.split("?")[0]!];
        return route ? respond(route.status, route.body) : respond(404, {});
    }) as unknown as typeof fetch;
});

const link = { kind: "link" as const, code: "abcd1234" };
const accepts = () => calls.filter(c => c.url.endsWith("/accept"));

function signedIn() {
    mockAuth.isSignedIn = true;
    mockUser.user = { email: "newt@example.com", name: "Newt" };
}

describe("JoinLanding", () => {
    it("names the workspace and who invited you, and offers sign-up first", async () => {
        render(<JoinLanding source={link} socialProviders={[]} />);

        expect(await screen.findByRole("heading", { name: "Join Acme." })).toBeInTheDocument();
        expect(screen.getByText("Ada Admin")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "Create account" })).toHaveAttribute(
            "aria-selected",
            "true"
        );
        expect(screen.getByLabelText("Name")).toBeInTheDocument();
        expect(accepts()).toHaveLength(0);
    });

    it("joins straight away for someone back from signing in on this page", async () => {
        rememberJoinIntent("link", "abcd1234");
        signedIn();

        render(<JoinLanding source={link} socialProviders={[]} />);

        await waitFor(() => expect(mockAssign).toHaveBeenCalledWith("/employer/documents"));
        expect(accepts()).toEqual([
            {
                url: "/api/workspace/join-links/accept",
                method: "POST",
                body: { code: "abcd1234" },
            },
        ]);
        expect(screen.getByText("You're in. Opening Acme…")).toBeInTheDocument();
        expect(takeJoinWelcome()).toEqual({
            workspaceName: "Acme",
            roleName: "Member",
            invitedBy: "Ada Admin",
        });
    });

    it("never joins a signed-in person who only opened the link", async () => {
        signedIn();
        const user = userEvent.setup();

        render(<JoinLanding source={link} socialProviders={[]} />);

        const button = await screen.findByRole("button", { name: "Join Acme" });
        expect(screen.getByText("newt@example.com")).toBeInTheDocument();
        expect(accepts()).toHaveLength(0);

        await user.click(button);
        await waitFor(() => expect(mockAssign).toHaveBeenCalledWith("/employer/documents"));
        expect(accepts()).toHaveLength(1);
    });

    it("leaves the joining to the page that loads after an email sign-in", async () => {
        // Sign-in success reloads the page; the session can land here first.
        mockSignInEmail.mockResolvedValue({ error: null });
        jest.spyOn(console, "error").mockImplementation(() => {}); // jsdom: "navigation not implemented"
        const user = userEvent.setup();
        const view = render(<JoinLanding source={link} socialProviders={[]} />);

        await user.click(await screen.findByRole("tab", { name: "I have an account" }));
        await user.type(screen.getByLabelText("Email", { exact: true }), "newt@example.com");
        await user.type(screen.getByLabelText("Password", { exact: true }), "correct horse");
        await user.click(screen.getByRole("button", { name: /^Sign in$/ }));
        await waitFor(() => expect(mockSignInEmail).toHaveBeenCalled());

        signedIn();
        view.rerender(<JoinLanding source={link} socialProviders={[]} />);
        await new Promise(r => setTimeout(r, 50));
        expect(accepts()).toHaveLength(0);
        expect(hasJoinIntent("link", "abcd1234")).toBe(true);

        // The reloaded page joins.
        view.unmount();
        render(<JoinLanding source={link} socialProviders={[]} />);
        await waitFor(() => expect(mockAssign).toHaveBeenCalledWith("/employer/documents"));
        expect(accepts()).toHaveLength(1);
        expect(hasJoinIntent("link", "abcd1234")).toBe(false);
    });

    it("keeps the intent when the join never got an answer, so the next load retries", async () => {
        rememberJoinIntent("link", "abcd1234");
        signedIn();
        const realFetch = global.fetch;
        global.fetch = jest.fn((url: string, init?: { method?: string; body?: string }) =>
            url.endsWith("/accept")
                ? Promise.reject(new TypeError("Failed to fetch"))
                : realFetch(url, init as RequestInit)
        ) as unknown as typeof fetch;

        render(<JoinLanding source={link} socialProviders={[]} />);

        expect(await screen.findByText(/couldn't reach the server/)).toBeInTheDocument();
        expect(hasJoinIntent("link", "abcd1234")).toBe(true);
    });

    it("ignores a join intent left for a different link", async () => {
        rememberJoinIntent("link", "ffff0000");
        signedIn();

        render(<JoinLanding source={link} socialProviders={[]} />);

        await screen.findByRole("button", { name: "Join Acme" });
        expect(accepts()).toHaveLength(0);
    });

    it("says a request is waiting, without claiming they're in or navigating", async () => {
        routes["/api/workspace/join-links/preview"]!.body = {
            ...(routes["/api/workspace/join-links/preview"]!.body as object),
            requiresApproval: true,
        };
        routes["/api/workspace/join-links/accept"] = {
            status: 200,
            body: {
                success: true,
                status: "pending",
                companyId: 5,
                redirectTo: "/employer/pending-approval",
                alreadyMember: false,
            },
        };
        signedIn();
        const user = userEvent.setup();

        render(<JoinLanding source={link} socialProviders={[]} />);

        expect(
            await screen.findByText("An admin approves new members before they can get in.")
        ).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Ask to join Acme" }));

        expect(await screen.findByText(/Request sent\./)).toBeInTheDocument();
        expect(screen.queryByText(/You're in\./)).not.toBeInTheDocument();
        expect(mockAssign).not.toHaveBeenCalled();
        expect(takeJoinWelcome()).toBeNull();
    });

    it.each([
        ["inactive", "This invite link was turned off. Ask whoever sent it for a new one."],
        ["expired", "This invite link has expired. Ask whoever sent it for a new one."],
        [
            "exhausted",
            "This invite link has been used as many times as it allows. Ask for a new one.",
        ],
    ])("explains a %s link and offers no way to join", async (reason, message) => {
        routes["/api/workspace/join-links/preview"] = {
            status: 200,
            body: { valid: false, reason },
        };

        render(<JoinLanding source={link} socialProviders={[]} />);

        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Join/ })).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    });

    it("explains a link that died between loading and joining in the page's own words", async () => {
        routes["/api/workspace/join-links/accept"] = {
            status: 410,
            body: { error: "This join link was revoked." },
        };
        signedIn();
        const user = userEvent.setup();

        render(<JoinLanding source={link} socialProviders={[]} />);
        const join = await screen.findByRole("button", { name: "Join Acme" });
        routes["/api/workspace/join-links/preview"] = {
            status: 200,
            body: { valid: false, reason: "inactive" },
        };
        await user.click(join);

        expect(
            await screen.findByText(
                "This invite link was turned off. Ask whoever sent it for a new one."
            )
        ).toBeInTheDocument();
        expect(mockAssign).not.toHaveBeenCalled();
    });

    describe("an invitation", () => {
        const invite = { kind: "invite" as const, token: "tok_abcdefghijklmnopqrstuvwxyz" };

        beforeEach(() => {
            routes["/api/workspace/invitations/preview"] = {
                status: 200,
                body: {
                    workspaceName: "Acme",
                    workspaceSlug: "acme",
                    role: "member",
                    roleName: "Member",
                    email: "bob@example.com",
                    expiresAt: "2026-10-20T12:00:00.000Z",
                    status: "pending",
                    invitedBy: "Ada Admin",
                },
            };
        });

        it("fills in and locks the address it was sent to", async () => {
            render(<JoinLanding source={invite} socialProviders={[]} />);

            const email = await screen.findByLabelText("Email");
            expect(email).toHaveValue("bob@example.com");
            expect(email).toHaveAttribute("readonly");
            expect(screen.getByText("The invitation is for this address.")).toBeInTheDocument();
        });

        it("explains a different signed-in address instead of failing silently", async () => {
            routes["/api/workspace/invitations/accept"] = {
                status: 403,
                body: { error: "This invitation was sent to a different email address." },
            };
            signedIn();
            const user = userEvent.setup();

            render(<JoinLanding source={invite} socialProviders={[]} />);
            await user.click(await screen.findByRole("button", { name: "Join Acme" }));

            expect(
                await screen.findByRole("button", { name: "Sign out and use bob@example.com" })
            ).toBeInTheDocument();
            expect(mockAssign).not.toHaveBeenCalled();
        });

        it("says so when the invitation was already used", async () => {
            routes["/api/workspace/invitations/preview"]!.body = {
                ...(routes["/api/workspace/invitations/preview"]!.body as object),
                status: "accepted",
            };

            render(<JoinLanding source={invite} socialProviders={[]} />);

            expect(
                await screen.findByText(
                    "This invitation has already been used. Sign in to open the workspace."
                )
            ).toBeInTheDocument();
        });
    });
});

/** @jest-environment jsdom */

/**
 * Settings › People › Invitations: the invite link is one click to make and
 * one click to copy, its two settings save as they change, a reset is
 * confirmed first, and an invitation never claims an email went out when the
 * server has no way to send one.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { toast } from "sonner";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock("../api", () => {
    const actual = jest.requireActual<object>("../api");
    return {
        ...actual,
        peopleApi: {
            invitations: {
                list: jest.fn(),
                create: jest.fn(),
                resend: jest.fn(),
                revoke: jest.fn(),
            },
            joinLinks: {
                list: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                reset: jest.fn(),
                revoke: jest.fn(),
            },
            roles: { list: jest.fn() },
            groups: { list: jest.fn() },
        },
    };
});

import { InvitationsTab } from "../InvitationsTab";
import { peopleApi, type Invitation, type JoinLink, type Role } from "../api";

const api = peopleApi as unknown as {
    invitations: Record<"list" | "create" | "resend" | "revoke", jest.Mock>;
    joinLinks: Record<"list" | "create" | "update" | "reset" | "revoke", jest.Mock>;
    roles: { list: jest.Mock };
    groups: { list: jest.Mock };
};

const role = (slug: string, name: string): Role => ({
    id: null,
    slug,
    name,
    description: null,
    permissions: [],
    builtin: true,
    memberCount: 0,
    assignable: true,
    editable: false,
});

function joinLink(over: Partial<JoinLink> = {}): JoinLink {
    const code = over.code ?? "0123456789abcdef0123456789abcdef";
    return {
        id: 7,
        code,
        role: "member",
        roleName: "Member",
        isActive: true,
        requiresApproval: false,
        createdAt: "2026-10-10T12:00:00Z",
        expiresAt: null,
        maxUses: null,
        useCount: 0,
        url: `https://app.example.com/join/${code}`,
        ...over,
    };
}

const invitation: Invitation = {
    id: 3,
    email: "ada@example.com",
    role: "member",
    roleName: "Member",
    groupIds: [],
    invitedBy: null,
    createdAt: "2026-10-10T12:00:00Z",
    expiresAt: "2026-10-17T12:00:00Z",
    status: "pending",
};

const writeText = jest.fn(async (_text: string) => undefined);

// Radix measures a switch inside a form; jsdom has no ResizeObserver.
global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

async function renderTab() {
    render(<InvitationsTab can={() => true} />);
    // The tab has loaded once the invitation list settles.
    await screen.findByText("No invitations yet");
}

describe("InvitationsTab", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText },
            configurable: true,
        });
        api.invitations.list.mockResolvedValue({ invitations: [] });
        api.joinLinks.list.mockResolvedValue({ links: [] });
        api.roles.list.mockResolvedValue({
            roles: [
                role("owner", "Owner"),
                role("admin", "Admin"),
                role("member", "Member"),
                role("viewer", "Viewer"),
            ],
            permissions: [],
        });
        api.groups.list.mockResolvedValue({ groups: [] });
    });

    it("creates a Member invite link from the empty state and shows it at once", async () => {
        const created = joinLink();
        api.joinLinks.create.mockResolvedValue({ link: created });
        await renderTab();

        expect(screen.getByText(/Share one link to bring people in/)).toBeInTheDocument();
        api.joinLinks.list.mockResolvedValue({ links: [created] });

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));
        });

        expect(api.joinLinks.create).toHaveBeenCalledTimes(1);
        expect(api.joinLinks.create).toHaveBeenCalledWith({ role: "member" });
        expect(await screen.findByLabelText("Invite link")).toHaveValue(created.url);
        expect(
            screen.getByText(
                "Anyone with this link can create an account and land straight in the workspace as Member."
            )
        ).toBeInTheDocument();
    });

    it("shows the newest link in full and copies it", async () => {
        const link = joinLink();
        api.joinLinks.list.mockResolvedValue({ links: [link] });
        await renderTab();

        expect(screen.getByLabelText("Invite link")).toHaveValue(link.url);
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
        });
        expect(writeText).toHaveBeenCalledWith(link.url);
        expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    });

    it("saves the approval switch as it is flipped", async () => {
        const link = joinLink();
        api.joinLinks.list.mockResolvedValue({ links: [link] });
        api.joinLinks.update.mockResolvedValue({
            link: { ...link, requiresApproval: true },
        });
        await renderTab();

        const toggle = screen.getByRole("switch", { name: "Require admin approval" });
        expect(toggle).not.toBeChecked();
        api.joinLinks.list.mockResolvedValue({ links: [{ ...link, requiresApproval: true }] });

        await act(async () => {
            fireEvent.click(toggle);
        });

        expect(api.joinLinks.update).toHaveBeenCalledWith(7, { requiresApproval: true });
        expect(
            await screen.findByText(
                "People who open it wait on the Pending list until an admin approves them."
            )
        ).toBeInTheDocument();
        expect(screen.getByRole("switch", { name: "Require admin approval" })).toBeChecked();
    });

    it("asks before resetting the link, then shows the new one", async () => {
        const link = joinLink();
        const fresh = joinLink({ id: 8, code: "fedcba9876543210fedcba9876543210" });
        api.joinLinks.list.mockResolvedValue({ links: [link] });
        api.joinLinks.reset.mockResolvedValue({ link: fresh });
        await renderTab();

        fireEvent.click(screen.getByRole("button", { name: "Reset link" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("Reset the invite link?")).toBeInTheDocument();
        expect(within(dialog).getByText(/stops working right away/)).toBeInTheDocument();
        expect(api.joinLinks.reset).not.toHaveBeenCalled();

        api.joinLinks.list.mockResolvedValue({ links: [fresh] });
        await act(async () => {
            fireEvent.click(within(dialog).getByRole("button", { name: "Reset link" }));
        });

        expect(api.joinLinks.reset).toHaveBeenCalledWith(7);
        await waitFor(() => expect(screen.getByLabelText("Invite link")).toHaveValue(fresh.url));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("lists other links under More links with their approval badge", async () => {
        const primary = joinLink();
        const other = joinLink({
            id: 5,
            code: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            role: "viewer",
            roleName: "Viewer",
            requiresApproval: true,
            maxUses: 10,
            useCount: 2,
        });
        api.joinLinks.list.mockResolvedValue({ links: [primary, other] });
        await renderTab();

        expect(screen.getByLabelText("Invite link")).toHaveValue(primary.url);
        expect(screen.getByText(other.url)).toBeInTheDocument();
        expect(screen.getByText("Needs approval")).toBeInTheDocument();
        expect(screen.getByText("2 of 10 uses · never expires")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Copy code" })).not.toBeInTheDocument();
        expect(screen.queryByText(/workspace setting/)).not.toBeInTheDocument();
    });

    it("keeps the open-ended link in the card when a newer capped link exists", async () => {
        const open = joinLink();
        const capped = joinLink({
            id: 9,
            code: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            url: "https://app.example.com/join/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            maxUses: 3,
        });
        // Newest first: the capped link was made after the open-ended one.
        api.joinLinks.list.mockResolvedValue({ links: [capped, open] });
        await renderTab();

        expect(screen.getByLabelText("Invite link")).toHaveValue(open.url);
        expect(screen.getByText(capped.url)).toBeInTheDocument();
    });

    it("says nothing was sent when the server can't email, and gives the link", async () => {
        const acceptUrl = "https://app.example.com/invite/tok_123";
        api.invitations.create.mockResolvedValue({ invitation, acceptUrl, emailSent: false });
        await renderTab();

        fireEvent.change(screen.getByLabelText("Email"), {
            target: { value: "ada@example.com" },
        });
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
        });

        expect(
            await screen.findByText("Email isn't set up on this server, so nothing was sent.")
        ).toBeInTheDocument();
        expect(screen.getByText(/send it to ada@example.com yourself/)).toBeInTheDocument();
        expect(screen.getByLabelText("Invitation link for ada@example.com")).toHaveValue(acceptUrl);
        expect(toast.success).toHaveBeenCalledWith("Invitation created — copy the link to send it");
        expect(screen.queryByText(/Invitation emailed/)).not.toBeInTheDocument();
    });

    it("says the invitation was emailed when it was", async () => {
        const acceptUrl = "https://app.example.com/invite/tok_456";
        api.invitations.create.mockResolvedValue({ invitation, acceptUrl, emailSent: true });
        await renderTab();

        fireEvent.change(screen.getByLabelText("Email"), {
            target: { value: "ada@example.com" },
        });
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
        });

        expect(
            await screen.findByText("Invitation emailed to ada@example.com.")
        ).toBeInTheDocument();
        expect(screen.getByLabelText("Invitation link for ada@example.com")).toHaveValue(acceptUrl);
        expect(screen.queryByText(/nothing was sent/)).not.toBeInTheDocument();
    });
});

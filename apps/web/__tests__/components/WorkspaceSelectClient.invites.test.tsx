/** @jest-environment jsdom */

/**
 * Pending invites on the workspace picker. A decline is only reported as
 * one when the server says it declined (or already had). An invitation that
 * was used, withdrawn or expired meanwhile — a stale page — says which,
 * under its own row, and the list refreshes.
 */

import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: mockRefresh }),
}));
jest.mock("next-themes", () => ({
    useTheme: () => ({ theme: "light", resolvedTheme: "light", setTheme: jest.fn() }),
}));
jest.mock("~/lib/auth-client", () => ({
    authClient: { useSession: () => ({ data: null }) },
    listDeviceAccounts: () => Promise.resolve([]),
}));
jest.mock("~/lib/profile/use-my-profile", () => ({
    useMyProfile: () => ({ data: undefined }),
    resetMyProfile: jest.fn(),
}));
jest.mock("sonner", () => ({
    toast: { success: jest.fn(), error: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

import { toast } from "sonner";

import { WorkspaceSelectClient } from "~/app/workspaces/WorkspaceSelectClient";

const mockToast = toast as unknown as { success: jest.Mock };

const INVITE = {
    id: "41",
    companyName: "Basecamp",
    slug: "basecamp",
    swatch: 2,
    invitedBy: "Dev Owner",
    invitedAt: new Date().toISOString(),
    role: "member",
};

function answer(status: number, body: unknown) {
    globalThis.fetch = jest.fn((url: string) =>
        Promise.resolve({
            ok: status >= 200 && status < 300 && url.includes("/decline"),
            status: url.includes("/decline") ? status : 404,
            json: () => Promise.resolve(body),
        })
    ) as unknown as typeof fetch;
}

function renderPicker() {
    return render(
        <WorkspaceSelectClient
            account={{ name: "Ada", email: "ada@example.com" }}
            fromSignup={false}
            workspaces={[]}
            pendingInvites={[INVITE]}
        />
    );
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe("declining an invitation", () => {
    it("reports a decline that happened, and drops the row", async () => {
        answer(200, { success: true, alreadyDeclined: false });
        const user = userEvent.setup();
        renderPicker();

        await user.click(screen.getByRole("button", { name: "Decline" }));

        await waitFor(() =>
            expect(mockToast.success).toHaveBeenCalledWith("Declined the invitation to Basecamp.")
        );
        expect(screen.queryByText("Basecamp")).toBeNull();
        expect(mockRefresh).toHaveBeenCalled();
    });

    it("counts one that was already declined as declined", async () => {
        answer(200, { success: true, alreadyDeclined: true });
        const user = userEvent.setup();
        renderPicker();

        await user.click(screen.getByRole("button", { name: "Decline" }));

        await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    });

    it.each([
        ["accepted", "This invitation has already been used."],
        ["revoked", "This invitation was revoked."],
        ["expired", "This invitation has expired. Ask for a new one."],
    ])("an invitation %s meanwhile: says so under the row, no success", async (reason, error) => {
        answer(410, { error, reason });
        const user = userEvent.setup();
        renderPicker();

        await user.click(screen.getByRole("button", { name: "Decline" }));

        const note = await screen.findByRole("alert");
        expect(note).toHaveTextContent(error);
        expect(mockToast.success).not.toHaveBeenCalled();
        // Still on screen to read, with nothing left to press.
        expect(screen.getByText("Basecamp")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Accept & open" })).toBeNull();
        expect(mockRefresh).toHaveBeenCalled();
    });

    it("a server error leaves the row and its buttons, with the error under it", async () => {
        answer(500, { error: "Something went wrong." });
        const user = userEvent.setup();
        renderPicker();

        await user.click(screen.getByRole("button", { name: "Decline" }));

        expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
        expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled();
        expect(mockToast.success).not.toHaveBeenCalled();
        expect(within(document.body).getByText("Basecamp")).toBeInTheDocument();
    });
});

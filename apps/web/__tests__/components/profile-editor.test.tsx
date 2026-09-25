/** @jest-environment jsdom */

/**
 * "Reset to my profile" clears this workspace's override and nothing else:
 * an unsaved edit to a profile field must survive it.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("~/lib/auth-client", () => ({
    authClient: { updateUser: jest.fn(async () => ({ error: null })) },
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import { ProfileEditor } from "~/app/employer/documents/_workspace/settings/ProfileEditor";
import type { MyProfile } from "~/lib/profile/resolve";
import { resetMyProfile } from "~/lib/profile/use-my-profile";

const profile = {
    name: "Ada Lovelace",
    email: "ada@example.com",
    displayName: "Ada",
    title: "Founder",
    pronouns: null,
    timeZone: null,
    bio: null,
    avatarUrl: null,
};

function snapshot(override: { displayName: string | null; title: string | null }): MyProfile {
    const workspace = {
        id: "1",
        name: "Acme",
        override: { ...override, avatarUrl: null },
    };
    return {
        profile,
        workspace,
        effective: {
            ...profile,
            displayName: override.displayName ?? profile.displayName,
            title: override.title ?? profile.title,
            initials: "A",
        },
    };
}

const json = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe("ProfileEditor", () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/profile/workspace" && init?.method === "DELETE") {
                return json(snapshot({ displayName: null, title: null }));
            }
            return json(snapshot({ displayName: "Ada at Acme", title: "Advisor" }));
        });
        global.fetch = fetchMock as unknown as typeof fetch;
        act(() => resetMyProfile());
    });

    it("keeps unsaved profile edits when the workspace override is reset", async () => {
        render(<ProfileEditor emailVerified onActions={() => undefined} />);
        const title = await screen.findByDisplayValue("Founder");
        expect(screen.getByDisplayValue("Ada at Acme")).toBeInTheDocument();

        fireEvent.change(title, { target: { value: "CTO" } });
        fireEvent.change(screen.getByDisplayValue("Advisor"), { target: { value: "Board" } });

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Reset to my profile" }));
        });

        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith(
                "/api/profile/workspace",
                expect.objectContaining({ method: "DELETE" })
            )
        );
        // The profile edit survives; the workspace fields (including the
        // unsaved "Board") are what Reset throws away.
        await waitFor(() => expect(screen.queryByDisplayValue("Ada at Acme")).toBeNull());
        expect(screen.getByDisplayValue("CTO")).toBeInTheDocument();
        expect(screen.queryByDisplayValue("Board")).toBeNull();
        expect(screen.queryByDisplayValue("Advisor")).toBeNull();
    });
});

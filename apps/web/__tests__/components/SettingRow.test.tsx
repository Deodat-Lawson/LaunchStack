/** @jest-environment jsdom */

/**
 * Who set a shared value.
 *
 * `settings_values.updated_by` is an auth user id. The row must say who that
 * is in words a person recognises — "you", the name the workspace knows them
 * by, or that they have left — and the id itself must never reach the page,
 * not even while the name is still being looked up.
 */

import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { SettingRow } from "~/app/employer/documents/_workspace/settings/SettingRow";
import type { PersonLook } from "~/lib/profile/resolve";
import { resetPeopleCache } from "~/lib/profile/use-people";
import type { SettingsPayload } from "~/lib/settings/types";
import { resetSettingsForTests } from "~/lib/settings/useSettings";

const VIEWER = "viewerAuthId0000000000000000000";
const ADA = "7J3DlHa4NlmveJHc6SuiTFEN8Lya4p4f";
const LEFT = "leftAuthId000000000000000000000";

const ada: PersonLook = {
    authUserId: ADA,
    name: "Ada Lovelace",
    email: "ada@example.test",
    displayName: "Ada",
    title: null,
    pronouns: null,
    avatarUrl: null,
    member: true,
};

function payloadSetBy(updatedBy: string): SettingsPayload {
    return {
        settings: {
            "agents.defaultAutonomy": {
                key: "agents.defaultAutonomy",
                value: "propose",
                source: "workspace",
                sourceId: null,
                updatedBy,
                updatedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
                canEdit: { workspace: true, folder: false, member: false },
                stored: { workspace: "propose" },
            },
        },
        viewer: { authUserId: VIEWER, permissions: ["settings.manage"] },
        folder: null,
    };
}

const json = (body: unknown, status = 200) =>
    ({ ok: status < 400, status, json: async () => body }) as Response;

describe("SettingRow — who set it", () => {
    const fetchMock = jest.fn();
    let peopleStatus = 200;

    function serve(updatedBy: string) {
        fetchMock.mockImplementation(async (input: string) => {
            const url = String(input);
            if (url.startsWith("/api/settings")) return json(payloadSetBy(updatedBy));
            if (url.startsWith("/api/profile/people")) {
                if (peopleStatus !== 200) return json({ error: "nope" }, peopleStatus);
                // The route answers members only; someone who left is simply absent.
                return json({ people: { [ADA]: ada } });
            }
            throw new Error(`unexpected fetch ${url}`);
        });
    }

    const peopleCalls = () =>
        fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/profile/people"));

    beforeEach(() => {
        fetchMock.mockReset();
        peopleStatus = 200;
        global.fetch = fetchMock as unknown as typeof fetch;
        resetSettingsForTests();
        act(() => resetPeopleCache());
    });

    it("names a teammate by their display name", async () => {
        serve(ADA);
        const { container } = render(<SettingRow settingKey="agents.defaultAutonomy" />);

        expect(await screen.findByText("Set 2 min ago by Ada")).toBeInTheDocument();
        expect(container).not.toHaveTextContent(ADA);
    });

    it('calls the viewer "you" without looking anyone up', async () => {
        serve(VIEWER);
        const { container } = render(<SettingRow settingKey="agents.defaultAutonomy" />);

        expect(await screen.findByText("Set 2 min ago by you")).toBeInTheDocument();
        expect(container).not.toHaveTextContent(VIEWER);
        expect(peopleCalls()).toHaveLength(0);
    });

    it("says the setter has left when the workspace no longer has them", async () => {
        serve(LEFT);
        const { container } = render(<SettingRow settingKey="agents.defaultAutonomy" />);

        expect(
            await screen.findByText("Set 2 min ago by someone who has left")
        ).toBeInTheDocument();
        expect(container).not.toHaveTextContent(LEFT);
    });

    it("never shows the id while the name is on its way", async () => {
        let answer: (value: Response) => void = () => undefined;
        fetchMock.mockImplementation((input: string) => {
            const url = String(input);
            if (url.startsWith("/api/settings")) return Promise.resolve(json(payloadSetBy(ADA)));
            return new Promise<Response>(resolve => {
                answer = resolve;
            });
        });
        const { container } = render(<SettingRow settingKey="agents.defaultAutonomy" />);

        expect(await screen.findByText("Set 2 min ago")).toBeInTheDocument();
        expect(container).not.toHaveTextContent(ADA);

        await act(async () => answer(json({ people: { [ADA]: ada } })));
        expect(await screen.findByText("Set 2 min ago by Ada")).toBeInTheDocument();
    });

    it("does not claim someone left when the lookup itself failed", async () => {
        peopleStatus = 500;
        serve(ADA);
        const { container } = render(<SettingRow settingKey="agents.defaultAutonomy" />);

        await waitFor(() => expect(peopleCalls()).toHaveLength(1));
        expect(await screen.findByText("Set 2 min ago")).toBeInTheDocument();
        expect(container).not.toHaveTextContent(/someone who has left/);
        expect(container).not.toHaveTextContent(ADA);
    });
});

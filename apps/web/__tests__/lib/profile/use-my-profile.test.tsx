/** @jest-environment jsdom */

/**
 * The profile store follows the active workspace. Client-side navigation
 * keeps the module alive across a switch, so it must revalidate on every
 * mount (not "if older than N seconds"), forget everything on
 * `resetMyProfile`, and drop a response that was already in flight for the
 * workspace being left.
 */

import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import type { MyProfile } from "~/lib/profile/resolve";
import { resetMyProfile, useMyProfile } from "~/lib/profile/use-my-profile";

function profileIn(workspace: string): MyProfile {
    const profile = {
        name: "Ada Lovelace",
        email: "ada@example.com",
        displayName: null,
        title: null,
        pronouns: null,
        timeZone: null,
        bio: null,
        avatarUrl: null,
    };
    return {
        profile,
        workspace: {
            id: workspace,
            name: workspace,
            override: { displayName: `Ada at ${workspace}`, title: null, avatarUrl: null },
        },
        effective: {
            ...profile,
            displayName: `Ada at ${workspace}`,
            initials: "AA",
        },
    };
}

function Probe() {
    const { data, loaded } = useMyProfile();
    return <span data-testid="who">{loaded ? (data?.effective.displayName ?? "none") : "…"}</span>;
}

type Deferred = { resolve: (r: Response) => void; promise: Promise<Response> };
function deferred(): Deferred {
    let resolve!: (r: Response) => void;
    const promise = new Promise<Response>(r => {
        resolve = r;
    });
    return { resolve, promise };
}
const json = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe("useMyProfile across a workspace switch", () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
        act(() => resetMyProfile());
    });

    it("revalidates when a new screen mounts, however recent the last fetch", async () => {
        fetchMock.mockResolvedValueOnce(json(profileIn("Acme")));
        const first = render(<Probe />);
        await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("Ada at Acme"));
        first.unmount();

        // The server-side active workspace changed; the next screen mounts at once.
        fetchMock.mockResolvedValueOnce(json(profileIn("Beta")));
        render(<Probe />);
        await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("Ada at Beta"));
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("shares one request between components mounting together", async () => {
        fetchMock.mockResolvedValue(json(profileIn("Acme")));
        render(
            <>
                <Probe />
                <Probe />
            </>
        );
        await waitFor(() => expect(screen.getAllByTestId("who")[0]).toHaveTextContent("Acme"));
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("forgets the old workspace on reset and ignores its late response", async () => {
        const late = deferred();
        fetchMock.mockReturnValueOnce(late.promise);
        render(<Probe />);

        // Switching away while Acme's response is still on its way.
        act(() => resetMyProfile());
        expect(screen.getByTestId("who")).toHaveTextContent("…");

        await act(async () => {
            late.resolve(json(profileIn("Acme")));
            await late.promise;
        });
        expect(screen.getByTestId("who")).not.toHaveTextContent("Acme");
    });
});

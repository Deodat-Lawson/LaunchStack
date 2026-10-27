/** @jest-environment jsdom */

/**
 * Workspace › Bring your own keys: the workspace's own API key, and nothing
 * else. What must not regress: the embedding key it once had stays gone (no
 * field, no read of the company's embedding config, no Save of its own), and
 * OpenRouter's return leg still turns into a note here and leaves the
 * address bar. The API key panel itself is `WorkspaceModelPanel.test.tsx`.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { KeysSection } from "~/app/employer/documents/_workspace/settings/KeysSection";
import type { SettingsSectionActions } from "~/app/employer/documents/_workspace/settings/contract";

const fetchMock = jest.fn();

/** jsdom has no `Response`; the section only reads ok, status and json(). */
function respond(endpoint: unknown = null) {
    fetchMock.mockImplementation((url: string) => {
        const [status, body] =
            url === "/api/settings/models/workspace"
                ? [200, { endpoint }]
                : [404, { error: `unexpected ${url}` }];
        return Promise.resolve({
            ok: status < 400,
            status,
            json: () => Promise.resolve(body),
        });
    });
}

let actions: SettingsSectionActions | null = null;

beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    actions = null;
    window.history.replaceState(null, "", "/employer/documents");
});

describe("KeysSection", () => {
    it("offers the workspace's own API key, and no embedding key", async () => {
        respond();
        render(<KeysSection onActions={a => (actions = a)} />);

        expect(await screen.findByRole("heading", { name: "API key" })).toBeInTheDocument();
        expect(await screen.findByRole("button", { name: "Connect OpenRouter" })).toBeVisible();
        expect(screen.queryByRole("heading", { name: "Embedding key" })).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Embedding API key")).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Embeddings endpoint URL")).not.toBeInTheDocument();
        // Nothing reads the company's embedding config any more.
        expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain("/api/fetchCompany");
    });

    it("publishes no Save of its own while the model editor is closed", async () => {
        respond();
        render(<KeysSection onActions={a => (actions = a)} />);
        await screen.findByRole("button", { name: "Connect OpenRouter" });
        await waitFor(() => expect(actions?.primaryLabel).toBeUndefined());
    });

    it("turns OpenRouter's return into a note, and takes it out of the address bar", async () => {
        window.history.replaceState(
            null,
            "",
            "/employer/documents?feature=workspace&at=%2Fbyok&openrouter=denied"
        );
        respond();
        render(<KeysSection onActions={a => (actions = a)} />);

        expect(
            await screen.findByText("OpenRouter sign-in was cancelled. Nothing changed.")
        ).toBeInTheDocument();
        expect(window.location.search).toBe("?feature=workspace&at=%2Fbyok");
    });
});

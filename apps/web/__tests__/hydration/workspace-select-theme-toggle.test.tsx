/** @jest-environment jsdom */

/**
 * /workspaces hydrates whatever theme the browser picked.
 *
 * The server can't know the theme: next-themes reads it from localStorage, so
 * on the server `useTheme()` returns undefined. The theme toggle used to pick
 * its icon from `resolvedTheme`, so the server drew a Sun and a dark-theme
 * browser's first render drew a Moon. That was "Hydration failed because the
 * server rendered HTML didn't match the client" on every dark-theme load.
 * Both icons now ship in the markup and `[data-theme="dark"]` CSS shows one.
 *
 * This renders the page's client component the way the server does (no
 * theme), then hydrates that markup with each theme a browser can have.
 * Jest runs React 18, not the React 19 the app router uses, but both fail
 * hydration on this mismatch: the two icons' SVGs have different children.
 */

import React, { act } from "react";
import { hydrateRoot } from "react-dom/client";
// The node build: the browser one jsdom would resolve needs a TextEncoder.
import { renderToString } from "react-dom/server.node";

type Theme = { theme: string | undefined; resolvedTheme: string | undefined };
let mockTheme: Theme = { theme: undefined, resolvedTheme: undefined };
const mockSetTheme = jest.fn();
jest.mock("next-themes", () => ({
    useTheme: () => ({ ...mockTheme, setTheme: mockSetTheme }),
}));
jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));
jest.mock("~/lib/auth-client", () => ({ useAuth: () => ({ signOut: jest.fn() }) }));
jest.mock("~/lib/profile/use-my-profile", () => ({
    useMyProfile: () => ({ data: undefined }),
    resetMyProfile: jest.fn(),
}));

import { WorkspaceSelectClient } from "~/app/workspaces/WorkspaceSelectClient";

const SERVER: Theme = { theme: undefined, resolvedTheme: undefined };

const page = (
    <WorkspaceSelectClient
        account={{ name: "Ada Lovelace", email: "ada@launchstack.test" }}
        fromSignup={false}
        workspaces={[
            {
                id: "1",
                name: "Analytical Engines",
                slug: "engines",
                description: null,
                swatch: 1,
                role: "owner",
                status: "active",
                memberCount: 3,
                me: null,
                teammates: [],
                lastOpenedAt: "2026-01-01T00:00:00.000Z",
                isActive: true,
            },
        ]}
    />
);

function serverHtml(): string {
    mockTheme = SERVER;
    return renderToString(page);
}

/** Hydrates the server's markup as a browser with `theme`; returns React's complaints. */
async function hydrateAs(theme: Theme, html: string): Promise<string[]> {
    const complaints: string[] = [];
    const errors = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        complaints.push(args.map(String).join(" "));
    });
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    document.documentElement.dataset.theme = theme.resolvedTheme;
    mockTheme = theme;
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
        await act(async () => {
            root = hydrateRoot(container, page, {
                onRecoverableError: error => complaints.push(String(error)),
            });
        });
    } finally {
        act(() => root?.unmount());
        container.remove();
        errors.mockRestore();
    }
    return complaints;
}

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("/workspaces theme toggle hydration", () => {
    it.each<[string, Theme]>([
        ["dark", { theme: "dark", resolvedTheme: "dark" }],
        ["light", { theme: "light", resolvedTheme: "light" }],
        ["system, resolving to dark", { theme: "system", resolvedTheme: "dark" }],
        ["system, resolving to light", { theme: "system", resolvedTheme: "light" }],
    ])("hydrates without a mismatch in a %s browser", async (_name, theme) => {
        expect(await hydrateAs(theme, serverHtml())).toEqual([]);
    });

    it("renders the same markup whatever the theme, with both icons for CSS to choose", () => {
        const html = serverHtml();
        expect(html).toContain("lucide-sun");
        expect(html).toContain("lucide-moon");
        for (const resolvedTheme of ["dark", "light"]) {
            mockTheme = { theme: resolvedTheme, resolvedTheme };
            expect(renderToString(page)).toBe(html);
        }
    });
});

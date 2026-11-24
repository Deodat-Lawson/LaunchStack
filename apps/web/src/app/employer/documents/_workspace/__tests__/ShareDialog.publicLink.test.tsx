/** @jest-environment jsdom */

/**
 * The Share dialog's "Public link" section (ADR-016): a file only, loaded on
 * its own when the dialog opens, and every control acts at once — none of it
 * waits for the dialog's Save. Managers make, copy, time-limit, switch
 * download on or off, and turn off the link (after confirming); everyone else
 * sees it read-only; with the workspace switch off nothing new can be made.
 */

import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { toast } from "sonner";

import {
    ShareDialog,
    type ShareAdapter,
    type ShareState,
    type ShareTarget,
} from "../access/ShareDialog";
import type { PublicLink, PublicLinkState } from "../settings/people/api";
import { PUBLIC_LINKS_SETTING } from "~/lib/settings/registry";
import { workspaceHref } from "~/lib/settings/surfaces";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// Radix measures popper content (the tooltip, the menu); jsdom has no layout.
global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
    Element.prototype.hasPointerCapture = jest.fn(() => false);
    Element.prototype.releasePointerCapture = jest.fn();
});

const DOC: ShareTarget = { kind: "document", id: 42, name: "Q3 plan.pdf" };
const ROUTE = "/api/workspace/documents/42/public-link";

const LINK: PublicLink = {
    url: "https://app.example.test/s/tok_abc",
    markdownUrl: "https://app.example.test/s/tok_abc.md",
    allowDownload: true,
    expiresAt: null,
    createdAt: "2026-11-20T10:00:00.000Z",
    createdBy: "ada-auth",
};

const state = (over: Partial<PublicLinkState> = {}): PublicLinkState => ({
    link: null,
    canManage: true,
    enabled: true,
    ...over,
});

/** Who has access: only the people listed, nobody yet — the section does not care. */
const adapter: ShareAdapter = {
    load: async (): Promise<ShareState> => ({
        general: "restricted",
        grants: [],
        canManage: true,
        open: { kind: "workspace", workspaceName: "Acme", verb: "open" },
        levels: ["view", "edit", "manage"],
        owner: null,
        audienceCount: null,
    }),
    save: jest.fn(async () => undefined),
};

interface Call {
    method: string;
    body: unknown;
}

let calls: Call[] = [];
/** What the public-link route answers next, per method. */
let answers: Record<string, () => { status: number; body: unknown }> = {};

const fetchMock = jest.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    let status = 200;
    let body: unknown = { users: [], groups: [], roles: [] };
    if (url === ROUTE) {
        calls.push({
            method,
            body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        });
        const answer = answers[method]?.() ?? { status: 404, body: { error: "unexpected" } };
        status = answer.status;
        body = answer.body;
    } else if (!url.startsWith("/api/workspace/principals")) {
        status = 404;
        body = { error: `unexpected ${url}` };
    }
    return {
        ok: status < 400,
        status,
        text: async () => JSON.stringify(body),
        json: async () => body,
    } as Response;
});

function answer(method: string, body: unknown, status = 200) {
    answers[method] = () => ({ status, body });
}

const calledWith = (method: string) => calls.filter(c => c.method === method);

function renderDialog(target: ShareTarget = DOC) {
    const onSaved = jest.fn();
    const onClose = jest.fn();
    render(
        <ShareDialog
            target={target}
            onClose={onClose}
            onSaved={onSaved}
            selfAuthId="ada-auth"
            adapter={adapter}
        />
    );
    return { onSaved, onClose };
}

const section = () => screen.findByRole("region", { name: "Public link" });

beforeEach(() => {
    jest.clearAllMocks();
    calls = [];
    answers = {};
    global.fetch = fetchMock as unknown as typeof fetch;
});

describe("ShareDialog › Public link", () => {
    it("offers to make a link, makes it at once, and has the lists refetch their badges", async () => {
        const user = userEvent.setup();
        answer("GET", state());
        answer("POST", state({ link: LINK }));
        const { onSaved } = renderDialog();

        const region = await section();
        expect(
            within(region).getByText(
                "Anyone with the link can view this file, without signing in. AI agents can read it too."
            )
        ).toBeInTheDocument();
        await user.click(await within(region).findByRole("button", { name: "Create public link" }));

        expect(
            await within(region).findByRole("textbox", { name: "Public link address" })
        ).toHaveValue(LINK.url);
        expect(calledWith("POST")).toEqual([{ method: "POST", body: {} }]);
        expect(toast.success).toHaveBeenCalledWith("Public link to “Q3 plan.pdf” created");
        expect(onSaved).toHaveBeenCalledTimes(1);
        // It is not part of the dialog's Save: nothing there to save.
        expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
        expect(within(region).getByText("Changes to the link apply at once.")).toBeInTheDocument();
    });

    it("copies the link, and the plain-text link for AI agents", async () => {
        const user = userEvent.setup();
        answer("GET", state({ link: LINK }));
        renderDialog();
        const region = await section();

        await user.click(await within(region).findByRole("button", { name: "Copy link" }));
        expect(await navigator.clipboard.readText()).toBe(LINK.url);
        expect(toast.success).toHaveBeenLastCalledWith("Link copied");

        const forAi = within(region).getByRole("button", { name: "Copy for AI" });
        await user.hover(forAi);
        expect(
            await screen.findByRole("tooltip", {
                name: "Copies the plain-text (Markdown) version of the link, for AI agents.",
            })
        ).toBeInTheDocument();
        await user.click(forAi);
        expect(await navigator.clipboard.readText()).toBe(LINK.markdownUrl);
        expect(toast.success).toHaveBeenLastCalledWith("Plain-text link for AI agents copied");
    });

    it("sets an expiry and switches download off at once, and shows the date it expires", async () => {
        const user = userEvent.setup();
        const expiresAt = "2026-11-28T10:00:00.000Z";
        answer("GET", state({ link: LINK }));
        renderDialog();
        const region = await section();

        const expiry = await within(region).findByRole("combobox", { name: "Expires" });
        expect(expiry).toHaveTextContent("Never");

        answer("PATCH", state({ link: { ...LINK, expiresAt } }));
        await user.click(expiry);
        await user.click(await screen.findByRole("option", { name: "In 7 days" }));

        await waitFor(() => expect(expiry).toHaveTextContent(/^On Nov 2[78], 2026$/));
        expect(calledWith("PATCH")).toEqual([{ method: "PATCH", body: { expiresInDays: 7 } }]);
        expect(toast.success).toHaveBeenLastCalledWith(
            expect.stringMatching(/^The link now expires on Nov 2[78], 2026$/)
        );

        const download = within(region).getByRole("switch", { name: "Allow download" });
        expect(download).toBeChecked();
        answer("PATCH", state({ link: { ...LINK, expiresAt, allowDownload: false } }));
        await user.click(download);

        await waitFor(() => expect(download).not.toBeChecked());
        expect(calledWith("PATCH")[1]).toEqual({
            method: "PATCH",
            body: { allowDownload: false },
        });
        expect(toast.success).toHaveBeenLastCalledWith(
            "People with the link can no longer download “Q3 plan.pdf”"
        );

        // Back to never: the expiry is lifted.
        answer("PATCH", state({ link: { ...LINK, allowDownload: false } }));
        await user.click(expiry);
        await user.click(await screen.findByRole("option", { name: "Never" }));
        await waitFor(() => expect(expiry).toHaveTextContent("Never"));
        expect(calledWith("PATCH")[2]).toEqual({
            method: "PATCH",
            body: { expiresInDays: null },
        });
        expect(toast.success).toHaveBeenLastCalledWith("The link no longer expires");
        expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("turns the link off only after confirming, then offers a new one", async () => {
        const user = userEvent.setup();
        answer("GET", state({ link: LINK }));
        answer("DELETE", state());
        const { onSaved } = renderDialog();
        const region = await section();

        // Cancelling changes nothing.
        await user.click(await within(region).findByRole("button", { name: "Turn off link" }));
        expect(
            await screen.findByRole("heading", { name: "Turn off the public link?" })
        ).toBeInTheDocument();
        await user.click(screen.getByTestId("confirm-cancel"));
        expect(calledWith("DELETE")).toEqual([]);

        await user.click(within(region).getByRole("button", { name: "Turn off link" }));
        await user.click(await screen.findByTestId("confirm-accept"));

        expect(
            await within(region).findByRole("button", { name: "Create public link" })
        ).toBeInTheDocument();
        expect(calledWith("DELETE")).toHaveLength(1);
        expect(within(region).queryByRole("textbox")).not.toBeInTheDocument();
        expect(toast.success).toHaveBeenLastCalledWith("Public link to “Q3 plan.pdf” turned off");
        expect(onSaved).toHaveBeenCalledTimes(1);
    });

    it("shows a link read-only to someone who cannot manage the file", async () => {
        answer(
            "GET",
            state({
                link: { ...LINK, expiresAt: "2026-12-20T10:00:00.000Z" },
                canManage: false,
            })
        );
        renderDialog();
        const region = await section();

        expect(
            await within(region).findByRole("textbox", { name: "Public link address" })
        ).toHaveValue(LINK.url);
        expect(within(region).getByRole("button", { name: "Copy link" })).toBeEnabled();
        expect(within(region).getByRole("button", { name: "Copy for AI" })).toBeEnabled();
        expect(within(region).queryByRole("combobox", { name: "Expires" })).toBeNull();
        expect(within(region).queryByRole("switch")).toBeNull();
        expect(within(region).queryByRole("button", { name: "Turn off link" })).toBeNull();
        expect(within(region).getByText(/^Expires on Dec 20, 2026\.$/)).toBeInTheDocument();
        expect(
            within(region).getByText("Only people who manage this file can change its public link.")
        ).toBeInTheDocument();
    });

    it("tells someone who cannot manage the file that they cannot make a link", async () => {
        answer("GET", state({ canManage: false }));
        renderDialog();
        const region = await section();

        expect(
            await within(region).findByText(
                "Only people who manage this file can make a public link."
            )
        ).toBeInTheDocument();
        expect(within(region).queryByRole("button", { name: "Create public link" })).toBeNull();
    });

    it("offers nothing to make while the workspace has public links off, and says where to turn them on", async () => {
        answer("GET", state({ enabled: false }));
        renderDialog();
        const region = await section();

        const settings = await within(region).findByRole("link", {
            name: "Workspace › People and access",
        });
        expect(settings).toHaveAttribute(
            "href",
            workspaceHref("people", { focus: PUBLIC_LINKS_SETTING })
        );
        expect(region).toHaveTextContent(
            "Public links are off in this workspace. An owner or admin can turn them on in Workspace › People and access."
        );
        expect(within(region).queryByRole("button", { name: "Create public link" })).toBeNull();
    });

    it("says the switch is off when it was turned off after the dialog opened", async () => {
        const user = userEvent.setup();
        answer("GET", state());
        answer(
            "POST",
            { error: "Public links are turned off in this workspace.", code: "public_links_off" },
            403
        );
        renderDialog();
        const region = await section();

        await user.click(await within(region).findByRole("button", { name: "Create public link" }));

        expect(
            await within(region).findByRole("link", { name: "Workspace › People and access" })
        ).toBeInTheDocument();
        expect(within(region).queryByRole("button", { name: "Create public link" })).toBeNull();
        expect(toast.success).not.toHaveBeenCalled();
    });

    it("says what went wrong when a change is refused", async () => {
        const user = userEvent.setup();
        answer("GET", state({ link: LINK }));
        answer(
            "PATCH",
            { error: "Only people who can manage this file can make or change its public link." },
            403
        );
        renderDialog();
        const region = await section();

        await user.click(await within(region).findByRole("switch", { name: "Allow download" }));

        expect(await within(region).findByRole("alert")).toHaveTextContent(
            "Only people who can manage this file can make or change its public link."
        );
        // The switch stays where the server left it.
        expect(within(region).getByRole("switch", { name: "Allow download" })).toBeChecked();
    });

    it.each<ShareTarget>([
        { kind: "folder", path: "Finance", name: "Finance" },
        { kind: "chat", id: "c1", name: "Pricing chat" },
    ])("has no public link for a $kind", async target => {
        renderDialog(target);
        expect(await screen.findByRole("heading", { name: "General access" })).toBeInTheDocument();
        expect(screen.queryByRole("region", { name: "Public link" })).toBeNull();
        expect(calls).toEqual([]);
    });
});

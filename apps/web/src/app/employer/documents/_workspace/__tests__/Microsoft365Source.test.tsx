/** @jest-environment jsdom */

import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { toast } from "sonner";

import { renderWithLocale } from "~/i18n/testing/render";

import { Microsoft365SourcePanel } from "../Microsoft365Source";
import { browseUrl } from "../Microsoft365Browser";
import { emptyFolderNames, microsoft365SourceState } from "../microsoft365Status";
import { Microsoft365Section } from "../settings/Microsoft365Section";
import { ADD_TABS } from "../types";
import { MICROSOFT_365_CONNECT_URL } from "../useMicrosoft365Source";

/**
 * Add source's OneDrive and SharePoint tab, its built-in browser, and the
 * Microsoft 365 section of Settings › Integrations. Every state the status
 * route can put them in: not this person's to use, not configured, not
 * connected, revoked, connected. Then adding by link and from the browser,
 * into the folder the destination bar shows, and managing what syncs.
 */

jest.mock("sonner", () => ({
    toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

interface Call {
    url: string;
    method: string;
    body: unknown;
}

let calls: Call[];
let statusBody: unknown;
let statusCode: number;
let itemsResponse: { code: number; body: unknown };

function respond(body: unknown, code = 200) {
    return Promise.resolve({
        ok: code < 400,
        status: code,
        json: () => Promise.resolve(body),
    });
}

const ONEDRIVE_ROOT = {
    drive: { driveId: "b!me", name: "OneDrive", driveType: "business", webUrl: null },
    folder: { driveId: "b!me", itemId: "root" },
    truncated: false,
    items: [
        row({ itemId: "clients", kind: "folder", name: "Client files" }),
        row({ itemId: "deck", name: "Deck.pdf" }),
        row({ itemId: "clip", name: "Clip.mov", supported: false }),
    ],
};

function row(overrides: Record<string, unknown>) {
    return {
        driveId: "b!me",
        itemId: "x",
        kind: "file",
        name: "x",
        mimeType: null,
        size: 10,
        modifiedAt: "2026-11-01T10:00:00.000Z",
        webUrl: null,
        supported: true,
        ...overrides,
    };
}

function connected(overrides: Record<string, unknown> = {}) {
    return {
        configured: true,
        connected: true,
        connectionId: "7",
        status: "active",
        accountEmail: "morgan@contoso.com",
        pickedItems: [],
        lastSyncAt: "2026-11-10T09:00:00.000Z",
        lastSyncStatus: "ok",
        lastSyncError: null,
        lastSyncReport: null,
        deletedHere: { items: [], others: 0 },
        ...overrides,
    };
}

beforeEach(() => {
    calls = [];
    statusCode = 200;
    statusBody = connected();
    itemsResponse = {
        code: 200,
        body: { data: { added: [{ kind: "file", name: "Deck.pdf" }] } },
    };
    jest.clearAllMocks();
    global.fetch = jest.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({
            url,
            method,
            body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        });
        if (url.endsWith("/status")) return respond({ data: statusBody }, statusCode);
        if (url.endsWith("/items")) return respond(itemsResponse.body, itemsResponse.code);
        if (url.endsWith("/sync")) return respond({ data: { queued: true } }, 202);
        if (url.includes("/browse?sites=")) {
            return respond({
                data: { sites: [{ siteId: "site-1", name: "Clients", webUrl: null }] },
            });
        }
        if (url.includes("/browse?siteId=")) {
            return respond({ data: { drives: [{ driveId: "b!lib", name: "Documents" }] } });
        }
        if (url.includes("/browse?driveId=b%21me&itemId=clients")) {
            return respond({
                data: {
                    drive: null,
                    folder: { driveId: "b!me", itemId: "clients" },
                    truncated: false,
                    items: [row({ itemId: "letter", name: "Engagement letter.docx" })],
                },
            });
        }
        if (url.includes("/browse?driveId=b%21lib")) {
            return respond({
                data: {
                    drive: null,
                    folder: { driveId: "b!lib", itemId: "root" },
                    truncated: false,
                    items: [],
                },
            });
        }
        if (url.endsWith("/browse")) return respond({ data: ONEDRIVE_ROOT });
        if (url.startsWith("/api/connectors/connections/") && method === "DELETE") {
            return respond({ data: { deleted: true, providerRevoked: false } });
        }
        return respond({}, 404);
    }) as unknown as typeof fetch;
});

function panel(props: Partial<React.ComponentProps<typeof Microsoft365SourcePanel>> = {}) {
    const onAdded = jest.fn();
    render(<Microsoft365SourcePanel destination="Deals/Acme" onAdded={onAdded} {...props} />);
    return { onAdded };
}

describe("the Add source tab", () => {
    it("is listed under Connect as OneDrive and SharePoint", () => {
        const connect = ADD_TABS.find(group => group.group === "Connect")!;
        expect(connect.items.find(tab => tab.id === "microsoft-365")).toMatchObject({
            label: "OneDrive and SharePoint",
        });
    });
});

describe("Microsoft365SourcePanel states", () => {
    it("tells a member who to ask, and offers nothing to press", async () => {
        statusCode = 403;
        panel();
        expect(await screen.findByText(/ask a workspace admin/i)).toBeInTheDocument();
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("names the variables the server needs when it isn't configured", async () => {
        statusBody = { configured: false, connected: false };
        panel();
        expect(await screen.findByText("MICROSOFT_OAUTH_CLIENT_ID")).toBeInTheDocument();
        expect(screen.getByText("MICROSOFT_OAUTH_CLIENT_SECRET")).toBeInTheDocument();
        expect(screen.getByText("EMBEDDING_SECRETS_KEY")).toBeInTheDocument();
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("offers Connect, through Microsoft's consent, when nothing is connected", async () => {
        statusBody = { configured: true, connected: false };
        panel();
        const connect = await screen.findByRole("link", { name: "Connect Microsoft 365" });
        expect(connect).toHaveAttribute("href", MICROSOFT_365_CONNECT_URL);
        expect(screen.getByText(/never changes anything in Microsoft 365/i)).toBeInTheDocument();
    });

    it("offers Reconnect, and nothing to add from, when access was revoked", async () => {
        statusBody = connected({ status: "revoked" });
        panel();
        const reconnect = await screen.findByRole("link", { name: "Reconnect Microsoft 365" });
        expect(reconnect).toHaveAttribute("href", MICROSOFT_365_CONNECT_URL);
        expect(screen.getByText("morgan@contoso.com")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Browse" })).not.toBeInTheDocument();
    });

    it("says so when the status can't be loaded", async () => {
        statusCode = 500;
        panel();
        expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
    });

    it("shows the account, Browse and the link field when connected", async () => {
        panel();
        expect(await screen.findByText("Connected as morgan@contoso.com")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Browse" })).toBeEnabled();
        expect(screen.getByLabelText("Or paste a OneDrive or SharePoint link")).toBeInTheDocument();
    });

    it("reads in Simplified Chinese", async () => {
        statusBody = { configured: true, connected: false };
        renderWithLocale(
            <Microsoft365SourcePanel destination="Deals" onAdded={jest.fn()} />,
            "zh-CN"
        );
        expect(await screen.findByRole("link", { name: "连接 Microsoft 365" })).toBeInTheDocument();
        expect(screen.getByText("OneDrive 和 SharePoint")).toBeInTheDocument();
    });
});

describe("adding by link", () => {
    it("refuses something that isn't a OneDrive or SharePoint link without sending it", async () => {
        const user = userEvent.setup();
        const { onAdded } = panel();
        await user.type(
            await screen.findByLabelText("Or paste a OneDrive or SharePoint link"),
            "https://drive.google.com/drive/folders/abc"
        );
        await user.click(screen.getByRole("button", { name: "Add" }));

        expect(screen.getByText(/isn't a OneDrive or SharePoint link/i)).toBeInTheDocument();
        expect(calls.some(call => call.method === "POST")).toBe(false);
        expect(onAdded).not.toHaveBeenCalled();
    });

    it("saves it into the folder the destination bar shows, then starts the sync", async () => {
        const user = userEvent.setup();
        const { onAdded } = panel();
        const link = "https://contoso.sharepoint.com/:b:/s/Deals/Edeck";
        await user.type(
            await screen.findByLabelText("Or paste a OneDrive or SharePoint link"),
            link
        );
        await user.click(screen.getByRole("button", { name: "Add" }));

        await waitFor(() => expect(onAdded).toHaveBeenCalled());
        const posts = calls.filter(call => call.method === "POST");
        expect(posts.map(call => call.url)).toEqual([
            "/api/connectors/microsoft-files/items",
            "/api/connectors/microsoft-files/sync",
        ]);
        expect(posts[0]!.body).toEqual({ link, destination: "Deals/Acme" });
        expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Deck.pdf"));
    });

    it("shows the server's reason when the account can't open the link", async () => {
        itemsResponse = {
            code: 404,
            body: { message: "morgan@contoso.com can't open that link." },
        };
        const user = userEvent.setup();
        const { onAdded } = panel();
        await user.type(
            await screen.findByLabelText("Or paste a OneDrive or SharePoint link"),
            "https://contoso.sharepoint.com/:b:/s/Deals/Eprivate"
        );
        await user.click(screen.getByRole("button", { name: "Add" }));

        expect(
            await screen.findByText("morgan@contoso.com can't open that link.")
        ).toBeInTheDocument();
        expect(calls.some(call => call.url.endsWith("/sync"))).toBe(false);
        expect(onAdded).not.toHaveBeenCalled();
    });
});

describe("the built-in browser", () => {
    async function openBrowser() {
        const user = userEvent.setup();
        const rendered = panel();
        await user.click(await screen.findByRole("button", { name: "Browse" }));
        const dialog = await screen.findByRole("dialog", { name: "Add from Microsoft 365" });
        return { user, dialog, ...rendered };
    }

    it("opens on My OneDrive, with what can't be read shown but not selectable", async () => {
        const { dialog } = await openBrowser();
        expect(await within(dialog).findByText("Client files")).toBeInTheDocument();
        expect(within(dialog).getByRole("checkbox", { name: "Select Deck.pdf" })).toBeEnabled();
        expect(within(dialog).getByRole("checkbox", { name: "Select Clip.mov" })).toBeDisabled();
        expect(within(dialog).getByText("This file type can't be read")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
    });

    it("opens a folder, keeps the selection, and walks back by the breadcrumb", async () => {
        const { user, dialog } = await openBrowser();
        await user.click(await within(dialog).findByRole("checkbox", { name: "Select Deck.pdf" }));
        await user.click(within(dialog).getByRole("button", { name: "Open Client files" }));

        expect(await within(dialog).findByText("Engagement letter.docx")).toBeInTheDocument();
        const crumbs = within(dialog).getByRole("navigation", { name: "Location" });
        expect(within(crumbs).getByText("Client files")).toHaveAttribute("aria-current", "page");
        expect(within(dialog).getByText("1 selected")).toBeInTheDocument();

        await user.click(within(crumbs).getByRole("button", { name: "My OneDrive" }));
        expect(
            await within(dialog).findByRole("checkbox", { name: "Select Deck.pdf" })
        ).toBeChecked();
    });

    it("adds a file and a folder together, into the destination", async () => {
        const { user, dialog, onAdded } = await openBrowser();
        itemsResponse = {
            code: 200,
            body: {
                data: {
                    added: [
                        { kind: "file", name: "Deck.pdf" },
                        { kind: "folder", name: "Client files" },
                    ],
                },
            },
        };
        await user.click(await within(dialog).findByRole("checkbox", { name: "Select Deck.pdf" }));
        await user.click(within(dialog).getByRole("checkbox", { name: "Select Client files" }));
        await user.click(within(dialog).getByRole("button", { name: "Add 2" }));

        await waitFor(() => expect(onAdded).toHaveBeenCalled());
        const post = calls.find(call => call.method === "POST" && call.url.endsWith("/items"))!;
        expect(post.body).toEqual({
            items: [
                { driveId: "b!me", itemId: "deck" },
                { driveId: "b!me", itemId: "clients" },
            ],
            destination: "Deals/Acme",
        });
        expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("2 items"));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("keeps the dialog open with the reason when adding fails", async () => {
        const { user, dialog, onAdded } = await openBrowser();
        itemsResponse = { code: 403, body: { message: "You can't add to that folder." } };
        await user.click(await within(dialog).findByRole("checkbox", { name: "Select Deck.pdf" }));
        await user.click(within(dialog).getByRole("button", { name: "Add 1" }));

        expect(await within(dialog).findByRole("alert")).toHaveTextContent(
            "You can't add to that folder."
        );
        expect(onAdded).not.toHaveBeenCalled();
    });

    it("searches SharePoint sites, then opens a site's library", async () => {
        const { user, dialog } = await openBrowser();
        await user.click(within(dialog).getByRole("tab", { name: "SharePoint sites" }));
        await user.click(await within(dialog).findByRole("button", { name: /Clients/ }));
        await user.click(await within(dialog).findByRole("button", { name: /Documents/ }));

        expect(await within(dialog).findByText("This folder is empty.")).toBeInTheDocument();
        const crumbs = within(dialog).getByRole("navigation", { name: "Location" });
        expect(
            within(crumbs).getByRole("button", { name: "SharePoint sites" })
        ).toBeInTheDocument();
        expect(within(crumbs).getByRole("button", { name: "Clients" })).toBeInTheDocument();

        await user.click(within(crumbs).getByRole("button", { name: "SharePoint sites" }));
        await user.type(
            await within(dialog).findByRole("textbox", { name: "Search SharePoint sites" }),
            "client"
        );
        await user.click(within(dialog).getByRole("button", { name: "Search" }));
        await waitFor(() =>
            expect(calls.some(call => call.url.endsWith("/browse?sites=client"))).toBe(true)
        );
    });

    it("asks the route for each kind of place", () => {
        const api = "/api/connectors/microsoft-files/browse";
        expect(browseUrl({ kind: "onedrive" }, "")).toBe(api);
        expect(browseUrl({ kind: "sites" }, "client files")).toBe(`${api}?sites=client+files`);
        expect(browseUrl({ kind: "site", siteId: "a,b", name: "x" }, "")).toBe(
            `${api}?siteId=a%2Cb`
        );
        expect(browseUrl({ kind: "folder", driveId: "b!d", name: "Library" }, "")).toBe(
            `${api}?driveId=b%21d`
        );
        expect(browseUrl({ kind: "folder", driveId: "b!d", itemId: "01", name: "x" }, "")).toBe(
            `${api}?driveId=b%21d&itemId=01`
        );
    });
});

describe("the status, read", () => {
    it("turns what the route says into what the panel offers", () => {
        expect(microsoft365SourceState({ kind: "loading" })).toEqual({ kind: "loading" });
        expect(microsoft365SourceState({ kind: "forbidden" })).toEqual({ kind: "forbidden" });
        const of = (status: Record<string, unknown>) =>
            microsoft365SourceState({
                kind: "ok",
                status: status as unknown as Parameters<typeof emptyFolderNames>[0],
            }).kind;
        expect(of({ configured: false, connected: false })).toBe("not-configured");
        expect(of({ configured: true, connected: false })).toBe("connect");
        expect(of(connected({ status: "revoked" }))).toBe("reconnect");
        expect(of(connected())).toBe("ready");
    });

    it("names the picked folders the last sync found empty", () => {
        const status = connected({
            pickedItems: [
                { sourceId: "b!d:1", driveId: "b!d", itemId: "1", kind: "folder", name: "Room" },
                { sourceId: "b!d:2", driveId: "b!d", itemId: "2", kind: "folder", name: "Other" },
            ],
            lastSyncReport: { emptyFolders: ["b!d:1", "b!d:gone"] },
        });
        expect(
            emptyFolderNames(status as unknown as Parameters<typeof emptyFolderNames>[0])
        ).toEqual(["Room"]);
    });
});

describe("Settings › Integrations › Microsoft 365", () => {
    const picked = [
        {
            sourceId: "b!d:room",
            driveId: "b!d",
            itemId: "room",
            kind: "folder",
            name: "Data room",
            mimeType: null,
            folderPath: "Deals/Acme/Data room",
            folderHidden: false,
        },
        {
            sourceId: "b!d:deck",
            driveId: "b!d",
            itemId: "deck",
            kind: "file",
            name: "Deck.pdf",
            mimeType: "application/pdf",
            folderPath: null,
            folderHidden: true,
        },
    ];

    it("lists what syncs, where it is, and the last run", async () => {
        statusBody = connected({
            pickedItems: picked,
            lastSyncReport: { stored: 3, unchanged: 12, failed: 0, emptyFolders: ["b!d:room"] },
        });
        render(<Microsoft365Section />);

        expect(await screen.findByText("Data room")).toBeInTheDocument();
        expect(screen.getByText(/^In Deals.+Acme.+Data room$/)).toBeInTheDocument();
        expect(screen.getByText("In a private folder of whoever picked it")).toBeInTheDocument();
        expect(
            screen.getByText("Last run: 3 imported, 12 unchanged, 0 failed.")
        ).toBeInTheDocument();
        expect(screen.getByText(/Nothing came in from “Data room”/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
    });

    it("stops syncing one pick, and asks for a sync", async () => {
        statusBody = connected({ pickedItems: picked });
        const user = userEvent.setup();
        render(<Microsoft365Section />);

        await user.click(await screen.findByRole("button", { name: "Stop syncing Deck.pdf" }));
        await waitFor(() =>
            expect(calls.find(call => call.method === "DELETE")).toMatchObject({
                url: "/api/connectors/microsoft-files/items",
                body: { items: [{ driveId: "b!d", itemId: "deck" }] },
            })
        );

        await user.click(screen.getByRole("button", { name: "Sync now" }));
        await waitFor(() =>
            expect(calls.some(call => call.url.endsWith("/sync") && call.method === "POST")).toBe(
                true
            )
        );
        expect(toast.success).toHaveBeenCalledWith("Sync requested");
    });

    it("offers Sync again for a file deleted here", async () => {
        statusBody = connected({
            pickedItems: picked,
            deletedHere: {
                items: [{ sourceId: "b!d:old", title: "Old memo.docx", deletedAt: "2026-11-01" }],
                others: 0,
            },
        });
        render(<Microsoft365Section />);
        expect(await screen.findByText("Old memo.docx")).toBeInTheDocument();
        expect(
            screen.getByText(/Nothing was changed in OneDrive or SharePoint/)
        ).toBeInTheDocument();
    });

    it("disconnects only after confirming, and says the permission stays at Microsoft", async () => {
        const onChanged = jest.fn();
        const user = userEvent.setup();
        render(<Microsoft365Section onChanged={onChanged} />);

        await user.click(await screen.findByRole("button", { name: "Disconnect" }));
        const dialog = await screen.findByRole("dialog");
        expect(dialog).toHaveTextContent("Disconnect Microsoft 365 from this workspace?");
        expect(dialog).toHaveTextContent(/no way to withdraw the permission itself/);
        expect(calls.some(call => call.method === "DELETE")).toBe(false);

        await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));
        await waitFor(() =>
            expect(calls.find(call => call.method === "DELETE")?.url).toBe(
                "/api/connectors/connections/7"
            )
        );
        await waitFor(() => expect(onChanged).toHaveBeenCalled());
        expect(toast.success).toHaveBeenCalledWith(
            expect.stringContaining("stays listed in the Microsoft account")
        );
    });

    it("offers Reconnect when access was revoked", async () => {
        statusBody = connected({ status: "revoked" });
        render(<Microsoft365Section />);
        expect(
            await screen.findByRole("link", { name: "Reconnect Microsoft 365" })
        ).toHaveAttribute("href", MICROSOFT_365_CONNECT_URL);
        expect(screen.queryByRole("button", { name: "Sync now" })).not.toBeInTheDocument();
    });

    it("names the variables when the server isn't configured, and steps aside for a member", async () => {
        statusBody = { configured: false, connected: false };
        const { unmount } = render(<Microsoft365Section />);
        expect(await screen.findByText("MICROSOFT_OAUTH_CLIENT_ID")).toBeInTheDocument();
        unmount();

        statusCode = 403;
        render(<Microsoft365Section />);
        expect(
            await screen.findByText(/managed by people who manage this workspace's connections/)
        ).toBeInTheDocument();
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
});

/** @jest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { AddSourceModal } from "../AddSourceModal";
import { ADD_TABS } from "../types";

/**
 * "Add a source" → Create.
 *
 * The Create group does not ingest anything: Mindmap makes a document in the
 * Mindmap app and sends the user to the editor, where publishing it back turns
 * the diagram into a citable source; Google Doc makes a real Doc in the
 * workspace's Drive and opens it in a new tab. These tests pin both routes —
 * the entry point is the whole reason the features know about each other.
 */

// `mock`-prefixed so jest's factory hoisting allows the reference.
const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

const fetchMock = jest.fn();

/** Response the URL-aware mock returns for anything but the status probe. */
let defaultResponse: Record<string, unknown>;
/** What GET /api/connectors/google reports; drives whether the tab exists. */
let googleStatus: Record<string, unknown>;

function jsonOk(body: unknown, status = 201) {
    return {
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    };
}

/** The call the component made to `url`, or undefined. */
function callTo(url: string): [string, RequestInit | undefined] | undefined {
    return fetchMock.mock.calls.find(c => c[0] === url) as
        | [string, RequestInit | undefined]
        | undefined;
}

/** The request body the component sent to `url`, as JSON. */
function sentBody<T>(url: string): T {
    const body = callTo(url)?.[1]?.body;
    if (typeof body !== "string") throw new Error(`expected a JSON string body for ${url}`);
    return JSON.parse(body) as T;
}

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
    mockPush.mockReset();
    fetchMock.mockReset();
    // Default: Drive-linked files are dark, so the Google Doc tab is absent and
    // the Mindmap assertions below see the modal exactly as it ships today.
    googleStatus = { enabled: false, connected: false };
    defaultResponse = { mindmap: { id: 42 } };
    fetchMock.mockImplementation((url: string) =>
        Promise.resolve(
            url === "/api/connectors/google" ? jsonOk(googleStatus, 200) : jsonOk(defaultResponse)
        )
    );
});

/**
 * The modal probes the Google connection on open. Tests that do not care about
 * it still have to let that state land, or React warns about an update outside
 * act().
 */
function settleStatus() {
    return waitFor(() => expect(callTo("/api/connectors/google")).toBeDefined());
}

function mount(props: Partial<React.ComponentProps<typeof AddSourceModal>> = {}) {
    return render(
        <AddSourceModal
            open
            onClose={jest.fn()}
            userId="user_1"
            defaultCategory="Strategy"
            folders={["Strategy", "Unfiled"]}
            onUploaded={jest.fn()}
            {...props}
        />
    );
}

/** What GET /api/workspace/folders/by-path answers for each folder in these tests. */
let folderFacts: Record<string, Record<string, unknown>>;

function access(audience: "private" | "shared" | "workspace", canManage = false) {
    return {
        audience,
        ownAudience: true,
        principalCount: audience === "private" ? 1 : audience === "shared" ? 3 : 0,
        canEdit: true,
        canManage,
    };
}

function byPath(url: string): string | null {
    const prefix = "/api/workspace/folders/by-path?path=";
    return url.startsWith(prefix) ? decodeURIComponent(url.slice(prefix.length)) : null;
}

describe("where it goes and who will see it (ADR-014)", () => {
    beforeEach(() => {
        folderFacts = {};
        fetchMock.mockImplementation((url: string) => {
            const path = byPath(url);
            if (path !== null) {
                const facts = folderFacts[path];
                return Promise.resolve(facts ? jsonOk(facts, 200) : jsonOk({ error: "x" }, 404));
            }
            return Promise.resolve(
                url === "/api/connectors/google"
                    ? jsonOk(googleStatus, 200)
                    : jsonOk(defaultResponse)
            );
        });
    });

    it("shows the destination at the top, as a path", async () => {
        mount({ defaultCategory: "Strategy/2027", folders: ["Strategy", "Strategy/2027"] });
        expect(
            screen.getByRole("button", { name: "Add to: Strategy / 2027. Change folder" })
        ).toBeInTheDocument();
        await settleStatus();
    });

    it("says a loose file stays yours until you share it", async () => {
        mount({ defaultCategory: "Unfiled", initialTab: "paste" });
        const note = screen.getByTestId("add-source-audience");
        expect(note).toHaveTextContent("Only you");
        expect(note).toHaveTextContent("Files with no folder stay private until you share them.");
        expect(screen.getByRole("button", { name: /Add to: No folder/ })).toBeInTheDocument();
        await settleStatus();
    });

    it("says a file saved in a folder only you can open stays yours", async () => {
        mount({
            defaultCategory: "Strategy",
            initialTab: "paste",
            folderAccess: { Strategy: access("private") },
        });
        const note = screen.getByTestId("add-source-audience");
        expect(note).toHaveTextContent("Only you");
        expect(note).toHaveTextContent("Strategy is private to you.");
        await settleStatus();
    });

    it("names the whole workspace, with a head count, for an open folder", async () => {
        folderFacts.Strategy = {
            visibility: "workspace",
            grants: [],
            audienceCount: 8,
            canManage: false,
            inheritsFrom: { path: null, restricted: false },
            workspaceName: "Acme",
        };
        mount({
            defaultCategory: "Strategy",
            folderAccess: { Strategy: access("workspace") },
            workspaceName: "Acme",
        });
        const note = screen.getByTestId("add-source-audience");
        expect(note).toHaveTextContent("Everyone at Acme");
        expect(note).toHaveTextContent("Anyone in the workspace can open Strategy.");
        await waitFor(() => expect(note).toHaveTextContent("8 people"));
    });

    it("names the people and groups a shared folder is open to", async () => {
        folderFacts.Strategy = {
            visibility: "restricted",
            grants: [
                {
                    principalType: "user",
                    principalName: "Me",
                    level: "manage",
                    authUserId: "user_1",
                },
                {
                    principalType: "user",
                    principalName: "Ada Lovelace",
                    level: "edit",
                    authUserId: "ada",
                },
                { principalType: "group", principalName: "Design", level: "view" },
            ],
            audienceCount: 5,
            canManage: true,
            inheritsFrom: { path: null, restricted: false },
            workspaceName: "Acme",
        };
        mount({ defaultCategory: "Strategy", folderAccess: { Strategy: access("shared") } });
        const note = screen.getByTestId("add-source-audience");
        await waitFor(() => expect(note).toHaveTextContent("Shared with 5 people"));
        const people = screen.getByRole("list", { name: "People with access" });
        expect(people).toHaveTextContent("You");
        expect(people).toHaveTextContent("Ada Lovelace");
        expect(people).toHaveTextContent("Designgroup");
        expect(note).toHaveTextContent("Only the people Strategy is shared with can open it.");
    });

    it("offers the folder's Share dialog to someone who manages it", async () => {
        const user = userEvent.setup();
        const onShareFolder = jest.fn();
        mount({
            defaultCategory: "Strategy",
            folderAccess: { Strategy: access("shared", true) },
            onShareFolder,
        });
        await settleStatus();
        await user.click(screen.getByRole("button", { name: "Change access" }));
        expect(onShareFolder).toHaveBeenCalledWith("Strategy");
    });

    it("offers no Share to someone who can only add to the folder", async () => {
        mount({
            defaultCategory: "Strategy",
            folderAccess: { Strategy: access("shared", false) },
            onShareFolder: jest.fn(),
        });
        await settleStatus();
        expect(screen.queryByRole("button", { name: "Change access" })).not.toBeInTheDocument();
    });

    it("lists each folder's audience in the picker", async () => {
        const user = userEvent.setup();
        mount({
            defaultCategory: "Unfiled",
            folders: ["Board", "Strategy", "Team", "Unfiled"],
            folderAccess: {
                Board: access("private"),
                Strategy: access("shared"),
                Team: access("workspace"),
            },
        });
        await settleStatus();
        await user.click(screen.getByRole("button", { name: /Add to: No folder/ }));
        const options = screen.getAllByRole("option");
        expect(options.map(o => o.textContent)).toEqual([
            "No folderUnfiledOnly you",
            "BoardOnly you",
            "StrategyShared",
            "TeamEveryone",
        ]);
    });

    it("shows where a connector files things, and who sees them there", async () => {
        folderFacts["Agent Sessions"] = {
            visibility: "workspace",
            grants: [],
            audienceCount: 8,
            canManage: false,
            inheritsFrom: { path: null, restricted: false },
            workspaceName: "Acme",
        };
        mount({ initialTab: "agent-sessions" });
        expect(screen.getByTestId("add-destination-path")).toHaveTextContent("Agent Sessions");
        expect(screen.queryByTestId("add-destination-picker")).not.toBeInTheDocument();
        await waitFor(() =>
            expect(screen.getByTestId("add-source-audience")).toHaveTextContent("Everyone at Acme")
        );
    });

    it("says Gmail is private to its owner", async () => {
        mount({ initialTab: "gmail" });
        expect(screen.getByTestId("add-source-audience")).toHaveTextContent(
            "Mail lands in your own Gmail folder. Nobody else in the workspace can open it."
        );
        await settleStatus();
    });

    it("shows no destination where nothing is added to a folder", async () => {
        mount({ initialTab: "slack" });
        expect(screen.queryByTestId("add-destination")).not.toBeInTheDocument();
        await settleStatus();
    });
});

describe("creating a folder from the picker", () => {
    it("files into the folder that was really made when the name was taken", async () => {
        const user = userEvent.setup();
        // A folder the person can't see already holds "Board"; the server made "Board (2)".
        const onCreateFolder = jest.fn(() => Promise.resolve("Board (2)"));
        mount({ defaultCategory: "Strategy", initialTab: "paste", onCreateFolder });
        await settleStatus();

        await user.click(screen.getByRole("button", { name: /Add to: Strategy/ }));
        await user.type(screen.getByPlaceholderText("Find or create a folder…"), "Board");
        expect(screen.getByRole("button", { name: /Create “Board”/ })).toHaveTextContent(
            "Private to you"
        );
        await user.click(screen.getByRole("button", { name: /Create “Board”/ }));

        expect(onCreateFolder).toHaveBeenCalledWith("Board");
        await waitFor(() =>
            expect(screen.getByRole("button", { name: /Add to: Board \(2\)/ })).toBeInTheDocument()
        );
        expect(screen.getByTestId("add-source-audience")).toHaveTextContent(
            "Board (2) is a new folder. New folders start private to you."
        );
    });

    it("says a new subfolder follows the folder it is made in", async () => {
        const user = userEvent.setup();
        mount({ defaultCategory: "Strategy", onCreateFolder: jest.fn() });
        await settleStatus();
        await user.click(screen.getByRole("button", { name: /Add to: Strategy/ }));
        await user.type(screen.getByPlaceholderText("Find or create a folder…"), "Strategy/Q3");
        expect(screen.getByRole("button", { name: /Create “Strategy \/ Q3”/ })).toHaveTextContent(
            "Inside Strategy · follows its sharing"
        );
    });
});

describe("the Create group", () => {
    it("is listed first, before Upload and Connect", () => {
        expect(ADD_TABS[0]?.group).toBe("Create");
        expect(ADD_TABS.map(g => g.group)).toEqual(["Create", "Upload", "Connect"]);
    });

    it("offers a Mindmap entry", () => {
        expect(ADD_TABS[0]?.items.map(i => i.id)).toContain("mindmap");
    });

    it("offers Paste text, which is writing a note rather than uploading", () => {
        expect(ADD_TABS[0]?.items.map(i => i.id)).toContain("paste");
        expect(ADD_TABS.find(g => g.group === "Upload")?.items.map(i => i.id)).not.toContain(
            "paste"
        );
    });

    it("renders the Mindmap tab in the sidebar", async () => {
        mount();
        expect(screen.getByRole("button", { name: "Mindmap" })).toBeInTheDocument();
        await settleStatus();
    });
});

describe("creating a mindmap", () => {
    it("shows the template gallery when the tab is opened", async () => {
        const user = userEvent.setup();
        mount();

        await user.click(screen.getByRole("button", { name: "Mindmap" }));

        expect(screen.getByText("Diagram it, then cite it")).toBeInTheDocument();
        expect(screen.getByText("Blank canvas")).toBeInTheDocument();
        expect(screen.getByText("Flowchart")).toBeInTheDocument();
        expect(screen.getByText("Org chart")).toBeInTheDocument();
    });

    it("names the destination folder so the user knows where it lands", async () => {
        const user = userEvent.setup();
        mount({ defaultCategory: "Strategy", folderAccess: { Strategy: access("workspace") } });
        await user.click(screen.getByRole("button", { name: "Mindmap" }));
        expect(screen.getByRole("button", { name: /Add to: Strategy/ })).toBeInTheDocument();
        // Who can see a map is a question about its published copy.
        expect(screen.getByTestId("add-source-audience")).toHaveTextContent(
            "This applies to the published copy"
        );
    });

    it("opens on the Mindmap tab when asked to", async () => {
        mount({ initialTab: "mindmap" });
        expect(screen.getByText("Diagram it, then cite it")).toBeInTheDocument();
        await settleStatus();
    });

    it("creates the document and opens it in the workspace editor", async () => {
        const user = userEvent.setup();
        mount();

        await user.click(screen.getByRole("button", { name: "Mindmap" }));
        await user.click(screen.getByText("Mindmap", { selector: "span" }));

        await waitFor(() => expect(callTo("/api/mindmaps")).toBeDefined());

        expect(callTo("/api/mindmaps")![1]!.method).toBe("POST");
        const body = sentBody<{ title: string; templateId: string; folder: string }>(
            "/api/mindmaps"
        );
        expect(body.templateId).toBe("mindmap");
        expect(body.folder).toBe("Strategy");

        // No gallery, no route of its own: the map opens where the library is.
        await waitFor(() =>
            expect(mockPush).toHaveBeenCalledWith("/employer/documents?source=m42&edit=1")
        );
    });

    it("hands the new map to the workspace when it asks for it", async () => {
        const user = userEvent.setup();
        const onMindmapCreated = jest.fn();
        mount({ onMindmapCreated });

        await user.click(screen.getByRole("button", { name: "Mindmap" }));
        await user.click(screen.getByText("Blank canvas"));

        await waitFor(() => expect(onMindmapCreated).toHaveBeenCalledWith(42));
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("creates an untitled document from the blank template", async () => {
        const user = userEvent.setup();
        mount();

        await user.click(screen.getByRole("button", { name: "Mindmap" }));
        await user.click(screen.getByText("Blank canvas"));

        await waitFor(() => expect(callTo("/api/mindmaps")).toBeDefined());
        const body = sentBody<{ title: string; templateId: string }>("/api/mindmaps");
        expect(body.templateId).toBe("blank");
        expect(body.title).toBe("Untitled mindmap");
    });

    it("stays put and reports the problem when creation fails", async () => {
        fetchMock.mockImplementation((url: string) =>
            Promise.resolve(
                url === "/api/connectors/google"
                    ? jsonOk(googleStatus, 200)
                    : jsonOk({ error: "Boom" }, 500)
            )
        );
        const user = userEvent.setup();
        mount();

        await user.click(screen.getByRole("button", { name: "Mindmap" }));
        await user.click(screen.getByText("Blank canvas"));

        await waitFor(() => expect(callTo("/api/mindmaps")).toBeDefined());
        expect(mockPush).not.toHaveBeenCalled();
    });
});

/**
 * The Drive-linked files feature is dark by default, so the tab has to be
 * absent — not disabled — unless the deployment reports it enabled.
 */
describe("creating a Google Doc", () => {
    const openedTabs: Array<{ location: { href: string }; close: jest.Mock }> = [];

    beforeEach(() => {
        openedTabs.length = 0;
        window.open = jest.fn(() => {
            const tab = { location: { href: "" }, close: jest.fn() };
            openedTabs.push(tab);
            return tab as unknown as Window;
        }) as unknown as typeof window.open;
    });

    function enabled(extra: Record<string, unknown> = {}) {
        googleStatus = {
            enabled: true,
            connected: true,
            accountEmail: "team@example.com",
            ...extra,
        };
    }

    it("hides the tab when the deployment has the feature off", async () => {
        mount();
        await waitFor(() => expect(callTo("/api/connectors/google")).toBeDefined());
        expect(screen.queryByRole("button", { name: "Google Doc" })).not.toBeInTheDocument();
    });

    it("shows the tab once the deployment reports it enabled", async () => {
        enabled();
        mount();
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Google Doc" })).toBeInTheDocument()
        );
    });

    it("offers Connect instead of Create when no account is linked yet", async () => {
        enabled({ connected: false, connectUrl: "/api/connectors/google/oauth/start" });
        const user = userEvent.setup();
        mount();

        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Google Doc" })).toBeInTheDocument()
        );
        await user.click(screen.getByRole("button", { name: "Google Doc" }));

        expect(screen.getByRole("button", { name: "Connect Google" })).toBeInTheDocument();
        expect(screen.queryByText("Blank document")).not.toBeInTheDocument();
    });

    it("creates the doc in the chosen folder and opens it in a new tab", async () => {
        enabled();
        defaultResponse = {
            success: true,
            documentId: 51,
            url: "https://docs.google.com/document/d/doc1/edit",
        };
        const onUploaded = jest.fn();
        const user = userEvent.setup();
        mount({ defaultCategory: "Strategy", onUploaded });

        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Google Doc" })).toBeInTheDocument()
        );
        await user.click(screen.getByRole("button", { name: "Google Doc" }));
        await user.type(screen.getByPlaceholderText("Untitled document"), "Q3 Planning");
        await user.click(screen.getByText("Blank document"));

        await waitFor(() => expect(callTo("/api/google-docs")).toBeDefined());
        const body = sentBody<{ title: string; folder: string }>("/api/google-docs");
        expect(body).toEqual({ title: "Q3 Planning", folder: "Strategy" });

        // The tab is opened synchronously and pointed afterwards, so a popup
        // blocker sees a real user gesture.
        await waitFor(() =>
            expect(openedTabs[0]!.location.href).toBe(
                "https://docs.google.com/document/d/doc1/edit"
            )
        );
        await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    });

    it("sends no title when the field is left blank, letting the server default", async () => {
        enabled();
        defaultResponse = { success: true, documentId: 51, url: "https://docs.google.com/x" };
        const user = userEvent.setup();
        mount();

        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Google Doc" })).toBeInTheDocument()
        );
        await user.click(screen.getByRole("button", { name: "Google Doc" }));
        await user.click(screen.getByText("Blank document"));

        await waitFor(() => expect(callTo("/api/google-docs")).toBeDefined());
        expect(sentBody<{ title?: string }>("/api/google-docs").title).toBeUndefined();
    });

    it("closes the blank tab when creation fails", async () => {
        enabled();
        fetchMock.mockImplementation((url: string) =>
            Promise.resolve(
                url === "/api/connectors/google"
                    ? jsonOk(googleStatus, 200)
                    : jsonOk({ success: false, message: "Not connected" }, 409)
            )
        );
        const onUploaded = jest.fn();
        const user = userEvent.setup();
        mount({ onUploaded });

        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Google Doc" })).toBeInTheDocument()
        );
        await user.click(screen.getByRole("button", { name: "Google Doc" }));
        await user.click(screen.getByText("Blank document"));

        await waitFor(() => expect(openedTabs[0]!.close).toHaveBeenCalled());
        expect(onUploaded).not.toHaveBeenCalled();
    });
});

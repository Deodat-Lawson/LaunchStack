/** @jest-environment jsdom */

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { ContextMenuProvider } from "~/components/context-menu";
import { WorkspaceShell } from "../WorkspaceShell";
import * as sessionApi from "../sessionApi";
import * as sourceApi from "../sourceApi";
import type { KnowledgePaneProps } from "../KnowledgePane";
import type { WorkspaceSource } from "../types";

const indexed: WorkspaceSource = {
    id: "call-note:call-review",
    callId: "call-review",
    documentId: 41,
    title: "Release review",
    type: "call-note",
    visibility: "company",
    folder: "Calls",
    size: "",
    added: "just now",
    tags: [],
    domain: "General",
};
const privateNote: WorkspaceSource = {
    ...indexed,
    id: "call-note:call-private",
    callId: "call-private",
    documentId: undefined,
    title: "Private coaching",
    visibility: "private",
};
const pending: WorkspaceSource = {
    ...indexed,
    id: "call-note:call-pending",
    callId: "call-pending",
    documentId: undefined,
    title: "Awaiting indexing",
};
const mockWorkspace = {
    sources: [indexed, privateNote, pending],
    folders: [
        { id: "f-Calls", name: "Calls", color: "var(--ink-3)" },
        { id: "f-Plans", name: "Plans", color: "var(--ink-3)" },
    ],
    companyId: 1,
    can: () => true,
    permissionsLoaded: true,
    refresh: jest.fn(),
    loading: false,
};
const mockRouter = { push: jest.fn(), replace: jest.fn() };
let mockSearchParams = new URLSearchParams();
const mockSendQuery = jest.fn();
const mockHistory = {
    entries: [],
    loading: false,
    error: null,
    degraded: [],
    refresh: jest.fn(),
    renameEntry: jest.fn(),
    removeEntry: jest.fn(),
};

jest.mock("next/navigation", () => ({
    useRouter: () => mockRouter,
    useSearchParams: () => mockSearchParams,
}));
jest.mock("next-themes", () => ({
    useTheme: () => ({ resolvedTheme: "light", setTheme: jest.fn() }),
}));
jest.mock("~/lib/auth-client", () => ({
    useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "owner", signOut: jest.fn() }),
    useUser: () => ({ user: { name: "Owner", email: "owner@example.test" } }),
}));
jest.mock("~/lib/profile/use-my-profile", () => ({ useMyProfile: () => ({ data: null }) }));
jest.mock("~/lib/settings/useSettings", () => ({ useSettingValue: () => undefined }));
jest.mock("../../../_chrome/EmployerWorkspaceSwitcherContext", () => ({
    useEmployerWorkspaceSwitcher: () => ({
        name: "Acme Robotics",
        initials: "AR",
        swatch: 1,
        membershipCount: 1,
        workspaces: [],
        activeCompanyId: 1,
        switchingTo: null,
        onSwitch: jest.fn(),
    }),
}));
jest.mock("../../hooks/useChatRoutes", () => ({
    useChatRoutes: () => ({
        routes: [],
        loading: false,
        config: { routes: { default: {}, fast: {}, reasoning: {}, vision: {} } },
        visionEnabled: false,
        reasoningEnabled: true,
    }),
}));
jest.mock("../../hooks/useAIChat", () => ({
    useAIChat: () => ({ sendQuery: mockSendQuery, loading: false }),
}));
jest.mock("../useAskStarters", () => ({
    useAskStarters: () => ({ payload: null, loading: false, error: null, refresh: jest.fn() }),
    resetAskStartersMemo: jest.fn(),
}));
jest.mock("../useWorkspaceData", () => ({ useWorkspaceData: () => mockWorkspace }));
jest.mock("../useWorkspaceHistory", () => ({ useWorkspaceHistory: () => mockHistory }));
jest.mock("../collab/useMeetings", () => ({ useAgents: () => ({ data: { personas: [] } }) }));
jest.mock("../sessionApi", () => ({
    fetchSession: jest.fn(),
    createSession: jest.fn(),
    appendMessages: jest.fn(),
    renameSession: jest.fn(),
    deleteSession: jest.fn(),
}));

// Keep the actual shell, rail, Knowledge surface, composer, and their state.
// Unrelated panes and modal bodies are outside these interaction scenarios.
jest.mock("../StudioSplitView", () => ({
    StudioSplitView: (props: {
        layout: { groups: { tabIds: string[] }[] };
        renderPane: (id: string) => React.ReactNode;
    }) => {
        const ReactRuntime = jest.requireActual<typeof React>("react");
        return props.layout.groups.flatMap(group =>
            group.tabIds.map(id =>
                ReactRuntime.createElement(ReactRuntime.Fragment, { key: id }, props.renderPane(id))
            )
        );
    },
}));
jest.mock("../StudioPanes", () => ({
    renderStudioPane: (
        feature: { id: string },
        _onExit: () => void,
        context: { knowledge?: KnowledgePaneProps }
    ) => {
        const ReactRuntime = jest.requireActual<typeof React>("react");
        const { KnowledgePane } = jest.requireActual<{
            KnowledgePane: React.ComponentType<KnowledgePaneProps>;
        }>("../KnowledgePane");
        return feature.id === "knowledge" && context.knowledge
            ? ReactRuntime.createElement(KnowledgePane, context.knowledge)
            : null;
    },
}));
jest.mock("../AddSourceModal", () => ({ AddSourceModal: () => null }));
jest.mock("../CommandPalette", () => ({ CommandPalette: () => null }));
jest.mock("../ConfirmActionDialog", () => ({ ConfirmActionDialog: () => null }));
jest.mock("../DeleteFolderDialog", () => ({ DeleteFolderDialog: () => null }));
jest.mock("../FolderDialog", () => ({ FolderDialog: () => null }));
jest.mock("../RenameSourceDialog", () => ({ RenameSourceDialog: () => null }));
jest.mock("../access/AccessDialog", () => ({ AccessDialog: () => null }));
jest.mock("../MindmapEditorHost", () => ({ MindmapEditorHost: () => null }));
jest.mock("../StudioDrawer", () => ({ StudioDrawer: () => null }));
jest.mock("../AccountMenu", () => ({ AccountMenu: () => null }));
jest.mock("../DocumentViewer", () => ({ DocumentViewer: () => null }));

const storedSession: sessionApi.StoredSession = {
    id: "saved-chat",
    title: "Release questions",
    pinned: false,
    messageCount: 0,
    contextSourceIds: [],
    lastMessageAt: "2026-09-14T12:00:00.000Z",
    createdAt: "2026-09-14T12:00:00.000Z",
};

function mount() {
    return render(
        <ContextMenuProvider>
            <WorkspaceShell />
        </ContextMenuProvider>
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockSearchParams = new URLSearchParams();
    mockSendQuery.mockResolvedValue({
        success: true,
        summarizedAnswer: "Ship the revised onboarding flow.",
        references: [{ documentId: 41, snippet: "The revised flow is approved." }],
    });
    jest.mocked(sessionApi.createSession).mockResolvedValue(storedSession);
    jest.mocked(sessionApi.appendMessages).mockResolvedValue(storedSession);
    jest.mocked(sessionApi.fetchSession).mockResolvedValue(null);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("Call Notes from the source rail to chat", () => {
    it("pins an indexed Call Note, queries its document, stores its ref, and opens its citation in Calls", async () => {
        const user = userEvent.setup();
        mount();
        const row = screen.getByTestId(`source-row-${indexed.id}`);
        await user.click(within(row).getByRole("checkbox", { name: "Add to context" }));
        expect(within(row).getByRole("checkbox", { name: "Remove from context" })).toBeChecked();

        await user.type(
            screen.getByPlaceholderText("Ask anything about this source…"),
            "What did we approve?{Enter}"
        );
        await waitFor(() =>
            expect(mockSendQuery).toHaveBeenCalledWith(
                expect.objectContaining({
                    question: "What did we approve?",
                    searchScope: "document",
                    documentId: 41,
                })
            )
        );
        await waitFor(() =>
            expect(sessionApi.createSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    contextSourceIds: [indexed.id],
                    messages: expect.arrayContaining([
                        expect.objectContaining({ role: "user", refs: [indexed.id] }),
                        expect.objectContaining({
                            role: "assistant",
                            citations: [expect.objectContaining({ sourceId: indexed.id })],
                        }),
                    ]),
                })
            )
        );
        await user.click(await screen.findByTitle("Open the source at this passage"));
        const href = mockRouter.push.mock.calls.at(-1)?.[0] as string;
        const params = new URL(href, "http://localhost").searchParams;
        expect(params.get("feature")).toBe("calls");
        expect(params.get("call")).toBe(indexed.callId);
        expect(params.has("source")).toBe(false);
    });

    it("selects only indexed Call Notes with folder select-all and then deselects the whole selectable folder", async () => {
        const user = userEvent.setup();
        mount();
        const folder = screen.getByTestId("folder-row-Calls");
        await user.click(within(folder).getByRole("checkbox", { name: "Select all in folder" }));
        expect(within(folder).getByRole("checkbox", { name: "Deselect folder" })).toBeChecked();
        expect(
            within(screen.getByTestId(`source-row-${indexed.id}`)).getByRole("checkbox")
        ).toBeChecked();
        for (const source of [privateNote, pending]) {
            const row = screen.getByTestId(`source-row-${source.id}`);
            expect(within(row).queryByRole("checkbox")).not.toBeInTheDocument();
            expect(within(row).getByLabelText("Call Note — open in Calls")).toHaveAttribute(
                "title",
                expect.stringMatching(/private.*not indexed yet/i)
            );
        }
        await user.click(within(folder).getByRole("checkbox", { name: "Deselect folder" }));
        expect(
            within(screen.getByTestId(`source-row-${indexed.id}`)).getByRole("checkbox")
        ).not.toBeChecked();
    });

    it("adds and removes an indexed Call Note through its purpose-made context menu", async () => {
        const user = userEvent.setup();
        mount();
        const row = screen.getByTestId(`source-row-${indexed.id}`);
        fireEvent.contextMenu(row);
        await user.click(await screen.findByTestId("context-menu-item-context"));
        expect(within(row).getByRole("checkbox")).toBeChecked();
        fireEvent.contextMenu(row);
        await user.click(await screen.findByTestId("context-menu-item-context"));
        expect(within(row).getByRole("checkbox")).not.toBeChecked();

        fireEvent.contextMenu(screen.getByTestId(`source-row-${privateNote.id}`));
        expect(await screen.findByTestId("context-menu-item-open")).toBeInTheDocument();
        for (const verb of ["context", "rename", "move", "cut", "access", "delete", "open-tab"]) {
            expect(screen.queryByTestId(`context-menu-item-${verb}`)).not.toBeInTheDocument();
        }
    });

    it("keeps an indexed Call Note restored from history, prunes unavailable notes, and resolves a hidden d-id citation", async () => {
        const user = userEvent.setup();
        mockSearchParams = new URLSearchParams("session=saved-chat");
        jest.mocked(sessionApi.fetchSession).mockResolvedValue({
            ...storedSession,
            contextSourceIds: [indexed.id, privateNote.id, pending.id],
            messages: [
                {
                    role: "assistant",
                    text: "The release was approved.",
                    citations: [
                        { sourceId: "d41", snippet: "Approval recorded in the Call Note." },
                    ],
                    seq: 0,
                    createdAt: storedSession.createdAt,
                },
            ],
        });
        mount();
        await user.click(await screen.findByTitle("Open the source at this passage"));
        expect(
            new URL(
                mockRouter.push.mock.calls.at(-1)?.[0] as string,
                "http://localhost"
            ).searchParams.get("call")
        ).toBe(indexed.callId);
        await user.type(
            await screen.findByPlaceholderText("Ask anything about this source…"),
            "When do we ship?{Enter}"
        );
        await waitFor(() =>
            expect(sessionApi.appendMessages).toHaveBeenCalledWith(
                "saved-chat",
                expect.objectContaining({
                    contextSourceIds: [indexed.id],
                    messages: expect.arrayContaining([
                        expect.objectContaining({ role: "user", refs: [indexed.id] }),
                    ]),
                })
            )
        );
        expect(mockSendQuery).toHaveBeenCalledWith(expect.objectContaining({ documentId: 41 }));
    });

    it("never drags a Call Note into a different folder", () => {
        const move = jest.spyOn(sourceApi, "moveSource").mockResolvedValue(undefined);
        mount();
        const row = screen.getByTestId(`source-row-${indexed.id}`);
        fireEvent.dragStart(row);
        fireEvent.drop(screen.getByTestId("folder-row-Plans"));
        expect(move).not.toHaveBeenCalled();
    });

    it.each(["grid", "list"])(
        "pins an indexed Call Note from the Knowledge %s and sends it as document context",
        async layout => {
            const user = userEvent.setup();
            mockSearchParams = new URLSearchParams("feature=knowledge");
            mount();
            if (layout === "list")
                await user.click(await screen.findByRole("button", { name: "list view" }));
            const prefix = layout === "grid" ? "knowledge-card" : "knowledge-row";
            const row = await screen.findByTestId(`${prefix}-${indexed.id}`);
            const checkbox = within(row).getByRole("checkbox", { name: "Select source" });
            checkbox.focus();
            await user.keyboard(" ");
            expect(within(row).getByRole("checkbox", { name: "Deselect source" })).toBeChecked();
            expect(mockRouter.push).not.toHaveBeenCalled();
            for (const source of [privateNote, pending]) {
                expect(
                    within(screen.getByTestId(`${prefix}-${source.id}`)).queryByRole("checkbox")
                ).not.toBeInTheDocument();
            }
            await user.click(screen.getByRole("button", { name: "Ask about these" }));
            await user.type(
                screen.getByPlaceholderText("Ask anything about this source…"),
                "What is the release plan?{Enter}"
            );
            await waitFor(() =>
                expect(mockSendQuery).toHaveBeenCalledWith(
                    expect.objectContaining({ documentId: 41, searchScope: "document" })
                )
            );
        }
    );
});

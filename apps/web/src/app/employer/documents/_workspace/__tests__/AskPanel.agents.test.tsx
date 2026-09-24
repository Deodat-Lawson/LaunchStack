/** @jest-environment jsdom */

import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { AskPanel } from "../AskPanel";
import type { ChatAgentOption } from "../collab/types";
import type { ComposerSend, ThreadMessage, WorkspaceSource } from "../types";

/**
 * Agents in the chat: the picker sets the agent a send is addressed to, an
 * `@handle` in the draft summons another for that one turn, the `@` menu
 * completes handles, and a stored turn renders under its agent's live name.
 */

jest.mock("next-themes", () => ({
    useTheme: () => ({ resolvedTheme: "light", setTheme: jest.fn() }),
}));
jest.mock("../../../_chrome/EmployerWorkspaceSwitcherContext", () => ({
    useEmployerWorkspaceSwitcher: () => ({
        name: "Acme Robotics",
        initials: "AR",
        swatch: 1,
        membershipCount: 1,
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
jest.mock("../useAskStarters", () => ({
    useAskStarters: () => ({ payload: null, loading: false, error: null, refresh: jest.fn() }),
    resetAskStartersMemo: jest.fn(),
}));

const SOURCES: WorkspaceSource[] = [];

const AGENTS: ChatAgentOption[] = [
    {
        id: "analyst",
        displayName: "Ravi",
        role: "Analyst",
        description: "Reasons from the sources",
        accent: null,
        avatarUrl: null,
        mode: "all",
        tools: null,
        builtin: true,
    },
    {
        id: "finance",
        displayName: "Dana",
        role: "Finance partner",
        description: "Guards margin",
        accent: null,
        avatarUrl: null,
        mode: "all",
        tools: ["retrieval", "reasoning", "attachments"],
        builtin: true,
    },
    {
        id: "critic",
        displayName: "Vera",
        role: "Devil's advocate",
        description: "Argues the other side",
        accent: null,
        avatarUrl: null,
        mode: "subagent",
        tools: null,
        builtin: true,
    },
];

function mount(overrides: Partial<React.ComponentProps<typeof AskPanel>> = {}) {
    const sendMessage = jest.fn<void, [ComposerSend]>();
    const onChangeAgent = jest.fn();
    const props: React.ComponentProps<typeof AskPanel> = {
        sources: SOURCES,
        selected: [],
        setSelected: jest.fn(),
        thread: [],
        sendMessage,
        isSending: false,
        onOpenAdd: jest.fn(),
        onNewChat: jest.fn(),
        openPalette: jest.fn(),
        onStudioNavigate: jest.fn(),
        webSearch: true,
        onToggleWebSearch: jest.fn(),
        thinking: false,
        onToggleThinking: jest.fn(),
        agents: AGENTS,
        agentKey: null,
        onChangeAgent,
        ...overrides,
    };
    const utils = render(<AskPanel {...props} />);
    return { ...utils, sendMessage, onChangeAgent };
}

describe("AskPanel agents", () => {
    it("addresses a send to the picked agent", async () => {
        const user = userEvent.setup();
        const { sendMessage } = mount({ agentKey: "finance" });
        const box = screen.getByPlaceholderText(/Ask Dana/i);
        await user.type(box, "What does this cost?{Enter}");
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ agentKey: "finance" }));
    });

    it("shows what the agent's tool policy changes before sending", () => {
        mount({ agentKey: "finance", webSearch: true });
        expect(screen.getByRole("status")).toHaveTextContent(/web search is off for this agent/i);
    });

    it("lets a mention summon another agent for one turn", async () => {
        const user = userEvent.setup();
        const { sendMessage } = mount({ agentKey: "finance" });
        const box = screen.getByPlaceholderText(/Ask Dana/i);
        await user.type(box, "@critic what would you attack here?{Enter}");
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ agentKey: "critic" }));
    });

    it("completes handles from the @ menu, hiding primary-only agents", async () => {
        const user = userEvent.setup();
        const { sendMessage } = mount({
            agents: [
                ...AGENTS,
                { ...AGENTS[0]!, id: "chair", displayName: "Ada", mode: "primary" },
            ],
        });
        const box = screen.getByPlaceholderText(/Ask anything/i);
        await user.type(box, "ask @");
        const menu = await screen.findByRole("listbox", { name: "Agents" });
        expect(within(menu).getByText("Vera")).toBeInTheDocument();
        expect(within(menu).queryByText("Ada")).not.toBeInTheDocument();
        await user.type(box, "cri");
        await waitFor(() => expect(within(menu).queryByText("Ravi")).not.toBeInTheDocument());
        await user.keyboard("{Enter}");
        expect(box).toHaveValue("ask @critic ");
        await user.keyboard("hello{Enter}");
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ agentKey: "critic" }));
    });

    it("changes the chat's agent from the picker, without subagents", async () => {
        const user = userEvent.setup();
        const { onChangeAgent } = mount();
        await user.click(screen.getByRole("button", { name: "Agent" }));
        const options = await screen.findAllByRole("option");
        const labels = options.map(o => o.textContent ?? "");
        expect(labels.some(l => l.includes("Launchstack"))).toBe(true);
        expect(labels.some(l => l.includes("Ravi"))).toBe(true);
        expect(labels.some(l => l.includes("Vera"))).toBe(false);
        await user.click(options.find(o => o.textContent?.includes("Ravi"))!);
        expect(onChangeAgent).toHaveBeenCalledWith("analyst");
    });

    it("renders a stored agent turn under the agent's live name", () => {
        const thread: ThreadMessage[] = [
            {
                role: "user",
                text: "Hi",
                agent: { key: "analyst", displayName: "", role: "", accent: null },
            },
            {
                role: "assistant",
                text: "Hello.",
                agent: { key: "analyst", displayName: "", role: "", accent: null },
            },
        ];
        mount({ thread });
        expect(screen.getByText("Ravi")).toBeInTheDocument();
        expect(screen.getByText("Analyst")).toBeInTheDocument();
        expect(screen.getByText(/to @analyst/)).toBeInTheDocument();
    });
});

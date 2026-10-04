/** @jest-environment jsdom */
import React from "react";
import type * as ReactModule from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AskPanel, type AskPanelProps } from "../AskPanel";
import type { ThreadMessage } from "../types";

jest.mock("../../../_chrome/EmployerWorkspaceSwitcherContext", () => ({
    useEmployerWorkspaceSwitcher: () => ({ name: "Workspace" }),
}));
jest.mock("../ChatComposer", () => ({
    Composer: (props: {
        seed?: { text: string; mode: string };
        active?: boolean;
        disabled?: boolean;
        draftKey?: string;
        onStop?: () => void;
    }) => {
        const React = jest.requireActual<typeof ReactModule>("react");
        return React.createElement(
            "div",
            null,
            React.createElement(
                "output",
                { "data-testid": "composer-seed", "data-mode": props.seed?.mode },
                props.seed?.text
            ),
            React.createElement(
                "button",
                { disabled: props.disabled, onClick: props.onStop },
                props.active ? "Stop response" : "Send message"
            )
        );
    },
}));
jest.mock("../ChatAttachmentChip", () => ({
    ChatAttachmentChip: ({ attachment }: { attachment: { name: string } }) => {
        const React = jest.requireActual<typeof ReactModule>("react");
        return React.createElement("span", null, attachment.name);
    },
}));
jest.mock("../AskStarters", () => ({ AskStarters: () => null }));
const THREAD: ThreadMessage[] = [
    { id: "q1", role: "user", text: "What changed?", createdAt: "2026-10-04T12:00:00Z" },
    {
        id: "a1",
        role: "assistant",
        text: "A reliable answer.",
        createdAt: "2026-10-04T12:00:01Z",
        status: "complete",
        elapsedMs: 1200,
    },
];
function mount(overrides: Partial<AskPanelProps> = {}) {
    const props: AskPanelProps = {
        sources: [],
        selected: [],
        setSelected: jest.fn(),
        thread: THREAD,
        sendMessage: jest.fn(),
        isSending: false,
        onOpenAdd: jest.fn(),
        onNewChat: jest.fn(),
        openPalette: jest.fn(),
        onStudioNavigate: jest.fn(),
        webSearch: false,
        onToggleWebSearch: jest.fn(),
        thinking: false,
        onToggleThinking: jest.fn(),
        ...overrides,
    };
    return { ...render(<AskPanel {...props} />), props };
}
it("never replays an edit seed into another conversation, including after remount", () => {
    const composerSeed = {
        text: "Original question and files",
        mode: "append" as const,
        nonce: 100,
        draftKey: "chat:user:workspace:original",
    };
    const { props, rerender, unmount } = mount({ draftKey: composerSeed.draftKey, composerSeed });
    expect(screen.getByTestId("composer-seed")).toHaveTextContent(composerSeed.text);
    rerender(<AskPanel {...props} draftKey="chat:user:workspace:new" />);
    expect(screen.getByTestId("composer-seed")).toBeEmptyDOMElement();
    unmount();
    mount({ draftKey: "chat:user:workspace:another", composerSeed });
    expect(screen.getByTestId("composer-seed")).toBeEmptyDOMElement();
});
it("uses genuine metadata for timestamps and streaming/stopped/reasoning state", () => {
    const { rerender, props, container } = mount({
        thread: [
            THREAD[0]!,
            {
                ...THREAD[1]!,
                status: "streaming",
                stage: "Retrieving evidence",
                reasoning: "Compare the sources",
            },
        ],
        isSending: true,
    });
    expect(screen.getByText("Retrieving evidence")).toBeInTheDocument();
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(
        container.querySelector('time[datetime="2026-10-04T12:00:00.000Z"]')
    ).toBeInTheDocument();
    rerender(
        <AskPanel
            {...props}
            isSending={false}
            thread={[THREAD[0]!, { ...THREAD[1]!, status: "stopped" }]}
        />
    );
    expect(screen.getByText("Stopped")).toBeInTheDocument();
});
it("keeps queued composition enabled while a response is active and wires stop", () => {
    const onStop = jest.fn();
    mount({ isSending: true, onStop });
    const button = screen.getByRole("button", { name: "Stop response" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onStop).toHaveBeenCalledTimes(1);
});
it("retains attachment chips while collapsing a long user prompt", () => {
    mount({
        thread: [
            {
                role: "user",
                text: "Long prompt. ".repeat(100),
                attachments: [
                    {
                        id: "f1",
                        name: "evidence.pdf",
                        mimeType: "application/pdf",
                        size: 4,
                        url: "/files/evidence.pdf",
                        kind: "text",
                    },
                ],
            },
        ],
    });
    expect(screen.getByText("evidence.pdf")).toBeVisible();
    const expand = screen.getByRole("button", { name: "Show full message" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expand);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
        "aria-expanded",
        "true"
    );
});
it("exposes working retry, fork, save and rewind actions", () => {
    const onRetryMessage = jest.fn(),
        onForkMessage = jest.fn(),
        onSaveMessage = jest.fn(),
        onEditMessage = jest.fn();
    mount({ onRetryMessage, onForkMessage, onSaveMessage, onEditMessage });
    fireEvent.click(screen.getByRole("button", { name: "Retry answer" }));
    expect(onRetryMessage).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Fork new chat from here" })[1]!);
    expect(onForkMessage).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Save answer as a note" }));
    expect(onSaveMessage).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Edit from here" }));
    expect(onEditMessage).toHaveBeenCalledWith(0);
});
it("cites selected text with its source anchor and editable comment by appending to composer", () => {
    mount();
    const paragraph = screen.getByText("A reliable answer.");
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(paragraph);
    fireEvent.change(screen.getByRole("textbox", { name: "Citation comment" }), {
        target: { value: "Explain this" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cite in composer" }));
    expect(screen.getByTestId("composer-seed")).toHaveTextContent("> A reliable answer.");
    expect(screen.getByTestId("composer-seed")).toHaveTextContent(
        "[Source message](#chat-message-a1)"
    );
    expect(screen.getByTestId("composer-seed")).toHaveTextContent("Comment: Explain this");
    expect(screen.getByTestId("composer-seed")).toHaveAttribute("data-mode", "append");
    selection.removeAllRanges();
});
it("renders plans as structured cards with genuine refinement and implementation prompts", () => {
    const onImplementPlan = jest.fn();
    mount({
        thread: [
            {
                ...THREAD[0]!,
                send: {
                    text: "Plan this",
                    refs: [],
                    attachments: [],
                    webSearch: false,
                    thinking: false,
                    agentKey: null,
                    chatMode: "plan",
                },
            },
            THREAD[1]!,
        ],
        onImplementPlan,
    });
    expect(screen.getByRole("region", { name: "Proposed plan" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refine" }));
    expect(screen.getByTestId("composer-seed")).toHaveTextContent("Refine this proposed plan:");
    fireEvent.click(screen.getByRole("button", { name: "Implement in new chat" }));
    expect(onImplementPlan).toHaveBeenCalledWith("A reliable answer.");
});
it("commits valid title edits and cancels with Escape", () => {
    const onRename = jest.fn();
    mount({ title: "Original", onRename });
    fireEvent.click(screen.getByRole("button", { name: "Rename conversation" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Conversation title" }), {
        target: { value: "Renamed" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Conversation title" }), {
        key: "Enter",
    });
    expect(onRename).toHaveBeenCalledWith("Renamed");
    onRename.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Rename conversation" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Conversation title" }), {
        key: "Escape",
    });
    expect(onRename).not.toHaveBeenCalled();
});
it("reveals earlier history when its minimap row is activated", () => {
    mount({
        thread: Array.from({ length: 110 }, (_, i) => ({
            id: `m${i}`,
            role: i % 2 ? "assistant" : "user",
            text: `Unique message ${i}`,
        })),
    });
    expect(screen.queryByText("Unique message 0")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Message 1: You — Unique message 0" }));
    expect(screen.getByText("Unique message 0")).toBeInTheDocument();
});

it("uses native windowing spacers and remembers revealed history per conversation", () => {
    const long: ThreadMessage[] = Array.from({ length: 110 }, (_, i) => ({
        id: `l${i}`,
        role: i % 2 ? "assistant" : "user",
        text: `Long history ${i}`,
    }));
    const { rerender, props, container } = mount({ draftKey: "long-session", thread: long });
    expect(container.querySelector('[data-chat-message="10"]')).toHaveStyle({
        contentVisibility: "auto",
        containIntrinsicSize: "auto 220px",
    });
    fireEvent.click(screen.getByRole("button", { name: "Message 1: You — Long history 0" }));
    expect(screen.getByText("Long history 0")).toBeInTheDocument();
    rerender(<AskPanel {...props} draftKey="another-session" thread={THREAD} />);
    rerender(<AskPanel {...props} draftKey="long-session" thread={long} />);
    expect(screen.getByText("Long history 0")).toBeInTheDocument();
});

it("a saved quote source jump reveals an older source message", () => {
    const long: ThreadMessage[] = Array.from({ length: 110 }, (_, i) => ({
        id: `j${i}`,
        role: i % 2 ? "assistant" : "user",
        text: `Jump history ${i}`,
    }));
    long.push({
        id: "quote",
        role: "user",
        text: "> Saved quote\n\n[Source message](#chat-message-j0)\n\nComment: Explain this",
    });
    mount({ draftKey: "jump", thread: long });
    expect(screen.queryByText("Jump history 0")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Source message" }));
    expect(screen.getByText("Jump history 0")).toBeInTheDocument();
});

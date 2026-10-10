/** @jest-environment jsdom */

import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { Composer, type ComposerProps } from "../ChatComposer";
import type { ComposerSend } from "../types";
import type { ChatPassage } from "~/lib/chat-passages";

/**
 * "Ask AI" on a selected passage used to paste it into the message as a
 * Markdown quote plus a machine link, so the composer showed raw `>` lines and
 * `[Quoted context](#launchstack-quoted-context)`. The passage now sits above
 * the input as a card and travels beside the question.
 */

jest.mock("../../hooks/useChatRoutes", () => ({
    useChatRoutes: () => ({ routes: [], loading: false }),
}));

const PASSAGE: ChatPassage = {
    sourceId: "d7",
    documentId: 7,
    title: "Dense X Retrieval.pdf",
    page: 1,
    text: "we introduce a novel retrieval unit, proposition, for dense retrieval.",
};

function mount(overrides: Partial<ComposerProps> = {}) {
    const onSend = jest.fn<void, [ComposerSend]>();
    const props: ComposerProps = {
        sources: [],
        selected: [],
        setSelected: jest.fn(),
        onSend,
        agents: [],
        agentKey: null,
        onChangeAgent: jest.fn(),
        ...overrides,
    };
    const result = render(<Composer {...props} />);
    return {
        ...result,
        props,
        onSend,
        box: screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Chat message" }),
    };
}

beforeEach(() => localStorage.clear());

describe("passages in the composer", () => {
    it("shows a seeded passage as a card, leaving the message box empty", () => {
        const { box } = mount({
            draftKey: "passage-card",
            seed: { nonce: 1, text: "", mode: "append", passages: [PASSAGE] },
        });
        const card = screen.getByTestId("passage-card");
        expect(within(card).getByText("Dense X Retrieval.pdf")).toBeInTheDocument();
        expect(within(card).getByText("p. 1")).toBeInTheDocument();
        expect(within(card).getByText(PASSAGE.text)).toBeInTheDocument();
        expect(box).toHaveValue("");
        expect(box.placeholder).toMatch(/Ask about this passage/);
        expect(document.body.textContent).not.toContain("launchstack-quoted-context");
    });

    it("sends the typed question with the passage beside it, then clears both", async () => {
        const user = userEvent.setup();
        const { box, onSend } = mount({
            draftKey: "passage-send",
            seed: { nonce: 2, text: "", mode: "append", passages: [PASSAGE] },
        });
        await user.type(box, "What do they propose?");
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onSend).toHaveBeenCalledWith(
            expect.objectContaining({
                text: "What do they propose?",
                origin: "user",
                passages: [PASSAGE],
            })
        );
        expect(screen.queryByTestId("passage-card")).not.toBeInTheDocument();
    });

    it("can be sent with nothing typed, asking for an explanation", () => {
        const { box, onSend } = mount({
            draftKey: "passage-empty",
            seed: { nonce: 3, text: "", mode: "append", passages: [PASSAGE] },
        });
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onSend).toHaveBeenCalledWith(
            expect.objectContaining({ text: "Explain this passage.", passages: [PASSAGE] })
        );
    });

    it("adds a second passage, skips a duplicate, and keeps what was typed", async () => {
        const user = userEvent.setup();
        const { box, rerender, props } = mount({ draftKey: "passage-add" });
        await user.type(box, "Compare these");
        const second = { ...PASSAGE, page: 4, text: "Propositions are atomic expressions." };
        rerender(
            <Composer
                {...props}
                seed={{ nonce: 4, text: "", mode: "append", passages: [PASSAGE] }}
            />
        );
        rerender(
            <Composer
                {...props}
                seed={{ nonce: 5, text: "", mode: "append", passages: [PASSAGE, second] }}
            />
        );
        expect(screen.getAllByTestId("passage-card")).toHaveLength(2);
        expect(box).toHaveValue("Compare these");
    });

    it("removes a passage from its card", async () => {
        const user = userEvent.setup();
        mount({
            draftKey: "passage-remove",
            seed: { nonce: 6, text: "", mode: "append", passages: [PASSAGE] },
        });
        await user.click(
            screen.getByRole("button", { name: "Remove passage from Dense X Retrieval.pdf" })
        );
        expect(screen.queryByTestId("passage-card")).not.toBeInTheDocument();
    });

    it("keeps passages in the saved draft across a remount", () => {
        const first = mount({
            draftKey: "passage-draft",
            seed: { nonce: 7, text: "", mode: "append", passages: [PASSAGE] },
        });
        first.unmount();
        mount({ draftKey: "passage-draft" });
        expect(screen.getByTestId("passage-card")).toBeInTheDocument();
    });

    it("opens the passage in its document from the card title", async () => {
        const user = userEvent.setup();
        const onOpenPassage = jest.fn();
        mount({
            draftKey: "passage-open",
            onOpenPassage,
            seed: { nonce: 8, text: "", mode: "append", passages: [PASSAGE] },
        });
        await user.click(screen.getByRole("button", { name: "Dense X Retrieval.pdf" }));
        expect(onOpenPassage).toHaveBeenCalledWith(PASSAGE);
    });
});

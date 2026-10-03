/** @jest-environment jsdom */

import React, { createRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import RichChatEditor, {
    composerContexts,
    composerJsonToMarkdown,
    markdownToComposerHtml,
    validComposerDocument,
    type ComposerContext,
    type RichChatEditorHandle,
} from "../RichChatEditor";

const SOURCE: ComposerContext = {
    id: "source-1",
    kind: "source",
    label: "Budget",
    markdown: "[Source: Budget](#launchstack-source-source-1)",
};

beforeAll(() => {
    Range.prototype.getClientRects = () =>
        ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as DOMRectList;
    Range.prototype.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
    });
});

describe("Rich composer context and formatting", () => {
    it("marks an existing inline source unavailable when its roster entry disappears", async () => {
        const props = {
            value: SOURCE.markdown,
            contexts: [SOURCE],
            placeholder: "Write",
            onChange: jest.fn(),
            onKeyDown: () => false,
            onPaste: () => false,
            onOpenContext: jest.fn(),
        };
        const { rerender } = render(<RichChatEditor {...props} />);
        const source = await screen.findByRole("button", { name: "Source context: Budget" });
        expect(source).not.toHaveTextContent("unavailable");
        rerender(<RichChatEditor {...props} contexts={[{ ...SOURCE, unavailable: true }]} />);
        await waitFor(() => expect(source).toHaveTextContent("unavailable"));
        expect(source.closest("[data-context-unavailable]")).toHaveAttribute(
            "data-context-unavailable",
            "true"
        );
    });

    it("rejects malformed persisted documents and retains task completion in Markdown", () => {
        expect(validComposerDocument({ type: "doc", content: [{ type: "text", text: 4 }] })).toBe(
            false
        );
        expect(
            validComposerDocument({
                type: "doc",
                content: [{ type: "composerContext", attrs: { context: { id: 4 } } }],
            })
        ).toBe(false);
        expect(
            composerJsonToMarkdown({
                type: "bulletList",
                content: [
                    {
                        type: "listItem",
                        attrs: { checked: true },
                        content: [{ type: "paragraph", content: [{ type: "text", text: "Done" }] }],
                    },
                ],
            })
        ).toBe("- [x] Done\n\n");
    });

    it("edits real task checkboxes and serializes their changed completion", async () => {
        const onChange = jest.fn();
        render(
            <RichChatEditor
                value="- [ ] Review"
                contexts={[]}
                placeholder="Write"
                onChange={onChange}
                onKeyDown={() => false}
                onPaste={() => false}
                onOpenContext={jest.fn()}
            />
        );
        const checkbox = await screen.findByRole("checkbox", { name: "Complete task" });
        fireEvent.click(checkbox);
        expect(onChange).toHaveBeenLastCalledWith(
            expect.stringContaining("- [x] Review"),
            expect.any(Object),
            []
        );
    });

    it("creates movable inline chips and keeps their surrounding text in Markdown", () => {
        const document = {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [
                        { type: "text", text: "Before " },
                        { type: "composerContext", attrs: { context: SOURCE } },
                        { type: "text", text: " after", marks: [{ type: "bold" }] },
                    ],
                },
            ],
        };
        expect(composerJsonToMarkdown(document)).toBe(
            "Before [Source: Budget](#launchstack-source-source-1)** after**"
        );
        expect(composerContexts(document)).toEqual([SOURCE]);
    });

    it("serializes quotes and comments instead of losing them during send or stash", () => {
        const document = {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [
                        {
                            type: "composerContext",
                            attrs: {
                                context: {
                                    id: "quote-1",
                                    kind: "quote",
                                    label: "Quote",
                                    quote: "Quoted words\nSecond line",
                                    comment: "Explain this",
                                    markdown: "",
                                },
                            },
                        },
                    ],
                },
            ],
        };
        expect(composerJsonToMarkdown(document)).toBe(
            "> Quoted words\n> Second line\n> Comment: Explain this"
        );
    });

    it("renders Markdown formatting and safe context markers with no executable elements", () => {
        const html = markdownToComposerHtml(
            "**Bold**\n\n" +
                SOURCE.markdown +
                "\n\n<script>alert(1)</script><iframe src='/private'></iframe>\n\n[Bad](javascript:alert(1))",
            [SOURCE]
        );
        expect(html).toContain("<strong>Bold</strong>");
        expect(html).toContain("data-composer-context");
        expect(html).not.toContain("<script");
        expect(html).not.toContain("<iframe");
        expect(html).not.toContain('href="javascript:');
    });

    it("uses the real editor to insert an inline context chip and undo it", async () => {
        const ref = createRef<RichChatEditorHandle>();
        const onChange = jest.fn();
        render(
            <RichChatEditor
                ref={ref}
                value="Before"
                contexts={[]}
                placeholder="Write"
                onChange={onChange}
                onKeyDown={() => false}
                onPaste={() => false}
                onOpenContext={jest.fn()}
            />
        );
        await screen.findByRole("textbox", { name: "Rich chat message" });
        await waitFor(() => expect(ref.current?.getJSON()).not.toBeNull());
        act(() => ref.current?.insertContext(SOURCE));
        expect(
            await screen.findByRole("button", { name: "Source context: Budget" })
        ).toBeInTheDocument();
        expect(onChange).toHaveBeenLastCalledWith(
            expect.stringContaining(SOURCE.markdown),
            expect.any(Object),
            [SOURCE]
        );
        fireEvent.click(screen.getByRole("button", { name: "Undo" }));
        expect(
            screen.queryByRole("button", { name: "Source context: Budget" })
        ).not.toBeInTheDocument();
        expect(ref.current?.getContexts()).toEqual([]);
    });

    it("allows quote comments to be edited on the actual chip", async () => {
        const ref = createRef<RichChatEditorHandle>();
        const onChange = jest.fn();
        render(
            <RichChatEditor
                ref={ref}
                value="> Original quote"
                contexts={[]}
                placeholder="Write"
                onChange={onChange}
                onKeyDown={() => false}
                onPaste={() => false}
                onOpenContext={jest.fn()}
            />
        );
        fireEvent.click(
            await screen.findByRole("button", { name: "Quoted response: Original quote" })
        );
        fireEvent.change(screen.getByRole("textbox", { name: "Quote comment" }), {
            target: { value: "Why does this matter?" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
        expect(onChange).toHaveBeenLastCalledWith(
            expect.stringContaining("Comment: Why does this matter?"),
            expect.any(Object),
            expect.arrayContaining([expect.objectContaining({ comment: "Why does this matter?" })])
        );
    });
});

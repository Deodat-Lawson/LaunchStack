"use client";

/**
 * The formatting toolbar that appears over a text selection.
 *
 * Order and grouping follow Notion's: turn-into and link on the left, the
 * inline marks in the middle, colour and the overflow menu on the right.
 */

import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import {
    Bold,
    ChevronDown,
    Code,
    Copy,
    Italic,
    Link2,
    MessageSquare,
    MoreHorizontal,
    Palette,
    Sigma,
    Strikethrough,
    Trash2,
    Underline,
} from "lucide-react";
import { useRef, useState } from "react";

import { TURN_INTO_BLOCKS } from "../../lib/blocks";
import { MenuDivider, MenuItem, Popover } from "../../ui/Popover";
import { ColorMenu } from "./ColorMenu";
import { LinkEditor } from "./LinkEditor";

type OpenMenu = "turn-into" | "color" | "link" | "more" | null;

export function BubbleToolbar({
    editor,
    onComment,
}: {
    editor: Editor;
    onComment: (text: string) => void;
}) {
    const [menu, setMenu] = useState<OpenMenu>(null);
    const turnIntoRef = useRef<HTMLButtonElement>(null);
    const colorRef = useRef<HTMLButtonElement>(null);
    const linkRef = useRef<HTMLButtonElement>(null);
    const moreRef = useRef<HTMLButtonElement>(null);

    const close = () => setMenu(null);

    const currentBlock =
        TURN_INTO_BLOCKS.find((block) => block.isActive?.(editor)) ?? TURN_INTO_BLOCKS[0];

    const selectedText = () => {
        const { from, to } = editor.state.selection;
        return editor.state.doc.textBetween(from, to, " ");
    };

    return (
        <BubbleMenu
            editor={editor}
            options={{ placement: "top", offset: 8 }}
            shouldShow={({ editor: instance, from, to }) => {
                if (!instance.isEditable) return false;
                // Nothing selected, or a selected atom (image, embed): those
                // carry their own toolbars.
                if (from === to) return false;
                if (instance.isActive("codeBlock")) return false;
                return instance.state.doc.textBetween(from, to, " ").trim().length > 0;
            }}
        >
            <div className="ntn-bubble">
                <button
                    ref={turnIntoRef}
                    type="button"
                    className="ntn-bubble__btn ntn-bubble__btn--wide"
                    onClick={() => setMenu(menu === "turn-into" ? null : "turn-into")}
                >
                    <span>{currentBlock?.title ?? "Text"}</span>
                    <ChevronDown size={12} />
                </button>

                <span className="ntn-bubble__sep" />

                <button
                    ref={linkRef}
                    type="button"
                    className={`ntn-bubble__btn${editor.isActive("link") ? " is-active" : ""}`}
                    title="Link (⌘K)"
                    onClick={() => setMenu(menu === "link" ? null : "link")}
                >
                    <Link2 size={15} />
                </button>

                <button
                    type="button"
                    className="ntn-bubble__btn"
                    title="Comment"
                    onClick={() => onComment(selectedText())}
                >
                    <MessageSquare size={15} />
                </button>

                <span className="ntn-bubble__sep" />

                <button
                    type="button"
                    className={`ntn-bubble__btn${editor.isActive("bold") ? " is-active" : ""}`}
                    title="Bold (⌘B)"
                    onClick={() => editor.chain().focus().toggleBold().run()}
                >
                    <Bold size={15} />
                </button>
                <button
                    type="button"
                    className={`ntn-bubble__btn${editor.isActive("italic") ? " is-active" : ""}`}
                    title="Italic (⌘I)"
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                >
                    <Italic size={15} />
                </button>
                <button
                    type="button"
                    className={`ntn-bubble__btn${editor.isActive("underline") ? " is-active" : ""}`}
                    title="Underline (⌘U)"
                    onClick={() => editor.chain().focus().toggleUnderline().run()}
                >
                    <Underline size={15} />
                </button>
                <button
                    type="button"
                    className={`ntn-bubble__btn${editor.isActive("strike") ? " is-active" : ""}`}
                    title="Strikethrough (⌘⇧S)"
                    onClick={() => editor.chain().focus().toggleStrike().run()}
                >
                    <Strikethrough size={15} />
                </button>
                <button
                    type="button"
                    className={`ntn-bubble__btn${editor.isActive("code") ? " is-active" : ""}`}
                    title="Code (⌘E)"
                    onClick={() => editor.chain().focus().toggleCode().run()}
                >
                    <Code size={15} />
                </button>
                <button
                    type="button"
                    className="ntn-bubble__btn"
                    title="Equation (⌘⇧E)"
                    onClick={() => {
                        const latex = selectedText();
                        editor
                            .chain()
                            .focus()
                            .deleteSelection()
                            .insertInlineMath({ latex })
                            .run();
                    }}
                >
                    <Sigma size={15} />
                </button>

                <span className="ntn-bubble__sep" />

                <button
                    ref={colorRef}
                    type="button"
                    className="ntn-bubble__btn"
                    title="Colour"
                    onClick={() => setMenu(menu === "color" ? null : "color")}
                >
                    <Palette size={15} />
                    <ChevronDown size={11} />
                </button>

                <button
                    ref={moreRef}
                    type="button"
                    className="ntn-bubble__btn"
                    title="More"
                    onClick={() => setMenu(menu === "more" ? null : "more")}
                >
                    <MoreHorizontal size={15} />
                </button>
            </div>

            <Popover
                anchor={turnIntoRef.current}
                open={menu === "turn-into"}
                onClose={close}
                ignore={[turnIntoRef.current]}
            >
                <div className="ntn-menu ntn-menu--turn-into">
                    {TURN_INTO_BLOCKS.map((block) => {
                        const Icon = block.icon;
                        return (
                            <MenuItem
                                key={block.id}
                                icon={<Icon size={15} />}
                                label={block.title}
                                active={block.isActive?.(editor)}
                                onClick={() => {
                                    block.turnInto?.(editor);
                                    close();
                                }}
                            />
                        );
                    })}
                </div>
            </Popover>

            <Popover
                anchor={colorRef.current}
                open={menu === "color"}
                onClose={close}
                ignore={[colorRef.current]}
            >
                <ColorMenu editor={editor} onDone={close} />
            </Popover>

            <Popover
                anchor={linkRef.current}
                open={menu === "link"}
                onClose={close}
                ignore={[linkRef.current]}
            >
                <LinkEditor editor={editor} onDone={close} />
            </Popover>

            <Popover
                anchor={moreRef.current}
                open={menu === "more"}
                onClose={close}
                ignore={[moreRef.current]}
            >
                <div className="ntn-menu">
                    <MenuItem
                        icon={<Copy size={15} />}
                        label="Duplicate selection"
                        hint="⌘D"
                        onClick={() => {
                            const { from, to } = editor.state.selection;
                            const slice = editor.state.doc.slice(from, to);
                            editor
                                .chain()
                                .focus()
                                .insertContentAt(to, slice.content.toJSON() as never)
                                .run();
                            close();
                        }}
                    />
                    <MenuItem
                        icon={<Code size={15} />}
                        label="Clear formatting"
                        onClick={() => {
                            editor.chain().focus().unsetAllMarks().clearBlockColor().run();
                            close();
                        }}
                    />
                    <MenuDivider />
                    <MenuItem
                        icon={<Trash2 size={15} />}
                        label="Delete"
                        hint="⌫"
                        danger
                        onClick={() => {
                            editor.chain().focus().deleteSelection().run();
                            close();
                        }}
                    />
                </div>
            </Popover>
        </BubbleMenu>
    );
}

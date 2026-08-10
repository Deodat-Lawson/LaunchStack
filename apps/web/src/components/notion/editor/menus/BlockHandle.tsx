"use client";

/**
 * The gutter controls: `+` to insert a block below, `⠿` to drag or open the
 * block menu.
 *
 * Tiptap's DragHandle handles hit-testing and the drag itself; everything
 * Notion puts on the handle — turn into, colour, duplicate, move to, copy link
 * — is this component's job.
 */

import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
    ArrowRight,
    Copy,
    CornerUpLeft,
    GripVertical,
    Link2,
    MessageSquare,
    Palette,
    Plus,
    RefreshCw,
    Trash2,
    Type,
} from "lucide-react";
import { useRef, useState } from "react";

import { TURN_INTO_BLOCKS } from "../../lib/blocks";
import { MenuDivider, MenuHeading, MenuItem, Popover } from "../../ui/Popover";
import { ColorMenu } from "./ColorMenu";

interface HandleTarget {
    node: ProseMirrorNode | null;
    pos: number;
}

export function BlockHandle({
    editor,
    onInsertBelow,
    onComment,
    onMoveTo,
}: {
    editor: Editor;
    /** Opens the slash menu on a fresh empty block below the current one. */
    onInsertBelow: (pos: number) => void;
    onComment: (blockId: string, text: string) => void;
    onMoveTo: (blockId: string) => void;
}) {
    const [target, setTarget] = useState<HandleTarget>({ node: null, pos: -1 });
    const [menu, setMenu] = useState<"block" | "turn-into" | "color" | null>(null);
    const gripRef = useRef<HTMLButtonElement>(null);

    const close = () => setMenu(null);

    /** Select the whole block so any command applies to all of it. */
    const selectBlock = () => {
        if (target.pos < 0 || !target.node) return;
        editor
            .chain()
            .focus()
            .setTextSelection({
                from: target.pos + 1,
                to: target.pos + target.node.nodeSize - 1,
            })
            .run();
    };

    const blockId = (target.node?.attrs.id as string | undefined) ?? "";

    const remove = () => {
        if (target.pos < 0 || !target.node) return;
        editor
            .chain()
            .focus()
            .deleteRange({ from: target.pos, to: target.pos + target.node.nodeSize })
            .run();
        close();
    };

    const duplicate = () => {
        if (target.pos < 0 || !target.node) return;
        const json = target.node.toJSON() as Record<string, unknown>;
        // Drop the id so the copy gets its own — two blocks sharing an id
        // would make comments and drag targets ambiguous.
        const attrs = { ...((json.attrs as Record<string, unknown>) ?? {}) };
        delete attrs.id;
        editor
            .chain()
            .focus()
            .insertContentAt(target.pos + target.node.nodeSize, {
                ...json,
                attrs,
            } as never)
            .run();
        close();
    };

    return (
        <DragHandle
            editor={editor}
            nested
            onNodeChange={({ node, pos }) => setTarget({ node, pos })}
            className="ntn-handle"
        >
            <div className="ntn-handle__group">
                <button
                    type="button"
                    className="ntn-handle__btn"
                    title="Click to add a block below"
                    onClick={() => {
                        if (target.pos < 0 || !target.node) return;
                        onInsertBelow(target.pos + target.node.nodeSize);
                    }}
                >
                    <Plus size={15} />
                </button>
                <button
                    ref={gripRef}
                    type="button"
                    className="ntn-handle__btn ntn-handle__btn--grip"
                    title="Drag to move, click to open menu"
                    onClick={() => {
                        selectBlock();
                        setMenu(menu === "block" ? null : "block");
                    }}
                >
                    <GripVertical size={15} />
                </button>
            </div>

            <Popover
                anchor={gripRef.current}
                open={menu === "block"}
                onClose={close}
                ignore={[gripRef.current]}
            >
                <div className="ntn-menu">
                    <MenuItem
                        icon={<Trash2 size={15} />}
                        label="Delete"
                        hint="Del"
                        danger
                        onClick={remove}
                    />
                    <MenuItem
                        icon={<Copy size={15} />}
                        label="Duplicate"
                        hint="⌘D"
                        onClick={duplicate}
                    />
                    <MenuItem
                        icon={<Type size={15} />}
                        label="Turn into"
                        hint="›"
                        onClick={() => setMenu("turn-into")}
                    />
                    <MenuItem
                        icon={<Palette size={15} />}
                        label="Colour"
                        hint="›"
                        onClick={() => setMenu("color")}
                    />
                    <MenuDivider />
                    <MenuItem
                        icon={<Link2 size={15} />}
                        label="Copy link to block"
                        onClick={() => {
                            const url = `${window.location.origin}${window.location.pathname}#${blockId}`;
                            void navigator.clipboard.writeText(url);
                            close();
                        }}
                    />
                    <MenuItem
                        icon={<MessageSquare size={15} />}
                        label="Comment"
                        hint="⌘⇧M"
                        onClick={() => {
                            onComment(blockId, target.node?.textContent ?? "");
                            close();
                        }}
                    />
                    <MenuItem
                        icon={<ArrowRight size={15} />}
                        label="Move to"
                        hint="⌘⇧P"
                        onClick={() => {
                            onMoveTo(blockId);
                            close();
                        }}
                    />
                    <MenuDivider />
                    <MenuItem
                        icon={<CornerUpLeft size={15} />}
                        label="Undo"
                        hint="⌘Z"
                        onClick={() => {
                            editor.chain().focus().undo().run();
                            close();
                        }}
                    />
                    <MenuItem
                        icon={<RefreshCw size={15} />}
                        label="Redo"
                        hint="⌘⇧Z"
                        onClick={() => {
                            editor.chain().focus().redo().run();
                            close();
                        }}
                    />
                </div>
            </Popover>

            <Popover
                anchor={gripRef.current}
                open={menu === "turn-into"}
                onClose={close}
                placement="right-start"
                ignore={[gripRef.current]}
            >
                <div className="ntn-menu ntn-menu--turn-into">
                    <MenuHeading>Turn into</MenuHeading>
                    {TURN_INTO_BLOCKS.map((block) => {
                        const Icon = block.icon;
                        return (
                            <MenuItem
                                key={block.id}
                                icon={<Icon size={15} />}
                                label={block.title}
                                active={block.isActive?.(editor)}
                                onClick={() => {
                                    selectBlock();
                                    block.turnInto?.(editor);
                                    close();
                                }}
                            />
                        );
                    })}
                </div>
            </Popover>

            <Popover
                anchor={gripRef.current}
                open={menu === "color"}
                onClose={close}
                placement="right-start"
                ignore={[gripRef.current]}
            >
                <ColorMenu editor={editor} onDone={close} />
            </Popover>
        </DragHandle>
    );
}

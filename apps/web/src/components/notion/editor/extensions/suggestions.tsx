"use client";

/**
 * The three inline triggers — `/` for blocks, `@` for mentions, `:` for emoji.
 *
 * Each is a Suggestion plugin plus a React list. They are built by factories
 * rather than declared as constants because they need live data (the page
 * tree, the command context) that changes while the editor is mounted; the
 * factories close over a getter so the plugin always sees current values
 * without being rebuilt, which would drop the editor's state.
 */

import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { ReactRenderer, type Editor } from "@tiptap/react";
import type { EmojiItem } from "@tiptap/extension-emoji";

import type { BlockCommandContext, BlockDefinition } from "../../lib/blocks";
import type { WorkspacePageSummary } from "~/types/workspace";
import { EmojiMenu } from "../menus/EmojiMenu";
import { MentionMenu } from "../menus/MentionMenu";
import { SlashMenu } from "../menus/SlashMenu";
import { createSuggestionPopup, listHandle } from "../suggestion-popup";
import type { MentionAttrs } from "./mention";

/** Live values the suggestion plugins read on every keystroke. */
export interface SuggestionRuntime {
    ctx: BlockCommandContext;
    pages: WorkspacePageSummary[];
    people: Array<{ id: string; name: string; avatar?: string | null }>;
}

type RuntimeGetter = () => SuggestionRuntime;

type RendererComponent = ConstructorParameters<typeof ReactRenderer>[0];

/**
 * Shared plumbing: mount a React list in a floating popup, forward keys to it,
 * and tear it down. `render` is the only part of a Suggestion that differs
 * between the three triggers once the list component is chosen.
 */
function reactRenderer<P extends Record<string, unknown>>(
    // ReactRenderer's parameter type is deliberately loose; the list
    // components are typed on their own props, so the cast happens once here
    // rather than at all three call sites.
    component: unknown,
    buildProps: (props: {
        editor: Editor;
        query: string;
        command: (item: never) => void;
    }) => P
): SuggestionOptions["render"] {
    return () => {
        let renderer: ReactRenderer | null = null;
        const popup = createSuggestionPopup();

        return {
            onStart: (props) => {
                renderer = new ReactRenderer(component as RendererComponent, {
                    editor: props.editor,
                    props: buildProps({
                        editor: props.editor,
                        query: props.query,
                        command: props.command as (item: never) => void,
                    }),
                });
                popup.mount(renderer.element, props.clientRect?.() ?? null);
            },

            onUpdate: (props) => {
                renderer?.updateProps(
                    buildProps({
                        editor: props.editor,
                        query: props.query,
                        command: props.command as (item: never) => void,
                    })
                );
                popup.update(props.clientRect?.() ?? null);
            },

            onKeyDown: (props) => {
                if (props.event.key === "Escape") {
                    popup.destroy();
                    renderer?.destroy();
                    renderer = null;
                    return true;
                }
                return listHandle(renderer)?.onKeyDown(props.event) ?? false;
            },

            onExit: () => {
                popup.destroy();
                renderer?.destroy();
                renderer = null;
            },
        };
    };
}

// ---------------------------------------------------------------------------
// `/` — block menu
// ---------------------------------------------------------------------------

export function createSlashCommand(getRuntime: RuntimeGetter): Extension {
    return Extension.create({
        name: "slashCommand",

        addProseMirrorPlugins() {
            return [
                Suggestion({
                    editor: this.editor,
                    char: "/",
                    // Notion only opens the menu at the start of a block or
                    // after a space, so "and/or" does not trigger it.
                    allowSpaces: false,
                    startOfLine: false,
                    allow: ({ state, range }) => {
                        const before = state.doc.textBetween(
                            Math.max(0, range.from - 1),
                            range.from
                        );
                        return before === "" || /\s/.test(before);
                    },
                    items: () => [],
                    command: ({ editor, range, props }) => {
                        const block = props as unknown as BlockDefinition;
                        // Remove the "/query" text first so the inserted block
                        // does not inherit it.
                        editor.chain().focus().deleteRange(range).run();
                        void block.run(editor, getRuntime().ctx);
                    },
                    render: reactRenderer(SlashMenu, ({ editor, query, command }) => ({
                        editor,
                        query,
                        onCommand: (block: BlockDefinition) => command(block as never),
                    })),
                }),
            ];
        },
    });
}

// ---------------------------------------------------------------------------
// `@` — mentions
// ---------------------------------------------------------------------------

export function createMentionSuggestion(
    getRuntime: RuntimeGetter
): Omit<SuggestionOptions, "editor"> {
    return {
        char: "@",
        allowSpaces: true,
        items: () => [],
        command: ({ editor, range, props }) => {
            const attrs = props as unknown as MentionAttrs;
            editor
                .chain()
                .focus()
                .insertContentAt(range, [
                    { type: "mention", attrs },
                    { type: "text", text: " " },
                ])
                .run();
        },
        render: reactRenderer(MentionMenu, ({ query, command }) => {
            const runtime = getRuntime();
            return {
                query,
                pages: runtime.pages,
                people: runtime.people,
                onSelect: (attrs: MentionAttrs) => command(attrs as never),
            };
        }),
    };
}

// ---------------------------------------------------------------------------
// `:` — emoji
// ---------------------------------------------------------------------------

export function createEmojiSuggestion(): Partial<SuggestionOptions> {
    return {
        render: reactRenderer(EmojiMenu, ({ query, command }) => ({
            query,
            onSelect: (item: EmojiItem) => command(item as never),
        })),
    };
}

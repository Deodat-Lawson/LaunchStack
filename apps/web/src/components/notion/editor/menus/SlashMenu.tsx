"use client";

/**
 * The `/` menu.
 *
 * Filtering, grouping, and keyboard handling live here; the catalogue itself
 * is in `lib/blocks`. Arrow keys move within the flattened list so a group
 * heading never swallows a keystroke.
 */

import type { Editor } from "@tiptap/react";
import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import {
    BLOCK_GROUP_LABELS,
    groupBlocks,
    searchBlocks,
    type BlockDefinition,
} from "../../lib/blocks";
import type { SuggestionListHandle } from "../suggestion-popup";

export interface SlashMenuProps {
    editor: Editor;
    query: string;
    /** Deletes the `/query` text before the block command runs. */
    onCommand: (block: BlockDefinition) => void;
}

export const SlashMenu = forwardRef<SuggestionListHandle, SlashMenuProps>(
    function SlashMenu({ editor, query, onCommand }, ref) {
        const [active, setActive] = useState(0);
        const listRef = useRef<HTMLDivElement>(null);
        const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

        const matches = useMemo(() => searchBlocks(query), [query]);
        const sections = useMemo(() => groupBlocks(matches), [matches]);

        // A new query means a new list; keeping the old index would highlight
        // an unrelated row.
        useEffect(() => {
            setActive(0);
        }, [query]);

        useLayoutEffect(() => {
            itemRefs.current[active]?.scrollIntoView({ block: "nearest" });
        }, [active]);

        useImperativeHandle(ref, () => ({
            onKeyDown: (event) => {
                if (matches.length === 0) return false;

                if (event.key === "ArrowDown") {
                    setActive((index) => (index + 1) % matches.length);
                    return true;
                }
                if (event.key === "ArrowUp") {
                    setActive((index) => (index - 1 + matches.length) % matches.length);
                    return true;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                    const block = matches[active];
                    if (block) onCommand(block);
                    return true;
                }
                return false;
            },
        }));

        if (matches.length === 0) {
            return (
                <div className="ntn-menu ntn-menu--slash">
                    <div className="ntn-menu__empty">
                        No results{query ? ` for “${query}”` : ""}
                    </div>
                </div>
            );
        }

        let flatIndex = -1;

        return (
            <div className="ntn-menu ntn-menu--slash" ref={listRef}>
                {sections.map((section) => (
                    <div key={section.group} className="ntn-menu__section">
                        <div className="ntn-menu__heading">
                            {BLOCK_GROUP_LABELS[section.group]}
                        </div>
                        {section.blocks.map((block) => {
                            flatIndex += 1;
                            const index = flatIndex;
                            const Icon = block.icon;
                            const isActive = index === active;
                            return (
                                <button
                                    key={block.id}
                                    type="button"
                                    ref={(element) => {
                                        itemRefs.current[index] = element;
                                    }}
                                    className={`ntn-menu__item${isActive ? " is-active" : ""}`}
                                    onMouseEnter={() => setActive(index)}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => onCommand(block)}
                                >
                                    <span className="ntn-menu__icon">
                                        <Icon size={16} />
                                    </span>
                                    <span className="ntn-menu__text">
                                        <span className="ntn-menu__title">{block.title}</span>
                                        <span className="ntn-menu__desc">{block.description}</span>
                                    </span>
                                    {block.shortcut && (
                                        <span className="ntn-menu__shortcut">{block.shortcut}</span>
                                    )}
                                    {block.isActive?.(editor) && (
                                        <span className="ntn-menu__current">Current</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                ))}
                <div className="ntn-menu__footer">
                    <kbd>↑</kbd>
                    <kbd>↓</kbd>
                    <span>to navigate</span>
                    <kbd>↵</kbd>
                    <span>to select</span>
                    <kbd>esc</kbd>
                    <span>to dismiss</span>
                </div>
            </div>
        );
    }
);

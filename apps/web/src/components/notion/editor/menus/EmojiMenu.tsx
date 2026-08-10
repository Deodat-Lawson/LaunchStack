"use client";

/**
 * The `:shortcode:` emoji menu.
 *
 * Deliberately narrower than the full picker: it is a quick completion while
 * typing, so it shows one compact row per match and never scrolls past ten.
 */

import { emojis, type EmojiItem } from "@tiptap/extension-emoji";
import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import type { SuggestionListHandle } from "../suggestion-popup";

const LIMIT = 10;

export interface EmojiMenuProps {
    query: string;
    onSelect: (item: EmojiItem) => void;
}

export const EmojiMenu = forwardRef<SuggestionListHandle, EmojiMenuProps>(
    function EmojiMenu({ query, onSelect }, ref) {
        const [active, setActive] = useState(0);
        const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

        const matches = useMemo(() => {
            const q = query.trim().toLowerCase();
            if (!q) return emojis.filter((item) => item.emoji).slice(0, LIMIT);
            // Shortcode prefixes first: typing `:sm` should land on `:smile:`
            // before it offers something that merely mentions "sm".
            const starts: EmojiItem[] = [];
            const contains: EmojiItem[] = [];
            for (const item of emojis) {
                if (!item.emoji) continue;
                if (item.shortcodes.some((code) => code.startsWith(q))) starts.push(item);
                else if (
                    item.name.includes(q) ||
                    item.tags.some((tag) => tag.includes(q))
                ) {
                    contains.push(item);
                }
                if (starts.length >= LIMIT) break;
            }
            return [...starts, ...contains].slice(0, LIMIT);
        }, [query]);

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
                    const item = matches[active];
                    if (item) onSelect(item);
                    return true;
                }
                return false;
            },
        }));

        if (matches.length === 0) {
            return (
                <div className="ntn-menu ntn-menu--emoji">
                    <div className="ntn-menu__empty">No emoji found</div>
                </div>
            );
        }

        return (
            <div className="ntn-menu ntn-menu--emoji">
                {matches.map((item, index) => (
                    <button
                        key={item.name}
                        type="button"
                        ref={(element) => {
                            itemRefs.current[index] = element;
                        }}
                        className={`ntn-menu__item ntn-menu__item--tight${
                            index === active ? " is-active" : ""
                        }`}
                        onMouseEnter={() => setActive(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onSelect(item)}
                    >
                        <span className="ntn-menu__icon">{item.emoji}</span>
                        <span className="ntn-menu__title">:{item.shortcodes[0] ?? item.name}:</span>
                    </button>
                ))}
            </div>
        );
    }
);

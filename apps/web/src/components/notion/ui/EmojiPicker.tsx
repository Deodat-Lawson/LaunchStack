"use client";

/**
 * Emoji picker — used by the page icon, callouts, and the `:shortcode:` menu.
 *
 * The dataset ships with `@tiptap/extension-emoji`, so there is no second
 * emoji dependency and the picker and the inline `:` suggestion always agree
 * on what exists.
 */

import { emojis, type EmojiItem } from "@tiptap/extension-emoji";
import { Shuffle, X } from "lucide-react";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";

/** Recently used emoji, newest first. Survives reloads, not sessions. */
const RECENTS_KEY = "ntn:emoji:recents";
const RECENTS_LIMIT = 24;

const GROUP_ORDER = [
    "people & body",
    "animals & nature",
    "food & drink",
    "travel & places",
    "activities",
    "objects",
    "symbols",
    "flags",
] as const;

const GROUP_LABELS: Record<string, string> = {
    "people & body": "People",
    "animals & nature": "Nature",
    "food & drink": "Food",
    "travel & places": "Travel",
    activities: "Activities",
    objects: "Objects",
    symbols: "Symbols",
    flags: "Flags",
};

/** Emoji with a renderable glyph, grouped and de-duplicated once at module load. */
const CATALOG: Array<{ group: string; items: EmojiItem[] }> = (() => {
    const byGroup = new Map<string, EmojiItem[]>();
    const seen = new Set<string>();

    for (const item of emojis) {
        if (!item.emoji) continue;
        if (seen.has(item.emoji)) continue;
        seen.add(item.emoji);
        // Ungrouped entries carry "" rather than being absent, so an empty
        // string has to fall back too — `??` alone would not catch it.
        const rawGroup = item.group ?? "";
        const group = rawGroup.length > 0 ? rawGroup : "symbols";
        const bucket = byGroup.get(group) ?? [];
        bucket.push(item);
        byGroup.set(group, bucket);
    }

    return GROUP_ORDER.map((group) => ({
        group,
        items: byGroup.get(group) ?? [],
    })).filter((section) => section.items.length > 0);
})();

const ALL_ITEMS: EmojiItem[] = CATALOG.flatMap((section) => section.items);

function readRecents(): string[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(RECENTS_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
        return [];
    }
}

function pushRecent(emoji: string): void {
    if (typeof window === "undefined") return;
    const next = [emoji, ...readRecents().filter((e) => e !== emoji)].slice(0, RECENTS_LIMIT);
    try {
        window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
        // Private browsing — recents are a nicety, not a requirement.
    }
}

export interface EmojiPickerProps {
    onSelect: (emoji: string) => void;
    /** Rendered above the grid — the icon picker uses it for Upload/Link tabs. */
    header?: ReactNode;
    /** Shown as a "Remove" action when the caller has something to clear. */
    onRemove?: () => void;
    onClose?: () => void;
    autoFocus?: boolean;
}

export function EmojiPicker({
    onSelect,
    header,
    onRemove,
    onClose,
    autoFocus = true,
}: EmojiPickerProps) {
    const [query, setQuery] = useState("");
    const [recents, setRecents] = useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setRecents(readRecents());
    }, []);

    useEffect(() => {
        if (autoFocus) inputRef.current?.focus();
    }, [autoFocus]);

    const choose = useCallback(
        (emoji: string) => {
            pushRecent(emoji);
            setRecents(readRecents());
            onSelect(emoji);
        },
        [onSelect]
    );

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return null;
        return ALL_ITEMS.filter(
            (item) =>
                item.name.includes(q) ||
                item.shortcodes.some((code) => code.includes(q)) ||
                item.tags.some((tag) => tag.includes(q))
        ).slice(0, 120);
    }, [query]);

    return (
        <div className="ntn-emoji" role="dialog" aria-label="Pick an emoji">
            {header}
            <div className="ntn-emoji__bar">
                <input
                    ref={inputRef}
                    className="ntn-emoji__search"
                    value={query}
                    placeholder="Filter…"
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            event.stopPropagation();
                            onClose?.();
                        }
                        if (event.key === "Enter") {
                            const first = results?.[0] ?? ALL_ITEMS[0];
                            if (first?.emoji) choose(first.emoji);
                        }
                    }}
                />
                <button
                    type="button"
                    className="ntn-emoji__action"
                    title="Random"
                    onClick={() => {
                        const pick = ALL_ITEMS[Math.floor(Math.random() * ALL_ITEMS.length)];
                        if (pick?.emoji) choose(pick.emoji);
                    }}
                >
                    <Shuffle size={13} />
                </button>
                {onRemove && (
                    <button
                        type="button"
                        className="ntn-emoji__action"
                        title="Remove"
                        onClick={onRemove}
                    >
                        <X size={13} />
                    </button>
                )}
            </div>

            <div className="ntn-emoji__scroll">
                {results ? (
                    <Section
                        label={`${results.length} result${results.length === 1 ? "" : "s"}`}
                        items={results.flatMap((item) => (item.emoji ? [item.emoji] : []))}
                        onSelect={choose}
                    />
                ) : (
                    <>
                        {recents.length > 0 && (
                            <Section label="Recent" items={recents} onSelect={choose} />
                        )}
                        {CATALOG.map((section) => (
                            <Section
                                key={section.group}
                                label={GROUP_LABELS[section.group] ?? section.group}
                                items={section.items.flatMap((item) => (item.emoji ? [item.emoji] : []))}
                                onSelect={choose}
                            />
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}

function Section({
    label,
    items,
    onSelect,
}: {
    label: string;
    items: string[];
    onSelect: (emoji: string) => void;
}) {
    if (items.length === 0) return null;
    return (
        <div className="ntn-emoji__section">
            <div className="ntn-emoji__label">{label}</div>
            <div className="ntn-emoji__grid">
                {items.map((emoji, index) => (
                    <button
                        key={`${emoji}-${index}`}
                        type="button"
                        className="ntn-emoji__cell"
                        onClick={() => onSelect(emoji)}
                    >
                        {emoji}
                    </button>
                ))}
            </div>
        </div>
    );
}

/**
 * The picker in a floating card that closes on outside click or Escape — the
 * form callouts and inline buttons want.
 */
export function EmojiPickerPopover({
    onSelect,
    onClose,
    onRemove,
}: {
    onSelect: (emoji: string) => void;
    onClose: () => void;
    onRemove?: () => void;
}) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onPointerDown = (event: MouseEvent) => {
            if (!ref.current?.contains(event.target as Node)) onClose();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        // Defer so the click that opened the popover does not immediately close it.
        const timer = window.setTimeout(() => {
            document.addEventListener("mousedown", onPointerDown);
        }, 0);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [onClose]);

    return (
        <div className="ntn-popover ntn-popover--emoji" ref={ref}>
            <EmojiPicker onSelect={onSelect} onClose={onClose} onRemove={onRemove} />
        </div>
    );
}

"use client";

/**
 * The `@` menu: pages, dates, and people in one list.
 *
 * Notion shows all three kinds together and lets the query narrow across them,
 * so the items are built into a single flat array with headings rather than
 * three independent lists.
 */

import { CalendarDays, FileText, UserRound } from "lucide-react";
import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import type { WorkspacePageSummary } from "~/types/workspace";
import type { MentionAttrs } from "../extensions/mention";
import type { SuggestionListHandle } from "../suggestion-popup";

export interface MentionMenuProps {
    query: string;
    pages: WorkspacePageSummary[];
    /** Workspace members offered under "People". */
    people: Array<{ id: string; name: string; avatar?: string | null }>;
    onSelect: (attrs: MentionAttrs) => void;
}

interface Row {
    key: string;
    group: string;
    label: string;
    hint?: string;
    icon: "page" | "date" | "person";
    glyph?: string | null;
    attrs: MentionAttrs;
}

/** Date shortcuts Notion offers before you have typed anything specific. */
function dateRows(query: string): Row[] {
    const q = query.trim().toLowerCase();
    const now = new Date();
    const offset = (days: number) => {
        const date = new Date(now);
        date.setDate(date.getDate() + days);
        return date.toISOString().slice(0, 10);
    };

    const candidates: Array<[string, string]> = [
        ["Today", offset(0)],
        ["Tomorrow", offset(1)],
        ["Yesterday", offset(-1)],
        ["Next week", offset(7)],
    ];

    // A typed date wins over the shortcuts — "@2026-03-01" should offer that date.
    const parsed = q ? new Date(q) : null;
    if (parsed && !Number.isNaN(parsed.getTime()) && /\d/.test(q)) {
        candidates.unshift([
            parsed.toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
            }),
            parsed.toISOString().slice(0, 10),
        ]);
    }

    return candidates
        .filter(([label]) => !q || label.toLowerCase().includes(q) || /\d/.test(q))
        .map(([label, iso]) => ({
            key: `date:${iso}:${label}`,
            group: "Date",
            label,
            hint: iso,
            icon: "date" as const,
            attrs: { id: iso, label, kind: "date" as const, date: iso },
        }));
}

export const MentionMenu = forwardRef<SuggestionListHandle, MentionMenuProps>(
    function MentionMenu({ query, pages, people, onSelect }, ref) {
        const [active, setActive] = useState(0);
        const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

        const rows = useMemo<Row[]>(() => {
            const q = query.trim().toLowerCase();

            const pageRows: Row[] = pages
                .filter((page) => !page.inTrash)
                .filter((page) => !q || (page.title || "Untitled").toLowerCase().includes(q))
                .slice(0, 8)
                .map((page) => ({
                    key: `page:${page.id}`,
                    group: "Link to page",
                    label: page.title || "Untitled",
                    icon: "page" as const,
                    glyph: page.icon?.type === "emoji" ? page.icon.value : null,
                    attrs: {
                        id: page.id,
                        label: page.title || "Untitled",
                        kind: "page" as const,
                        icon: page.icon?.type === "emoji" ? page.icon.value : null,
                    },
                }));

            const personRows: Row[] = people
                .filter((person) => !q || person.name.toLowerCase().includes(q))
                .slice(0, 6)
                .map((person) => ({
                    key: `person:${person.id}`,
                    group: "People",
                    label: person.name,
                    icon: "person" as const,
                    attrs: { id: person.id, label: person.name, kind: "person" as const },
                }));

            return [...pageRows, ...dateRows(query), ...personRows];
        }, [pages, people, query]);

        useEffect(() => {
            setActive(0);
        }, [query]);

        useLayoutEffect(() => {
            itemRefs.current[active]?.scrollIntoView({ block: "nearest" });
        }, [active]);

        useImperativeHandle(ref, () => ({
            onKeyDown: (event) => {
                if (rows.length === 0) return false;
                if (event.key === "ArrowDown") {
                    setActive((index) => (index + 1) % rows.length);
                    return true;
                }
                if (event.key === "ArrowUp") {
                    setActive((index) => (index - 1 + rows.length) % rows.length);
                    return true;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                    const row = rows[active];
                    if (row) onSelect(row.attrs);
                    return true;
                }
                return false;
            },
        }));

        if (rows.length === 0) {
            return (
                <div className="ntn-menu ntn-menu--mention">
                    <div className="ntn-menu__empty">No matches</div>
                </div>
            );
        }

        let lastGroup = "";

        return (
            <div className="ntn-menu ntn-menu--mention">
                {rows.map((row, index) => {
                    const heading = row.group !== lastGroup ? row.group : null;
                    lastGroup = row.group;
                    return (
                        <div key={row.key}>
                            {heading && <div className="ntn-menu__heading">{heading}</div>}
                            <button
                                type="button"
                                ref={(element) => {
                                    itemRefs.current[index] = element;
                                }}
                                className={`ntn-menu__item${index === active ? " is-active" : ""}`}
                                onMouseEnter={() => setActive(index)}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => onSelect(row.attrs)}
                            >
                                <span className="ntn-menu__icon">
                                    {row.icon === "page" ? (
                                        row.glyph ? (
                                            <span>{row.glyph}</span>
                                        ) : (
                                            <FileText size={15} />
                                        )
                                    ) : row.icon === "date" ? (
                                        <CalendarDays size={15} />
                                    ) : (
                                        <UserRound size={15} />
                                    )}
                                </span>
                                <span className="ntn-menu__text">
                                    <span className="ntn-menu__title">{row.label}</span>
                                </span>
                                {row.hint && <span className="ntn-menu__shortcut">{row.hint}</span>}
                            </button>
                        </div>
                    );
                })}
            </div>
        );
    }
);

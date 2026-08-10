"use client";

/**
 * One cell, rendered and edited according to its property type.
 *
 * Notion's cells are display-first and become inputs on click; that is what
 * keeps a grid readable at a glance. Each branch below is the same idea:
 * render a compact value, and swap in the smallest editor that type needs.
 */

import { Check, ExternalLink, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { backgroundColorValue, colorForName, getColor } from "../lib/colors";
import { dateString, isReadOnly, readValue, toText } from "./query";
import type {
    DatabaseProperty,
    SelectOption,
    WorkspacePageDto,
} from "~/types/workspace";

export interface PropertyCellProps {
    row: WorkspacePageDto;
    property: DatabaseProperty;
    onChange: (value: unknown) => void;
    /** Adds an option to a select/multi-select/status column. */
    onAddOption?: (option: SelectOption) => void;
    onOpenRow?: () => void;
    compact?: boolean;
}

function formatDate(value: unknown): string {
    const raw = dateString(value);
    if (!raw) return "";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    });
}

function formatNumber(value: unknown, format: string | undefined): string {
    const number = typeof value === "number" ? value : Number(value);
    if (Number.isNaN(number) || value === null || value === "") return "";
    switch (format) {
        case "percent":
            return `${number}%`;
        case "dollar":
            return `$${number.toLocaleString()}`;
        case "euro":
            return `€${number.toLocaleString()}`;
        default:
            return number.toLocaleString();
    }
}

function Tag({
    label,
    color,
    onRemove,
}: {
    label: string;
    color: string;
    onRemove?: () => void;
}) {
    const swatch = getColor(color);
    return (
        <span
            className="ntn-tag"
            style={{
                background: backgroundColorValue(color) ?? "var(--panel-2)",
                color: swatch.text,
            }}
        >
            {label}
            {onRemove && (
                <button type="button" className="ntn-tag__x" onClick={onRemove}>
                    <X size={10} />
                </button>
            )}
        </span>
    );
}

export function PropertyCell({
    row,
    property,
    onChange,
    onAddOption,
    onOpenRow,
    compact = false,
}: PropertyCellProps) {
    const value = readValue(row, property);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing) inputRef.current?.focus();
    }, [editing]);

    const readOnly = isReadOnly(property);

    // -- Title ------------------------------------------------------------
    if (property.type === "title") {
        return (
            <div className="ntn-cell ntn-cell--title">
                {editing ? (
                    <input
                        ref={inputRef}
                        className="ntn-cell__input"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => {
                            setEditing(false);
                            if (draft !== row.title) onChange(draft);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                            if (event.key === "Escape") setEditing(false);
                        }}
                    />
                ) : (
                    <>
                        <button
                            type="button"
                            className="ntn-cell__title-text"
                            onClick={() => {
                                setDraft(row.title);
                                setEditing(true);
                            }}
                        >
                            {row.title || <span className="ntn-cell__placeholder">Untitled</span>}
                        </button>
                        {onOpenRow && (
                            <button
                                type="button"
                                className="ntn-cell__open"
                                onClick={onOpenRow}
                                title="Open page"
                            >
                                <ExternalLink size={11} />
                                <span>Open</span>
                            </button>
                        )}
                    </>
                )}
            </div>
        );
    }

    // -- Checkbox ---------------------------------------------------------
    if (property.type === "checkbox") {
        return (
            <div className="ntn-cell ntn-cell--checkbox">
                <input
                    type="checkbox"
                    checked={Boolean(value)}
                    disabled={readOnly}
                    onChange={(event) => onChange(event.target.checked)}
                />
            </div>
        );
    }

    // -- Select / status / multi-select -----------------------------------
    if (
        property.type === "select" ||
        property.type === "status" ||
        property.type === "multi_select"
    ) {
        const multiple = property.type === "multi_select";
        const selected: string[] = multiple
            ? Array.isArray(value)
                ? (value as string[])
                : []
            : toText(value)
              ? [toText(value)]
              : [];

        const toggle = (name: string) => {
            if (!multiple) {
                onChange(selected[0] === name ? null : name);
                setEditing(false);
                return;
            }
            onChange(
                selected.includes(name)
                    ? selected.filter((item) => item !== name)
                    : [...selected, name]
            );
        };

        const optionColor = (name: string) =>
            property.options?.find((option) => option.name === name)?.color ??
            colorForName(name);

        return (
            <div className="ntn-cell ntn-cell--select">
                <button
                    type="button"
                    className="ntn-cell__tags"
                    disabled={readOnly}
                    onClick={() => setEditing((open) => !open)}
                >
                    {selected.length === 0 ? (
                        <span className="ntn-cell__placeholder">Empty</span>
                    ) : (
                        selected.map((name) => (
                            <Tag key={name} label={name} color={optionColor(name)} />
                        ))
                    )}
                </button>

                {editing && !readOnly && (
                    <div className="ntn-cell__popover">
                        <input
                            ref={inputRef}
                            className="ntn-input ntn-input--flush"
                            placeholder="Search or create…"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Escape") setEditing(false);
                                if (event.key === "Enter" && draft.trim()) {
                                    const name = draft.trim();
                                    const exists = property.options?.some(
                                        (option) => option.name === name
                                    );
                                    if (!exists) {
                                        onAddOption?.({
                                            id: `${property.id}-${name}`,
                                            name,
                                            color: colorForName(name),
                                        });
                                    }
                                    toggle(name);
                                    setDraft("");
                                }
                            }}
                        />
                        <div className="ntn-cell__options">
                            {(property.options ?? [])
                                .filter(
                                    (option) =>
                                        !draft.trim() ||
                                        option.name
                                            .toLowerCase()
                                            .includes(draft.trim().toLowerCase())
                                )
                                .map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        className="ntn-menu__item"
                                        onClick={() => toggle(option.name)}
                                    >
                                        <Tag label={option.name} color={option.color} />
                                        {selected.includes(option.name) && (
                                            <Check size={13} className="ntn-cell__check" />
                                        )}
                                    </button>
                                ))}
                            {draft.trim() &&
                                !property.options?.some(
                                    (option) =>
                                        option.name.toLowerCase() === draft.trim().toLowerCase()
                                ) && (
                                    <button
                                        type="button"
                                        className="ntn-menu__item"
                                        onClick={() => {
                                            const name = draft.trim();
                                            onAddOption?.({
                                                id: `${property.id}-${name}`,
                                                name,
                                                color: colorForName(name),
                                            });
                                            toggle(name);
                                            setDraft("");
                                        }}
                                    >
                                        <Plus size={13} />
                                        <span className="ntn-menu__title">
                                            Create “{draft.trim()}”
                                        </span>
                                    </button>
                                )}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // -- Date -------------------------------------------------------------
    if (
        property.type === "date" ||
        property.type === "created_time" ||
        property.type === "last_edited_time"
    ) {
        if (readOnly) {
            return <div className="ntn-cell ntn-cell--date">{formatDate(value)}</div>;
        }
        return (
            <div className="ntn-cell ntn-cell--date">
                {editing ? (
                    <input
                        ref={inputRef}
                        type="date"
                        className="ntn-cell__input"
                        value={typeof value === "string" ? value.slice(0, 10) : ""}
                        onChange={(event) => onChange(event.target.value || null)}
                        onBlur={() => setEditing(false)}
                    />
                ) : (
                    <button
                        type="button"
                        className="ntn-cell__text"
                        onClick={() => setEditing(true)}
                    >
                        {formatDate(value) || <span className="ntn-cell__placeholder">Empty</span>}
                    </button>
                )}
            </div>
        );
    }

    // -- Number -----------------------------------------------------------
    if (property.type === "number") {
        return (
            <div className="ntn-cell ntn-cell--number">
                {editing ? (
                    <input
                        ref={inputRef}
                        type="number"
                        className="ntn-cell__input"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => {
                            setEditing(false);
                            onChange(draft === "" ? null : Number(draft));
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                        }}
                    />
                ) : (
                    <button
                        type="button"
                        className="ntn-cell__text"
                        onClick={() => {
                            setDraft(toText(value));
                            setEditing(true);
                        }}
                    >
                        {formatNumber(value, property.format) || (
                            <span className="ntn-cell__placeholder">Empty</span>
                        )}
                    </button>
                )}
            </div>
        );
    }

    // -- URL / email / phone ----------------------------------------------
    if (property.type === "url" || property.type === "email" || property.type === "phone") {
        const raw = toText(value);
        const href =
            property.type === "email"
                ? `mailto:${raw}`
                : property.type === "phone"
                  ? `tel:${raw}`
                  : raw;

        return (
            <div className="ntn-cell ntn-cell--link">
                {editing ? (
                    <input
                        ref={inputRef}
                        className="ntn-cell__input"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => {
                            setEditing(false);
                            onChange(draft || null);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                        }}
                    />
                ) : value ? (
                    <a
                        className="ntn-link"
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        onDoubleClick={(event) => {
                            event.preventDefault();
                            setDraft(raw);
                            setEditing(true);
                        }}
                    >
                        {raw}
                    </a>
                ) : (
                    <button
                        type="button"
                        className="ntn-cell__text"
                        onClick={() => {
                            setDraft("");
                            setEditing(true);
                        }}
                    >
                        <span className="ntn-cell__placeholder">Empty</span>
                    </button>
                )}
            </div>
        );
    }

    // -- Everything else renders as text ----------------------------------
    const text = toText(value);

    if (readOnly) {
        return (
            <div className={`ntn-cell${compact ? " ntn-cell--compact" : ""}`}>{text}</div>
        );
    }

    return (
        <div className={`ntn-cell${compact ? " ntn-cell--compact" : ""}`}>
            {editing ? (
                <input
                    ref={inputRef}
                    className="ntn-cell__input"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => {
                        setEditing(false);
                        onChange(draft || null);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") setEditing(false);
                    }}
                />
            ) : (
                <button
                    type="button"
                    className="ntn-cell__text"
                    onClick={() => {
                        setDraft(text);
                        setEditing(true);
                    }}
                >
                    {text || <span className="ntn-cell__placeholder">Empty</span>}
                </button>
            )}
        </div>
    );
}

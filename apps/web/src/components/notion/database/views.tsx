"use client";

/**
 * The six database layouts.
 *
 * They share the same inputs — rows already filtered and sorted, the visible
 * properties, and the mutation callbacks — and differ only in arrangement.
 * Keeping them in one file makes that symmetry visible and keeps the shared
 * card renderer honest.
 */

import {
    ChevronLeft,
    ChevronRight,
    GripVertical,
    MoreHorizontal,
    Plus,
    Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { backgroundColorValue, getColor } from "../lib/colors";
import { PropertyCell } from "./PropertyCell";
import { dateString, groupRows, readValue, toText, type RowGroup } from "./query";
import type {
    DatabaseProperty,
    DatabaseView,
    SelectOption,
    WorkspacePageDto,
} from "~/types/workspace";

export interface ViewProps {
    rows: WorkspacePageDto[];
    properties: DatabaseProperty[];
    visible: DatabaseProperty[];
    view: DatabaseView;
    editable: boolean;
    onUpdateRow: (
        rowId: string,
        patch: { title?: string; properties?: Record<string, unknown> }
    ) => void;
    onCreateRow: (values?: Record<string, unknown>) => void;
    onDeleteRow: (rowId: string) => void;
    onOpenRow: (rowId: string) => void;
    onAddOption: (propertyId: string, option: SelectOption) => void;
    onAddProperty: () => void;
    onEditProperty: (propertyId: string) => void;
}

/** Write one property value back onto a row, preserving the others. */
function patchFor(
    row: WorkspacePageDto,
    property: DatabaseProperty,
    value: unknown
): { title?: string; properties?: Record<string, unknown> } {
    if (property.type === "title") return { title: toText(value) };
    return { properties: { ...(row.properties ?? {}), [property.id]: value } };
}

function useCellHandlers(props: ViewProps) {
    return useMemo(
        () => ({
            change: (row: WorkspacePageDto, property: DatabaseProperty, value: unknown) =>
                props.onUpdateRow(row.id, patchFor(row, property, value)),
            addOption: (property: DatabaseProperty, option: SelectOption) =>
                props.onAddOption(property.id, option),
        }),
        [props]
    );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function TableView(props: ViewProps) {
    const { rows, visible, editable, onCreateRow, onDeleteRow, onOpenRow } = props;
    const handlers = useCellHandlers(props);

    return (
        <div className="ntn-db-table-wrap">
            <table className="ntn-db-table">
                <thead>
                    <tr>
                        {visible.map((property) => (
                            <th
                                key={property.id}
                                style={{ width: property.width ?? undefined }}
                                onClick={() => editable && props.onEditProperty(property.id)}
                            >
                                <span className="ntn-db-table__head">{property.name}</span>
                            </th>
                        ))}
                        {editable && (
                            <th className="ntn-db-table__add">
                                <button type="button" onClick={props.onAddProperty} title="Add a property">
                                    <Plus size={14} />
                                </button>
                            </th>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.id}>
                            {visible.map((property) => (
                                <td key={property.id}>
                                    <PropertyCell
                                        row={row}
                                        property={property}
                                        onChange={(value) => handlers.change(row, property, value)}
                                        onAddOption={(option) => handlers.addOption(property, option)}
                                        onOpenRow={
                                            property.type === "title"
                                                ? () => onOpenRow(row.id)
                                                : undefined
                                        }
                                    />
                                </td>
                            ))}
                            {editable && (
                                <td className="ntn-db-table__row-actions">
                                    <button
                                        type="button"
                                        title="Delete row"
                                        onClick={() => onDeleteRow(row.id)}
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </td>
                            )}
                        </tr>
                    ))}
                    {rows.length === 0 && (
                        <tr>
                            <td colSpan={visible.length + 1} className="ntn-db-empty">
                                No rows yet.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
            {editable && (
                <button type="button" className="ntn-db-newrow" onClick={() => onCreateRow()}>
                    <Plus size={14} /> New
                </button>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export function BoardView(props: ViewProps) {
    const { rows, properties, view, editable, onCreateRow, onUpdateRow } = props;
    const [dragging, setDragging] = useState<string | null>(null);

    const groupProperty = properties.find((p) => p.id === view.groupByPropertyId);
    const groups = useMemo(() => groupRows(rows, groupProperty), [rows, groupProperty]);

    /** Dropping a card into a column sets the grouping property to it. */
    const drop = (group: RowGroup) => {
        if (!dragging || !groupProperty) return;
        const row = rows.find((r) => r.id === dragging);
        if (!row) return;
        const value =
            group.key === "__none__"
                ? null
                : groupProperty.type === "multi_select"
                  ? [group.label]
                  : group.label;
        onUpdateRow(row.id, {
            properties: { ...(row.properties ?? {}), [groupProperty.id]: value },
        });
        setDragging(null);
    };

    return (
        <div className="ntn-db-board">
            {groups.map((group) => (
                <div
                    key={group.key}
                    className="ntn-db-board__column"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => drop(group)}
                >
                    <div className="ntn-db-board__head">
                        <span
                            className="ntn-tag"
                            style={{
                                background:
                                    backgroundColorValue(group.color ?? "gray") ?? "var(--panel-2)",
                                color: getColor(group.color ?? "gray").text,
                            }}
                        >
                            {group.label}
                        </span>
                        <span className="ntn-db-board__count">{group.rows.length}</span>
                    </div>

                    <div className="ntn-db-board__cards">
                        {group.rows.map((row) => (
                            <BoardCard
                                key={row.id}
                                row={row}
                                props={props}
                                onDragStart={() => setDragging(row.id)}
                            />
                        ))}
                    </div>

                    {editable && (
                        <button
                            type="button"
                            className="ntn-db-board__new"
                            onClick={() =>
                                onCreateRow(
                                    groupProperty && group.key !== "__none__"
                                        ? {
                                              [groupProperty.id]:
                                                  groupProperty.type === "multi_select"
                                                      ? [group.label]
                                                      : group.label,
                                          }
                                        : {}
                                )
                            }
                        >
                            <Plus size={13} /> New
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}

function BoardCard({
    row,
    props,
    onDragStart,
}: {
    row: WorkspacePageDto;
    props: ViewProps;
    onDragStart: () => void;
}) {
    const handlers = useCellHandlers(props);
    const others = props.visible.filter((property) => property.type !== "title");

    return (
        <div className="ntn-db-card" draggable onDragStart={onDragStart}>
            <div className="ntn-db-card__head">
                <button
                    type="button"
                    className="ntn-db-card__title"
                    onClick={() => props.onOpenRow(row.id)}
                >
                    {row.title || "Untitled"}
                </button>
                <GripVertical size={13} className="ntn-db-card__grip" />
            </div>
            {others.map((property) => (
                <div key={property.id} className="ntn-db-card__field">
                    <PropertyCell
                        row={row}
                        property={property}
                        compact
                        onChange={(value) => handlers.change(row, property, value)}
                        onAddOption={(option) => handlers.addOption(property, option)}
                    />
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export function ListView(props: ViewProps) {
    const { rows, visible, editable, onCreateRow, onOpenRow } = props;
    const handlers = useCellHandlers(props);
    const others = visible.filter((property) => property.type !== "title");

    return (
        <div className="ntn-db-list">
            {rows.map((row) => (
                <div key={row.id} className="ntn-db-list__row">
                    <button
                        type="button"
                        className="ntn-db-list__title"
                        onClick={() => onOpenRow(row.id)}
                    >
                        {row.title || "Untitled"}
                    </button>
                    <div className="ntn-db-list__meta">
                        {others.slice(0, 3).map((property) => (
                            <PropertyCell
                                key={property.id}
                                row={row}
                                property={property}
                                compact
                                onChange={(value) => handlers.change(row, property, value)}
                                onAddOption={(option) => handlers.addOption(property, option)}
                            />
                        ))}
                    </div>
                </div>
            ))}
            {rows.length === 0 && <div className="ntn-db-empty">No rows yet.</div>}
            {editable && (
                <button type="button" className="ntn-db-newrow" onClick={() => onCreateRow()}>
                    <Plus size={14} /> New
                </button>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

export function GalleryView(props: ViewProps) {
    const { rows, visible, view, editable, onCreateRow, onOpenRow } = props;
    const handlers = useCellHandlers(props);
    const others = visible.filter((property) => property.type !== "title");

    return (
        <div className={`ntn-db-gallery ntn-db-gallery--${view.cardSize ?? "medium"}`}>
            {rows.map((row) => {
                const cover =
                    row.cover?.type === "image"
                        ? row.cover.value
                        : row.cover?.type === "gradient"
                          ? null
                          : null;
                return (
                    <div key={row.id} className="ntn-db-gallery__card">
                        <button
                            type="button"
                            className="ntn-db-gallery__preview"
                            onClick={() => onOpenRow(row.id)}
                            style={
                                !cover && row.cover?.type === "gradient"
                                    ? { background: row.cover.value }
                                    : undefined
                            }
                        >
                            {cover ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={cover} alt="" />
                            ) : (
                                <span className="ntn-db-gallery__glyph">
                                    {row.icon?.type === "emoji" ? row.icon.value : "📄"}
                                </span>
                            )}
                        </button>
                        <div className="ntn-db-gallery__body">
                            <button
                                type="button"
                                className="ntn-db-gallery__title"
                                onClick={() => onOpenRow(row.id)}
                            >
                                {row.title || "Untitled"}
                            </button>
                            {others.slice(0, 3).map((property) => (
                                <PropertyCell
                                    key={property.id}
                                    row={row}
                                    property={property}
                                    compact
                                    onChange={(value) => handlers.change(row, property, value)}
                                    onAddOption={(option) => handlers.addOption(property, option)}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}
            {editable && (
                <button
                    type="button"
                    className="ntn-db-gallery__new"
                    onClick={() => onCreateRow()}
                >
                    <Plus size={16} /> New
                </button>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

function startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isoDay(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate()
    ).padStart(2, "0")}`;
}

export function CalendarView(props: ViewProps) {
    const { rows, properties, view, editable, onCreateRow, onOpenRow } = props;
    const [cursor, setCursor] = useState(() => startOfMonth(new Date()));

    const dateProperty =
        properties.find((p) => p.id === view.datePropertyId) ??
        properties.find((p) => p.type === "date");

    const byDay = useMemo(() => {
        const map = new Map<string, WorkspacePageDto[]>();
        if (!dateProperty) return map;
        for (const row of rows) {
            const value = readValue(row, dateProperty);
            const raw = dateString(value);
            if (!raw) continue;
            const day = raw.slice(0, 10);
            if (!day) continue;
            const bucket = map.get(day) ?? [];
            bucket.push(row);
            map.set(day, bucket);
        }
        return map;
    }, [rows, dateProperty]);

    // A month grid always starts on Sunday and runs six weeks, so the layout
    // does not jump height between months.
    const days = useMemo(() => {
        const first = startOfMonth(cursor);
        const start = new Date(first);
        start.setDate(start.getDate() - start.getDay());
        return Array.from({ length: 42 }, (_, index) => {
            const date = new Date(start);
            date.setDate(start.getDate() + index);
            return date;
        });
    }, [cursor]);

    const today = isoDay(new Date());

    return (
        <div className="ntn-db-calendar">
            <div className="ntn-db-calendar__bar">
                <button
                    type="button"
                    onClick={() =>
                        setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
                    }
                >
                    <ChevronLeft size={15} />
                </button>
                <span className="ntn-db-calendar__month">
                    {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                </span>
                <button
                    type="button"
                    onClick={() =>
                        setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
                    }
                >
                    <ChevronRight size={15} />
                </button>
                <button
                    type="button"
                    className="ntn-db-calendar__today"
                    onClick={() => setCursor(startOfMonth(new Date()))}
                >
                    Today
                </button>
            </div>

            <div className="ntn-db-calendar__weekdays">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
                    <span key={label}>{label}</span>
                ))}
            </div>

            <div className="ntn-db-calendar__grid">
                {days.map((date) => {
                    const key = isoDay(date);
                    const entries = byDay.get(key) ?? [];
                    return (
                        <div
                            key={key}
                            className={`ntn-db-calendar__day${
                                date.getMonth() === cursor.getMonth() ? "" : " is-outside"
                            }${key === today ? " is-today" : ""}`}
                        >
                            <div className="ntn-db-calendar__daynum">
                                <span>{date.getDate()}</span>
                                {editable && dateProperty && (
                                    <button
                                        type="button"
                                        className="ntn-db-calendar__add"
                                        onClick={() => onCreateRow({ [dateProperty.id]: key })}
                                    >
                                        <Plus size={12} />
                                    </button>
                                )}
                            </div>
                            {entries.map((row) => (
                                <button
                                    key={row.id}
                                    type="button"
                                    className="ntn-db-calendar__event"
                                    onClick={() => onOpenRow(row.id)}
                                >
                                    {row.title || "Untitled"}
                                </button>
                            ))}
                        </div>
                    );
                })}
            </div>

            {!dateProperty && (
                <div className="ntn-db-empty">Add a date property to use the calendar.</div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export function TimelineView(props: ViewProps) {
    const { rows, properties, view, onOpenRow } = props;

    const dateProperty =
        properties.find((p) => p.id === view.datePropertyId) ??
        properties.find((p) => p.type === "date");

    const bars = useMemo(() => {
        if (!dateProperty) return [];
        const entries = rows
            .map((row) => {
                const value = readValue(row, dateProperty);
                const startRaw = dateString(value);
                if (!startRaw) return null;
                const endRaw = dateString(value, "end") || startRaw;
                const start = new Date(startRaw).getTime();
                const end = new Date(endRaw).getTime();
                if (Number.isNaN(start)) return null;
                return { row, start, end: Number.isNaN(end) ? start : Math.max(end, start) };
            })
            .filter((entry): entry is { row: WorkspacePageDto; start: number; end: number } =>
                entry !== null
            );
        return entries.sort((a, b) => a.start - b.start);
    }, [rows, dateProperty]);

    // Pad the window so a single-day item is not a hairline at the edge.
    const window = useMemo(() => {
        if (bars.length === 0) return null;
        const min = Math.min(...bars.map((bar) => bar.start)) - 3 * DAY_MS;
        const max = Math.max(...bars.map((bar) => bar.end)) + 3 * DAY_MS;
        return { min, max, span: Math.max(max - min, DAY_MS) };
    }, [bars]);

    if (!dateProperty) {
        return <div className="ntn-db-empty">Add a date property to use the timeline.</div>;
    }
    if (!window) {
        return <div className="ntn-db-empty">No dated rows to show.</div>;
    }

    return (
        <div className="ntn-db-timeline">
            {bars.map(({ row, start, end }) => {
                const left = ((start - window.min) / window.span) * 100;
                const width = Math.max(((end - start + DAY_MS) / window.span) * 100, 2);
                return (
                    <div key={row.id} className="ntn-db-timeline__row">
                        <button
                            type="button"
                            className="ntn-db-timeline__label"
                            onClick={() => onOpenRow(row.id)}
                        >
                            {row.title || "Untitled"}
                        </button>
                        <div className="ntn-db-timeline__track">
                            <button
                                type="button"
                                className="ntn-db-timeline__bar"
                                style={{ left: `${left}%`, width: `${width}%` }}
                                onClick={() => onOpenRow(row.id)}
                                title={new Date(start).toLocaleDateString()}
                            >
                                {row.title || "Untitled"}
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export { MoreHorizontal };

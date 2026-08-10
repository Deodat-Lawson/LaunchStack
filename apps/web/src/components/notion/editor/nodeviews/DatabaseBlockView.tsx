"use client";

/**
 * The inline database: view tabs, the filter/sort/properties toolbar, and
 * whichever layout the active view selects.
 */

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
    ArrowUpDown,
    CalendarDays,
    Filter as FilterIcon,
    Kanban,
    LayoutList,
    Clock,
    Loader2,
    Plus,
    Rows3,
    Settings2,
    Table2,
    Trash2,
    X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useNotionEditor } from "../../context";
import {
    BoardView,
    CalendarView,
    GalleryView,
    ListView,
    TableView,
    TimelineView,
    type ViewProps,
} from "../../database/views";
import {
    OPERATOR_LABELS,
    operatorsFor,
    visibleProperties,
    visibleRows,
} from "../../database/query";
import { useDatabase } from "../../database/useDatabase";
import { MenuDivider, MenuHeading, MenuItem, Popover } from "../../ui/Popover";
import type {
    DatabaseProperty,
    DatabasePropertyType,
    DatabaseView,
    DatabaseViewType,
    SelectOption,
} from "~/types/workspace";

const VIEW_ICONS: Record<DatabaseViewType, typeof Table2> = {
    table: Table2,
    board: Kanban,
    list: LayoutList,
    gallery: Rows3,
    calendar: CalendarDays,
    timeline: Clock,
};

const PROPERTY_TYPES: Array<[DatabasePropertyType, string]> = [
    ["text", "Text"],
    ["number", "Number"],
    ["select", "Select"],
    ["multi_select", "Multi-select"],
    ["status", "Status"],
    ["date", "Date"],
    ["person", "Person"],
    ["files", "Files & media"],
    ["checkbox", "Checkbox"],
    ["url", "URL"],
    ["email", "Email"],
    ["phone", "Phone"],
    ["formula", "Formula"],
    ["relation", "Relation"],
    ["rollup", "Rollup"],
    ["created_time", "Created time"],
    ["created_by", "Created by"],
    ["last_edited_time", "Last edited time"],
    ["last_edited_by", "Last edited by"],
];

/** Unique-enough ids without pulling a uuid dependency into the client. */
function newId(): string {
    return `p${Math.random().toString(36).slice(2, 10)}`;
}

export function DatabaseBlockView({ node, updateAttributes, editor, deleteNode }: NodeViewProps) {
    const workspace = useNotionEditor();
    const databaseId = node.attrs.databaseId as string | null;
    const state = useDatabase(databaseId, workspace.pageId);
    const [menu, setMenu] = useState<"filter" | "sort" | "properties" | "new-view" | null>(null);
    const [editingProperty, setEditingProperty] = useState<string | null>(null);
    const filterRef = useRef<HTMLButtonElement>(null);
    const sortRef = useRef<HTMLButtonElement>(null);
    const propsRef = useRef<HTMLButtonElement>(null);
    const newViewRef = useRef<HTMLButtonElement>(null);
    const propertyAnchor = useRef<HTMLDivElement>(null);

    const database = state.database;
    const views = database?.views ?? [];
    const activeViewId = (node.attrs.viewId as string | null) ?? views[0]?.id ?? null;
    const view = views.find((candidate) => candidate.id === activeViewId) ?? views[0] ?? null;
    // Memoised because the `?? []` fallback would otherwise be a fresh array
    // each render and re-run every derived memo below it.
    const properties = useMemo(() => database?.properties ?? [], [database]);
    const editable = editor.isEditable;

    const rows = useMemo(
        () => (view ? visibleRows(state.rows, view, properties) : state.rows),
        [state.rows, view, properties]
    );
    const visible = useMemo(
        () => (view ? visibleProperties(view, properties) : properties),
        [view, properties]
    );

    const patchView = (patch: Partial<DatabaseView>) => {
        if (!view) return;
        void state.setViews(
            views.map((candidate) =>
                candidate.id === view.id ? { ...candidate, ...patch } : candidate
            )
        );
    };

    const addView = (type: DatabaseViewType) => {
        const created: DatabaseView = {
            id: newId(),
            name: type[0]!.toUpperCase() + type.slice(1),
            type,
            filters: [],
            filterConjunction: "and",
            sorts: [],
            groupByPropertyId: properties.find(
                (p) => p.type === "select" || p.type === "status" || p.type === "multi_select"
            )?.id,
            datePropertyId: properties.find((p) => p.type === "date")?.id,
            visiblePropertyIds: properties.map((p) => p.id),
            cardPreview: "cover",
            cardSize: "medium",
        };
        void state.setViews([...views, created]);
        updateAttributes({ viewId: created.id });
        setMenu(null);
    };

    const addProperty = () => {
        const property: DatabaseProperty = {
            id: newId(),
            name: "New property",
            type: "text",
            width: 160,
        };
        const next = [...properties, property];
        void state.setProperties(next);
        void state.setViews(
            views.map((candidate) => ({
                ...candidate,
                visiblePropertyIds: candidate.visiblePropertyIds
                    ? [...candidate.visiblePropertyIds, property.id]
                    : undefined,
            }))
        );
        setEditingProperty(property.id);
    };

    const patchProperty = (propertyId: string, patch: Partial<DatabaseProperty>) => {
        void state.setProperties(
            properties.map((property) =>
                property.id === propertyId ? { ...property, ...patch } : property
            )
        );
    };

    const removeProperty = (propertyId: string) => {
        void state.setProperties(properties.filter((property) => property.id !== propertyId));
        void state.setViews(
            views.map((candidate) => ({
                ...candidate,
                visiblePropertyIds: candidate.visiblePropertyIds?.filter(
                    (id) => id !== propertyId
                ),
                filters: candidate.filters.filter((f) => f.propertyId !== propertyId),
                sorts: candidate.sorts.filter((s) => s.propertyId !== propertyId),
            }))
        );
        setEditingProperty(null);
    };

    const addOption = (propertyId: string, option: SelectOption) => {
        const property = properties.find((candidate) => candidate.id === propertyId);
        if (!property) return;
        patchProperty(propertyId, { options: [...(property.options ?? []), option] });
    };

    if (!databaseId) {
        return (
            <NodeViewWrapper className="ntn-db">
                <div className="ntn-db-empty">This database block is not linked to a database.</div>
            </NodeViewWrapper>
        );
    }

    if (state.loading && !database) {
        return (
            <NodeViewWrapper className="ntn-db">
                <div className="ntn-db-empty">
                    <Loader2 size={14} className="ntn-spin" /> Loading database…
                </div>
            </NodeViewWrapper>
        );
    }

    if (state.error || !database || !view) {
        return (
            <NodeViewWrapper className="ntn-db">
                <div className="ntn-db-empty">
                    {state.error ?? "This database is no longer available."}
                    {editable && (
                        <button type="button" className="ntn-btn" onClick={deleteNode}>
                            Remove block
                        </button>
                    )}
                </div>
            </NodeViewWrapper>
        );
    }

    const viewProps: ViewProps = {
        rows,
        properties,
        visible,
        view,
        editable,
        onUpdateRow: (rowId, patch) => void state.updateRow(rowId, patch),
        onCreateRow: (values) => void state.createRow(values),
        onDeleteRow: (rowId) => void state.deleteRow(rowId),
        onOpenRow: (rowId) => workspace.navigateToPage(rowId),
        onAddOption: addOption,
        onAddProperty: addProperty,
        onEditProperty: setEditingProperty,
    };

    const Layout =
        view.type === "board"
            ? BoardView
            : view.type === "list"
              ? ListView
              : view.type === "gallery"
                ? GalleryView
                : view.type === "calendar"
                  ? CalendarView
                  : view.type === "timeline"
                    ? TimelineView
                    : TableView;

    const editedProperty = properties.find((p) => p.id === editingProperty) ?? null;

    return (
        <NodeViewWrapper className="ntn-db" contentEditable={false}>
            <div className="ntn-db__bar">
                <input
                    className="ntn-db__title"
                    value={database.title}
                    disabled={!editable}
                    placeholder="Untitled database"
                    onChange={(event) => void state.patchDatabase({ title: event.target.value })}
                />

                <div className="ntn-db__views">
                    {views.map((candidate) => {
                        const Icon = VIEW_ICONS[candidate.type];
                        return (
                            <button
                                key={candidate.id}
                                type="button"
                                className={`ntn-db__view${
                                    candidate.id === view.id ? " is-active" : ""
                                }`}
                                onClick={() => updateAttributes({ viewId: candidate.id })}
                            >
                                <Icon size={13} />
                                <span>{candidate.name}</span>
                            </button>
                        );
                    })}
                    {editable && (
                        <button
                            ref={newViewRef}
                            type="button"
                            className="ntn-db__view ntn-db__view--add"
                            title="Add a view"
                            onClick={() => setMenu(menu === "new-view" ? null : "new-view")}
                        >
                            <Plus size={13} />
                        </button>
                    )}
                </div>

                <div className="ntn-db__actions">
                    <button
                        ref={filterRef}
                        type="button"
                        className={`ntn-db__action${view.filters.length ? " is-active" : ""}`}
                        onClick={() => setMenu(menu === "filter" ? null : "filter")}
                    >
                        <FilterIcon size={13} />
                        {view.filters.length > 0 && <span>{view.filters.length}</span>}
                    </button>
                    <button
                        ref={sortRef}
                        type="button"
                        className={`ntn-db__action${view.sorts.length ? " is-active" : ""}`}
                        onClick={() => setMenu(menu === "sort" ? null : "sort")}
                    >
                        <ArrowUpDown size={13} />
                        {view.sorts.length > 0 && <span>{view.sorts.length}</span>}
                    </button>
                    <button
                        ref={propsRef}
                        type="button"
                        className="ntn-db__action"
                        onClick={() => setMenu(menu === "properties" ? null : "properties")}
                    >
                        <Settings2 size={13} />
                    </button>
                    {editable && (
                        <button
                            type="button"
                            className="ntn-db__action"
                            title="Remove this block"
                            onClick={deleteNode}
                        >
                            <Trash2 size={13} />
                        </button>
                    )}
                </div>
            </div>

            <div className="ntn-db__body">
                <Layout {...viewProps} />
            </div>

            <div ref={propertyAnchor} />

            {/* -- Add view ---------------------------------------------- */}
            <Popover
                anchor={newViewRef.current}
                open={menu === "new-view"}
                onClose={() => setMenu(null)}
                ignore={[newViewRef.current]}
            >
                <div className="ntn-menu">
                    <MenuHeading>Add a view</MenuHeading>
                    {(Object.keys(VIEW_ICONS) as DatabaseViewType[]).map((type) => {
                        const Icon = VIEW_ICONS[type];
                        return (
                            <MenuItem
                                key={type}
                                icon={<Icon size={15} />}
                                label={type[0]!.toUpperCase() + type.slice(1)}
                                onClick={() => addView(type)}
                            />
                        );
                    })}
                </div>
            </Popover>

            {/* -- Filters ------------------------------------------------ */}
            <Popover
                anchor={filterRef.current}
                open={menu === "filter"}
                onClose={() => setMenu(null)}
                ignore={[filterRef.current]}
            >
                <div className="ntn-menu ntn-menu--wide">
                    <MenuHeading>Filters</MenuHeading>
                    {view.filters.map((filter) => {
                        const property = properties.find((p) => p.id === filter.propertyId);
                        return (
                            <div key={filter.id} className="ntn-db-filter">
                                <select
                                    className="ntn-select"
                                    value={filter.propertyId}
                                    onChange={(event) =>
                                        patchView({
                                            filters: view.filters.map((f) =>
                                                f.id === filter.id
                                                    ? { ...f, propertyId: event.target.value }
                                                    : f
                                            ),
                                        })
                                    }
                                >
                                    {properties.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.name}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    className="ntn-select"
                                    value={filter.operator}
                                    onChange={(event) =>
                                        patchView({
                                            filters: view.filters.map((f) =>
                                                f.id === filter.id
                                                    ? {
                                                          ...f,
                                                          operator: event.target
                                                              .value as typeof filter.operator,
                                                      }
                                                    : f
                                            ),
                                        })
                                    }
                                >
                                    {operatorsFor(property?.type ?? "text").map((operator) => (
                                        <option key={operator} value={operator}>
                                            {OPERATOR_LABELS[operator]}
                                        </option>
                                    ))}
                                </select>
                                {!filter.operator.startsWith("is_empty") &&
                                    !filter.operator.startsWith("is_not_empty") && (
                                        <input
                                            className="ntn-input"
                                            value={String(filter.value ?? "")}
                                            onChange={(event) =>
                                                patchView({
                                                    filters: view.filters.map((f) =>
                                                        f.id === filter.id
                                                            ? { ...f, value: event.target.value }
                                                            : f
                                                    ),
                                                })
                                            }
                                        />
                                    )}
                                <button
                                    type="button"
                                    className="ntn-db-filter__x"
                                    onClick={() =>
                                        patchView({
                                            filters: view.filters.filter((f) => f.id !== filter.id),
                                        })
                                    }
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        );
                    })}
                    <MenuItem
                        icon={<Plus size={14} />}
                        label="Add a filter"
                        onClick={() =>
                            patchView({
                                filters: [
                                    ...view.filters,
                                    {
                                        id: newId(),
                                        propertyId: properties[0]?.id ?? "title",
                                        operator: "contains",
                                        value: "",
                                    },
                                ],
                            })
                        }
                    />
                    {view.filters.length > 1 && (
                        <>
                            <MenuDivider />
                            <MenuItem
                                label={`Match ${
                                    view.filterConjunction === "or" ? "any" : "all"
                                } filters`}
                                onClick={() =>
                                    patchView({
                                        filterConjunction:
                                            view.filterConjunction === "or" ? "and" : "or",
                                    })
                                }
                            />
                        </>
                    )}
                </div>
            </Popover>

            {/* -- Sorts -------------------------------------------------- */}
            <Popover
                anchor={sortRef.current}
                open={menu === "sort"}
                onClose={() => setMenu(null)}
                ignore={[sortRef.current]}
            >
                <div className="ntn-menu ntn-menu--wide">
                    <MenuHeading>Sort</MenuHeading>
                    {view.sorts.map((sort) => (
                        <div key={sort.id} className="ntn-db-filter">
                            <select
                                className="ntn-select"
                                value={sort.propertyId}
                                onChange={(event) =>
                                    patchView({
                                        sorts: view.sorts.map((s) =>
                                            s.id === sort.id
                                                ? { ...s, propertyId: event.target.value }
                                                : s
                                        ),
                                    })
                                }
                            >
                                {properties.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name}
                                    </option>
                                ))}
                            </select>
                            <select
                                className="ntn-select"
                                value={sort.direction}
                                onChange={(event) =>
                                    patchView({
                                        sorts: view.sorts.map((s) =>
                                            s.id === sort.id
                                                ? {
                                                      ...s,
                                                      direction: event.target.value as "asc" | "desc",
                                                  }
                                                : s
                                        ),
                                    })
                                }
                            >
                                <option value="asc">Ascending</option>
                                <option value="desc">Descending</option>
                            </select>
                            <button
                                type="button"
                                className="ntn-db-filter__x"
                                onClick={() =>
                                    patchView({ sorts: view.sorts.filter((s) => s.id !== sort.id) })
                                }
                            >
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                    <MenuItem
                        icon={<Plus size={14} />}
                        label="Add a sort"
                        onClick={() =>
                            patchView({
                                sorts: [
                                    ...view.sorts,
                                    {
                                        id: newId(),
                                        propertyId: properties[0]?.id ?? "title",
                                        direction: "asc",
                                    },
                                ],
                            })
                        }
                    />
                </div>
            </Popover>

            {/* -- Properties / view options ------------------------------ */}
            <Popover
                anchor={propsRef.current}
                open={menu === "properties"}
                onClose={() => setMenu(null)}
                ignore={[propsRef.current]}
            >
                <div className="ntn-menu ntn-menu--wide">
                    <MenuHeading>Properties</MenuHeading>
                    {properties.map((property) => {
                        const shown =
                            !view.visiblePropertyIds ||
                            view.visiblePropertyIds.includes(property.id);
                        return (
                            <div key={property.id} className="ntn-db-property">
                                <button
                                    type="button"
                                    className="ntn-db-property__name"
                                    onClick={() => setEditingProperty(property.id)}
                                >
                                    {property.name}
                                </button>
                                <button
                                    type="button"
                                    className={`ntn-toggle-switch${shown ? " is-on" : ""}`}
                                    disabled={property.type === "title"}
                                    onClick={() =>
                                        patchView({
                                            visiblePropertyIds: shown
                                                ? (view.visiblePropertyIds ??
                                                      properties.map((p) => p.id)
                                                  ).filter((id) => id !== property.id)
                                                : [
                                                      ...(view.visiblePropertyIds ?? []),
                                                      property.id,
                                                  ],
                                        })
                                    }
                                >
                                    <span />
                                </button>
                            </div>
                        );
                    })}
                    <MenuItem icon={<Plus size={14} />} label="New property" onClick={addProperty} />

                    {(view.type === "board" || view.type === "gallery") && (
                        <>
                            <MenuDivider />
                            <MenuHeading>Group by</MenuHeading>
                            <select
                                className="ntn-select ntn-select--block"
                                value={view.groupByPropertyId ?? ""}
                                onChange={(event) =>
                                    patchView({ groupByPropertyId: event.target.value || undefined })
                                }
                            >
                                <option value="">None</option>
                                {properties
                                    .filter(
                                        (p) =>
                                            p.type === "select" ||
                                            p.type === "status" ||
                                            p.type === "multi_select"
                                    )
                                    .map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.name}
                                        </option>
                                    ))}
                            </select>
                        </>
                    )}

                    {(view.type === "calendar" || view.type === "timeline") && (
                        <>
                            <MenuDivider />
                            <MenuHeading>Date property</MenuHeading>
                            <select
                                className="ntn-select ntn-select--block"
                                value={view.datePropertyId ?? ""}
                                onChange={(event) =>
                                    patchView({ datePropertyId: event.target.value || undefined })
                                }
                            >
                                <option value="">None</option>
                                {properties
                                    .filter((p) => p.type === "date")
                                    .map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.name}
                                        </option>
                                    ))}
                            </select>
                        </>
                    )}
                </div>
            </Popover>

            {/* -- Property editor ---------------------------------------- */}
            <Popover
                anchor={propsRef.current}
                open={editedProperty !== null}
                onClose={() => setEditingProperty(null)}
            >
                {editedProperty && (
                    <div className="ntn-menu ntn-menu--wide">
                        <input
                            className="ntn-input"
                            value={editedProperty.name}
                            onChange={(event) =>
                                patchProperty(editedProperty.id, { name: event.target.value })
                            }
                        />
                        <MenuHeading>Type</MenuHeading>
                        <select
                            className="ntn-select ntn-select--block"
                            value={editedProperty.type}
                            disabled={editedProperty.type === "title"}
                            onChange={(event) =>
                                patchProperty(editedProperty.id, {
                                    type: event.target.value as DatabasePropertyType,
                                })
                            }
                        >
                            {PROPERTY_TYPES.map(([value, label]) => (
                                <option key={value} value={value}>
                                    {label}
                                </option>
                            ))}
                        </select>
                        {editedProperty.type === "number" && (
                            <>
                                <MenuHeading>Format</MenuHeading>
                                <select
                                    className="ntn-select ntn-select--block"
                                    value={editedProperty.format ?? "number"}
                                    onChange={(event) =>
                                        patchProperty(editedProperty.id, {
                                            format: event.target.value,
                                        })
                                    }
                                >
                                    <option value="number">Number</option>
                                    <option value="percent">Percent</option>
                                    <option value="dollar">Dollar</option>
                                    <option value="euro">Euro</option>
                                </select>
                            </>
                        )}
                        {editedProperty.type !== "title" && (
                            <>
                                <MenuDivider />
                                <MenuItem
                                    icon={<Trash2 size={14} />}
                                    label="Delete property"
                                    danger
                                    onClick={() => removeProperty(editedProperty.id)}
                                />
                            </>
                        )}
                    </div>
                )}
            </Popover>
        </NodeViewWrapper>
    );
}

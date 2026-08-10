/**
 * Filtering, sorting, and grouping for database views.
 *
 * Rows are pages, so a "cell" is either a property value or a derived field
 * (title, created time). `readValue` is the one place that knows the
 * difference, which keeps every operator below working on plain values.
 */

import type {
    DatabaseFilter,
    DatabaseProperty,
    DatabaseSort,
    DatabaseView,
    SelectOption,
    WorkspacePageDto,
} from "~/types/workspace";

/** The value a property holds for a row, normalised for comparison. */
export function readValue(
    row: WorkspacePageDto,
    property: DatabaseProperty
): unknown {
    switch (property.type) {
        case "title":
            return row.title;
        case "created_time":
            return row.createdAt;
        case "last_edited_time":
            return row.updatedAt;
        case "created_by":
        case "last_edited_by":
            return row.lastEditedBy;
        default:
            return row.properties?.[property.id] ?? null;
    }
}

/** True when a property is computed and therefore not directly editable. */
export function isReadOnly(property: DatabaseProperty): boolean {
    return (
        property.type === "created_time" ||
        property.type === "last_edited_time" ||
        property.type === "created_by" ||
        property.type === "last_edited_by" ||
        property.type === "formula" ||
        property.type === "rollup"
    );
}

export function toText(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.map(toText).join(", ");
    if (typeof value === "object") {
        // Date and select values are objects; show their human-facing field
        // rather than JSON where one exists.
        const record = value as Record<string, unknown>;
        if (typeof record.name === "string") return record.name;
        if (typeof record.start === "string") return record.start;
        return JSON.stringify(value);
    }
    return "";
}

/**
 * The ISO string a date-ish property carries. A date property is either a
 * plain `"2026-08-09"` or a `{ start, end }` range.
 */
export function dateString(value: unknown, field: "start" | "end" = "start"): string {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
        const candidate = (value as Record<string, unknown>)[field];
        if (typeof candidate === "string") return candidate;
    }
    return "";
}

function toNumber(value: unknown): number | null {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
}

function toTime(value: unknown): number | null {
    const raw = dateString(value);
    if (!raw) return null;
    const time = new Date(raw).getTime();
    return Number.isNaN(time) ? null : time;
}

function isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "string") return value.trim() === "";
    if (typeof value === "boolean") return value === false;
    return false;
}

export function matchesFilter(
    row: WorkspacePageDto,
    filter: DatabaseFilter,
    property: DatabaseProperty
): boolean {
    const value = readValue(row, property);
    const target = filter.value;

    switch (filter.operator) {
        case "is_empty":
            return isEmpty(value);
        case "is_not_empty":
            return !isEmpty(value);
        case "is":
            if (typeof value === "boolean") return value === Boolean(target);
            if (Array.isArray(value)) return value.some((v) => toText(v) === toText(target));
            return toText(value).toLowerCase() === toText(target).toLowerCase();
        case "is_not":
            if (Array.isArray(value)) return !value.some((v) => toText(v) === toText(target));
            return toText(value).toLowerCase() !== toText(target).toLowerCase();
        case "contains":
            return toText(value).toLowerCase().includes(toText(target).toLowerCase());
        case "does_not_contain":
            return !toText(value).toLowerCase().includes(toText(target).toLowerCase());
        case "starts_with":
            return toText(value).toLowerCase().startsWith(toText(target).toLowerCase());
        case "ends_with":
            return toText(value).toLowerCase().endsWith(toText(target).toLowerCase());
        case "greater_than":
        case "less_than":
        case "greater_than_or_equal":
        case "less_than_or_equal": {
            const left = toNumber(value);
            const right = toNumber(target);
            if (left === null || right === null) return false;
            if (filter.operator === "greater_than") return left > right;
            if (filter.operator === "less_than") return left < right;
            if (filter.operator === "greater_than_or_equal") return left >= right;
            return left <= right;
        }
        case "is_before":
        case "is_after":
        case "is_on_or_before":
        case "is_on_or_after": {
            const left = toTime(value);
            const right = toTime(target);
            if (left === null || right === null) return false;
            if (filter.operator === "is_before") return left < right;
            if (filter.operator === "is_after") return left > right;
            if (filter.operator === "is_on_or_before") return left <= right;
            return left >= right;
        }
        default:
            return true;
    }
}

export function applyFilters(
    rows: WorkspacePageDto[],
    view: DatabaseView,
    properties: DatabaseProperty[]
): WorkspacePageDto[] {
    if (view.filters.length === 0) return rows;
    const byId = new Map(properties.map((p) => [p.id, p]));
    const conjunction = view.filterConjunction ?? "and";

    return rows.filter((row) => {
        const results = view.filters.map((filter) => {
            const property = byId.get(filter.propertyId);
            if (!property) return true;
            return matchesFilter(row, filter, property);
        });
        return conjunction === "and" ? results.every(Boolean) : results.some(Boolean);
    });
}

export function applySorts(
    rows: WorkspacePageDto[],
    sorts: DatabaseSort[],
    properties: DatabaseProperty[]
): WorkspacePageDto[] {
    if (sorts.length === 0) return rows;
    const byId = new Map(properties.map((p) => [p.id, p]));

    // Copy first: view sorting must not reorder the array the caller holds.
    return [...rows].sort((a, b) => {
        for (const sort of sorts) {
            const property = byId.get(sort.propertyId);
            if (!property) continue;

            const left = readValue(a, property);
            const right = readValue(b, property);

            let comparison: number;
            const leftNumber = toNumber(left);
            const rightNumber = toNumber(right);
            if (leftNumber !== null && rightNumber !== null) {
                comparison = leftNumber - rightNumber;
            } else {
                const leftTime = toTime(left);
                const rightTime = toTime(right);
                comparison =
                    leftTime !== null && rightTime !== null
                        ? leftTime - rightTime
                        : toText(left).localeCompare(toText(right));
            }

            if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
        }
        return 0;
    });
}

export interface RowGroup {
    key: string;
    label: string;
    color: string | null;
    option: SelectOption | null;
    rows: WorkspacePageDto[];
}

/**
 * Group rows for a board or a grouped table. Every option gets a group even
 * when empty — an empty kanban column is a drop target, not a gap.
 */
export function groupRows(
    rows: WorkspacePageDto[],
    property: DatabaseProperty | undefined
): RowGroup[] {
    if (!property) {
        return [{ key: "all", label: "All", color: null, option: null, rows }];
    }

    const groups = new Map<string, RowGroup>();
    for (const option of property.options ?? []) {
        groups.set(option.name, {
            key: option.id,
            label: option.name,
            color: option.color,
            option,
            rows: [],
        });
    }
    groups.set("__none__", {
        key: "__none__",
        label: "No " + property.name,
        color: null,
        option: null,
        rows: [],
    });

    for (const row of rows) {
        const value = readValue(row, property);
        const names = Array.isArray(value)
            ? value.map(toText)
            : isEmpty(value)
              ? []
              : [toText(value)];

        if (names.length === 0) {
            groups.get("__none__")!.rows.push(row);
            continue;
        }
        for (const name of names) {
            const group = groups.get(name);
            if (group) group.rows.push(row);
            else {
                groups.set(name, {
                    key: name,
                    label: name,
                    color: null,
                    option: null,
                    rows: [row],
                });
            }
        }
    }

    // "No value" last, matching Notion's board layout.
    const ordered = [...groups.values()];
    const noneIndex = ordered.findIndex((g) => g.key === "__none__");
    if (noneIndex >= 0) ordered.push(...ordered.splice(noneIndex, 1));
    return ordered;
}

/** Rows visible in a view, with its filters and sorts applied. */
export function visibleRows(
    rows: WorkspacePageDto[],
    view: DatabaseView,
    properties: DatabaseProperty[]
): WorkspacePageDto[] {
    return applySorts(applyFilters(rows, view, properties), view.sorts, properties);
}

/** Properties a view shows, in the view's own order. */
export function visibleProperties(
    view: DatabaseView,
    properties: DatabaseProperty[]
): DatabaseProperty[] {
    if (!view.visiblePropertyIds) return properties.filter((p) => !p.hidden);
    const byId = new Map(properties.map((p) => [p.id, p]));
    return view.visiblePropertyIds
        .map((id) => byId.get(id))
        .filter((p): p is DatabaseProperty => p !== undefined && !p.hidden);
}

/** Operators that make sense for a property type, in menu order. */
export function operatorsFor(type: DatabaseProperty["type"]): DatabaseFilter["operator"][] {
    switch (type) {
        case "checkbox":
            return ["is", "is_not"];
        case "number":
            return [
                "is",
                "is_not",
                "greater_than",
                "less_than",
                "greater_than_or_equal",
                "less_than_or_equal",
                "is_empty",
                "is_not_empty",
            ];
        case "date":
        case "created_time":
        case "last_edited_time":
            return [
                "is",
                "is_before",
                "is_after",
                "is_on_or_before",
                "is_on_or_after",
                "is_empty",
                "is_not_empty",
            ];
        case "select":
        case "status":
        case "multi_select":
            return ["is", "is_not", "is_empty", "is_not_empty"];
        default:
            return [
                "is",
                "is_not",
                "contains",
                "does_not_contain",
                "starts_with",
                "ends_with",
                "is_empty",
                "is_not_empty",
            ];
    }
}

export const OPERATOR_LABELS: Record<DatabaseFilter["operator"], string> = {
    is: "Is",
    is_not: "Is not",
    contains: "Contains",
    does_not_contain: "Does not contain",
    starts_with: "Starts with",
    ends_with: "Ends with",
    is_empty: "Is empty",
    is_not_empty: "Is not empty",
    greater_than: "Greater than",
    less_than: "Less than",
    greater_than_or_equal: "Greater than or equal to",
    less_than_or_equal: "Less than or equal to",
    is_before: "Is before",
    is_after: "Is after",
    is_on_or_before: "Is on or before",
    is_on_or_after: "Is on or after",
};

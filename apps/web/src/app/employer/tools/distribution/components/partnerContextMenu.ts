import type { ActionMenuItem } from "~/components/ui/action-menu";
import {
    KIND_LABELS,
    STAGE_LABELS,
    type PartnerItemDto,
    type RelationshipStage,
    type RunDto,
} from "../api";
import type { PartnerFilters } from "../useDistribution";

/**
 * Declarative items for the Prospects surfaces: a partner (table row or board
 * card), a discovery run, and the table's column headers.
 */

export interface PartnerMenuHandlers {
    onOpen: () => void;
    onMoveToStage: (stage: RelationshipStage) => void;
    onDraftOutreach?: () => void;
    /** Narrow the table to this row's stage / kind — absent on the board. */
    onFilterStage?: () => void;
    onFilterKind?: () => void;
    onCopyName: () => void;
    onCopyDomain?: () => void;
}

export function buildPartnerMenuItems(
    item: PartnerItemDto,
    handlers: PartnerMenuHandlers
): ActionMenuItem[] {
    const { relationship, org } = item;
    const items: ActionMenuItem[] = [
        { type: "label", id: "title", label: org.name },
        { type: "item", id: "open", label: "Open", icon: "open", onSelect: handlers.onOpen },
        {
            type: "submenu",
            id: "stage",
            label: "Move to stage",
            icon: "move",
            items: (Object.keys(STAGE_LABELS) as RelationshipStage[]).map(stage => ({
                type: "item" as const,
                id: `stage-${stage}`,
                label: STAGE_LABELS[stage],
                icon: stage === relationship.stage ? "check" : undefined,
                checked: stage === relationship.stage,
                disabled: stage === relationship.stage,
                onSelect: () => handlers.onMoveToStage(stage),
            })),
        },
    ];
    if (handlers.onDraftOutreach) {
        items.push({
            type: "item",
            id: "outreach",
            label: "Draft an outreach email",
            icon: "mail",
            onSelect: () => handlers.onDraftOutreach?.(),
        });
    }
    if (handlers.onFilterStage || handlers.onFilterKind) {
        items.push({ type: "separator", id: "sep-filter" });
    }
    if (handlers.onFilterStage) {
        items.push({
            type: "item",
            id: "filter-stage",
            label: `Show only ${STAGE_LABELS[relationship.stage]}`,
            icon: "filter",
            onSelect: () => handlers.onFilterStage?.(),
        });
    }
    if (handlers.onFilterKind) {
        items.push({
            type: "item",
            id: "filter-kind",
            label: `Show only ${KIND_LABELS[relationship.kind]}`,
            icon: "filter",
            onSelect: () => handlers.onFilterKind?.(),
        });
    }
    items.push({ type: "separator", id: "sep-copy" });
    items.push({
        type: "item",
        id: "copy-name",
        label: "Copy the organisation name",
        icon: "copy",
        onSelect: handlers.onCopyName,
    });
    if (org.domain && handlers.onCopyDomain) {
        items.push({
            type: "item",
            id: "copy-domain",
            label: "Copy the domain",
            icon: "globe",
            onSelect: () => handlers.onCopyDomain?.(),
        });
    }
    return items;
}

export interface RunMenuHandlers {
    onToggleDetails: () => void;
    onStartAnother: () => void;
    onCopyId: () => void;
}

export function buildRunMenuItems(
    run: RunDto,
    state: { expanded: boolean; running: boolean },
    handlers: RunMenuHandlers
): ActionMenuItem[] {
    return [
        { type: "label", id: "title", label: `Run ${run.id.slice(0, 8)} · ${run.status}` },
        {
            type: "item",
            id: "details",
            label: state.expanded ? "Hide details" : "Show details",
            icon: state.expanded ? "hide" : "open",
            onSelect: handlers.onToggleDetails,
        },
        {
            type: "item",
            id: "start",
            label: "Start another run",
            icon: "play",
            disabled: state.running,
            disabledReason: state.running ? "A run is already in progress." : undefined,
            onSelect: handlers.onStartAnother,
        },
        { type: "separator", id: "sep-copy" },
        {
            type: "item",
            id: "copy-id",
            label: "Copy the run id",
            icon: "copy",
            onSelect: handlers.onCopyId,
        },
    ];
}

const ORDERS: { id: PartnerFilters["order"]; label: string }[] = [
    { id: "fit", label: "Best fit first" },
    { id: "activity", label: "Most recent activity first" },
    { id: "stage", label: "By stage" },
    { id: "created", label: "Newest first" },
];

/** The column-header menu: how the table is ordered, current choice checked. */
export function buildOrderMenuItems(
    current: PartnerFilters["order"],
    onOrder: (order: PartnerFilters["order"]) => void
): ActionMenuItem[] {
    return [
        { type: "label", id: "title", label: "Order the table" },
        ...ORDERS.map(order => ({
            type: "item" as const,
            id: `order-${order.id}`,
            label: order.label,
            icon: order.id === current ? ("check" as const) : undefined,
            checked: order.id === current,
            onSelect: () => onOrder(order.id),
        })),
    ];
}

"use client";

import { Input } from "~/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { toast } from "sonner";
import type { ReactNode } from "react";
import { useContextTarget } from "~/components/context-menu";
import { copyText } from "~/lib/context-menu";

import {
    KIND_LABELS,
    STAGE_LABELS,
    daysAgo,
    type PartnerItemDto,
    type PartnerKind,
    type RelationshipStage,
} from "../api";
import type { DistributionState } from "../useDistribution";
import { FitBadge, StageBadge } from "./badges";
import { buildOrderMenuItems, buildPartnerMenuItems } from "./partnerContextMenu";

/** A column header: right-click to change how the table is ordered. */
function OrderHead({
    state,
    className,
    children,
}: {
    state: DistributionState;
    className?: string;
    children?: ReactNode;
}) {
    const ctxTarget = useContextTarget({
        kind: "partner-column",
        label: "Column actions",
        items: () =>
            buildOrderMenuItems(state.filters.order, order =>
                state.setFilters({ ...state.filters, order })
            ),
    });
    return (
        <TableHead {...ctxTarget} className={className}>
            {children}
        </TableHead>
    );
}

/** A partner row: the drawer's verbs, reachable without opening it. */
function PartnerRow({
    item,
    state,
    children,
}: {
    item: PartnerItemDto;
    state: DistributionState;
    children: ReactNode;
}) {
    const ctxTarget = useContextTarget({
        kind: "partner",
        id: item.relationship.id,
        label: `Actions for ${item.org.name}`,
        data: item,
        items: () => buildPartnerMenuItems(item, partnerHandlers(item, state, true)),
    });
    return (
        <TableRow
            {...ctxTarget}
            className="cursor-pointer"
            onClick={() => void state.openPartner(item.relationship.id)}
        >
            {children}
        </TableRow>
    );
}

/** The handlers a partner's menu needs, shared by the table row and the board card. */
export function partnerHandlers(
    item: PartnerItemDto,
    state: DistributionState,
    withFilters: boolean
) {
    const id = item.relationship.id;
    return {
        onOpen: () => void state.openPartner(id),
        onMoveToStage: (stage: RelationshipStage) =>
            void state.patchRelationship(id, { stage }, `Moved to ${STAGE_LABELS[stage]}`),
        onDraftOutreach: () => void state.outreach([id]),
        onFilterStage: withFilters
            ? () => state.setFilters({ ...state.filters, stage: item.relationship.stage })
            : undefined,
        onFilterKind: withFilters
            ? () => state.setFilters({ ...state.filters, kind: item.relationship.kind })
            : undefined,
        onCopyName: () => {
            void copyText(item.org.name).then(ok => {
                if (ok) toast.success("Copied");
            });
        },
        onCopyDomain: item.org.domain
            ? () => {
                  void copyText(item.org.domain ?? "").then(ok => {
                      if (ok) toast.success("Copied");
                  });
              }
            : undefined,
    };
}

const ALL = "__all__";

export function PartnersTable({ state }: { state: DistributionState }) {
    const { filters, setFilters, partners } = state;
    return (
        <div className="flex flex-col gap-3">
            <div className="border-line bg-panel flex flex-wrap items-end gap-3 rounded-xl border p-3">
                <div className="flex flex-col gap-1">
                    <Label className="text-ink-3 text-[10px] uppercase tracking-widest">
                        Search
                    </Label>
                    <Input
                        className="w-[200px]"
                        placeholder="Organisation name"
                        value={filters.search}
                        onChange={e => setFilters({ ...filters, search: e.target.value })}
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <Label className="text-ink-3 text-[10px] uppercase tracking-widest">
                        Stage
                    </Label>
                    <Select
                        value={filters.stage || ALL}
                        onValueChange={v => setFilters({ ...filters, stage: v === ALL ? "" : v })}
                    >
                        <SelectTrigger className="w-[170px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>All stages</SelectItem>
                            {(Object.keys(STAGE_LABELS) as RelationshipStage[]).map(s => (
                                <SelectItem key={s} value={s}>
                                    {STAGE_LABELS[s]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1">
                    <Label className="text-ink-3 text-[10px] uppercase tracking-widest">Kind</Label>
                    <Select
                        value={filters.kind || ALL}
                        onValueChange={v => setFilters({ ...filters, kind: v === ALL ? "" : v })}
                    >
                        <SelectTrigger className="w-[150px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>All kinds</SelectItem>
                            {(Object.keys(KIND_LABELS) as PartnerKind[]).map(k => (
                                <SelectItem key={k} value={k}>
                                    {KIND_LABELS[k]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1">
                    <Label className="text-ink-3 text-[10px] uppercase tracking-widest">
                        Min fit
                    </Label>
                    <Input
                        className="w-[90px]"
                        type="number"
                        min={0}
                        max={100}
                        value={filters.minFit}
                        onChange={e => setFilters({ ...filters, minFit: e.target.value })}
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <Label className="text-ink-3 text-[10px] uppercase tracking-widest">
                        Order
                    </Label>
                    <Select
                        value={filters.order}
                        onValueChange={v =>
                            setFilters({ ...filters, order: v as typeof filters.order })
                        }
                    >
                        <SelectTrigger className="w-[150px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="fit">Fit score</SelectItem>
                            <SelectItem value="activity">Last activity</SelectItem>
                            <SelectItem value="stage">Stage</SelectItem>
                            <SelectItem value="created">Newest</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center gap-2 pb-2">
                    <Switch
                        id="stale-only"
                        checked={filters.staleOnly}
                        onCheckedChange={v => setFilters({ ...filters, staleOnly: v })}
                    />
                    <Label htmlFor="stale-only" className="text-ink-2 text-xs">
                        Stale only
                    </Label>
                </div>
                <span className="text-ink-3 ml-auto self-center text-xs">
                    {partners.length} shown
                </span>
            </div>

            <div className="border-line bg-panel overflow-x-auto rounded-xl border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <OrderHead state={state}>Organisation</OrderHead>
                            <OrderHead state={state}>Kind</OrderHead>
                            <OrderHead state={state}>Territory</OrderHead>
                            <OrderHead state={state}>Stage</OrderHead>
                            <OrderHead state={state}>Fit</OrderHead>
                            <OrderHead state={state} className="text-right">
                                Evidence
                            </OrderHead>
                            <OrderHead state={state}>Last activity</OrderHead>
                            <OrderHead state={state}>Next action</OrderHead>
                            <OrderHead state={state}>Flags</OrderHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {partners.length === 0 && (
                            <TableRow>
                                <TableCell
                                    colSpan={9}
                                    className="text-ink-2 py-8 text-center text-sm"
                                >
                                    {state.loading.partners
                                        ? "Loading…"
                                        : "No partners match. Run discovery or import your existing partners."}
                                </TableCell>
                            </TableRow>
                        )}
                        {partners.map(item => (
                            <PartnerRow key={item.relationship.id} item={item} state={state}>
                                <TableCell>
                                    <div className="text-ink font-medium">{item.org.name}</div>
                                    <div className="text-ink-3 text-xs">
                                        {item.org.domain ?? item.org.country ?? ""}
                                        {item.org.kgEntityId ? " · known in your documents" : ""}
                                    </div>
                                </TableCell>
                                <TableCell>{KIND_LABELS[item.relationship.kind]}</TableCell>
                                <TableCell className="font-mono text-xs">
                                    {item.relationship.territory
                                        ? `${item.relationship.territory.region ? `${item.relationship.territory.region}, ` : ""}${item.relationship.territory.country}`
                                        : (item.org.country ?? "—")}
                                </TableCell>
                                <TableCell>
                                    <StageBadge stage={item.relationship.stage} />
                                </TableCell>
                                <TableCell>
                                    <FitBadge score={item.relationship.fitScore} />
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs tabular-nums">
                                    {item.evidenceCount}
                                </TableCell>
                                <TableCell className="text-ink-2 text-xs">
                                    {daysAgo(
                                        item.relationship.lastActivityAt ??
                                            item.relationship.stageChangedAt
                                    )}
                                    {item.stale && (
                                        <Badge variant="warn" className="ml-2">
                                            stale
                                        </Badge>
                                    )}
                                </TableCell>
                                <TableCell className="text-ink-2 max-w-[220px] truncate text-xs">
                                    {item.relationship.nextAction ?? "—"}
                                </TableCell>
                                <TableCell className="text-xs">
                                    {item.relationship.screening?.status === "flagged" && (
                                        <Badge variant="destructive">screening</Badge>
                                    )}
                                    {item.relationship.riskFlags.length > 0 && (
                                        <span className="text-ink-3 ml-1">
                                            {item.relationship.riskFlags.length} flag
                                            {item.relationship.riskFlags.length === 1 ? "" : "s"}
                                        </span>
                                    )}
                                </TableCell>
                            </PartnerRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

"use client";

import type { ReactNode } from "react";
import { ChevronLeft, Ellipsis, PanelRightClose, PanelRightOpen } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

import { WORKSPACE_HEADER_HEIGHT_PX } from "./workspaceHeader";

/**
 * How much of the header a given width can carry.
 *
 * A document can sit in a column dragged down to 18% of the workspace —
 * around 130px on a small laptop — and the header used to lay everything
 * out regardless: "Ask about this" wrapped to three lines over the save
 * state and the title shrank to nothing. Each step down gives up the least
 * useful thing first, and nothing is ever dropped outright: whatever leaves
 * the row goes into the "More" menu.
 *
 *   full    everything, with the kind and date under the title
 *   narrow  the kind and date go; the save state stays
 *   icons   labelled buttons become icons (their label is the tooltip)
 *   compact one action stays in the row, the rest go into More
 *   tiny    the row is the title and More, and More has everything
 */
export type HeaderTier = "full" | "narrow" | "icons" | "compact" | "tiny";

const TIERS: HeaderTier[] = ["full", "narrow", "icons", "compact", "tiny"];

/** The title keeps at least this much room; below it, a step down is taken. */
export const MIN_TITLE_PX = 120;
/** With the kind and date under it, the title column needs this much. */
export const MIN_TITLE_WITH_META_PX = 210;
const ICON_BUTTON_PX = 32;
const KIND_TILE_PX = 26 + 8;

/**
 * A label's rendered width at the header's 12px. Measured with a canvas
 * when there is one; an average glyph width otherwise (tests, the server),
 * which errs wide so a guess never picks a tier that does not fit.
 */
let canvas: HTMLCanvasElement | null = null;
export function measureLabel(label: string): number {
    if (typeof document !== "undefined") {
        canvas ??= document.createElement("canvas");
        const context = canvas.getContext?.("2d");
        if (context) {
            const family = getComputedStyle(document.body).fontFamily || "sans-serif";
            context.font = `500 12px ${family}`;
            return Math.ceil(context.measureText(label).width);
        }
    }
    return Math.ceil(label.length * 7);
}

/** A labelled small button: 10px padding each side, 14px icon, 6px gap, border. */
function labelledButtonPx(label: string, measure: (label: string) => number): number {
    return 10 + 14 + 6 + measure(label) + 10 + 2 + 4;
}

/** The width a tier needs, for these actions. */
export function headerWidthFor(
    tier: HeaderTier,
    actions: HeaderAction[],
    hasBack: boolean,
    measure: (label: string) => number = measureLabel
): number {
    const tight = tier === "compact" || tier === "tiny";
    const gap = tight ? 8 : 12;
    const padding = tight ? 24 : 36;
    const { inline, overflow, labelled, toggleInline } = placeHeaderActions(actions, tier);
    const buttons = inline.map(action =>
        labelled && !action.iconOnly ? labelledButtonPx(action.label, measure) : ICON_BUTTON_PX
    );
    if (overflow.length > 0 || !toggleInline) buttons.push(ICON_BUTTON_PX);
    if (toggleInline) buttons.push(ICON_BUTTON_PX);
    const back = hasBack
        ? (tight ? ICON_BUTTON_PX : labelledButtonPx("Library", measure)) + gap
        : 0;
    const title = tier === "full" ? MIN_TITLE_WITH_META_PX : MIN_TITLE_PX;
    return (
        padding +
        back +
        (tight ? 0 : KIND_TILE_PX) +
        title +
        buttons.reduce((sum, px) => sum + px + gap, 0)
    );
}

/** The richest tier that fits `width`. Unmeasured (0) means room for everything. */
export function headerTier(
    width: number,
    actions: HeaderAction[],
    hasBack: boolean,
    measure?: (label: string) => number
): HeaderTier {
    if (width <= 0) return "full";
    return TIERS.find(tier => headerWidthFor(tier, actions, hasBack, measure) <= width) ?? "tiny";
}

export interface HeaderAction {
    id: string;
    label: string;
    icon: ReactNode;
    onSelect: () => void;
    /** `primary` is the filled button; `danger` is for delete; `on` marks a set state. */
    tone?: "primary" | "danger" | "on";
    /** An icon even at full width — the lock, the bin. */
    iconOnly?: boolean;
    disabled?: boolean;
    /** Longer than the label, for the tooltip. */
    hint?: string;
    testId?: string;
}

/** Which actions sit in the row, which go into More, and how the row draws them. */
export function placeHeaderActions(
    actions: HeaderAction[],
    tier: HeaderTier
): { inline: HeaderAction[]; overflow: HeaderAction[]; labelled: boolean; toggleInline: boolean } {
    switch (tier) {
        case "full":
        case "narrow":
            return { inline: actions, overflow: [], labelled: true, toggleInline: true };
        case "icons":
            return { inline: actions, overflow: [], labelled: false, toggleInline: true };
        case "compact":
            // The first action is the one the document is for — Edit on a
            // map, Ask on everything else — so it is the one that stays.
            return {
                inline: actions.slice(0, 1),
                overflow: actions.slice(1),
                labelled: false,
                toggleInline: true,
            };
        case "tiny":
            return { inline: [], overflow: actions, labelled: false, toggleInline: false };
    }
}

interface DocumentViewerHeaderProps {
    /** The viewer's measured width; 0 before it has been measured. */
    width: number;
    /** The full-screen preview's way back to the library. Absent in a column. */
    onBack?: () => void;
    kindIcon: ReactNode;
    kindColor: string;
    /** The editable title field; the viewer owns its state and ref. */
    title: ReactNode;
    /** Kind, size or date — the part that goes first when room runs out. */
    meta: ReactNode;
    status: { text: string; color: string };
    actions: HeaderAction[];
    details: { visible: boolean; onToggle: () => void };
}

export function DocumentViewerHeader({
    width,
    onBack,
    kindIcon,
    kindColor,
    title,
    meta,
    status,
    actions,
    details,
}: DocumentViewerHeaderProps) {
    const tier = headerTier(width, actions, Boolean(onBack));
    const { inline, overflow, labelled, toggleInline } = placeHeaderActions(actions, tier);
    const tight = tier === "compact" || tier === "tiny";
    const detailsLabel = details.visible ? "Hide versions and notes" : "Show versions and notes";
    const DetailsIcon = details.visible ? PanelRightClose : PanelRightOpen;

    return (
        <div
            data-testid="viewer-header"
            data-tier={tier}
            className={cn(
                "border-line bg-panel flex shrink-0 items-center border-b",
                tight ? "gap-2 px-3" : "gap-3 px-[18px]"
            )}
            // The same height as the chat's bar beside it, so the rule under
            // both runs level across the columns.
            style={{ height: WORKSPACE_HEADER_HEIGHT_PX }}
        >
            {onBack && (
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onBack}
                    aria-label="Back to Library"
                    title="Back to Library"
                    className={cn("text-ink-2 h-8 shrink-0 text-xs font-normal", tight && "px-2")}
                >
                    <ChevronLeft className="size-3.5" />
                    {!tight && "Library"}
                </Button>
            )}

            <div className="flex min-w-0 flex-1 items-center gap-2">
                {!tight && (
                    <div
                        className="bg-line-2 flex size-[26px] shrink-0 items-center justify-center rounded-md"
                        style={{ color: kindColor }}
                    >
                        {kindIcon}
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    {title}
                    <div className="text-ink-3 flex gap-1.5 whitespace-nowrap px-1 text-[11px] leading-4">
                        {tier === "full" && meta}
                        <span className="truncate" style={{ color: status.color }}>
                            {status.text}
                        </span>
                    </div>
                </div>
            </div>

            {inline.map(action =>
                labelled && !action.iconOnly ? (
                    <Button
                        key={action.id}
                        variant={action.tone === "primary" ? "default" : "outline"}
                        size="sm"
                        onClick={action.onSelect}
                        disabled={action.disabled}
                        title={action.hint ?? action.label}
                        data-testid={action.testId}
                        className={cn(
                            "h-8 shrink-0 text-xs",
                            action.tone !== "primary" && "text-ink-2 font-normal"
                        )}
                    >
                        {action.icon}
                        {action.label}
                    </Button>
                ) : (
                    <Button
                        key={action.id}
                        variant={action.tone === "primary" ? "default" : "outline"}
                        size="icon"
                        onClick={action.onSelect}
                        disabled={action.disabled}
                        aria-label={action.label}
                        title={action.hint ?? action.label}
                        data-testid={action.testId}
                        className={cn(
                            "size-8 shrink-0",
                            action.tone === "danger" && "text-danger hover:text-danger",
                            action.tone === "on" && "text-brand",
                            !action.tone && "text-ink-2"
                        )}
                    >
                        {action.icon}
                    </Button>
                )
            )}

            {overflow.length > 0 || !toggleInline ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="outline"
                            size="icon"
                            aria-label="More actions"
                            title="More actions"
                            data-testid="viewer-more"
                            className="text-ink-2 size-8 shrink-0"
                        >
                            <Ellipsis className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    {/* Above the full-screen preview, which sits at z-index 80;
                        the menu's own z-50 would open behind it. */}
                    <DropdownMenuContent align="end" className="z-[90] min-w-44">
                        {overflow.map(action => (
                            <DropdownMenuItem
                                key={action.id}
                                onSelect={action.onSelect}
                                disabled={action.disabled}
                                variant={action.tone === "danger" ? "destructive" : "default"}
                                data-testid={action.testId ? `${action.testId}-menu` : undefined}
                            >
                                {action.icon}
                                {action.label}
                            </DropdownMenuItem>
                        ))}
                        {!toggleInline && (
                            <>
                                {overflow.length > 0 && <DropdownMenuSeparator />}
                                <DropdownMenuItem
                                    onSelect={details.onToggle}
                                    data-testid="viewer-details-toggle-menu"
                                >
                                    <DetailsIcon />
                                    {detailsLabel}
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}

            {toggleInline && (
                <Button
                    variant="outline"
                    size="icon"
                    onClick={details.onToggle}
                    aria-pressed={details.visible}
                    aria-label={detailsLabel}
                    title={detailsLabel}
                    data-testid="viewer-details-toggle"
                    className={cn(
                        "size-8 shrink-0",
                        details.visible ? "bg-brand-soft text-brand-ink" : "text-ink-2"
                    )}
                >
                    <DetailsIcon className="size-3.5" />
                </Button>
            )}
        </div>
    );
}

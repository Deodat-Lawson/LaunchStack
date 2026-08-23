"use client";

import React, { useMemo } from "react";
import {
    AlignCenterHorizontal,
    AlignCenterVertical,
    AlignEndVertical,
    AlignHorizontalDistributeCenter,
    AlignLeft,
    AlignRight,
    AlignStartVertical,
    AlignVerticalDistributeCenter,
    ArrowLeftRight,
    Bold,
    BringToFront,
    FlipHorizontal,
    FlipVertical,
    Group,
    Italic,
    Lock,
    LockOpen,
    Maximize2,
    SendToBack,
    Spline,
    Strikethrough,
    Underline,
    Ungroup,
    Waypoints,
} from "lucide-react";

import { ScrollArea } from "~/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";

import {
    alignSelection,
    applyTheme,
    clearWaypoints,
    distributeSelection,
    fitNodeToText,
    flipSelection,
    groupSelection,
    matchSize,
    reorder,
    reverseEdges,
    setArrow,
    setEdgeKind,
    setPageBackground,
    setSettings,
    setShapeType,
    styleEdgeSelection,
    styleSelection,
    styleTextSelection,
    toggleLock,
    ungroupSelection,
} from "../model/commands";
import { activePage, mapNodes, nodeById } from "../model/doc";
import { SHAPES } from "../model/shapes";
import { ThemePicker } from "./ThemePicker";
import type { EditorState } from "../model/store";
import type {
    ArrowId,
    DiagramEdge,
    DiagramNode,
    EdgeKind,
    HAlign,
    ShapeId,
    StrokeStyle,
    VAlign,
} from "../model/types";
import { ARROW_OPTIONS } from "./arrows";
import {
    ColorField,
    IconToggle,
    Label,
    NumberField,
    Row,
    Section,
    Segmented,
    Slider,
} from "./controls";
import { useCommittedDoc, useEditor, useStore } from "./EditorContext";

/**
 * The properties panel.
 *
 * Shows whatever the selection has in common. With nothing selected it falls
 * back to page settings — which is where the grid, background and theme live,
 * so the panel is never a dead empty column.
 *
 * Every control writes through a command in `commands.ts`; nothing here mutates
 * the document directly.
 */

const selectSelection = (s: EditorState) => s.selection;

/** Common value across a set, or `null` when they disagree. */
function common<T, K>(items: readonly T[], read: (item: T) => K): K | null {
    if (items.length === 0) return null;
    const first = read(items[0]!);
    return items.every(i => read(i) === first) ? first : null;
}

export function Inspector() {
    const store = useStore();
    const doc = useCommittedDoc();
    const selection = useEditor(selectSelection);
    const page = useMemo(() => activePage(doc), [doc]);

    const nodes = useMemo(
        () =>
            selection
                .filter(s => s.kind === "node")
                .map(s => nodeById(page, s.id))
                .filter((nd): nd is DiagramNode => nd !== undefined),
        [page, selection]
    );
    const edges = useMemo(
        () =>
            selection
                .filter(s => s.kind === "edge")
                .map(s => page.edges.find(e => e.id === s.id))
                .filter((e): e is DiagramEdge => e !== undefined),
        [page, selection]
    );

    return (
        <ScrollArea className="h-full">
            <div className="pb-10">
                {nodes.length === 0 && edges.length === 0 && <PageSettings />}
                {nodes.length > 0 && <NodeSections nodes={nodes} />}
                {edges.length > 0 && <EdgeSections edges={edges} />}
                {(nodes.length > 0 || edges.length > 0) && (
                    <Section title="Arrange">
                        <Row>
                            <IconToggle
                                title="Align left"
                                onClick={() => alignSelection(store, "left")}
                            >
                                <AlignStartVertical className="size-4" />
                            </IconToggle>
                            <IconToggle
                                title="Align centre"
                                onClick={() => alignSelection(store, "hcenter")}
                            >
                                <AlignCenterVertical className="size-4" />
                            </IconToggle>
                            <IconToggle
                                title="Align right"
                                onClick={() => alignSelection(store, "right")}
                            >
                                <AlignEndVertical className="size-4" />
                            </IconToggle>
                            <div className="bg-line mx-1 h-5 w-px" />
                            <IconToggle
                                title="Align top"
                                onClick={() => alignSelection(store, "top")}
                            >
                                <AlignStartVertical className="size-4 rotate-90" />
                            </IconToggle>
                            <IconToggle
                                title="Align middle"
                                onClick={() => alignSelection(store, "vcenter")}
                            >
                                <AlignCenterHorizontal className="size-4" />
                            </IconToggle>
                            <IconToggle
                                title="Align bottom"
                                onClick={() => alignSelection(store, "bottom")}
                            >
                                <AlignEndVertical className="size-4 rotate-90" />
                            </IconToggle>
                        </Row>
                        <Row>
                            <IconToggle
                                title="Distribute horizontally"
                                onClick={() => distributeSelection(store, "h")}
                            >
                                <AlignHorizontalDistributeCenter className="size-4" />
                            </IconToggle>
                            <IconToggle
                                title="Distribute vertically"
                                onClick={() => distributeSelection(store, "v")}
                            >
                                <AlignVerticalDistributeCenter className="size-4" />
                            </IconToggle>
                            <IconToggle title="Match size" onClick={() => matchSize(store, "both")}>
                                <Maximize2 className="size-4" />
                            </IconToggle>
                            <div className="bg-line mx-1 h-5 w-px" />
                            <IconToggle
                                title="Flip horizontally"
                                onClick={() => flipSelection(store, "h")}
                            >
                                <FlipHorizontal className="size-4" />
                            </IconToggle>
                            <IconToggle
                                title="Flip vertically"
                                onClick={() => flipSelection(store, "v")}
                            >
                                <FlipVertical className="size-4" />
                            </IconToggle>
                        </Row>
                        <Row>
                            <IconToggle
                                title="Bring to front"
                                onClick={() => reorder(store, "front")}
                            >
                                <BringToFront className="size-4" />
                            </IconToggle>
                            <IconToggle title="Send to back" onClick={() => reorder(store, "back")}>
                                <SendToBack className="size-4" />
                            </IconToggle>
                            <div className="bg-line mx-1 h-5 w-px" />
                            <IconToggle title="Group (⌘G)" onClick={() => groupSelection(store)}>
                                <Group className="size-4" />
                            </IconToggle>
                            <IconToggle
                                title="Ungroup (⇧⌘G)"
                                onClick={() => ungroupSelection(store)}
                            >
                                <Ungroup className="size-4" />
                            </IconToggle>
                            <IconToggle
                                title="Lock / unlock (⌘L)"
                                active={nodes.some(nd => nd.locked)}
                                onClick={() => toggleLock(store)}
                            >
                                {nodes.some(nd => nd.locked) ? (
                                    <Lock className="size-4" />
                                ) : (
                                    <LockOpen className="size-4" />
                                )}
                            </IconToggle>
                        </Row>
                    </Section>
                )}
            </div>
        </ScrollArea>
    );
}

// ---------------------------------------------------------------------------
// Node sections
// ---------------------------------------------------------------------------

function NodeSections({ nodes }: { nodes: DiagramNode[] }) {
    const store = useStore();
    const first = nodes[0]!;
    const ids = nodes.map(nd => nd.id);

    const fill = common(nodes, nd => nd.style.fill);
    const stroke = common(nodes, nd => nd.style.stroke);
    const strokeWidth = common(nodes, nd => nd.style.strokeWidth);
    const strokeStyle = common(nodes, nd => nd.style.strokeStyle);
    const radius = common(nodes, nd => nd.style.radius);
    const opacity = common(nodes, nd => nd.style.opacity);
    const shadow = common(nodes, nd => nd.style.shadow);
    const shape = common(nodes, nd => nd.shape);

    const textColor = common(nodes, nd => nd.textStyle.color);
    const fontSize = common(nodes, nd => nd.textStyle.size);
    const family = common(nodes, nd => nd.textStyle.family);
    const align = common(nodes, nd => nd.textStyle.align);
    const valign = common(nodes, nd => nd.textStyle.valign);

    const setGeometry = (patch: Partial<Pick<DiagramNode, "x" | "y" | "w" | "h" | "rotation">>) => {
        store.updatePage(p => mapNodes(p, ids, nd => ({ ...nd, ...patch })), {
            label: "Set geometry",
            coalesceKey: `geometry:${ids.join(",")}`,
        });
    };

    return (
        <>
            <Section title={nodes.length > 1 ? `${nodes.length} shapes` : "Shape"}>
                <Select
                    value={shape ?? undefined}
                    onValueChange={value => setShapeType(store, value as ShapeId)}
                >
                    <SelectTrigger className="h-7 text-[12px]">
                        <SelectValue placeholder="Mixed shapes" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                        {SHAPES.map(def => (
                            <SelectItem key={def.id} value={def.id} className="text-[12px]">
                                {def.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </Section>

            <Section title="Fill & stroke">
                <Row>
                    <Label>Fill</Label>
                    <ColorField
                        label="Fill colour"
                        tone="fill"
                        allowNone
                        value={fill ?? "none"}
                        onChange={value => styleSelection(store, { fill: value }, "Fill")}
                    />
                </Row>
                <Row>
                    <Label>Stroke</Label>
                    <ColorField
                        label="Stroke colour"
                        tone="stroke"
                        allowNone
                        value={stroke ?? "none"}
                        onChange={value => styleSelection(store, { stroke: value }, "Stroke")}
                    />
                </Row>
                <Row>
                    <Label>Weight</Label>
                    <NumberField
                        aria-label="Stroke width"
                        value={strokeWidth ?? 1.5}
                        mixed={strokeWidth === null}
                        min={0}
                        max={40}
                        step={0.5}
                        onChange={value =>
                            styleSelection(store, { strokeWidth: value }, "Stroke width")
                        }
                    />
                    <Segmented<StrokeStyle>
                        value={strokeStyle}
                        onChange={value =>
                            styleSelection(store, { strokeStyle: value }, "Stroke style")
                        }
                        options={[
                            { value: "solid", label: "──", title: "Solid" },
                            { value: "dashed", label: "╌╌", title: "Dashed" },
                            { value: "dotted", label: "···", title: "Dotted" },
                        ]}
                    />
                </Row>
                <Row>
                    <Label>Corner</Label>
                    <NumberField
                        aria-label="Corner radius"
                        value={radius ?? 0}
                        mixed={radius === null}
                        min={0}
                        max={200}
                        onChange={value =>
                            styleSelection(store, { radius: value }, "Corner radius")
                        }
                        suffix="px"
                    />
                    <div className="flex items-center gap-1.5">
                        <span className="text-ink-3 text-[11px]">Shadow</span>
                        <Switch
                            checked={shadow ?? false}
                            onCheckedChange={value =>
                                styleSelection(store, { shadow: value }, "Shadow")
                            }
                            aria-label="Drop shadow"
                        />
                    </div>
                </Row>
                <Row>
                    <Label>Opacity</Label>
                    <Slider
                        aria-label="Opacity"
                        value={opacity ?? 1}
                        onChange={value => styleSelection(store, { opacity: value }, "Opacity")}
                    />
                    <span className="text-ink-3 w-9 text-right text-[11px] tabular-nums">
                        {Math.round((opacity ?? 1) * 100)}%
                    </span>
                </Row>
            </Section>

            <Section title="Text">
                <Row>
                    <Label>Colour</Label>
                    <ColorField
                        label="Text colour"
                        tone="ink"
                        value={textColor ?? "var(--ink)"}
                        onChange={value =>
                            styleTextSelection(store, { color: value }, "Text colour")
                        }
                    />
                </Row>
                <Row>
                    <Label>Size</Label>
                    <NumberField
                        aria-label="Font size"
                        value={fontSize ?? 14}
                        mixed={fontSize === null}
                        min={6}
                        max={200}
                        onChange={value => styleTextSelection(store, { size: value }, "Font size")}
                    />
                    <Segmented
                        value={family}
                        onChange={value =>
                            styleTextSelection(store, { family: value }, "Font family")
                        }
                        options={[
                            { value: "sans" as const, label: "Aa", title: "Sans" },
                            { value: "serif" as const, label: "Aa", title: "Serif" },
                            { value: "mono" as const, label: "Aa", title: "Mono" },
                        ]}
                    />
                </Row>
                <Row>
                    <IconToggle
                        title="Bold"
                        active={first.textStyle.bold}
                        onClick={() =>
                            styleTextSelection(store, { bold: !first.textStyle.bold }, "Bold")
                        }
                    >
                        <Bold className="size-4" />
                    </IconToggle>
                    <IconToggle
                        title="Italic"
                        active={first.textStyle.italic}
                        onClick={() =>
                            styleTextSelection(store, { italic: !first.textStyle.italic }, "Italic")
                        }
                    >
                        <Italic className="size-4" />
                    </IconToggle>
                    <IconToggle
                        title="Underline"
                        active={first.textStyle.underline}
                        onClick={() =>
                            styleTextSelection(
                                store,
                                { underline: !first.textStyle.underline },
                                "Underline"
                            )
                        }
                    >
                        <Underline className="size-4" />
                    </IconToggle>
                    <IconToggle
                        title="Strikethrough"
                        active={first.textStyle.strike}
                        onClick={() =>
                            styleTextSelection(store, { strike: !first.textStyle.strike }, "Strike")
                        }
                    >
                        <Strikethrough className="size-4" />
                    </IconToggle>
                </Row>
                <Row>
                    <Segmented<HAlign>
                        value={align}
                        onChange={value => styleTextSelection(store, { align: value }, "Align")}
                        options={[
                            {
                                value: "left",
                                icon: <AlignLeft className="size-3.5" />,
                                title: "Left",
                            },
                            {
                                value: "center",
                                icon: <AlignCenterHorizontal className="size-3.5" />,
                                title: "Centre",
                            },
                            {
                                value: "right",
                                icon: <AlignRight className="size-3.5" />,
                                title: "Right",
                            },
                        ]}
                    />
                    <Segmented<VAlign>
                        value={valign}
                        onChange={value => styleTextSelection(store, { valign: value }, "Align")}
                        options={[
                            { value: "top", label: "⌃", title: "Top" },
                            { value: "middle", label: "―", title: "Middle" },
                            { value: "bottom", label: "⌄", title: "Bottom" },
                        ]}
                    />
                </Row>
                <button
                    type="button"
                    onClick={() => fitNodeToText(store, ids)}
                    className="border-line text-ink-2 hover:bg-panel-2 w-full rounded-md border py-1.5 text-[12px] transition-colors"
                >
                    Fit shape to text
                </button>
            </Section>

            <Section title="Position & size">
                <Row>
                    <Label>X / Y</Label>
                    <NumberField
                        aria-label="X"
                        value={first.x}
                        mixed={common(nodes, nd => nd.x) === null}
                        onChange={value => setGeometry({ x: value })}
                    />
                    <NumberField
                        aria-label="Y"
                        value={first.y}
                        mixed={common(nodes, nd => nd.y) === null}
                        onChange={value => setGeometry({ y: value })}
                    />
                </Row>
                <Row>
                    <Label>W / H</Label>
                    <NumberField
                        aria-label="Width"
                        value={first.w}
                        min={1}
                        mixed={common(nodes, nd => nd.w) === null}
                        onChange={value => setGeometry({ w: value })}
                    />
                    <NumberField
                        aria-label="Height"
                        value={first.h}
                        min={1}
                        mixed={common(nodes, nd => nd.h) === null}
                        onChange={value => setGeometry({ h: value })}
                    />
                </Row>
                <Row>
                    <Label>Rotate</Label>
                    <NumberField
                        aria-label="Rotation"
                        value={first.rotation}
                        mixed={common(nodes, nd => nd.rotation) === null}
                        min={-360}
                        max={360}
                        onChange={value => setGeometry({ rotation: value })}
                        suffix="°"
                    />
                </Row>
            </Section>
        </>
    );
}

// ---------------------------------------------------------------------------
// Edge sections
// ---------------------------------------------------------------------------

function EdgeSections({ edges }: { edges: DiagramEdge[] }) {
    const store = useStore();
    const kind = common(edges, e => e.kind);
    const stroke = common(edges, e => e.style.stroke);
    const strokeWidth = common(edges, e => e.style.strokeWidth);
    const strokeStyle = common(edges, e => e.style.strokeStyle);
    const startArrow = common(edges, e => e.startArrow);
    const endArrow = common(edges, e => e.endArrow);

    return (
        <Section title={edges.length > 1 ? `${edges.length} connectors` : "Connector"}>
            <Row>
                <Label>Route</Label>
                <Segmented<EdgeKind>
                    value={kind}
                    onChange={value => setEdgeKind(store, value)}
                    options={[
                        { value: "straight", label: "╱", title: "Straight" },
                        { value: "elbow", label: "⌐", title: "Elbow" },
                        { value: "curved", label: "∿", title: "Curved" },
                    ]}
                />
            </Row>
            <Row>
                <Label>Colour</Label>
                <ColorField
                    label="Connector colour"
                    tone="stroke"
                    value={stroke ?? "var(--ink-2)"}
                    onChange={value =>
                        styleEdgeSelection(store, { stroke: value }, "Connector colour")
                    }
                />
            </Row>
            <Row>
                <Label>Weight</Label>
                <NumberField
                    aria-label="Connector width"
                    value={strokeWidth ?? 1.8}
                    mixed={strokeWidth === null}
                    min={0.5}
                    max={24}
                    step={0.5}
                    onChange={value => styleEdgeSelection(store, { strokeWidth: value }, "Width")}
                />
                <Segmented<StrokeStyle>
                    value={strokeStyle}
                    onChange={value => styleEdgeSelection(store, { strokeStyle: value }, "Style")}
                    options={[
                        { value: "solid", label: "──", title: "Solid" },
                        { value: "dashed", label: "╌╌", title: "Dashed" },
                        { value: "dotted", label: "···", title: "Dotted" },
                    ]}
                />
            </Row>
            <Row>
                <Label>Start</Label>
                <ArrowSelect
                    value={startArrow}
                    onChange={value => setArrow(store, "start", value)}
                    ariaLabel="Start arrowhead"
                />
            </Row>
            <Row>
                <Label>End</Label>
                <ArrowSelect
                    value={endArrow}
                    onChange={value => setArrow(store, "end", value)}
                    ariaLabel="End arrowhead"
                />
            </Row>
            <Row>
                <IconToggle title="Reverse direction" onClick={() => reverseEdges(store)}>
                    <ArrowLeftRight className="size-4" />
                </IconToggle>
                <IconToggle title="Reset route" onClick={() => clearWaypoints(store)}>
                    <Waypoints className="size-4" />
                </IconToggle>
                <span className="text-ink-3 text-[11px]">Double-click a connector to label it</span>
            </Row>
        </Section>
    );
}

function ArrowSelect({
    value,
    onChange,
    ariaLabel,
}: {
    value: ArrowId | null;
    onChange: (next: ArrowId) => void;
    ariaLabel: string;
}) {
    return (
        <Select value={value ?? undefined} onValueChange={v => onChange(v as ArrowId)}>
            <SelectTrigger className="h-7 flex-1 text-[12px]" aria-label={ariaLabel}>
                <SelectValue placeholder="Mixed" />
            </SelectTrigger>
            <SelectContent>
                {ARROW_OPTIONS.map(option => (
                    <SelectItem key={option.id} value={option.id} className="text-[12px]">
                        {option.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

// ---------------------------------------------------------------------------
// Page settings (nothing selected)
// ---------------------------------------------------------------------------

function PageSettings() {
    const store = useStore();
    const doc = useCommittedDoc();
    const page = useMemo(() => activePage(doc), [doc]);

    return (
        <>
            <Section title="Theme">
                <ThemePicker
                    activeId={doc.settings.paletteId}
                    onPick={id => applyTheme(store, id)}
                />
            </Section>

            <Section title="Canvas">
                <Row>
                    <Label>Background</Label>
                    <ColorField
                        label="Background colour"
                        tone="fill"
                        value={page.background.color}
                        onChange={value => setPageBackground(store, { color: value })}
                    />
                </Row>
                <Row>
                    <Label>Pattern</Label>
                    <Segmented
                        value={page.background.pattern}
                        onChange={value => setPageBackground(store, { pattern: value })}
                        options={[
                            { value: "plain" as const, label: "None" },
                            { value: "dots" as const, label: "Dots" },
                            { value: "grid" as const, label: "Grid" },
                            { value: "lines" as const, label: "Lines" },
                        ]}
                    />
                </Row>
                <Row>
                    <Label>Spacing</Label>
                    <NumberField
                        aria-label="Grid spacing"
                        value={page.background.spacing}
                        min={4}
                        max={200}
                        onChange={value => setPageBackground(store, { spacing: value })}
                        suffix="px"
                    />
                </Row>
            </Section>

            <Section title="Snapping">
                <Row>
                    <span className="text-ink-2 flex-1 text-[12px]">Show grid</span>
                    <Switch
                        checked={doc.settings.showGrid}
                        onCheckedChange={value => setSettings(store, { showGrid: value })}
                        aria-label="Show grid"
                    />
                </Row>
                <Row>
                    <span className="text-ink-2 flex-1 text-[12px]">Show rulers</span>
                    <Switch
                        checked={doc.settings.showRulers}
                        onCheckedChange={value => setSettings(store, { showRulers: value })}
                        aria-label="Show rulers"
                    />
                </Row>
                <Row>
                    <span className="text-ink-2 flex-1 text-[12px]">Snap to grid</span>
                    <Switch
                        checked={doc.settings.snapToGrid}
                        onCheckedChange={value => setSettings(store, { snapToGrid: value })}
                        aria-label="Snap to grid"
                    />
                </Row>
                <Row>
                    <span className="text-ink-2 flex-1 text-[12px]">Snap to objects</span>
                    <Switch
                        checked={doc.settings.snapToObjects}
                        onCheckedChange={value => setSettings(store, { snapToObjects: value })}
                        aria-label="Snap to objects"
                    />
                </Row>
                <Row>
                    <Label>Grid size</Label>
                    <NumberField
                        aria-label="Grid size"
                        value={doc.settings.gridSize}
                        min={1}
                        max={100}
                        onChange={value => setSettings(store, { gridSize: value })}
                        suffix="px"
                    />
                </Row>
            </Section>

            <Section title="New connectors">
                <Row>
                    <Label>
                        <Spline className="size-3.5" />
                    </Label>
                    <Segmented<EdgeKind>
                        value={doc.settings.defaultEdgeKind}
                        onChange={value => setSettings(store, { defaultEdgeKind: value })}
                        options={[
                            { value: "straight", label: "╱", title: "Straight" },
                            { value: "elbow", label: "⌐", title: "Elbow" },
                            { value: "curved", label: "∿", title: "Curved" },
                        ]}
                    />
                </Row>
            </Section>
        </>
    );
}

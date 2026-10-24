"use client";

import React, { useMemo } from "react";
import { useTranslations } from "next-intl";
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
    PresetNumberField,
    Row,
    Section,
    Segmented,
    Slider,
} from "./controls";
import { shapeName, useCommittedDoc, useEditor, useStore } from "./EditorContext";

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

/**
 * Stroke weights people ask for by name; the field still takes any number.
 * `key` names the weight in `mindmap.inspector.weights`.
 */
const WEIGHT_PRESETS = [
    { key: "hairline", value: 0.75 },
    { key: "thin", value: 1 },
    { key: "regular", value: 1.5 },
    { key: "medium", value: 2.5 },
    { key: "bold", value: 4 },
    { key: "heavy", value: 6 },
] as const;

/** Type sizes by role rather than by pixel, named in `inspector.fontSizes`. */
const FONT_SIZE_PRESETS = [
    { key: "small", value: 11 },
    { key: "body", value: 14 },
    { key: "emphasis", value: 16 },
    { key: "subheading", value: 20 },
    { key: "heading", value: 24 },
    { key: "display", value: 32 },
] as const;

type InspectorT = ReturnType<typeof useTranslations<"mindmap.inspector">>;

function weightPresets(t: InspectorT) {
    return WEIGHT_PRESETS.map(p => ({ label: t(`weights.${p.key}`), value: p.value }));
}

function strokeStyleOptions(t: InspectorT) {
    return [
        { value: "solid", label: "──", title: t("strokeStyles.solid") },
        { value: "dashed", label: "╌╌", title: t("strokeStyles.dashed") },
        { value: "dotted", label: "···", title: t("strokeStyles.dotted") },
    ] as const;
}

function routeOptions(t: InspectorT) {
    return [
        { value: "straight", label: "╱", title: t("routes.straight") },
        { value: "elbow", label: "⌐", title: t("routes.elbow") },
        { value: "curved", label: "∿", title: t("routes.curved") },
    ] as const;
}

/** Common value across a set, or `null` when they disagree. */
function common<T, K>(items: readonly T[], read: (item: T) => K): K | null {
    if (items.length === 0) return null;
    const first = read(items[0]!);
    return items.every(i => read(i) === first) ? first : null;
}

export function Inspector() {
    const t = useTranslations("mindmap.inspector");
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
                {nodes.length > 0 && <NodeSections nodes={nodes} />}
                {edges.length > 0 && <EdgeSections edges={edges} />}
                {(nodes.length > 0 || edges.length > 0) && (
                    <Section title={t("arrange")} collapsible defaultOpen={false}>
                        <Row>
                            <IconToggle
                                title={t("alignLeft")}
                                onClick={() => alignSelection(store, "left")}
                            >
                                <AlignStartVertical className="size-4" />
                            </IconToggle>
                            <IconToggle
                                title={t("alignCentre")}
                                onClick={() => alignSelection(store, "hcenter")}
                            >
                                <AlignCenterVertical className="size-4" />
                            </IconToggle>
                            <IconToggle
                                title={t("alignRight")}
                                onClick={() => alignSelection(store, "right")}
                            >
                                <AlignEndVertical className="size-4" />
                            </IconToggle>
                            <div className="bg-line mx-1 h-5 w-px" />
                            <IconToggle
                                title={t("alignTop")}
                                onClick={() => alignSelection(store, "top")}
                            >
                                <AlignStartVertical className="size-4 rotate-90" />
                            </IconToggle>
                            <IconToggle
                                title={t("alignMiddle")}
                                onClick={() => alignSelection(store, "vcenter")}
                            >
                                <AlignCenterHorizontal className="size-4" />
                            </IconToggle>
                            <IconToggle
                                title={t("alignBottom")}
                                onClick={() => alignSelection(store, "bottom")}
                            >
                                <AlignEndVertical className="size-4 rotate-90" />
                            </IconToggle>
                        </Row>
                        <Row>
                            <IconToggle
                                title={t("distributeH")}
                                onClick={() => distributeSelection(store, "h")}
                            >
                                <AlignHorizontalDistributeCenter className="size-4" />
                            </IconToggle>
                            <IconToggle
                                title={t("distributeV")}
                                onClick={() => distributeSelection(store, "v")}
                            >
                                <AlignVerticalDistributeCenter className="size-4" />
                            </IconToggle>
                            <IconToggle
                                title={t("matchSize")}
                                onClick={() => matchSize(store, "both")}
                            >
                                <Maximize2 className="size-4" />
                            </IconToggle>
                            <div className="bg-line mx-1 h-5 w-px" />
                            <IconToggle
                                title={t("flipH")}
                                onClick={() => flipSelection(store, "h")}
                            >
                                <FlipHorizontal className="size-4" />
                            </IconToggle>
                            <IconToggle
                                title={t("flipV")}
                                onClick={() => flipSelection(store, "v")}
                            >
                                <FlipVertical className="size-4" />
                            </IconToggle>
                        </Row>
                        <Row>
                            <IconToggle title={t("front")} onClick={() => reorder(store, "front")}>
                                <BringToFront className="size-4" />
                            </IconToggle>
                            <IconToggle title={t("back")} onClick={() => reorder(store, "back")}>
                                <SendToBack className="size-4" />
                            </IconToggle>
                            <div className="bg-line mx-1 h-5 w-px" />
                            <IconToggle title={t("group")} onClick={() => groupSelection(store)}>
                                <Group className="size-4" />
                            </IconToggle>
                            <IconToggle
                                title={t("ungroup")}
                                onClick={() => ungroupSelection(store)}
                            >
                                <Ungroup className="size-4" />
                            </IconToggle>
                            <IconToggle
                                title={t("lock")}
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
    const t = useTranslations("mindmap.inspector");
    const tm = useTranslations("mindmap");
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
            <Section
                title={nodes.length > 1 ? t("shapesCount", { count: nodes.length }) : t("shape")}
            >
                <Select
                    value={shape ?? undefined}
                    onValueChange={value => setShapeType(store, value as ShapeId)}
                >
                    <SelectTrigger className="h-7 text-[12px]">
                        <SelectValue placeholder={t("mixedShapes")} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                        {/* Hidden duplicates stay listable only while one is the
                            current value, so a legacy node's select isn't blank. */}
                        {SHAPES.filter(def => !def.paletteHidden || def.id === shape).map(def => (
                            <SelectItem key={def.id} value={def.id} className="text-[12px]">
                                {shapeName(tm, def.id)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </Section>

            {/* The three things people change constantly, pinned at the top
                and side by side; everything below is reached for rarely. */}
            <Section title={t("colour")}>
                <div className="flex items-center gap-3">
                    <div className="flex flex-col items-center gap-1">
                        <ColorField
                            label={t("fillColour")}
                            tone="fill"
                            allowNone
                            value={fill ?? "none"}
                            onChange={value => styleSelection(store, { fill: value }, "Fill")}
                        />
                        <span className="text-ink-3 text-[10px]">{t("fill")}</span>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                        <ColorField
                            label={t("strokeColour")}
                            tone="stroke"
                            allowNone
                            value={stroke ?? "none"}
                            onChange={value => styleSelection(store, { stroke: value }, "Stroke")}
                        />
                        <span className="text-ink-3 text-[10px]">{t("stroke")}</span>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                        <ColorField
                            label={t("textColour")}
                            tone="ink"
                            value={textColor ?? "var(--ink)"}
                            onChange={value =>
                                styleTextSelection(store, { color: value }, "Text colour")
                            }
                        />
                        <span className="text-ink-3 text-[10px]">{t("text")}</span>
                    </div>
                </div>
            </Section>
            <Section title={t("shapeStyle")} collapsible>
                <Row>
                    <Label>{t("weight")}</Label>
                    <PresetNumberField
                        aria-label={t("strokeWidth")}
                        presets={weightPresets(t)}
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
                        options={strokeStyleOptions(t)}
                    />
                </Row>
                <Row>
                    <Label>{t("corner")}</Label>
                    <NumberField
                        aria-label={t("cornerRadius")}
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
                        <span className="text-ink-3 text-[11px]">{t("shadow")}</span>
                        <Switch
                            checked={shadow ?? false}
                            onCheckedChange={value =>
                                styleSelection(store, { shadow: value }, "Shadow")
                            }
                            aria-label={t("dropShadow")}
                        />
                    </div>
                </Row>
                <Row>
                    <Label>{t("opacity")}</Label>
                    <Slider
                        aria-label={t("opacity")}
                        value={opacity ?? 1}
                        onChange={value => styleSelection(store, { opacity: value }, "Opacity")}
                    />
                    <span className="text-ink-3 w-9 text-right text-[11px] tabular-nums">
                        {Math.round((opacity ?? 1) * 100)}%
                    </span>
                </Row>
            </Section>

            <Section title={t("text")}>
                <Row>
                    <Label>{t("size")}</Label>
                    <PresetNumberField
                        aria-label={t("fontSize")}
                        presets={FONT_SIZE_PRESETS.map(p => ({
                            label: t(`fontSizes.${p.key}`),
                            value: p.value,
                        }))}
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
                            { value: "sans" as const, label: "Aa", title: t("families.sans") },
                            { value: "serif" as const, label: "Aa", title: t("families.serif") },
                            { value: "mono" as const, label: "Aa", title: t("families.mono") },
                        ]}
                    />
                </Row>
                <Row>
                    <IconToggle
                        title={t("bold")}
                        active={first.textStyle.bold}
                        onClick={() =>
                            styleTextSelection(store, { bold: !first.textStyle.bold }, "Bold")
                        }
                    >
                        <Bold className="size-4" />
                    </IconToggle>
                    <IconToggle
                        title={t("italic")}
                        active={first.textStyle.italic}
                        onClick={() =>
                            styleTextSelection(store, { italic: !first.textStyle.italic }, "Italic")
                        }
                    >
                        <Italic className="size-4" />
                    </IconToggle>
                    <IconToggle
                        title={t("underline")}
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
                        title={t("strikethrough")}
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
                                title: t("textAlign.left"),
                            },
                            {
                                value: "center",
                                icon: <AlignCenterHorizontal className="size-3.5" />,
                                title: t("textAlign.center"),
                            },
                            {
                                value: "right",
                                icon: <AlignRight className="size-3.5" />,
                                title: t("textAlign.right"),
                            },
                        ]}
                    />
                    <Segmented<VAlign>
                        value={valign}
                        onChange={value => styleTextSelection(store, { valign: value }, "Align")}
                        options={[
                            { value: "top", label: "⌃", title: t("textAlign.top") },
                            { value: "middle", label: "―", title: t("textAlign.middle") },
                            { value: "bottom", label: "⌄", title: t("textAlign.bottom") },
                        ]}
                    />
                </Row>
                <button
                    type="button"
                    onClick={() => fitNodeToText(store, ids)}
                    className="border-line text-ink-2 hover:bg-panel-2 w-full rounded-md border py-1.5 text-[12px] transition-colors"
                >
                    {t("fitToText")}
                </button>
            </Section>

            <Section title={t("positionSize")} collapsible defaultOpen={false}>
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
                    <Label>{t("widthHeight")}</Label>
                    <NumberField
                        aria-label={t("width")}
                        value={first.w}
                        min={1}
                        mixed={common(nodes, nd => nd.w) === null}
                        onChange={value => setGeometry({ w: value })}
                    />
                    <NumberField
                        aria-label={t("height")}
                        value={first.h}
                        min={1}
                        mixed={common(nodes, nd => nd.h) === null}
                        onChange={value => setGeometry({ h: value })}
                    />
                </Row>
                <Row>
                    <Label>{t("rotate")}</Label>
                    <NumberField
                        aria-label={t("rotation")}
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
    const t = useTranslations("mindmap.inspector");
    const store = useStore();
    const kind = common(edges, e => e.kind);
    const stroke = common(edges, e => e.style.stroke);
    const strokeWidth = common(edges, e => e.style.strokeWidth);
    const strokeStyle = common(edges, e => e.style.strokeStyle);
    const startArrow = common(edges, e => e.startArrow);
    const endArrow = common(edges, e => e.endArrow);

    return (
        <Section
            title={
                edges.length > 1 ? t("connectorsCount", { count: edges.length }) : t("connector")
            }
        >
            <Row>
                <Label>{t("route")}</Label>
                <Segmented<EdgeKind>
                    value={kind}
                    onChange={value => setEdgeKind(store, value)}
                    options={routeOptions(t)}
                />
            </Row>
            <Row>
                <Label>{t("colour")}</Label>
                <ColorField
                    label={t("connectorColour")}
                    tone="stroke"
                    value={stroke ?? "var(--ink-2)"}
                    onChange={value =>
                        styleEdgeSelection(store, { stroke: value }, "Connector colour")
                    }
                />
            </Row>
            <Row>
                <Label>{t("weight")}</Label>
                <PresetNumberField
                    aria-label={t("connectorWidth")}
                    presets={weightPresets(t)}
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
                    options={strokeStyleOptions(t)}
                />
            </Row>
            <Row>
                <Label>{t("start")}</Label>
                <ArrowSelect
                    value={startArrow}
                    onChange={value => setArrow(store, "start", value)}
                    ariaLabel={t("startArrow")}
                />
            </Row>
            <Row>
                <Label>{t("end")}</Label>
                <ArrowSelect
                    value={endArrow}
                    onChange={value => setArrow(store, "end", value)}
                    ariaLabel={t("endArrow")}
                />
            </Row>
            <Row>
                <IconToggle title={t("reverse")} onClick={() => reverseEdges(store)}>
                    <ArrowLeftRight className="size-4" />
                </IconToggle>
                <IconToggle title={t("resetRoute")} onClick={() => clearWaypoints(store)}>
                    <Waypoints className="size-4" />
                </IconToggle>
                <span className="text-ink-3 text-[11px]">{t("labelHint")}</span>
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
    const t = useTranslations("mindmap");
    return (
        <Select value={value ?? undefined} onValueChange={v => onChange(v as ArrowId)}>
            <SelectTrigger className="h-7 flex-1 text-[12px]" aria-label={ariaLabel}>
                <SelectValue placeholder={t("controls.mixed")} />
            </SelectTrigger>
            <SelectContent>
                {ARROW_OPTIONS.map(option => (
                    <SelectItem key={option.id} value={option.id} className="text-[12px]">
                        {t(`arrows.${option.id}`)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

// ---------------------------------------------------------------------------
// Page settings (nothing selected)
// ---------------------------------------------------------------------------

/**
 * Theme, canvas and snapping — document-wide settings. Shown from the top
 * bar's Appearance control rather than as the inspector's idle state, so an
 * empty selection means an empty panel, not ten themes.
 */
export function PageSettings() {
    const t = useTranslations("mindmap.inspector");
    const store = useStore();
    const doc = useCommittedDoc();
    const page = useMemo(() => activePage(doc), [doc]);

    return (
        <>
            <Section title={t("theme")}>
                <ThemePicker
                    activeId={doc.settings.paletteId}
                    onPick={id => applyTheme(store, id)}
                />
            </Section>

            <Section title={t("canvas")}>
                <Row>
                    <Label>{t("background")}</Label>
                    <ColorField
                        label={t("backgroundColour")}
                        tone="fill"
                        value={page.background.color}
                        onChange={value => setPageBackground(store, { color: value })}
                    />
                </Row>
                <Row>
                    <Label>{t("pattern")}</Label>
                    <Segmented
                        value={page.background.pattern}
                        onChange={value => setPageBackground(store, { pattern: value })}
                        options={[
                            { value: "plain" as const, label: t("patterns.plain") },
                            { value: "dots" as const, label: t("patterns.dots") },
                            { value: "grid" as const, label: t("patterns.grid") },
                            { value: "lines" as const, label: t("patterns.lines") },
                        ]}
                    />
                </Row>
                <Row>
                    <Label>{t("spacing")}</Label>
                    <NumberField
                        aria-label={t("gridSpacing")}
                        value={page.background.spacing}
                        min={4}
                        max={200}
                        onChange={value => setPageBackground(store, { spacing: value })}
                        suffix="px"
                    />
                </Row>
            </Section>

            <Section title={t("snapping")}>
                <Row>
                    <span className="text-ink-2 flex-1 text-[12px]">{t("showGrid")}</span>
                    <Switch
                        checked={doc.settings.showGrid}
                        onCheckedChange={value => setSettings(store, { showGrid: value })}
                        aria-label={t("showGrid")}
                    />
                </Row>
                <Row>
                    <span className="text-ink-2 flex-1 text-[12px]">{t("showRulers")}</span>
                    <Switch
                        checked={doc.settings.showRulers}
                        onCheckedChange={value => setSettings(store, { showRulers: value })}
                        aria-label={t("showRulers")}
                    />
                </Row>
                <Row>
                    <span className="text-ink-2 flex-1 text-[12px]">{t("snapToGrid")}</span>
                    <Switch
                        checked={doc.settings.snapToGrid}
                        onCheckedChange={value => setSettings(store, { snapToGrid: value })}
                        aria-label={t("snapToGrid")}
                    />
                </Row>
                <Row>
                    <span className="text-ink-2 flex-1 text-[12px]">{t("snapToObjects")}</span>
                    <Switch
                        checked={doc.settings.snapToObjects}
                        onCheckedChange={value => setSettings(store, { snapToObjects: value })}
                        aria-label={t("snapToObjects")}
                    />
                </Row>
                <Row>
                    <Label>{t("gridSize")}</Label>
                    <NumberField
                        aria-label={t("gridSize")}
                        value={doc.settings.gridSize}
                        min={1}
                        max={100}
                        onChange={value => setSettings(store, { gridSize: value })}
                        suffix="px"
                    />
                </Row>
            </Section>

            <Section title={t("newConnectors")}>
                <Row>
                    <Label>
                        <Spline className="size-3.5" />
                    </Label>
                    <Segmented<EdgeKind>
                        value={doc.settings.defaultEdgeKind}
                        onChange={value => setSettings(store, { defaultEdgeKind: value })}
                        options={routeOptions(t)}
                    />
                </Row>
            </Section>
        </>
    );
}

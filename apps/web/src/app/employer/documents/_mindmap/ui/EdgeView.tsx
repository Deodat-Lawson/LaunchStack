"use client";

import React, { memo, useMemo } from "react";

import { labelAnchor, renderPath, trimPolyline, type RoutedEdge } from "../model/routing";
import { fontFamilyCss, layoutText } from "../model/text";
import type { DiagramEdge } from "../model/types";
import { ArrowHead, arrowInset } from "./arrows";
import { dashArray } from "./ShapeView";

/**
 * One connector: the stroke, its arrowheads, and any labels riding on it.
 *
 * A wide transparent "hit" path is drawn underneath so a 1.5px line is still
 * comfortably clickable — the visible stroke stays thin.
 */

interface EdgeViewProps {
    edge: DiagramEdge;
    routed: RoutedEdge;
    selected: boolean;
    hovered: boolean;
    /** Hide labels while one of them is being edited in an overlay. */
    editingLabelIndex?: number;
}

export const HIT_WIDTH = 14;

export const EdgeView = memo(function EdgeView({
    edge,
    routed,
    selected,
    hovered,
    editingLabelIndex,
}: EdgeViewProps) {
    const { style } = edge;
    const dash = dashArray(style.strokeStyle, style.strokeWidth);

    // Pull the visible stroke back from each tip so a solid head does not have
    // the line showing through its point.
    const strokePath = useMemo(() => {
        const startInset = arrowInset(edge.startArrow, style.strokeWidth);
        const endInset = arrowInset(edge.endArrow, style.strokeWidth);
        if (startInset === 0 && endInset === 0) return routed.path;
        return renderPath(edge.kind, trimPolyline(routed.points, startInset, endInset));
    }, [edge.startArrow, edge.endArrow, edge.kind, style.strokeWidth, routed]);

    return (
        <g opacity={style.opacity}>
            {(selected || hovered) && (
                <path
                    d={routed.path}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={style.strokeWidth + (selected ? 6 : 4)}
                    strokeOpacity={selected ? 0.28 : 0.16}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            )}
            <path
                d={strokePath}
                fill="none"
                stroke={style.stroke}
                strokeWidth={style.strokeWidth}
                strokeDasharray={dash}
                strokeLinecap={style.strokeStyle === "dotted" ? "round" : "butt"}
                strokeLinejoin="round"
            />
            <ArrowHead
                at={routed.start}
                direction={routed.startNormal}
                kind={edge.startArrow}
                color={style.stroke}
                strokeWidth={style.strokeWidth}
            />
            <ArrowHead
                at={routed.end}
                direction={routed.endNormal}
                kind={edge.endArrow}
                color={style.stroke}
                strokeWidth={style.strokeWidth}
            />

            {edge.labels.map((label, i) =>
                label.text && i !== editingLabelIndex ? (
                    <EdgeLabel key={i} edge={edge} routed={routed} index={i} />
                ) : null
            )}
        </g>
    );
});

function EdgeLabel({
    edge,
    routed,
    index,
}: {
    edge: DiagramEdge;
    routed: RoutedEdge;
    index: number;
}) {
    const label = edge.labels[index];
    if (!label) return null;
    const at = labelAnchor(routed, label.t, label.offset);
    const laid = layoutText(label.text, edge.textStyle, 240);
    const padX = 6;
    const padY = 3;
    const w = laid.width + padX * 2;
    const h = laid.height + padY * 2;

    return (
        <g transform={`translate(${at.x - w / 2} ${at.y - h / 2})`}>
            <rect
                width={w}
                height={h}
                rx={4}
                fill="var(--panel)"
                stroke="var(--line)"
                strokeWidth={0.75}
            />
            <text
                x={w / 2}
                y={padY + laid.lineHeight * 0.78}
                textAnchor="middle"
                fill={edge.textStyle.color}
                fontSize={edge.textStyle.size}
                fontWeight={edge.textStyle.bold ? 700 : 400}
                fontStyle={edge.textStyle.italic ? "italic" : undefined}
                fontFamily={fontFamilyCss(edge.textStyle.family)}
                style={{ pointerEvents: "none", userSelect: "none", whiteSpace: "pre" }}
            >
                {laid.lines.map((line, i) => (
                    <tspan key={i} x={w / 2} dy={i === 0 ? 0 : laid.lineHeight}>
                        {line.text === "" ? " " : line.text}
                    </tspan>
                ))}
            </text>
        </g>
    );
}

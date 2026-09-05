"use client";

import React, { memo, useMemo } from "react";

import { shapeGeometry, shapeTextBox } from "../model/shapes";
import { firstBaseline, fontFamilyCss, layoutText } from "../model/text";
import type { DiagramNode, StrokeStyle, TextStyle } from "../model/types";

/**
 * One shape, rendered into the canvas coordinate system.
 *
 * Pure and memoised on the node object: the store hands out new node objects
 * only for shapes that actually changed, so dragging one box does not re-render
 * the other four hundred.
 */

export const SHADOW_FILTER_ID = "lswmm-shadow";
export const SHADOW_FILTER = `url(#${SHADOW_FILTER_ID})`;

export function dashArray(style: StrokeStyle, strokeWidth: number): string | undefined {
    const w = Math.max(strokeWidth, 0.5);
    if (style === "dashed") return `${w * 4} ${w * 3}`;
    if (style === "dotted") return `0.01 ${w * 2.4}`;
    return undefined;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

interface ShapeTextProps {
    text: string;
    style: TextStyle;
    box: { x: number; y: number; w: number; h: number };
}

export const ShapeText = memo(function ShapeText({ text, style, box }: ShapeTextProps) {
    const laid = useMemo(() => layoutText(text, style, box.w), [text, style, box.w]);
    if (!text) return null;

    const anchor = style.align === "left" ? "start" : style.align === "right" ? "end" : "middle";
    const x =
        style.align === "left"
            ? box.x
            : style.align === "right"
              ? box.x + box.w
              : box.x + box.w / 2;
    const baseline = box.y + firstBaseline(box.h, laid, style.valign);

    const decorations: string[] = [];
    if (style.underline) decorations.push("underline");
    if (style.strike) decorations.push("line-through");

    return (
        <text
            x={x}
            y={baseline}
            textAnchor={anchor}
            fill={style.color}
            fontSize={style.size}
            fontWeight={style.bold ? 700 : 400}
            fontStyle={style.italic ? "italic" : undefined}
            fontFamily={fontFamilyCss(style.family)}
            textDecoration={decorations.length ? decorations.join(" ") : undefined}
            style={{ pointerEvents: "none", userSelect: "none", whiteSpace: "pre" }}
        >
            {laid.lines.map((lineText, i) => (
                <tspan key={i} x={x} dy={i === 0 ? 0 : laid.lineHeight}>
                    {lineText.text === "" ? " " : lineText.text}
                </tspan>
            ))}
        </text>
    );
});

// ---------------------------------------------------------------------------
// Shape body
// ---------------------------------------------------------------------------

interface ShapeViewProps {
    node: DiagramNode;
    /** Suppress the label — the text editor overlay is showing instead. */
    hideText?: boolean;
    /** Extra opacity multiplier, used to ghost a shape while it is dragged. */
    ghost?: boolean;
}

export const ShapeView = memo(function ShapeView({ node, hideText, ghost }: ShapeViewProps) {
    const { style, textStyle } = node;
    const geometry = useMemo(
        () => shapeGeometry(node.shape, node.w, node.h, style.radius),
        [node.shape, node.w, node.h, style.radius]
    );
    const textBox = useMemo(
        () => shapeTextBox(node.shape, node.w, node.h),
        [node.shape, node.w, node.h]
    );

    const dash = dashArray(style.strokeStyle, style.strokeWidth);
    const stroke = style.stroke === "none" ? "none" : style.stroke;
    const strokeWidth = style.stroke === "none" ? 0 : style.strokeWidth;
    const fill = style.fill === "none" ? "none" : style.fill;

    const common = {
        fill,
        stroke,
        strokeWidth,
        strokeDasharray: dash,
        strokeLinejoin: "round" as const,
        strokeLinecap: style.strokeStyle === "dotted" ? ("round" as const) : ("butt" as const),
    };

    const transform = node.rotation
        ? `translate(${node.x} ${node.y}) rotate(${node.rotation} ${node.w / 2} ${node.h / 2})`
        : `translate(${node.x} ${node.y})`;

    return (
        <g
            transform={transform}
            opacity={(ghost ? 0.45 : 1) * style.opacity}
            filter={style.shadow ? SHADOW_FILTER : undefined}
        >
            {geometry.backing?.map((d, i) => (
                <path key={`b${i}`} d={d} {...common} />
            ))}
            {geometry.path ? <path d={geometry.path} {...common} /> : null}

            {node.shape === "image" ? <ImageBody node={node} /> : null}
            {node.shape === "ink" ? <InkBody node={node} /> : null}

            {geometry.decorations?.map((d, i) => (
                <path
                    key={`d${i}`}
                    d={d}
                    fill="none"
                    stroke={stroke === "none" ? style.fill : stroke}
                    strokeWidth={strokeWidth || 1.2}
                    strokeDasharray={dash}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />
            ))}

            {hideText ? null : <ShapeText text={node.text} style={textStyle} box={textBox} />}

            {node.data?.badge ? (
                <text
                    x={node.w - 8}
                    y={16}
                    textAnchor="end"
                    fontSize={15}
                    style={{ pointerEvents: "none", userSelect: "none" }}
                >
                    {node.data.badge}
                </text>
            ) : null}

            {typeof node.data?.progress === "number" ? (
                <ProgressBar w={node.w} h={node.h} value={node.data.progress} tint={style.stroke} />
            ) : null}
        </g>
    );
});

// ---------------------------------------------------------------------------
// Special bodies
// ---------------------------------------------------------------------------

function ImageBody({ node }: { node: DiagramNode }) {
    const src = node.data?.src;
    if (!src) {
        return (
            <>
                <rect
                    width={node.w}
                    height={node.h}
                    rx={node.style.radius}
                    fill="var(--line-2)"
                    stroke="var(--line)"
                    strokeDasharray="6 4"
                />
                <text
                    x={node.w / 2}
                    y={node.h / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={12}
                    fill="var(--ink-3)"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                >
                    Drop an image
                </text>
            </>
        );
    }
    const clipId = `clip-${node.id}`;
    return (
        <>
            <defs>
                <clipPath id={clipId}>
                    <rect width={node.w} height={node.h} rx={node.style.radius} />
                </clipPath>
            </defs>
            {/* SVG <image>, not an HTML <img> — no next/image involved. */}
            <image
                href={src}
                width={node.w}
                height={node.h}
                preserveAspectRatio="xMidYMid slice"
                clipPath={`url(#${clipId})`}
            />
        </>
    );
}

function InkBody({ node }: { node: DiagramNode }) {
    const points = node.data?.points;
    if (!points || points.length < 2) return null;
    // Ink is stored in unit space so a stroke scales with its bounding box.
    const d = points
        .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * node.w} ${p.y * node.h}`)
        .join(" ");
    return (
        <path
            d={d}
            fill="none"
            stroke={node.style.stroke}
            strokeWidth={node.style.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    );
}

function ProgressBar({ w, h, value, tint }: { w: number; h: number; value: number; tint: string }) {
    const pct = Math.min(Math.max(value, 0), 1);
    const barY = h - 10;
    return (
        <g style={{ pointerEvents: "none" }}>
            <rect x={8} y={barY} width={w - 16} height={4} rx={2} fill="var(--line)" />
            <rect
                x={8}
                y={barY}
                width={(w - 16) * pct}
                height={4}
                rx={2}
                fill={tint === "none" ? "var(--accent)" : tint}
            />
        </g>
    );
}

// ---------------------------------------------------------------------------
// Shared defs
// ---------------------------------------------------------------------------

/** Mounted once by the canvas; referenced by every shadowed shape. */
export function CanvasDefs() {
    return (
        <defs>
            <filter id={SHADOW_FILTER_ID} x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow
                    dx="0"
                    dy="2"
                    stdDeviation="3"
                    floodColor="oklch(0.22 0.04 280)"
                    floodOpacity="0.18"
                />
            </filter>
        </defs>
    );
}

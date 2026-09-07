"use client";

import React, { memo } from "react";

import { nodeBounds, nodesBounds, portPoint } from "../model/geometry";
import { handlePosition, rotatedCursor, rotationGripPosition } from "../model/resize";
import { shapePorts } from "../model/shapes";
import type { ResizeHandle } from "../model/resize";
import type { DiagramNode, Rect } from "../model/types";

/**
 * Selection chrome: the outline, the eight resize grips, the rotation grip and
 * the connection ports.
 *
 * Everything here is sized in *screen* pixels via the `zoom` prop — a handle
 * must stay 8px whether the canvas is at 20% or 400%, so each dimension is
 * divided by the zoom before it enters world space.
 */

const HANDLE_ORDER: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

interface SelectionOverlayProps {
    nodes: DiagramNode[];
    zoom: number;
    /** Hide the grips while a gesture is running. */
    interacting: boolean;
}

export const SelectionOverlay = memo(function SelectionOverlay({
    nodes,
    zoom,
    interacting,
}: SelectionOverlayProps) {
    if (nodes.length === 0) return null;
    const px = (v: number) => v / zoom;
    const single = nodes.length === 1 ? nodes[0] : null;
    const bounds = nodesBounds(nodes);
    if (!bounds) return null;

    return (
        <g style={{ pointerEvents: "none" }}>
            {/* Per-node outlines, so a multi-selection shows what is in it. */}
            {nodes.length > 1 &&
                nodes.map(nd => {
                    const b = nodeBounds(nd);
                    return (
                        <rect
                            key={nd.id}
                            x={b.x}
                            y={b.y}
                            width={b.w}
                            height={b.h}
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth={px(1)}
                            strokeOpacity={0.5}
                            strokeDasharray={`${px(3)} ${px(3)}`}
                        />
                    );
                })}

            {single ? (
                <SingleNodeChrome node={single} zoom={zoom} interacting={interacting} />
            ) : (
                <GroupChrome bounds={bounds} zoom={zoom} interacting={interacting} />
            )}
        </g>
    );
});

function SingleNodeChrome({
    node,
    zoom,
    interacting,
}: {
    node: DiagramNode;
    zoom: number;
    interacting: boolean;
}) {
    const px = (v: number) => v / zoom;
    const transform = node.rotation
        ? `translate(${node.x} ${node.y}) rotate(${node.rotation} ${node.w / 2} ${node.h / 2})`
        : `translate(${node.x} ${node.y})`;

    return (
        <>
            <g transform={transform}>
                <rect
                    x={0}
                    y={0}
                    width={node.w}
                    height={node.h}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={px(1.5)}
                />
            </g>
            {!interacting && !node.locked && (
                <>
                    {/* The outline's own sides resize too, Lucid-style — a
                        thin invisible band straddling each edge, so grabbing
                        anywhere along a side works, not just the mid grip. */}
                    <g transform={transform} style={{ pointerEvents: "all" }}>
                        {(["n", "e", "s", "w"] as const).map(side => {
                            const band = px(6);
                            const horizontal = side === "n" || side === "s";
                            return (
                                <rect
                                    key={side}
                                    data-handle={side}
                                    x={horizontal ? 0 : side === "w" ? -band : node.w - band}
                                    y={horizontal ? (side === "n" ? -band : node.h - band) : 0}
                                    width={horizontal ? node.w : band * 2}
                                    height={horizontal ? band * 2 : node.h}
                                    fill="transparent"
                                    style={{ cursor: rotatedCursor(side, node.rotation) }}
                                />
                            );
                        })}
                    </g>
                    {HANDLE_ORDER.map(handle => {
                        const p = handlePosition(node, handle);
                        return (
                            <Grip
                                key={handle}
                                x={p.x}
                                y={p.y}
                                size={px(8)}
                                handle={handle}
                                cursor={rotatedCursor(handle, node.rotation)}
                            />
                        );
                    })}
                    <RotationGrip node={node} zoom={zoom} />
                </>
            )}
        </>
    );
}

function GroupChrome({
    bounds,
    zoom,
    interacting,
}: {
    bounds: Rect;
    zoom: number;
    interacting: boolean;
}) {
    const px = (v: number) => v / zoom;
    const anchors: Record<ResizeHandle, { x: number; y: number }> = {
        nw: { x: bounds.x, y: bounds.y },
        n: { x: bounds.x + bounds.w / 2, y: bounds.y },
        ne: { x: bounds.x + bounds.w, y: bounds.y },
        e: { x: bounds.x + bounds.w, y: bounds.y + bounds.h / 2 },
        se: { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
        s: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h },
        sw: { x: bounds.x, y: bounds.y + bounds.h },
        w: { x: bounds.x, y: bounds.y + bounds.h / 2 },
    };

    return (
        <>
            <rect
                x={bounds.x}
                y={bounds.y}
                width={bounds.w}
                height={bounds.h}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={px(1.5)}
            />
            {!interacting &&
                HANDLE_ORDER.map(handle => (
                    <Grip
                        key={handle}
                        x={anchors[handle].x}
                        y={anchors[handle].y}
                        size={px(8)}
                        handle={handle}
                        cursor={rotatedCursor(handle, 0)}
                    />
                ))}
        </>
    );
}

function Grip({
    x,
    y,
    size,
    handle,
    cursor,
}: {
    x: number;
    y: number;
    size: number;
    handle: ResizeHandle;
    cursor: string;
}) {
    return (
        <rect
            data-handle={handle}
            x={x - size / 2}
            y={y - size / 2}
            width={size}
            height={size}
            rx={size * 0.25}
            fill="var(--panel)"
            stroke="var(--accent)"
            strokeWidth={size * 0.16}
            style={{ pointerEvents: "all", cursor }}
        />
    );
}

function RotationGrip({ node, zoom }: { node: DiagramNode; zoom: number }) {
    const px = (v: number) => v / zoom;
    const p = rotationGripPosition(node, px(24));
    return (
        <g data-handle="rotate" style={{ pointerEvents: "all", cursor: "grab" }}>
            <circle cx={p.x} cy={p.y} r={px(11)} fill="transparent" />
            <circle
                cx={p.x}
                cy={p.y}
                r={px(5)}
                fill="var(--panel)"
                stroke="var(--accent)"
                strokeWidth={px(1.5)}
            />
        </g>
    );
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

interface PortsProps {
    node: DiagramNode;
    zoom: number;
    /** Highlight the port the pointer is over during a connect drag. */
    activePort?: string | null;
}

/**
 * Connection points. Shown on hover and on the selected shape — dragging one
 * out is how every connector gets made, so they have to be visible without a
 * mode switch.
 */
export const NodePorts = memo(function NodePorts({ node, zoom, activePort }: PortsProps) {
    const px = (v: number) => v / zoom;
    const ports = shapePorts(node.shape);
    if (node.locked) return null;

    return (
        <g>
            {ports.map(port => {
                const p = portPoint(node, port);
                const active = activePort === port;
                return (
                    <g key={port} data-node-id={node.id} data-port={port}>
                        <circle
                            cx={p.x}
                            cy={p.y}
                            r={px(9)}
                            fill="transparent"
                            style={{ pointerEvents: "all", cursor: "crosshair" }}
                        />
                        <circle
                            cx={p.x}
                            cy={p.y}
                            r={px(active ? 6 : 4)}
                            fill={active ? "var(--accent)" : "var(--panel)"}
                            stroke="var(--accent)"
                            strokeWidth={px(1.5)}
                            style={{ pointerEvents: "none" }}
                        />
                    </g>
                );
            })}
        </g>
    );
});

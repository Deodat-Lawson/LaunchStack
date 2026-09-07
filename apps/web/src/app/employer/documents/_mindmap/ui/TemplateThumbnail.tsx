"use client";

import React, { useMemo } from "react";

import { useAppThemeMode } from "./useAppThemeMode";

import { nodeLookup, pageBounds } from "../model/doc";
import { expandRect } from "../model/geometry";
import { routeEdge } from "../model/routing";
import { shapeGeometry } from "../model/shapes";
import { buildTemplate } from "../model/templates";
import type { ThemeMode } from "../model/palette";
import type { MindmapDoc } from "../model/types";

/**
 * Preview card for a template.
 *
 * Renders the real document through the real geometry — a template that would
 * look wrong on the canvas looks wrong here too, which is the point. Labels are
 * dropped: at 200px wide they are illegible, and drawing them would triple the
 * node count on a page showing fifteen of these.
 *
 * Built documents are cached because `buildTemplate` allocates a whole document
 * and the gallery renders every card on mount.
 */

const cache = new Map<string, MindmapDoc>();

function templateDoc(templateId: string, mode: ThemeMode): MindmapDoc {
    const key = `${templateId}:${mode}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const doc = buildTemplate(templateId, undefined, mode);
    cache.set(key, doc);
    return doc;
}

export function TemplateThumbnail({ templateId }: { templateId: string }) {
    // Previews are built in the same mode a new document would be seeded in,
    // so the card is not a light board that turns dark the moment you open it.
    const mode = useAppThemeMode();
    const { viewBox, nodes, edges, background } = useMemo(() => {
        const doc = templateDoc(templateId, mode);
        const page = doc.pages[0];
        if (!page) {
            return { viewBox: "0 0 100 75", nodes: [], edges: [], background: "var(--panel-2)" };
        }
        const bounds = pageBounds(page);
        const box = bounds ? expandRect(bounds, Math.max(bounds.w, bounds.h) * 0.06) : null;
        const lookup = nodeLookup(page);
        return {
            viewBox: box ? `${box.x} ${box.y} ${box.w} ${box.h}` : "0 0 100 75",
            nodes: page.nodes,
            edges: page.edges.map(e => routeEdge(e, lookup)),
            background: page.background.color,
        };
    }, [templateId, mode]);

    if (nodes.length === 0) {
        return (
            <div className="flex size-full items-center justify-center">
                <div className="border-line size-10 rounded-lg border-2 border-dashed" />
            </div>
        );
    }

    return (
        <svg
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            className="size-full"
            style={{ background }}
            aria-hidden
        >
            {edges.map((routed, i) => (
                <path
                    key={i}
                    d={routed.path}
                    fill="none"
                    stroke="oklch(0.62 0.02 280)"
                    strokeWidth={2}
                    strokeLinecap="round"
                />
            ))}
            {nodes.map(node => {
                const geometry = shapeGeometry(node.shape, node.w, node.h, node.style.radius);
                const transform = node.rotation
                    ? `translate(${node.x} ${node.y}) rotate(${node.rotation} ${node.w / 2} ${node.h / 2})`
                    : `translate(${node.x} ${node.y})`;
                const stroke = node.style.stroke === "none" ? "none" : node.style.stroke;
                return (
                    <g key={node.id} transform={transform} opacity={node.style.opacity}>
                        {geometry.backing?.map((d, i) => (
                            <path
                                key={`b${i}`}
                                d={d}
                                fill={node.style.fill}
                                stroke={stroke}
                                strokeWidth={node.style.strokeWidth}
                            />
                        ))}
                        {geometry.path ? (
                            <path
                                d={geometry.path}
                                fill={node.style.fill}
                                stroke={stroke}
                                strokeWidth={node.style.strokeWidth}
                                strokeLinejoin="round"
                            />
                        ) : null}
                        {geometry.decorations?.map((d, i) => (
                            <path
                                key={`d${i}`}
                                d={d}
                                fill="none"
                                stroke={stroke === "none" ? node.style.fill : stroke}
                                strokeWidth={node.style.strokeWidth || 1}
                                strokeLinecap="round"
                            />
                        ))}
                    </g>
                );
            })}
        </svg>
    );
}

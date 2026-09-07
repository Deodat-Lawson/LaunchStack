"use client";

import React from "react";
import { RefreshCw, Users } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

import { peerColor, peerInitials, type PresencePeer } from "./usePresence";

/**
 * Collaborator awareness: remote cursors on the canvas, avatars in the top bar,
 * and a nudge when someone else has saved a newer version.
 *
 * Cursors are drawn inside the canvas transform so they sit at the right world
 * position at any zoom, but their chrome is divided by zoom so the pointer stays
 * a constant size on screen.
 */

export function RemoteCursors({
    peers,
    pageId,
    zoom,
}: {
    peers: PresencePeer[];
    pageId: string;
    zoom: number;
}) {
    const px = (v: number) => v / zoom;
    const visible = peers.filter(p => p.cursor && p.pageId === pageId);
    if (visible.length === 0) return null;

    return (
        <g data-export="omit" style={{ pointerEvents: "none" }}>
            {visible.map(peer => {
                const colour = peerColor(peer.userId);
                const { x, y } = peer.cursor!;
                const label = peer.displayName ?? "Someone";
                return (
                    <g key={peer.userId} transform={`translate(${x} ${y})`}>
                        <path
                            d={`M 0 0 L 0 ${px(16)} L ${px(4.4)} ${px(12)} L ${px(7.4)} ${px(18)} L ${px(10.4)} ${px(16.6)} L ${px(7.4)} ${px(10.8)} L ${px(12)} ${px(10.4)} Z`}
                            fill={colour}
                            stroke="var(--panel)"
                            strokeWidth={px(1)}
                            strokeLinejoin="round"
                        />
                        <rect
                            x={px(12)}
                            y={px(16)}
                            width={px(Math.min(label.length * 6.2 + 12, 160))}
                            height={px(18)}
                            rx={px(4)}
                            fill={colour}
                        />
                        <text
                            x={px(18)}
                            y={px(28.5)}
                            fontSize={px(11)}
                            fill="var(--panel)"
                            style={{ userSelect: "none" }}
                        >
                            {label.slice(0, 24)}
                        </text>
                    </g>
                );
            })}
        </g>
    );
}

/**
 * Halo around shapes another person has selected, so you can see what someone
 * is about to change before you both grab it.
 */
export function RemoteSelections({
    peers,
    pageId,
    bounds,
    zoom,
}: {
    peers: PresencePeer[];
    pageId: string;
    /** Node id → its world bounds, supplied by the canvas. */
    bounds: (nodeId: string) => { x: number; y: number; w: number; h: number } | null;
    zoom: number;
}) {
    const px = (v: number) => v / zoom;
    return (
        <g data-export="omit" style={{ pointerEvents: "none" }}>
            {peers
                .filter(p => p.pageId === pageId)
                .flatMap(peer =>
                    peer.selection.map(nodeId => {
                        const box = bounds(nodeId);
                        if (!box) return null;
                        return (
                            <rect
                                key={`${peer.userId}:${nodeId}`}
                                x={box.x - px(3)}
                                y={box.y - px(3)}
                                width={box.w + px(6)}
                                height={box.h + px(6)}
                                rx={px(4)}
                                fill="none"
                                stroke={peerColor(peer.userId)}
                                strokeWidth={px(1.5)}
                                strokeDasharray={`${px(5)} ${px(4)}`}
                            />
                        );
                    })
                )}
        </g>
    );
}

/** Stacked avatars for everyone currently in the document. */
export function PresenceAvatars({ peers }: { peers: PresencePeer[] }) {
    if (peers.length === 0) return null;
    const shown = peers.slice(0, 4);
    const extra = peers.length - shown.length;

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div className="flex items-center -space-x-1.5" aria-label="People in this mindmap">
                    {shown.map(peer => (
                        <span
                            key={peer.userId}
                            className="border-panel flex size-6 items-center justify-center rounded-full border-2 text-[10px] font-semibold text-[color:var(--accent-fg)]"
                            style={{ background: peerColor(peer.userId) }}
                        >
                            {peerInitials(peer)}
                        </span>
                    ))}
                    {extra > 0 && (
                        <span className="border-panel bg-line-2 text-ink-2 flex size-6 items-center justify-center rounded-full border-2 text-[10px] font-semibold">
                            +{extra}
                        </span>
                    )}
                </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
                <span className="flex items-center gap-1.5">
                    <Users className="size-3" />
                    {peers.map(p => p.displayName ?? "Someone").join(", ")}
                </span>
            </TooltipContent>
        </Tooltip>
    );
}

/**
 * Shown when the server has a newer revision than this tab loaded. Reloading is
 * offered rather than applied: the local document may hold unsaved work, and
 * throwing that away silently is exactly the failure this banner exists to
 * prevent.
 */
export function StaleBanner({ staleBy, dirty }: { staleBy: number; dirty: boolean }) {
    if (staleBy <= 0) return null;
    return (
        <div className="border-warn bg-panel text-ink-2 shadow-2 absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1.5 text-[12px]">
            <RefreshCw className="text-warn size-3.5" />
            {dirty
                ? "Someone else saved a newer version — your changes will conflict."
                : "A newer version is available."}
            <button
                type="button"
                onClick={() => window.location.reload()}
                className="bg-brand text-brand-fg rounded-full px-2 py-0.5 text-[11px] font-medium"
            >
                Reload
            </button>
        </div>
    );
}

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconBolt } from "./icons";
import { usePermissions } from "~/lib/use-permissions";
import { STUDIO_GROUPS } from "./types";

export interface StudioMenuProps {
    /** Fires with the feature id when the user picks one; if omitted, falls back to direct navigation. */
    onPickFeature?: (featureId: string) => void;
    /** Fires when the main Studio button is clicked; if omitted, opens the menu. */
    onOpenStudio?: () => void;
    /** Where the menu opens: under the button, or beside it (collapsed sidebar). */
    side?: "bottom" | "right";
}

/** The menu's natural width, and the gap it keeps from the window's edge. */
const MENU_WIDTH_PX = 460;
const MENU_EDGE_PX = 8;
const MENU_GAP_PX = 6;

/**
 * Studio's launcher — a bolt in the sidebar's header, or in the collapsed
 * strip — with its hover mega-menu. It used to be a labelled button at the
 * end of the first column's tab strip, which put an app-wide control
 * wherever that column happened to end. **`onOpenStudio`** opens Studio
 * itself; individual tiles call **`onPickFeature`** to jump straight to that
 * app (parent wires `expandFeature` vs `openFeature` accordingly).
 *
 * Gated entries (`feature.requires`) are absent until permissions have loaded
 * and say yes — a viewer never sees a Settings tile flash and vanish.
 */
export function StudioMenu({ onPickFeature, onOpenStudio, side = "bottom" }: StudioMenuProps) {
    const router = useRouter();
    const { can } = usePermissions();
    const [menuOpen, setMenuOpen] = useState(false);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    /**
     * Where the menu sits, relative to its button, worked out from where the
     * button is on screen when it opens. A pill hangs the menu from its right
     * edge; the sidebar's icon drops it from its left edge, or opens it to the
     * side when the sidebar is collapsed. Whichever, it is capped to the
     * window and kept on it — hung from a narrow column's edge at 460px it
     * used to leave the screen.
     */
    const [placement, setPlacement] = useState({ width: MENU_WIDTH_PX, left: 0, top: 0 });

    const open = () => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        const rect = buttonRef.current?.getBoundingClientRect();
        const width = Math.min(MENU_WIDTH_PX, window.innerWidth - MENU_EDGE_PX * 2);
        if (rect) {
            // Beside the strip it sits in, not beside the bolt: from the
            // bolt, the menu covered the strip's own edge.
            const edge =
                buttonRef.current?.closest("[data-menu-anchor]")?.getBoundingClientRect().right ??
                rect.right;
            const wanted = side === "right" ? edge + MENU_GAP_PX : rect.left;
            const onScreen = Math.min(
                Math.max(wanted, MENU_EDGE_PX),
                window.innerWidth - width - MENU_EDGE_PX
            );
            setPlacement({
                width,
                left: onScreen - rect.left,
                top: side === "right" ? 0 : rect.height + MENU_GAP_PX,
            });
        }
        setMenuOpen(true);
    };
    const close = () => {
        closeTimer.current = setTimeout(() => setMenuOpen(false), 120);
    };

    const groups = STUDIO_GROUPS.map(g => ({
        ...g,
        features: g.features.filter(f => can(f.requires)),
    })).filter(g => g.features.length > 0);

    const pickFeature = (featureId: string, href?: string) => {
        setMenuOpen(false);
        if (onPickFeature) {
            onPickFeature(featureId);
        } else if (href) {
            router.push(href);
        }
    };

    return (
        <div style={{ position: "relative" }} onMouseEnter={open} onMouseLeave={close}>
            <button
                ref={buttonRef}
                type="button"
                onClick={() => {
                    if (onOpenStudio) {
                        setMenuOpen(false);
                        onOpenStudio();
                    } else {
                        setMenuOpen(v => !v);
                    }
                }}
                title="Studio"
                aria-label="Open Studio"
                data-testid="studio-launcher"
                className="text-brand hover:bg-line-2 data-[open=true]:bg-line-2 flex size-[26px] items-center justify-center rounded-md transition-colors"
                data-open={menuOpen ? "true" : undefined}
            >
                <IconBolt size={14} />
            </button>

            {menuOpen && (
                <div
                    style={{
                        position: "absolute",
                        top: placement.top,
                        left: placement.left,
                        zIndex: 60,
                        width: placement.width,
                        padding: 10,
                        background: "var(--panel)",
                        border: "1px solid var(--line)",
                        borderRadius: 12,
                        boxShadow: "0 18px 42px var(--scrim-shadow), 0 2px 6px rgba(0,0,0,0.06)",
                        animation: "lsw-fadeIn 120ms ease-out",
                    }}
                >
                    <div
                        style={{
                            padding: "6px 8px 10px",
                            display: "flex",
                            alignItems: "baseline",
                            gap: 8,
                        }}
                    >
                        <div style={{ fontSize: 13, fontWeight: 600 }}>Studio</div>
                        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                            Tools and management for your workspace
                        </div>
                    </div>

                    {groups.map(group => (
                        <div key={group.id} style={{ marginTop: 4 }}>
                            <div
                                className="mono"
                                style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    letterSpacing: "0.1em",
                                    color: "var(--ink-3)",
                                    textTransform: "uppercase",
                                    padding: "6px 10px 4px",
                                }}
                            >
                                {group.label}
                            </div>
                            <div
                                style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}
                            >
                                {group.features.map(f => {
                                    const Icon = f.Icon;
                                    return (
                                        <button
                                            key={f.id}
                                            type="button"
                                            onClick={() => pickFeature(f.id, f.href)}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                                padding: "7px 10px",
                                                minHeight: 40,
                                                borderRadius: 8,
                                                textAlign: "left",
                                                transition: "background 120ms",
                                            }}
                                            onMouseEnter={e => {
                                                e.currentTarget.style.background = "var(--line-2)";
                                            }}
                                            onMouseLeave={e => {
                                                e.currentTarget.style.background = "transparent";
                                            }}
                                        >
                                            <div
                                                style={{
                                                    width: 26,
                                                    height: 26,
                                                    borderRadius: 6,
                                                    flexShrink: 0,
                                                    background: "var(--accent-soft)",
                                                    color: "var(--accent-ink)",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                }}
                                            >
                                                <Icon size={12} />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 6,
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            fontSize: 12.5,
                                                            fontWeight: 500,
                                                            color: "var(--ink)",
                                                            whiteSpace: "nowrap",
                                                            overflow: "hidden",
                                                            textOverflow: "ellipsis",
                                                        }}
                                                    >
                                                        {f.label}
                                                    </div>
                                                    {f.comingSoon && (
                                                        <span
                                                            className="mono"
                                                            style={{
                                                                fontSize: 9,
                                                                fontWeight: 600,
                                                                letterSpacing: "0.04em",
                                                                color: "var(--ink-3)",
                                                                padding: "1px 5px",
                                                                borderRadius: 4,
                                                                background: "var(--line-2)",
                                                            }}
                                                        >
                                                            SOON
                                                        </span>
                                                    )}
                                                </div>
                                                <div
                                                    style={{
                                                        fontSize: 11,
                                                        color: "var(--ink-3)",
                                                        lineHeight: 1.35,
                                                        marginTop: 1,
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        display: "-webkit-box",
                                                        WebkitLineClamp: 2,
                                                        WebkitBoxOrient: "vertical",
                                                    }}
                                                >
                                                    {f.desc}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

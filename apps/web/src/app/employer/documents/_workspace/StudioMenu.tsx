"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "~/components/ui/hover-card";
import { usePermissions } from "~/lib/use-permissions";

import { STUDIO_GROUPS } from "./types";

export interface StudioMenuProps {
    /** Fires with the feature id when the user picks one; if omitted, falls back to direct navigation. */
    onPickFeature?: (featureId: string) => void;
    /** Fires when the Studio button is clicked. */
    onOpenStudio?: () => void;
    /** Where the menu opens: under the button, or beside it (collapsed sidebar). */
    side?: "bottom" | "right";
}

/**
 * Studio's launcher — a bolt in the sidebar's header, or in the collapsed
 * strip — with its hover mega-menu. **`onOpenStudio`** opens Studio itself;
 * individual tiles call **`onPickFeature`** to jump straight to that app
 * (parent wires `expandFeature` vs `openFeature` accordingly).
 *
 * The menu is a portalled hover card, not a box positioned inside the
 * launcher. Once the launcher moved into the sidebar, a child box was
 * clipped by the sidebar's own `overflow: hidden` — everything past its
 * 280px edge was simply cut off — and a measurement of its rectangle still
 * reported it as on screen. Rendered at the document root, nothing the
 * launcher sits in can clip or cover it, and the card keeps itself inside
 * the window.
 *
 * Gated entries (`feature.requires`) are absent until permissions have loaded
 * and say yes — a viewer never sees a Settings tile flash and vanish.
 */
export function StudioMenu({ onPickFeature, onOpenStudio, side = "bottom" }: StudioMenuProps) {
    const router = useRouter();
    const { can } = usePermissions();
    const [open, setOpen] = useState(false);

    const groups = STUDIO_GROUPS.map(g => ({
        ...g,
        features: g.features.filter(f => can(f.requires)),
    })).filter(g => g.features.length > 0);

    const pickFeature = (featureId: string, href?: string) => {
        setOpen(false);
        if (onPickFeature) {
            onPickFeature(featureId);
        } else if (href) {
            router.push(href);
        }
    };

    return (
        <HoverCard open={open} onOpenChange={setOpen} openDelay={80} closeDelay={120}>
            <HoverCardTrigger asChild>
                <button
                    type="button"
                    onClick={() => {
                        setOpen(false);
                        onOpenStudio?.();
                    }}
                    title="Studio"
                    aria-label="Open Studio"
                    data-testid="studio-launcher"
                    className="text-brand hover:bg-line-2 data-[state=open]:bg-line-2 focus-visible:ring-brand/50 flex size-[26px] items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-[3px]"
                >
                    <Zap className="size-3.5" />
                </button>
            </HoverCardTrigger>
            <HoverCardContent
                side={side}
                align="start"
                // Beside the collapsed strip, clear the strip's edge rather
                // than the bolt's, which sits ~10px inside it.
                sideOffset={side === "right" ? 16 : 6}
                collisionPadding={8}
                data-testid="studio-menu"
                className="max-h-[var(--radix-hover-card-content-available-height)] w-[460px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl p-2.5"
            >
                <div className="flex items-baseline gap-2 px-2 pb-2.5 pt-1.5">
                    <div className="text-ink text-[13px] font-semibold">Studio</div>
                    <div className="text-ink-3 text-[11px]">
                        Tools and management for your workspace
                    </div>
                </div>

                {groups.map(group => (
                    <div key={group.id} className="mt-1">
                        <div className="mono text-ink-3 px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.1em]">
                            {group.label}
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                            {group.features.map(f => {
                                const Icon = f.Icon;
                                return (
                                    <button
                                        key={f.id}
                                        type="button"
                                        onClick={() => pickFeature(f.id, f.href)}
                                        className="hover:bg-line-2 focus-visible:bg-line-2 flex min-h-10 items-center gap-2 rounded-lg px-2.5 py-[7px] text-left outline-none transition-colors"
                                    >
                                        <div className="bg-brand-soft text-brand-ink flex size-[26px] shrink-0 items-center justify-center rounded-md">
                                            <Icon size={12} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5">
                                                <div className="text-ink truncate text-[12.5px] font-medium">
                                                    {f.label}
                                                </div>
                                                {f.comingSoon && (
                                                    <span className="mono bg-line-2 text-ink-3 rounded px-[5px] py-px text-[9px] font-semibold tracking-[0.04em]">
                                                        SOON
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-ink-3 mt-px line-clamp-2 text-[11px] leading-[1.35]">
                                                {f.desc}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </HoverCardContent>
        </HoverCard>
    );
}

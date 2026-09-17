"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { usePermissions } from "~/lib/use-permissions";
import { STUDIO_GROUPS } from "./types";

export interface StudioMenuProps {
    /** Fires with the feature id when the user picks one; if omitted, falls back to Studio routing. */
    onPickFeature?: (featureId: string) => void;
    /** Fires when the main Studio button is clicked; if omitted, toggles the app menu. */
    onOpenStudio?: () => void;
}

/**
 * Studio button and compact app menu for the AskPanel / expanded tool topbar.
 *
 * Gated entries (`feature.requires`) are absent until permissions have loaded
 * and say yes — a viewer never sees a Settings tile flash and vanish.
 */
export function StudioMenu({ onPickFeature, onOpenStudio }: StudioMenuProps) {
    const router = useRouter();
    const { can } = usePermissions();
    const [menuOpen, setMenuOpen] = useState(false);
    const closeTimer = useRef<number>(0);

    const open = () => {
        window.clearTimeout(closeTimer.current);
        setMenuOpen(true);
    };

    const close = () => {
        closeTimer.current = window.setTimeout(() => setMenuOpen(false), 120);
    };

    useEffect(
        () => () => {
            window.clearTimeout(closeTimer.current);
        },
        []
    );

    useEffect(() => {
        if (!menuOpen) return;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                setMenuOpen(false);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [menuOpen]);

    const groups = STUDIO_GROUPS.map(group => ({
        ...group,
        features: group.features.filter(feature => can(feature.requires)),
    })).filter(group => group.features.length > 0);

    const pickFeature = (featureId: string) => {
        setMenuOpen(false);
        if (onPickFeature) {
            onPickFeature(featureId);
        } else {
            router.push(`/employer/documents?feature=${encodeURIComponent(featureId)}`);
        }
    };

    return (
        <div className="relative" onMouseEnter={open} onMouseLeave={close}>
            <Button
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => {
                    if (onOpenStudio) {
                        setMenuOpen(false);
                        onOpenStudio();
                    } else {
                        setMenuOpen(value => !value);
                    }
                }}
                title="Open Studio"
                className="bg-brand text-brand-fg hover:bg-brand/90 h-8 gap-1.5 rounded-lg px-3 text-xs font-semibold shadow-sm"
            >
                <Sparkles className="size-3.5" aria-hidden />
                Studio
                <ChevronDown className="size-3 opacity-80" aria-hidden />
            </Button>

            {menuOpen && (
                <div
                    role="menu"
                    aria-label="Studio apps"
                    className="border-line bg-panel absolute right-0 top-[calc(100%+6px)] z-[60] w-[460px] max-w-[calc(100vw-2rem)] rounded-xl border p-2 shadow-xl"
                >
                    <div className="px-2 pb-2 pt-1">
                        <div className="text-ink text-sm font-semibold">Studio</div>
                        <div className="text-ink-3 mt-0.5 text-[11px]">
                            Tools and management for your workspace
                        </div>
                    </div>

                    {groups.map(group => (
                        <section key={group.id} className="mt-1">
                            <h2 className="text-ink-3 px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                                {group.label}
                            </h2>
                            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                                {group.features.map(feature => {
                                    const Icon = feature.Icon;

                                    return (
                                        <Button
                                            key={feature.id}
                                            type="button"
                                            role="menuitem"
                                            variant="ghost"
                                            onClick={() => pickFeature(feature.id)}
                                            className="hover:bg-panel-2 h-auto min-h-10 w-full items-start justify-start gap-2 whitespace-normal rounded-lg px-2.5 py-2 text-left font-normal"
                                        >
                                            <span
                                                aria-hidden
                                                className="bg-brand-soft text-brand mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md"
                                            >
                                                <Icon size={14} />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="text-ink flex items-center gap-1.5 text-xs font-medium leading-snug">
                                                    <span className="truncate">
                                                        {feature.label}
                                                    </span>
                                                    {feature.comingSoon && (
                                                        <span
                                                            title="Coming soon"
                                                            className="bg-panel-2 text-ink-3 shrink-0 rounded px-1 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-wide"
                                                        >
                                                            SOON
                                                        </span>
                                                    )}
                                                </span>
                                                <span className="text-ink-3 mt-0.5 line-clamp-2 text-[11px] leading-snug">
                                                    {feature.desc}
                                                </span>
                                            </span>
                                        </Button>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>
            )}
        </div>
    );
}

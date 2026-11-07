"use client";

import React from "react";
import { useFormatter } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";

interface StatsCardProps {
    label: string;
    value: number | string;
    /** One neutral glyph beside the label; the number carries the weight. */
    icon?: LucideIcon;
    /** A short qualifier under the value ("All time"). */
    caption?: string;
    /** Smaller value and padding, for a tile row inside a sheet. */
    compact?: boolean;
    className?: string;
}

/** A KPI tile: hairline panel, quiet label, the value large in ink. */
export function StatsCard({
    label,
    value,
    icon: Icon,
    caption,
    compact = false,
    className,
}: StatsCardProps) {
    const format = useFormatter();

    return (
        <Card
            className={cn(
                "border-line min-w-0 justify-between gap-2 rounded-[14px] shadow-none",
                compact ? "p-3" : "px-4 py-3.5",
                className
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <span className="text-ink-3 min-w-0 text-[13px] leading-snug">{label}</span>
                {/* On a phone-narrow pane the label needs the room more than the glyph. */}
                {Icon && (
                    <Icon aria-hidden className="text-ink-3 @max-xs:hidden mt-px size-4 shrink-0" />
                )}
            </div>
            <div>
                <div
                    className={cn(
                        "text-ink font-semibold tabular-nums leading-none tracking-tight",
                        compact ? "text-2xl" : "@max-sm:text-2xl text-[28px]"
                    )}
                >
                    {typeof value === "number" ? format.number(value) : value}
                </div>
                {caption && <div className="text-ink-3 mt-1.5 text-xs">{caption}</div>}
            </div>
        </Card>
    );
}

"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { cn } from "~/lib/utils";

/**
 * One published value of a Program (a sector, a region) as a way into the list:
 * how many Programs share it, opening them filtered by it.
 */
export function FacetLink({
    href,
    label,
    count,
    marker,
    active = false,
    onActive,
}: {
    href: string;
    label: string;
    count: number;
    marker?: ReactNode;
    active?: boolean;
    /** Hovered or focused (true), or left (false): lets a map point at the same value. */
    onActive?: (active: boolean) => void;
}) {
    const t = useTranslations("accelerators.overview");
    const format = useFormatter();
    const name = t("showPrograms", { label, count });
    return (
        <ToolLink
            href={href}
            aria-label={name}
            title={name}
            onPointerEnter={onActive && (() => onActive(true))}
            onPointerLeave={onActive && (() => onActive(false))}
            onFocus={onActive && (() => onActive(true))}
            onBlur={onActive && (() => onActive(false))}
            className={cn(
                "border-line text-ink-2 hover:border-brand/40 hover:bg-brand-soft hover:text-brand-ink focus-visible:ring-brand/50 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs outline-none transition-colors focus-visible:ring-2",
                active && "border-brand/40 bg-brand-soft text-brand-ink"
            )}
        >
            {marker}
            <span className="truncate">{label}</span>
            <span className="text-ink-3 tabular-nums">{format.number(count)}</span>
        </ToolLink>
    );
}

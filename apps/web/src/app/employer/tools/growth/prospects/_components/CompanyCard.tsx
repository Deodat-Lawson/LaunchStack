"use client";

import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { FitMeter } from "~/components/tools/FitMeter";
import { Checkbox } from "~/components/ui/checkbox";
import { useCopyText } from "~/lib/tools/copyText";
import { cn } from "~/lib/utils";

import type { CompanyRow } from "../api";
import { FoundViaChips } from "./SourceChip";
import { StagePill } from "./StagePill";

function initials(name: string): string {
    const parts = name.split(/[\s.&_-]+/).filter(Boolean);
    return (
        parts
            .slice(0, 2)
            .map(w => w[0]!.toUpperCase())
            .join("") || "•"
    );
}

/**
 * The picture a company's own site declares: its share image, else its
 * icon on a quiet panel, else its initials. A picture that fails to load
 * falls back the same way, so a card never shows a broken image.
 */
export function CompanyPicture({ c, className }: { c: CompanyRow; className?: string }) {
    const [imageFailed, setImageFailed] = useState(false);
    const [iconFailed, setIconFailed] = useState(false);
    const image = !imageFailed ? c.imageUrl : null;
    const icon = !iconFailed ? c.iconUrl : null;
    return (
        <div className={cn("bg-brand-soft relative overflow-hidden", className)}>
            {image ? (
                // eslint-disable-next-line @next/next/no-img-element -- the company's own share image, any host; next/image would need every host allow-listed
                <img
                    src={image}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="size-full object-cover"
                    onError={() => setImageFailed(true)}
                />
            ) : (
                <div className="grid size-full place-items-center">
                    {icon ? (
                        // eslint-disable-next-line @next/next/no-img-element -- the company's own icon, any host
                        <img
                            src={icon}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="bg-panel shadow-1 size-12 rounded-lg object-contain p-1.5"
                            onError={() => setIconFailed(true)}
                        />
                    ) : (
                        <span className="text-brand-ink text-2xl font-semibold tracking-tight">
                            {initials(c.name)}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

/** One company as a card: picture, who it is, why it fits, and where the deal stands. */
export function CompanyCard({
    c,
    index,
    focused,
    checked,
    onToggle,
    onOpen,
    href,
}: {
    c: CompanyRow;
    index: number;
    focused: boolean;
    checked: boolean;
    onToggle: () => void;
    onOpen: () => void;
    href: string;
}) {
    const t = useTranslations("growth.prospects");
    const word = useCopyText();
    return (
        <article
            data-row-index={index}
            className={cn(
                "group border-line bg-panel hover:shadow-1 flex cursor-pointer flex-col overflow-hidden rounded-xl border transition-shadow",
                checked && "ring-brand ring-2",
                focused && "outline-brand outline outline-2 outline-offset-2",
                c.excluded && "opacity-60"
            )}
            onClick={e => {
                if ((e.target as HTMLElement).closest("[data-no-open]")) return;
                onOpen();
            }}
        >
            <div className="relative">
                <CompanyPicture c={c} className="aspect-[16/9] w-full" />
                <div
                    className={cn(
                        "bg-panel/90 absolute top-2 left-2 rounded-md p-1 transition-opacity",
                        checked ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    )}
                    data-no-open
                >
                    <Checkbox
                        aria-label={t("common.select", { name: c.name })}
                        checked={checked}
                        onCheckedChange={onToggle}
                    />
                </div>
                {c.isNew && (
                    <span className="bg-panel text-brand-ink shadow-1 absolute top-2 right-2 rounded px-1.5 py-px text-[10.5px] font-medium">
                        {t("companies.newBadge")}
                    </span>
                )}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-3.5">
                <div className="min-w-0">
                    <ToolLink
                        href={href}
                        className="text-ink block truncate text-[14px] font-semibold hover:underline"
                        onClick={e => e.stopPropagation()}
                    >
                        {c.name}
                    </ToolLink>
                    <p className="text-ink-3 mt-0.5 truncate text-xs">
                        {[c.hq, c.domain].filter(Boolean).join(" · ")}
                    </p>
                </div>
                <p className="text-ink-2 line-clamp-3 text-[13px] leading-snug">
                    {word(c.whyCopy, c.why)}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
                    <FitMeter value={c.fit} threshold={c.fitThreshold} />
                    <StagePill stage={c.stage} staleDays={c.staleDays} />
                    <span className="text-ink-3 ml-auto inline-flex items-center gap-1 text-xs tabular-nums">
                        <Users className="size-3.5" aria-hidden />
                        {c.people}
                    </span>
                </div>
                <div data-no-open>
                    <FoundViaChips items={c.foundVia} max={2} />
                </div>
            </div>
        </article>
    );
}

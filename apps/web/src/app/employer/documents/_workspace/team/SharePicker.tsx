"use client";

/**
 * "Share something…" on a person's page: pick one of your folders, files or
 * chats, and the Share dialog opens on it — add the person there. The list is
 * what you manage (`/api/workspace/team/shareable`); the dialog re-checks.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Search, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Spinner } from "~/components/ui/spinner";
import { displayFolderPath } from "~/lib/folders/path";

import { useErrorText } from "../settings/people/ui";
import { teamApi, type ShareableItem } from "./api";
import { itemTarget } from "./format";
import type { TeamTarget } from "./types";
import { ItemIcon } from "./ui";

const SECTIONS: readonly ShareableItem["type"][] = ["folder", "document", "chat"];

export function SharePicker({
    personName,
    onShare,
}: {
    personName: string;
    onShare: (target: TeamTarget & { name: string }) => void;
}) {
    const t = useTranslations("team.sharePicker");
    const errorText = useErrorText();
    const tc = useTranslations("common");
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<ShareableItem[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState("");

    useEffect(() => {
        if (!open) return;
        setFilter("");
        let cancelled = false;
        setError(null);
        teamApi
            .shareable()
            .then(res => {
                if (!cancelled) setItems(res.items);
            })
            .catch(err => {
                if (!cancelled) setError(errorText(err, t("loadError")));
            });
        return () => {
            cancelled = true;
        };
    }, [open, t, errorText]);

    const needle = filter.trim().toLowerCase();
    const shown = useMemo(
        () =>
            (items ?? []).filter(
                i =>
                    !needle ||
                    i.name.toLowerCase().includes(needle) ||
                    (i.path ?? "").toLowerCase().includes(needle)
            ),
        [items, needle]
    );

    const pick = (item: ShareableItem) => {
        setOpen(false);
        const name = item.type === "folder" ? displayFolderPath(item.name) : item.name;
        onShare({ ...itemTarget(item), name });
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    size="sm"
                    className="h-8 w-full text-[12.5px]"
                    aria-label={t("label", { name: personName })}
                    data-testid="team-share-something"
                >
                    <Share2 className="size-3.5" />
                    {t("button")}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={6} className="w-[300px] p-0">
                <div className="border-line border-b p-2">
                    <div className="relative">
                        <Search className="text-ink-3 pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
                        <Input
                            value={filter}
                            onChange={e => setFilter(e.target.value)}
                            placeholder={t("findPlaceholder")}
                            aria-label={t("findLabel")}
                            className="h-8 pl-8 text-[13px]"
                            autoFocus
                        />
                    </div>
                </div>
                <div className="max-h-[320px] overflow-y-auto py-1">
                    {error ? (
                        <p role="alert" className="text-danger m-0 px-3 py-3 text-[12.5px]">
                            {error}
                        </p>
                    ) : items === null ? (
                        <div className="text-ink-3 flex items-center gap-2 px-3 py-3 text-[12.5px]">
                            <Spinner className="size-3.5" /> {tc("status.loading")}
                        </div>
                    ) : shown.length === 0 ? (
                        <p className="text-ink-3 m-0 px-3 py-3 text-[12.5px] leading-relaxed">
                            {items.length === 0
                                ? t("emptyNone")
                                : t("noMatch", { query: filter.trim() })}
                        </p>
                    ) : (
                        SECTIONS.map(type => {
                            const list = shown.filter(i => i.type === type);
                            if (list.length === 0) return null;
                            const label = t(`sections.${type}`);
                            return (
                                <div key={type} role="group" aria-label={label}>
                                    <div className="text-ink-3 px-3 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.04em]">
                                        {label}
                                    </div>
                                    {list.map(item => (
                                        <button
                                            key={`${item.type}:${item.id}`}
                                            type="button"
                                            onClick={() => pick(item)}
                                            className="hover:bg-panel-2 focus-visible:bg-panel-2 text-ink flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] outline-none"
                                        >
                                            <ItemIcon type={item.type} />
                                            <span className="min-w-0 flex-1 truncate">
                                                {item.type === "folder"
                                                    ? displayFolderPath(item.name)
                                                    : item.name}
                                            </span>
                                            {item.type === "document" && item.path && (
                                                <span className="text-ink-3 max-w-[40%] shrink-0 truncate text-[11px]">
                                                    {displayFolderPath(item.path)}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            );
                        })
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

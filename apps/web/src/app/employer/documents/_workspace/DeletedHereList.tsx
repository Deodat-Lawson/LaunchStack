"use client";

/**
 * Synced files someone deleted in LaunchStack — the Drive card in Settings
 * and each Notion workspace card. Drive and Notion would otherwise import a
 * deleted file again on the next sync, so a delete is remembered and the
 * sync leaves the file out (see server/services/connectors/deleted-items).
 * This list is the way back: "Sync again" forgets the delete and starts a
 * sync, which imports the file like any new one.
 *
 * A file is named only to whoever deleted it (it may have sat in a folder
 * no one else could open); the rest are counted. "Sync all again" covers
 * those too. Nothing renders when nothing was deleted.
 */

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileX, RotateCcw } from "lucide-react";

import { Button } from "~/components/ui/button";

export interface DeletedHereSummary {
    readonly items: readonly {
        readonly sourceId: string;
        readonly title: string;
        readonly deletedAt: string;
    }[];
    readonly others: number;
}

export type DeletedHereProvider = "google-drive" | "notion";

export function DeletedHereList({
    className = "mb-4",
    provider,
    connectionId,
    deleted,
    disabled = false,
    onRestored,
}: {
    /** Spacing around the block; it renders nothing when nothing was deleted. */
    readonly className?: string;
    readonly provider: DeletedHereProvider;
    readonly connectionId: string | undefined;
    readonly deleted: DeletedHereSummary | null | undefined;
    /** While a sync is starting or running: a restore would wait for the next one. */
    readonly disabled?: boolean;
    /** Called after a restore went through; the panel starts the sync and refreshes. */
    readonly onRestored: () => Promise<unknown> | void;
}) {
    const t = useTranslations("sources.deletedHere");
    const [busy, setBusy] = useState<string | null>(null);

    const items = deleted?.items ?? [];
    const others = deleted?.others ?? 0;
    const total = items.length + others;
    if (!connectionId || total === 0) return null;

    const restore = async (key: string, body: Record<string, unknown>) => {
        setBusy(key);
        try {
            const res = await fetch(`/api/connectors/${provider}/deleted`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ connectionId, ...body }),
            });
            if (!res.ok) {
                toast.error(t("restoreFailed"));
                return;
            }
            const payload = (await res.json().catch(() => null)) as {
                data?: { restored?: number };
            } | null;
            toast.success(t("restored", { provider, count: payload?.data?.restored ?? 0 }));
            await onRestored();
        } catch {
            toast.error(t("restoreFailed"));
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className={className} aria-label={t("title", { count: total })}>
            <div className="text-ink-3 mb-1 text-xs font-semibold">
                {t("title", { count: total })}
            </div>
            <p className="text-ink-3 mb-2 text-[12px] leading-relaxed">{t("body", { provider })}</p>
            <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                {items.map(item => (
                    <li
                        key={item.sourceId}
                        className="border-line flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px]"
                    >
                        <FileX className="text-ink-3 size-4 shrink-0" aria-hidden />
                        <span className="text-ink min-w-0 flex-1 truncate">{item.title}</span>
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={disabled || busy !== null}
                            onClick={() =>
                                void restore(item.sourceId, { sourceIds: [item.sourceId] })
                            }
                            aria-label={t("syncAgainAria", { name: item.title })}
                        >
                            <RotateCcw aria-hidden />
                            {t("syncAgain")}
                        </Button>
                    </li>
                ))}
                {others > 0 ? (
                    <li className="text-ink-3 px-1 text-[12.5px]">
                        {items.length > 0
                            ? t("othersMore", { count: others })
                            : t("othersOnly", { count: others })}
                    </li>
                ) : null}
            </ul>
            {others > 0 || items.length > 1 ? (
                <Button
                    className="mt-2"
                    size="sm"
                    variant="outline"
                    disabled={disabled || busy !== null}
                    onClick={() => void restore("all", { all: true })}
                >
                    <RotateCcw aria-hidden />
                    {t("syncAllAgain", { count: total })}
                </Button>
            ) : null}
        </section>
    );
}

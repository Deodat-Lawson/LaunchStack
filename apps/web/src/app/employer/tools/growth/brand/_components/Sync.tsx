"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { useErrorText } from "~/lib/tools/errorText";
import { useGrowthFormat } from "../../_lib/format";

import { brandApi, type SyncResult } from "../api";

/**
 * "Sync now": read numbers and comments from the networks, then let the
 * screen reload. Channels that could not be read come back as one line
 * each and stay on screen until the next sync, next to the button.
 */
export function useBrandSync(onSynced: (result: SyncResult) => void | Promise<void>) {
    const t = useTranslations("growth.brand.sync");
    const errorText = useErrorText();
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [failure, setFailure] = useState<string | null>(null);
    const run = useCallback(async () => {
        setBusy(true);
        setFailure(null);
        try {
            const result = await brandApi.sync();
            setErrors(result.errors);
            await onSynced(result);
            if (result.errors.length > 0)
                toast.warning(
                    t("partial", {
                        posts: result.posts,
                        comments: result.comments,
                        channels: result.errors.length,
                    })
                );
            else toast.success(t("done", { posts: result.posts, comments: result.comments }));
        } catch (e) {
            setFailure(errorText(e, t("unreachable")));
        } finally {
            setBusy(false);
        }
    }, [onSynced, t, errorText]);
    return { run, busy, errors, failure };
}

export function SyncButton({
    onClick,
    busy,
    variant = "default",
    disabled = false,
}: {
    onClick: () => void;
    busy: boolean;
    variant?: "default" | "outline";
    /** The member's role cannot ask the networks (Viewer, Guest). */
    disabled?: boolean;
}) {
    const t = useTranslations("growth.brand.sync");
    return (
        <Button
            size="sm"
            variant={variant}
            onClick={onClick}
            disabled={busy || disabled}
            title={disabled ? t("readOnly") : undefined}
        >
            <RefreshCw
                className={cn("size-3.5", busy && "animate-spin motion-reduce:animate-none")}
                aria-hidden
            />
            {busy ? t("syncing") : t("syncNow")}
        </Button>
    );
}

/** "Updated 5 min ago", kept current while the screen is open. */
export function SyncedAt({ at }: { at: string | null | undefined }) {
    const t = useTranslations("growth.brand.sync");
    const { relativeTime } = useGrowthFormat();
    const [, tick] = useState(0);
    useEffect(() => {
        const id = window.setInterval(() => tick(n => n + 1), 30_000);
        return () => window.clearInterval(id);
    }, []);
    if (!at) return <>{t("never")}</>;
    return <>{t("updated", { ago: relativeTime(at) })}</>;
}

/** The lines a sync could not read, and a sync that failed outright. */
export function SyncProblems({
    errors,
    failure,
    className,
}: {
    errors: string[];
    failure: string | null;
    className?: string;
}) {
    const t = useTranslations("growth.brand.sync");
    if (!failure && errors.length === 0) return null;
    return (
        <div role="alert" className={cn("text-danger flex flex-col gap-1 text-[13px]", className)}>
            {failure && <p>{t("failed", { error: failure })}</p>}
            {errors.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                    {errors.map(line => (
                        <li key={line}>{line}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}

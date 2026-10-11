"use client";

import { useCallback, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { cn } from "~/lib/utils";

/**
 * Pieces shared by the stand-in viewer pages: the warning strip, a polling
 * snapshot hook, relative times and a stored-image tile.
 */

export function StandInBanner({ network }: { network: string }) {
    return (
        <div
            role="note"
            className="border-warn/40 bg-warn-soft text-warn flex items-center justify-center gap-2 border-b px-4 py-1.5 text-xs font-medium"
        >
            <TriangleAlert className="size-3.5" aria-hidden />
            Development stand-in — not {network}. Nothing here leaves this machine.
        </div>
    );
}

/**
 * The world as the stand-in's `_standin/state` route reports it, refreshed
 * every two seconds so scheduled comments appear as they "arrive".
 */
export function useStandInState<T>(base: string, initial: T) {
    const [state, setState] = useState<T>(initial);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch(`${base}/_standin/state`, { cache: "no-store" });
            if (res.ok) setState((await res.json()) as T);
        } catch {
            // The dev server restarting; the next tick retries.
        }
    }, [base]);

    useEffect(() => {
        const timer = window.setInterval(() => void refresh(), 2000);
        return () => window.clearInterval(timer);
    }, [refresh]);

    const act = useCallback(
        async (label: string, body: Record<string, unknown>) => {
            setBusy(label);
            setError(null);
            try {
                const res = await fetch(`${base}/_standin/action`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(body),
                });
                if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
                setState((await res.json()) as T);
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setBusy(null);
            }
        },
        [base]
    );

    return { state, busy, error, act };
}

/** "3m ago" / "in 18s", relative to the snapshot's own clock so SSR and hydration agree. */
export function relativeTime(at: number, now: number): string {
    const diff = Math.round((at - now) / 1000);
    const abs = Math.abs(diff);
    const text =
        abs < 60
            ? `${abs}s`
            : abs < 3600
              ? `${Math.floor(abs / 60)}m`
              : abs < 86_400
                ? `${Math.floor(abs / 3600)}h`
                : `${Math.floor(abs / 86_400)}d`;
    if (abs < 2) return "just now";
    return diff > 0 ? `in ${text}` : `${text} ago`;
}

export function Ago({ at, now, className }: { at: number; now: number; className?: string }) {
    return (
        <time
            dateTime={new Date(at).toISOString()}
            title={new Date(at).toISOString()}
            className={cn("text-ink-3 tabular-nums", className)}
        >
            {relativeTime(at, now)}
        </time>
    );
}

export function Monogram({
    src,
    name,
    className,
}: {
    src: string | null;
    name: string;
    className?: string;
}) {
    const initials = name
        .split(/\s+/)
        .map(part => part[0] ?? "")
        .join("")
        .slice(0, 2)
        .toUpperCase();
    return (
        <Avatar className={className}>
            {src ? <AvatarImage src={src} alt="" /> : null}
            <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
    );
}

/** An image the stand-in stored, served back from its own route. */
export function StoredImage({ src, alt }: { src: string; alt: string | null }) {
    return (
        <figure className="border-line bg-panel-2 overflow-hidden rounded-lg border">
            {/* eslint-disable-next-line @next/next/no-img-element -- bytes served by the stand-in's own route, any size or type */}
            <img src={src} alt={alt ?? ""} className="max-h-72 w-full object-contain" />
            {alt ? (
                <figcaption className="text-ink-3 border-line border-t px-2 py-1 text-xs">
                    Alt: {alt}
                </figcaption>
            ) : null}
        </figure>
    );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="flex flex-col">
            <span className="text-ink text-sm font-semibold tabular-nums">{value}</span>
            <span className="text-ink-3 text-[11px]">{label}</span>
        </div>
    );
}

export function CallLog({
    calls,
    now,
}: {
    calls: { at: number; method: string; path: string; status: number }[];
    now: number;
}) {
    if (calls.length === 0) {
        return <p className="text-ink-3 text-sm">No API calls yet.</p>;
    }
    return (
        <ol className="divide-line divide-y text-xs">
            {calls.map((c, i) => (
                <li key={`${c.at}-${i}`} className="flex items-baseline gap-2 py-1.5">
                    <span
                        className={cn(
                            "w-8 shrink-0 font-mono tabular-nums",
                            c.status >= 400 ? "text-danger" : "text-success"
                        )}
                    >
                        {c.status}
                    </span>
                    <span className="text-ink-2 w-12 shrink-0 font-mono">{c.method}</span>
                    <span className="text-ink-2 min-w-0 flex-1 break-all font-mono">{c.path}</span>
                    <Ago at={c.at} now={now} className="shrink-0" />
                </li>
            ))}
        </ol>
    );
}

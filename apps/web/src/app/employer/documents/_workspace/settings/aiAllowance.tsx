"use client";

/**
 * A person's monthly AI allowance, for the three places that show one:
 * Settings › Usage (everyone's, for admins), Settings › Account (your own)
 * and the Ask composer (a notice as you near the limit, and a stop at it).
 *
 * The shapes are the server's own (~/server/ai-usage), imported as types
 * only: nothing server-side reaches the bundle, and a change to them is a
 * compile error here rather than a blank screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";

import { Progress } from "~/components/ui/progress";
import { cn } from "~/lib/utils";
import type { MemberAllowanceRow, MemberAllowances } from "~/server/ai-usage/members";
import type { AiAllowance, MemberLimitChoice } from "~/server/ai-usage/quota";
import type { AiAllowanceRefusal } from "~/server/ai-usage/refusal";

export type { AiAllowance, MemberAllowanceRow, MemberLimitChoice };

/** `GET /api/settings/usage/members`. */
export type MemberAllowancesResponse = MemberAllowances & { canEdit: boolean };

/** The `code` of a request refused at an AI limit (HTTP 429). */
export const AI_ALLOWANCE_REACHED: AiAllowanceRefusal["code"] = "ai_allowance_reached";

/** The workspace default's registry key; its row is drawn by hand in Settings › Usage. */
export const MEMBER_LIMIT_SETTING_KEY = "usage.memberMonthlyTokenLimit";

/** From this share of the binding limit the bar turns amber and the chat says so. */
export const ALLOWANCE_WARN_PERCENT = 80;

export type AllowanceTone = "normal" | "warn" | "danger";

export function allowanceTone(percent: number | null | undefined, blocked = false): AllowanceTone {
    const share = percent ?? 0;
    if (blocked || share >= 100) return "danger";
    if (share >= ALLOWANCE_WARN_PERCENT) return "warn";
    return "normal";
}

/** The limit that binds: its size, what counts against it, and where it comes from. */
export interface BindingLimit {
    limit: number;
    used: number;
    source: "default" | "member" | "server";
}

export function bindingLimit(allowance: AiAllowance): BindingLimit | null {
    if (allowance.binding === "server" && allowance.server) {
        return { ...allowance.server, source: "server" };
    }
    if (allowance.workspace.limit !== null) {
        return {
            limit: allowance.workspace.limit,
            used: allowance.used,
            source: allowance.workspace.source,
        };
    }
    return allowance.server ? { ...allowance.server, source: "server" } : null;
}

/** Enough of the shape to draw it; anything else is treated as no answer. */
export function isAiAllowance(value: unknown): value is AiAllowance {
    if (!value || typeof value !== "object") return false;
    const allowance = value as Partial<AiAllowance>;
    return (
        typeof allowance.used === "number" &&
        typeof allowance.resetsAt === "string" &&
        typeof allowance.blocked === "boolean" &&
        typeof allowance.workspace === "object" &&
        allowance.workspace !== null
    );
}

/** Why the allowance could not be read: the server's own sentence, or the HTTP status. */
export interface AllowanceProblem {
    status?: number;
    message?: string;
}

export interface AiAllowanceState {
    allowance: AiAllowance | null;
    loaded: boolean;
    problem: AllowanceProblem | null;
    refresh: () => Promise<void>;
}

/**
 * The caller's own allowance in the active workspace (`GET /api/ai-allowance`),
 * read on mount and again whenever `refresh` is called. A failed read keeps
 * the last answer: a notice that vanished on a network blip would read as
 * "you're fine now".
 */
export function useAiAllowance(): AiAllowanceState {
    const [state, setState] = useState<Omit<AiAllowanceState, "refresh">>({
        allowance: null,
        loaded: false,
        problem: null,
    });
    const mounted = useRef(true);
    const latest = useRef(0);

    const refresh = useCallback(async () => {
        const id = ++latest.current;
        const settle = (next: Partial<Omit<AiAllowanceState, "refresh">>) => {
            if (mounted.current && id === latest.current) {
                setState(previous => ({ ...previous, loaded: true, ...next }));
            }
        };
        try {
            const res = await fetch("/api/ai-allowance", {
                credentials: "same-origin",
                cache: "no-store",
            });
            const body = (await res.json().catch(() => null)) as {
                allowance?: unknown;
                error?: unknown;
            } | null;
            if (!res.ok) {
                settle({
                    problem: {
                        status: res.status,
                        message: typeof body?.error === "string" ? body.error : undefined,
                    },
                });
                return;
            }
            if (!isAiAllowance(body?.allowance)) {
                settle({ problem: {} });
                return;
            }
            settle({ allowance: body.allowance, problem: null });
        } catch {
            settle({ problem: {} });
        }
    }, []);

    useEffect(() => {
        mounted.current = true;
        void refresh();
        return () => {
            mounted.current = false;
        };
    }, [refresh]);

    return useMemo(() => ({ ...state, refresh }), [state, refresh]);
}

/** Numbers and dates for allowances, in the reader's locale. Reset dates are UTC calendar days. */
export function useAllowanceFormat() {
    const locale = useLocale();
    return useMemo(() => {
        const exact = new Intl.NumberFormat(locale);
        const short = new Intl.NumberFormat(locale, {
            notation: "compact",
            maximumFractionDigits: 1,
        });
        const day = new Intl.DateTimeFormat(locale, {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
        });
        const date = new Intl.DateTimeFormat(locale, {
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
        });
        const share = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
        const when = (iso: string) => {
            const at = new Date(iso);
            return Number.isNaN(at.getTime()) ? null : at;
        };
        return {
            /** 1,234,567 */
            tokens: (n: number) => exact.format(n),
            /** 1.2M */
            compact: (n: number) => short.format(n),
            /**
             * A whole percentage, rounded down so 99.6 never reads as 100 before
             * the limit; "<1" for some use that rounds to nothing, so 9K of 2M
             * doesn't read as unused.
             */
            percent: (value: number) =>
                value > 0 && value < 1 ? `<${exact.format(1)}` : exact.format(Math.floor(value)),
            /** "84%" with the locale's own sign and spacing; rounded like `percent`. */
            share: (value: number) =>
                value > 0 && value < 1
                    ? `<${share.format(0.01)}`
                    : share.format(Math.floor(value) / 100),
            /** Nov 1 */
            shortDate: (iso: string) => {
                const at = when(iso);
                return at ? day.format(at) : iso;
            },
            /** November 1, 2026 */
            longDate: (iso: string) => {
                const at = when(iso);
                return at ? date.format(at) : iso;
            },
        };
    }, [locale]);
}

const TONE_CLASSES: Record<AllowanceTone, string> = {
    normal: "bg-brand/15",
    warn: "bg-warn/20 [&>[data-slot=progress-indicator]]:bg-warn",
    danger: "bg-danger/15 [&>[data-slot=progress-indicator]]:bg-danger",
};

/** How far along the binding limit is: brand, amber from 80%, red at the limit. */
export function AllowanceBar({
    percent,
    blocked = false,
    label,
    className,
}: {
    percent: number;
    blocked?: boolean;
    label: string;
    className?: string;
}) {
    const tone = allowanceTone(percent, blocked);
    return (
        <Progress
            value={Math.min(100, Math.max(0, percent))}
            aria-label={label}
            data-tone={tone}
            className={cn("h-1.5", TONE_CLASSES[tone], className)}
        />
    );
}

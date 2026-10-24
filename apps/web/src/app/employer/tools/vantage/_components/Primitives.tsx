"use client";

import { Lock, Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "~/lib/utils";

import type { VantageEvidenceKind, VantageEvidenceRef } from "../api";

export type Tone = "neutral" | "quiet" | "brand" | "success" | "warn" | "danger";

const TONE_TEXT: Record<Tone, string> = {
    neutral: "text-ink-2",
    quiet: "text-ink-3",
    brand: "text-brand-ink",
    success: "text-success-ink",
    warn: "text-warn-ink",
    danger: "text-danger",
};

const TONE_DOT: Record<Tone, string> = {
    neutral: "bg-ink-3",
    quiet: "border-line border",
    brand: "bg-brand",
    success: "bg-success",
    warn: "bg-warn",
    danger: "bg-danger",
};

/** Status as a dot and a word; semantic colour only where the status is one. */
export function StatusWord({
    tone,
    children,
    className,
}: {
    tone: Tone;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <span
            className={cn("inline-flex items-center gap-1.5 text-xs", TONE_TEXT[tone], className)}
        >
            <span className={cn("size-[7px] shrink-0 rounded-full", TONE_DOT[tone])} />
            {children}
        </span>
    );
}

/**
 * Observed fact, founder interpretation, generator suggestion — the three
 * things an agenda mixes, kept apart with a word rather than a colour.
 */
export type Basis = "observed" | "interpretation" | "suggestion" | "unknown" | "conflict";

export function BasisTag({ basis, className }: { basis: Basis; className?: string }) {
    const t = useTranslations("vantage.primitives");
    return (
        <span
            className={cn(
                "border-line text-ink-3 inline-flex h-5 items-center rounded-md border px-1.5 text-[11px] font-medium",
                basis === "conflict" && "border-warn/40 text-warn-ink",
                basis === "unknown" && "border-dashed",
                className
            )}
        >
            {t(`basis.${basis}`)}
        </span>
    );
}

/** An outline chip naming a kind of evidence; never a colour. */
export function KindPill({ kind, className }: { kind: VantageEvidenceKind; className?: string }) {
    const t = useTranslations("vantage.evidenceKind");
    return (
        <span
            className={cn(
                "border-line text-ink-2 inline-flex h-5 items-center rounded-md border px-1.5 text-[11px]",
                className
            )}
        >
            {t(`label.${kind}`)}
        </span>
    );
}

/** The sources a fact rests on, as small chips: label and date. */
export function EvidenceChips({
    refs,
    unsupported,
    className,
}: {
    refs: VantageEvidenceRef[];
    unsupported?: boolean;
    className?: string;
}) {
    const t = useTranslations("vantage.primitives");
    if (refs.length === 0 && !unsupported) return null;
    return (
        <span className={cn("inline-flex flex-wrap gap-1", className)}>
            {refs.map(r => (
                <span
                    key={r.ref}
                    title={r.ref}
                    className="bg-panel-2 text-ink-2 inline-flex max-w-[280px] items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]"
                >
                    <span className="truncate">{r.label}</span>
                    {r.date && (
                        <span className="text-ink-3 shrink-0 whitespace-nowrap font-mono tabular-nums">
                            {r.date}
                        </span>
                    )}
                </span>
            ))}
            {unsupported && (
                <span className="border-warn/50 text-warn-ink inline-flex items-center rounded-md border border-dashed px-1.5 py-0.5 text-[11px]">
                    {t("noSource")}
                </span>
            )}
        </span>
    );
}

export function SharedMark({ shared, className }: { shared: boolean; className?: string }) {
    const t = useTranslations("vantage.primitives");
    return shared ? (
        <span className={cn("text-ink-3 inline-flex items-center gap-1 text-[11.5px]", className)}>
            <Users className="size-3" aria-hidden="true" /> {t("shared")}
        </span>
    ) : (
        <span className={cn("text-ink-3 inline-flex items-center gap-1 text-[11.5px]", className)}>
            <Lock className="size-3" aria-hidden="true" /> {t("private")}
        </span>
    );
}

/** A labelled control in a form: sentence-case label, optional hint under it. */
export function Field({
    label,
    hint,
    htmlFor,
    children,
    className,
}: {
    label: string;
    hint?: string;
    htmlFor?: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("flex flex-col gap-1.5", className)}>
            <label htmlFor={htmlFor} className="text-ink-2 text-[12.5px] font-medium">
                {label}
            </label>
            {children}
            {hint && <p className="text-ink-3 text-[11.5px]">{hint}</p>}
        </div>
    );
}

/** The one line a screen uses to say a request failed, next to the control. */
export function FormError({ message }: { message: string | null }) {
    if (!message) return null;
    return (
        <p role="alert" className="text-danger text-[12.5px]">
            {message}
        </p>
    );
}

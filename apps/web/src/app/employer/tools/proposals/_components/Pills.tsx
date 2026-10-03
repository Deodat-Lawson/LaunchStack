"use client";

import { ChevronDown } from "lucide-react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

import {
    APPLICATION_STATUS_LABEL,
    SECTION_STATUS_LABEL,
    type ApplicationStatus,
    type FindingSeverity,
    type SectionStatus,
} from "../api";
import { APPLICATION_TONE, SECTION_TONE, SEVERITY_LABEL, type Tone } from "../_lib/words";

const DOT: Record<Tone, string> = {
    quiet: "bg-ink-4",
    info: "bg-info",
    active: "bg-brand",
    won: "bg-success",
    lost: "bg-danger",
    warn: "bg-warn",
};

/** A dot and a word. Semantic colour only where the status is one. */
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
        <span className={cn("text-ink-2 inline-flex items-center gap-1.5 text-xs", className)}>
            <span className={cn("size-[7px] shrink-0 rounded-full", DOT[tone])} />
            <span className="whitespace-nowrap">{children}</span>
        </span>
    );
}

export function ApplicationStatusPill({
    status,
    className,
}: {
    status: ApplicationStatus;
    className?: string;
}) {
    return (
        <StatusWord tone={APPLICATION_TONE[status]} className={className}>
            {APPLICATION_STATUS_LABEL[status]}
        </StatusWord>
    );
}

export function SectionStatusPill({
    status,
    className,
}: {
    status: SectionStatus;
    className?: string;
}) {
    return (
        <StatusWord tone={SECTION_TONE[status]} className={className}>
            {SECTION_STATUS_LABEL[status]}
        </StatusWord>
    );
}

const SEVERITY_TONE: Record<FindingSeverity, Tone> = {
    blocker: "lost",
    warning: "warn",
    note: "quiet",
};

export function SeverityWord({ severity }: { severity: FindingSeverity }) {
    return <StatusWord tone={SEVERITY_TONE[severity]}>{SEVERITY_LABEL[severity]}</StatusWord>;
}

const STATUS_ORDER: ApplicationStatus[] = [
    "draft",
    "in_progress",
    "in_review",
    "ready",
    "submitted",
    "awarded",
    "declined",
    "withdrawn",
];

/** The status as a control: every status listed, the current one marked. */
export function ApplicationStatusMenu({
    status,
    onChange,
    disabled,
}: {
    status: ApplicationStatus;
    onChange: (status: ApplicationStatus) => void;
    disabled?: boolean;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={disabled}>
                <button
                    type="button"
                    className="border-line bg-panel hover:bg-panel-2 focus-visible:ring-brand/50 inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-[3px] disabled:opacity-60"
                    aria-label={`Status: ${APPLICATION_STATUS_LABEL[status]}. Change status`}
                >
                    <ApplicationStatusPill status={status} className="text-ink" />
                    <ChevronDown className="text-ink-3 size-3.5" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-ink-3 text-xs font-normal">
                    Move to
                </DropdownMenuLabel>
                {STATUS_ORDER.map(s => (
                    <DropdownMenuItem
                        key={s}
                        disabled={s === status}
                        onSelect={() => onChange(s)}
                        className="flex items-center justify-between"
                    >
                        <ApplicationStatusPill status={s} className="text-ink" />
                        {s === status && <span className="text-ink-3 text-[11px]">current</span>}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/**
 * Readiness as a short meter in ink, with the number beside it. The accent
 * appears only when the application is essentially ready, so a list shows
 * which rows can go out without turning every score into a traffic light.
 */
export function ReadinessMeter({
    value,
    label,
    className,
}: {
    value: number;
    label?: string;
    className?: string;
}) {
    const clamped = Math.max(0, Math.min(100, value));
    const ready = clamped >= 90;
    return (
        <span
            className={cn("inline-grid grid-cols-[44px_auto] items-center gap-2", className)}
            title={`${clamped}% ready`}
            aria-label={`${clamped} percent ready`}
        >
            <span className="bg-line relative block h-1.5 overflow-hidden rounded-full">
                <span
                    className={cn(
                        "absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 motion-reduce:transition-none",
                        ready ? "bg-brand" : "bg-ink-2"
                    )}
                    style={{ width: `${clamped}%` }}
                />
            </span>
            <span className="text-ink text-xs font-medium tabular-nums">
                {label ? `${label} ` : ""}
                {clamped}%
            </span>
        </span>
    );
}

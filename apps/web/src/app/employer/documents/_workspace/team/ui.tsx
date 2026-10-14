"use client";

/**
 * The few pieces every Team screen draws: the named back button, a filter
 * box, a bordered panel with its heading, a section heading, a one-sentence
 * empty state, loading rows, an avatar stack, and the icon for a folder, file
 * or chat.
 */

import React from "react";
import { ChevronLeft, FileText, Folder, MessageSquare, Search, Users } from "lucide-react";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

import type { Member } from "../settings/people/api";

/** "‹ Team" — a named, bordered button, never a bare strip. */
export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <Button
            variant="outline"
            size="sm"
            onClick={onClick}
            className="h-7 gap-1 pl-1.5 pr-2.5 text-[12px]"
            data-testid="team-back"
        >
            <ChevronLeft className="size-3.5" />
            {label}
        </Button>
    );
}

/** A screen's filter box: narrows the list below it, never searches the workspace. */
export function FilterInput({
    value,
    onChange,
    placeholder,
    className,
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    className?: string;
}) {
    return (
        <div className={cn("@max-md:w-full relative w-56", className)}>
            <Search className="text-ink-4 pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
            <Input
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                aria-label={placeholder}
                className="h-8 pl-8 text-[13px]"
                data-testid="team-filter"
            />
        </div>
    );
}

/** A bordered block of a screen with its heading — "Shared with you by Ada", "Activity". */
export function Panel({
    title,
    action,
    children,
    className,
    testId,
}: {
    title: React.ReactNode;
    action?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    testId?: string;
}) {
    return (
        <section
            className={cn("border-line bg-panel min-w-0 rounded-lg border pb-2", className)}
            data-testid={testId}
        >
            <SectionHeading action={action}>{title}</SectionHeading>
            {children}
        </section>
    );
}

export function SectionHeading({
    children,
    action,
}: {
    children: React.ReactNode;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex min-h-7 items-center justify-between gap-2 px-3.5 pb-1 pt-3">
            <h3 className="text-ink-3 m-0 truncate text-[11px] font-semibold uppercase tracking-[0.04em]">
                {children}
            </h3>
            {action}
        </div>
    );
}

/** One sentence where a list would be. `flush` drops the side padding for a full-width screen, so it lines up with the heading. */
export function EmptyLine({
    children,
    flush = false,
}: {
    children: React.ReactNode;
    flush?: boolean;
}) {
    return (
        <p
            className={cn(
                "text-ink-3 m-0 py-2 text-[12.5px] leading-relaxed",
                flush ? "px-0 text-[13px]" : "px-3.5"
            )}
        >
            {children}
        </p>
    );
}

export function ErrorLine({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <div className="flex items-center gap-2 px-3.5 py-2" role="alert">
            <span className="text-danger min-w-0 flex-1 text-[12.5px]">{message}</span>
            {onRetry && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[12px]"
                    onClick={onRetry}
                >
                    Retry
                </Button>
            )}
        </div>
    );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
    return (
        <div className="flex flex-col gap-1 px-3.5 py-2" aria-busy="true" aria-label="Loading">
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="flex h-10 items-center gap-2.5">
                    <Skeleton className="size-7 shrink-0 rounded-full" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <Skeleton className="h-2.5 w-2/3" />
                        <Skeleton className="h-2 w-1/3" />
                    </div>
                </div>
            ))}
        </div>
    );
}

const ITEM_ICONS = { folder: Folder, document: FileText, chat: MessageSquare, group: Users };

export function ItemIcon({
    type,
    className,
}: {
    type: keyof typeof ITEM_ICONS | (string & {});
    className?: string;
}) {
    const Icon = ITEM_ICONS[type as keyof typeof ITEM_ICONS] ?? FileText;
    return <Icon className={cn("text-ink-3 size-3.5 shrink-0", className)} aria-hidden />;
}

/** Up to `max` faces, overlapping, then "+N". */
export function AvatarStack({
    people,
    max = 3,
    className,
}: {
    people: readonly Pick<Member, "id" | "displayName" | "email" | "avatarUrl">[];
    max?: number;
    className?: string;
}) {
    const shown = people.slice(0, max);
    const rest = people.length - shown.length;
    if (people.length === 0) return null;
    return (
        <span className={cn("flex shrink-0 items-center", className)} aria-hidden>
            {shown.map((p, i) => (
                <ProfileAvatar
                    key={p.id}
                    name={p.displayName}
                    email={p.email}
                    src={p.avatarUrl}
                    className={cn("ring-panel size-5 ring-2", i > 0 && "-ml-1.5")}
                    fallbackClassName="text-[8px]"
                />
            ))}
            {rest > 0 && (
                <span className="bg-panel-2 text-ink-2 ring-panel -ml-1.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[9.5px] font-semibold ring-2">
                    +{rest}
                </span>
            )}
        </span>
    );
}

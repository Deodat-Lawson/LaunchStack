"use client";

/**
 * The few pieces every People tab shares: a tab intro, panels, empty and
 * error states, a copy button, the status pill, and one confirm dialog.
 * Everything else comes from the kit.
 */

import React, { useState, type ReactNode } from "react";
import { AlertCircle, Check, Copy } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

export function TabIntro({
    title,
    description,
    actions,
}: {
    title: string;
    description?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
                <h2 className="text-ink m-0 text-base font-bold tracking-[-0.01em]">{title}</h2>
                {description && (
                    <p className="text-ink-3 m-0 mt-1 max-w-[640px] text-[13px] leading-normal">
                        {description}
                    </p>
                )}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
    );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div
            className={cn("border-line bg-panel overflow-hidden rounded-[14px] border", className)}
        >
            {children}
        </div>
    );
}

export function EmptyState({
    title,
    body,
    action,
}: {
    title: string;
    body?: ReactNode;
    action?: ReactNode;
}) {
    return (
        <div className="text-ink-3 px-6 py-10 text-center text-[13px]">
            <div className="text-ink text-sm font-semibold">{title}</div>
            {body && <p className="m-0 mt-1 leading-relaxed">{body}</p>}
            {action && <div className="mt-3 flex justify-center">{action}</div>}
        </div>
    );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <div
            role="alert"
            className="bg-danger-soft text-danger flex items-start gap-2 rounded-[10px] px-3.5 py-2.5 text-[13px] leading-relaxed"
        >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">{message}</div>
            {onRetry && (
                <Button variant="ghost" size="sm" className="text-danger h-7" onClick={onRetry}>
                    Try again
                </Button>
            )}
        </div>
    );
}

export function LoadingNote({ label = "Loading…" }: { label?: string }) {
    return (
        <div role="status" aria-live="polite" className="text-ink-3 px-4 py-6 text-[13px]">
            {label}
        </div>
    );
}

export function StatusPill({ status }: { status: string }) {
    const variant = status === "active" ? "success" : status === "pending" ? "warn" : "secondary";
    const label =
        status === "active"
            ? "Active"
            : status === "pending"
              ? "Pending approval"
              : status === "suspended"
                ? "Suspended"
                : status;
    return <Badge variant={variant}>{label}</Badge>;
}

export function CopyButton({
    value,
    label = "Copy",
    copiedLabel = "Copied",
    variant = "outline",
    size = "sm",
    className,
}: {
    value: string;
    label?: string;
    copiedLabel?: string;
    variant?: "outline" | "ghost" | "secondary" | "default";
    size?: "sm" | "default" | "icon";
    className?: string;
}) {
    const [copied, setCopied] = useState(false);
    return (
        <Button
            type="button"
            variant={variant}
            size={size}
            className={className}
            onClick={() => {
                void navigator.clipboard
                    ?.writeText(value)
                    .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1600);
                    })
                    .catch(() => undefined);
            }}
        >
            {copied ? <Check /> : <Copy />}
            {size === "icon" ? (
                <span className="sr-only">{label}</span>
            ) : copied ? (
                copiedLabel
            ) : (
                label
            )}
        </Button>
    );
}

export interface ConfirmDialogProps {
    open: boolean;
    title: string;
    /** One or two sentences. Text only — it renders inside a paragraph. */
    body: string;
    confirmLabel: string;
    busyLabel?: string;
    danger?: boolean;
    busy?: boolean;
    error?: string | null;
    /** Extra controls between the body and the buttons — a picker, say. */
    children?: ReactNode;
    /** Disables Confirm, e.g. while a required choice is missing. */
    confirmDisabled?: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

export function ConfirmDialog({
    open,
    title,
    body,
    confirmLabel,
    busyLabel,
    danger = false,
    busy = false,
    error,
    children,
    confirmDisabled = false,
    onConfirm,
    onClose,
}: ConfirmDialogProps) {
    return (
        <Dialog
            open={open}
            onOpenChange={next => {
                if (!next && !busy) onClose();
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{body}</DialogDescription>
                </DialogHeader>
                {children}
                {error && <ErrorNote message={error} />}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        variant={danger ? "destructive" : "default"}
                        onClick={onConfirm}
                        disabled={busy || confirmDisabled}
                    >
                        {busy ? (busyLabel ?? `${confirmLabel}…`) : confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

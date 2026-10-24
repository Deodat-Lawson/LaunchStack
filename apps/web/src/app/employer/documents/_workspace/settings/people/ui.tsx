"use client";

/**
 * The few pieces every People tab shares: a tab intro, panels, empty and
 * error states, a copy button, the status pill, and one confirm dialog.
 * Everything else comes from the kit.
 */

import React, { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
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
import {
    translatePermission,
    translateRoleDescription,
    translateRoleLabel,
} from "~/lib/authz/i18n";
import type { BuiltinRole, Permission } from "~/lib/authz/permissions";
import { cn } from "~/lib/utils";

import { ApiError } from "./api";

/**
 * The sentence to show for a failure, in the reader's language: the
 * server's own `{ error }` as it came, else what `request` would have said.
 */
export function useErrorText(): (err: unknown, fallback?: string) => string {
    const t = useTranslations("settings.people.errors");
    const tc = useTranslations("common");
    return useCallback(
        (err: unknown, fallback?: string) => {
            if (err instanceof ApiError && err.generated) {
                if (err.generated === "signedOut") return tc("errors.signedOut");
                if (err.generated === "forbidden") return tc("errors.permission");
                return t("requestFailed", { status: err.status });
            }
            if (err instanceof Error && err.message) return err.message;
            return fallback ?? tc("errors.generic");
        },
        [t, tc]
    );
}

/**
 * What a permission allows, and what a built-in role is for, in the reader's
 * language (`team.permissions`, `team.roles` via lib/authz/i18n). Memoised
 * on the translator, so they are safe in dependency lists.
 */
export function usePermissionText(): (permission: Permission) => string {
    const t = useTranslations("team");
    return useCallback((permission: Permission) => translatePermission(t, permission), [t]);
}

export function useRoleDescription(): (role: BuiltinRole) => string {
    const t = useTranslations("team");
    return useCallback((role: BuiltinRole) => translateRoleDescription(t, role), [t]);
}

/**
 * A role's name for the screen: a built-in role labelled from its slug (the
 * server sends built-in names in English), a custom role's own name.
 */
export function useRoleLabel(): (slug: string, customName?: string | null) => string {
    const t = useTranslations("team");
    return useCallback(
        (slug: string, customName?: string | null) => translateRoleLabel(t, slug, customName),
        [t]
    );
}

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
    const tc = useTranslations("common");
    return (
        <div
            role="alert"
            className="bg-danger-soft text-danger flex items-start gap-2 rounded-[10px] px-3.5 py-2.5 text-[13px] leading-relaxed"
        >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">{message}</div>
            {onRetry && (
                <Button variant="ghost" size="sm" className="text-danger h-7" onClick={onRetry}>
                    {tc("actions.tryAgain")}
                </Button>
            )}
        </div>
    );
}

export function LoadingNote({ label }: { label?: string }) {
    const tc = useTranslations("common");
    return (
        <div role="status" aria-live="polite" className="text-ink-3 px-4 py-6 text-[13px]">
            {label ?? tc("status.loading")}
        </div>
    );
}

export function StatusPill({ status }: { status: string }) {
    const t = useTranslations("settings.people.ui");
    const variant = status === "active" ? "success" : status === "pending" ? "warn" : "secondary";
    const label =
        status === "active"
            ? t("statusActive")
            : status === "pending"
              ? t("statusPending")
              : status === "suspended"
                ? t("statusSuspended")
                : status;
    return <Badge variant={variant}>{label}</Badge>;
}

export function CopyButton({
    value,
    label: labelProp,
    copiedLabel: copiedLabelProp,
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
    const tc = useTranslations("common");
    const label = labelProp ?? tc("actions.copy");
    const copiedLabel = copiedLabelProp ?? tc("actions.copied");
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
    const tc = useTranslations("common");
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
                        {tc("actions.cancel")}
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

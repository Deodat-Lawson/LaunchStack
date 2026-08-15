"use client";

import { useEffect } from "react";

export interface ConfirmActionDialogProps {
    open: boolean;
    title: string;
    body: string;
    confirmLabel: string;
    busy?: boolean;
    error?: string | null;
    danger?: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

export function ConfirmActionDialog({
    open,
    title,
    body,
    confirmLabel,
    busy = false,
    error,
    danger = true,
    onConfirm,
    onClose,
}: ConfirmActionDialogProps) {
    useEffect(() => {
        if (!open) return;
        const onEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !busy) onClose();
        };
        window.addEventListener("keydown", onEsc);
        return () => window.removeEventListener("keydown", onEsc);
    }, [open, onClose, busy]);

    if (!open) return null;

    return (
        <div
            data-testid="confirm-action-dialog"
            onClick={() => {
                if (!busy) onClose();
            }}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 210,
                background: "var(--scrim)",
                backdropFilter: "blur(4px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                animation: "lsw-fadeIn 140ms",
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="confirm-action-title"
                onClick={e => e.stopPropagation()}
                style={{
                    width: 420,
                    maxWidth: "92vw",
                    background: "var(--panel)",
                    borderRadius: 14,
                    boxShadow: "0 30px 80px var(--scrim-shadow), 0 0 0 1px var(--line)",
                    overflow: "hidden",
                    animation: "lsw-modalIn 180ms",
                }}
            >
                <div style={{ padding: "18px 20px 14px" }}>
                    <div
                        id="confirm-action-title"
                        style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}
                    >
                        {title}
                    </div>
                    <p
                        style={{
                            margin: 0,
                            fontSize: 13,
                            lineHeight: 1.55,
                            color: "var(--ink-2)",
                        }}
                    >
                        {body}
                    </p>
                    {error && (
                        <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 8 }}>
                            {error}
                        </div>
                    )}
                </div>
                <div
                    style={{
                        padding: "12px 20px",
                        borderTop: "1px solid var(--line)",
                        background: "var(--line-2)",
                        display: "flex",
                        gap: 8,
                        justifyContent: "flex-end",
                    }}
                >
                    <button
                        onClick={onClose}
                        disabled={busy}
                        style={{
                            fontSize: 13,
                            padding: "7px 14px",
                            borderRadius: 7,
                            color: "var(--ink-2)",
                            border: "1px solid var(--line)",
                            background: "var(--panel)",
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={busy}
                        data-testid="confirm-action-confirm"
                        style={{
                            fontSize: 13,
                            fontWeight: 600,
                            padding: "7px 14px",
                            borderRadius: 7,
                            background: busy
                                ? "var(--line)"
                                : danger
                                  ? "var(--danger, oklch(0.5 0.18 25))"
                                  : "var(--accent)",
                            color: busy ? "var(--ink-3)" : "white",
                            cursor: busy ? "not-allowed" : "pointer",
                        }}
                    >
                        {busy ? "Working…" : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

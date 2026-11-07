"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { sourceApiErrorMessage } from "./sourceApi";
import { isPersistedSource } from "./sourceContextMenu";
import type { WorkspaceSource } from "./types";
import { File as IconFile } from "lucide-react";

export interface RenameSourceDialogProps {
    open: boolean;
    source: WorkspaceSource | null;
    onClose: () => void;
    onRename: (source: WorkspaceSource, title: string) => Promise<boolean>;
}

export function RenameSourceDialog({ open, source, onClose, onRename }: RenameSourceDialogProps) {
    const t = useTranslations("sources.renameSource");
    const tc = useTranslations("common");
    const tApi = useTranslations("sources.sourceApi");
    const [name, setName] = useState(source?.title ?? "");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open && source) {
            setName(source.title);
            setError(null);
            setSubmitting(false);
        }
    }, [open, source]);

    useEffect(() => {
        if (!open) return;
        const onEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !submitting) onClose();
        };
        window.addEventListener("keydown", onEsc);
        return () => window.removeEventListener("keydown", onEsc);
    }, [open, onClose, submitting]);

    if (!open || !source) return null;

    const trimmed = name.trim();
    const unchanged = trimmed === source.title;
    const ok = trimmed.length > 0 && !unchanged && isPersistedSource(source);

    const submit = async () => {
        if (!ok || submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            const success = await onRename(source, trimmed);
            if (!success) {
                setError(t("failed"));
                return;
            }
            onClose();
        } catch (err) {
            setError(sourceApiErrorMessage(err, tApi, t("failedFallback")));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            data-testid="rename-source-dialog"
            onClick={() => {
                if (!submitting) onClose();
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
                aria-labelledby="rename-source-title"
                onClick={e => e.stopPropagation()}
                style={{
                    width: 440,
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
                        style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}
                    >
                        <div
                            style={{
                                width: 28,
                                height: 28,
                                borderRadius: 7,
                                background: "var(--accent-soft)",
                                color: "var(--accent)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <IconFile size={14} />
                        </div>
                        <div id="rename-source-title" style={{ fontSize: 15, fontWeight: 700 }}>
                            {t("title")}
                        </div>
                    </div>
                    <input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        autoFocus
                        disabled={submitting}
                        maxLength={256}
                        aria-label={t("inputAria")}
                        data-testid="rename-source-input"
                        onKeyDown={e => {
                            if (e.key === "Enter") void submit();
                        }}
                        style={{
                            width: "100%",
                            padding: "10px 14px",
                            borderRadius: 9,
                            fontSize: 14,
                            border: `1px solid ${trimmed.length === 0 ? "var(--danger)" : "var(--line)"}`,
                            background: "var(--panel)",
                            color: "var(--ink)",
                            outline: "none",
                        }}
                    />
                    {trimmed.length === 0 && (
                        <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 6 }}>
                            {t("empty")}
                        </div>
                    )}
                    {error && (
                        <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 6 }}>
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
                        disabled={submitting}
                        style={{
                            fontSize: 13,
                            padding: "7px 14px",
                            borderRadius: 7,
                            color: "var(--ink-2)",
                            border: "1px solid var(--line)",
                            background: "var(--panel)",
                        }}
                    >
                        {tc("actions.cancel")}
                    </button>
                    <button
                        disabled={!ok || submitting}
                        onClick={() => void submit()}
                        data-testid="rename-source-save"
                        style={{
                            fontSize: 13,
                            fontWeight: 600,
                            padding: "7px 14px",
                            borderRadius: 7,
                            background: ok && !submitting ? "var(--accent)" : "var(--line)",
                            color: ok && !submitting ? "white" : "var(--ink-3)",
                            cursor: ok && !submitting ? "pointer" : "not-allowed",
                        }}
                    >
                        {submitting ? tc("status.saving") : tc("actions.save")}
                    </button>
                </div>
            </div>
        </div>
    );
}

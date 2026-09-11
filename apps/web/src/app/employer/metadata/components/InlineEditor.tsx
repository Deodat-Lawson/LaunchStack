"use client";

import React, { useState, useEffect } from "react";

interface InlineEditorProps {
    path: string;
    initialValue: string;
    multiline?: boolean;
    onSave: (path: string, value: string) => Promise<void>;
}

export function InlineEditor({ path, initialValue, multiline, onSave }: InlineEditorProps) {
    const [value, setValue] = useState(initialValue);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setValue(initialValue);
        setError(null);
    }, [initialValue]);

    const handleSave = async () => {
        if (value.trim() === initialValue) return;
        setSaving(true);
        setError(null);
        try {
            await onSave(path, value.trim());
        } catch {
            setError("Failed to save.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-1.5">
            {multiline ? (
                <textarea
                    className="border-line bg-surface text-ink focus:ring-brand-glow w-full resize-none rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2"
                    rows={3}
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    disabled={saving}
                />
            ) : (
                <input
                    className="border-line bg-surface text-ink focus:ring-brand-glow w-full rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2"
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    disabled={saving}
                />
            )}
            {error && <p className="text-danger text-xs">{error}</p>}
            <div className="flex gap-2">
                <button
                    onClick={() => void handleSave()}
                    disabled={saving || value.trim() === initialValue}
                    className="bg-brand hover:bg-brand-hi rounded px-2 py-1 text-xs font-semibold text-white transition-colors disabled:opacity-50"
                >
                    {saving ? "Saving..." : "Save"}
                </button>
                <button
                    onClick={() => {
                        setValue(initialValue);
                        setError(null);
                    }}
                    disabled={saving}
                    className="border-line hover:bg-panel-2 rounded border px-2 py-1 text-xs font-semibold transition-colors"
                >
                    Reset
                </button>
            </div>
        </div>
    );
}

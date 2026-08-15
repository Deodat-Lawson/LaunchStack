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
                    className="border-border bg-background text-foreground w-full resize-none rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    rows={3}
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    disabled={saving}
                />
            ) : (
                <input
                    className="border-border bg-background text-foreground w-full rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    disabled={saving}
                />
            )}
            {error && <p className="text-destructive text-xs">{error}</p>}
            <div className="flex gap-2">
                <button
                    onClick={() => void handleSave()}
                    disabled={saving || value.trim() === initialValue}
                    className="rounded bg-purple-600 px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
                >
                    {saving ? "Saving..." : "Save"}
                </button>
                <button
                    onClick={() => {
                        setValue(initialValue);
                        setError(null);
                    }}
                    disabled={saving}
                    className="border-border hover:bg-muted rounded border px-2 py-1 text-xs font-semibold transition-colors"
                >
                    Reset
                </button>
            </div>
        </div>
    );
}

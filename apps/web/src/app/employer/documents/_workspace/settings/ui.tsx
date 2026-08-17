"use client";

/**
 * The few settings-specific pieces the shared primitives do not cover.
 *
 * Everything else — `Section`, `Card`, `Field`, `TextInput`, `Button`,
 * `Badge` — comes from `~/components/ui/badge`, deliberately,
 * so a settings section cannot drift into its own look by accident.
 */

import React, { type CSSProperties, type ReactNode } from "react";

export type StatusTone = "ok" | "warn" | "danger" | "muted";

const TONES: Record<StatusTone, { bg: string; fg: string; border: string }> = {
    ok: { bg: "var(--accent-soft)", fg: "var(--accent-ink)", border: "var(--accent-glow)" },
    warn: { bg: "oklch(0.96 0.07 70)", fg: "oklch(0.4 0.13 55)", border: "oklch(0.85 0.12 70)" },
    danger: { bg: "oklch(0.96 0.05 25)", fg: "var(--danger)", border: "oklch(0.85 0.09 25)" },
    muted: { bg: "var(--panel-2)", fg: "var(--ink-3)", border: "var(--line)" },
};

/** One-line result or explanation, directly under the section header. */
export function StatusNote({
    tone = "muted",
    children,
    style,
}: {
    tone?: StatusTone;
    children: ReactNode;
    style?: CSSProperties;
}) {
    const palette = TONES[tone];
    return (
        <div
            role={tone === "danger" ? "alert" : undefined}
            style={{
                marginBottom: 20,
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 13,
                lineHeight: 1.5,
                background: palette.bg,
                color: palette.fg,
                border: `1px solid ${palette.border}`,
                ...style,
            }}
        >
            {children}
        </div>
    );
}

/**
 * A labelled row inside a `Card` — the readout counterpart to `Field`, for
 * state the user reads rather than edits (integration status, node health).
 */
export function StatusRow({
    label,
    detail,
    ok,
    okLabel = "Ready",
    offLabel = "Not configured",
    trailing,
}: {
    label: string;
    detail: ReactNode;
    ok: boolean;
    okLabel?: string;
    offLabel?: string;
    trailing?: ReactNode;
}) {
    const accent = ok ? "oklch(0.58 0.15 165)" : "oklch(0.72 0.14 60)";
    return (
        <div
            style={{
                display: "flex",
                gap: 11,
                alignItems: "flex-start",
                padding: "12px 0",
                borderTop: "1px solid var(--line)",
            }}
        >
            <span
                style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    marginTop: 6,
                    flexShrink: 0,
                    background: accent,
                }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                        {label}
                    </span>
                    <span
                        style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "1px 7px",
                            borderRadius: 999,
                            border: `1px solid ${accent}`,
                            color: ok ? "oklch(0.45 0.14 165)" : "oklch(0.45 0.13 55)",
                        }}
                    >
                        {ok ? okLabel : offLabel}
                    </span>
                </div>
                <div
                    style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3, lineHeight: 1.55 }}
                >
                    {detail}
                </div>
            </div>
            {trailing}
        </div>
    );
}

/** Inline code token, sized to sit inside body copy without shifting the line. */
export function Code({ children }: { children: ReactNode }) {
    return (
        <code
            className="mono"
            style={{
                fontSize: 11.5,
                padding: "1px 5px",
                borderRadius: 4,
                background: "var(--line-2)",
                border: "1px solid var(--line)",
                color: "var(--ink-2)",
            }}
        >
            {children}
        </code>
    );
}

/** A copyable command block. */
export function CommandBlock({ title, command }: { title: string; command: string }) {
    const [copied, setCopied] = React.useState(false);
    return (
        <div
            style={{
                border: "1px solid var(--line)",
                borderRadius: 10,
                background: "var(--panel-2)",
                overflow: "hidden",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderBottom: "1px solid var(--line)",
                }}
            >
                <span
                    className="mono"
                    style={{
                        flex: 1,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "var(--ink-3)",
                    }}
                >
                    {title}
                </span>
                <button
                    onClick={() => {
                        void navigator.clipboard?.writeText(command).then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1600);
                        });
                    }}
                    style={{
                        padding: "4px 9px",
                        borderRadius: 6,
                        border: "1px solid var(--line)",
                        background: "var(--panel)",
                        color: "var(--ink-2)",
                        fontSize: 11.5,
                        fontWeight: 500,
                    }}
                >
                    {copied ? "Copied" : "Copy"}
                </button>
            </div>
            <pre
                className="mono"
                style={{
                    margin: 0,
                    padding: "12px 14px",
                    fontSize: 11.5,
                    lineHeight: 1.7,
                    color: "var(--ink-2)",
                    overflowX: "auto",
                    whiteSpace: "pre",
                }}
            >
                {command}
            </pre>
        </div>
    );
}

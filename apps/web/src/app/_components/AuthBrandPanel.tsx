"use client";

import React from "react";
import {
    FileSearch,
    MessagesSquare,
    Sparkles,
} from "lucide-react";

/**
 * Launchstack auth-side brand panel.
 *
 * Used by /signin and /signup as the right-hand panel next to the Clerk form.
 * Styled with the `.lsw-root` OKLCH tokens so both themes render correctly.
 * Tone is tuned for solo founders, indie developers, and students — not the
 * enterprise "5k documents / 50+ companies / bank-level security" pitch.
 */
export function AuthBrandPanel({
    tagline,
    headline,
    description,
}: {
    tagline: string;
    headline: string;
    description: string;
}) {
    return (
        <div
            style={{
                flex: 1,
                minWidth: 0,
                padding: "64px 56px",
                background: "var(--panel-2)",
                borderLeft: "1px solid var(--line)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                position: "relative",
                overflow: "hidden",
            }}
        >
            <div
                aria-hidden
                style={{
                    position: "absolute",
                    inset: 0,
                    background:
                        "radial-gradient(circle at 15% 20%, var(--accent-glow) 0%, transparent 55%)",
                    opacity: 0.5,
                    pointerEvents: "none",
                }}
            />
            <div style={{ position: "relative", maxWidth: 480 }}>
                <div
                    className="mono"
                    style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.12em",
                        color: "var(--accent-ink)",
                        textTransform: "uppercase",
                        marginBottom: 14,
                    }}
                >
                    {tagline}
                </div>
                <h2
                    className="serif"
                    style={{
                        fontSize: 44,
                        lineHeight: 1.05,
                        letterSpacing: "-0.025em",
                        color: "var(--ink)",
                        margin: 0,
                    }}
                >
                    {headline}
                </h2>
                <p
                    style={{
                        fontSize: 15,
                        lineHeight: 1.6,
                        color: "var(--ink-3)",
                        marginTop: 14,
                        maxWidth: 420,
                    }}
                >
                    {description}
                </p>

                <div
                    style={{
                        marginTop: 36,
                        display: "flex",
                        flexDirection: "column",
                        gap: 16,
                    }}
                >
                    <BrandFeature
                        Icon={FileSearch}
                        title="Grounded answers"
                        text="Every response cites the exact passage — no more guessing where a fact came from."
                    />
                    <BrandFeature
                        Icon={Sparkles}
                        title="One place to think"
                        text="Files, notes, transcripts, emails, repos — drop anything in, then ask anything about it."
                    />
                    <BrandFeature
                        Icon={MessagesSquare}
                        title="Built for solo builders"
                        text="Designed around indie hackers, researchers, and students. No enterprise bloat."
                    />
                </div>

                <div
                    style={{
                        marginTop: 44,
                        paddingTop: 20,
                        borderTop: "1px solid var(--line)",
                        fontSize: 12,
                        color: "var(--ink-3)",
                        fontStyle: "italic",
                        lineHeight: 1.6,
                    }}
                >
                    &ldquo;It&apos;s the only workspace that keeps up with how
                    fast my notes move.&rdquo;
                    <div
                        className="mono"
                        style={{
                            marginTop: 6,
                            fontStyle: "normal",
                            fontSize: 11,
                            color: "var(--ink-4)",
                            letterSpacing: "0.04em",
                        }}
                    >
                        — an early user
                    </div>
                </div>
            </div>
        </div>
    );
}

function BrandFeature({
    Icon,
    title,
    text,
}: {
    Icon: React.ComponentType<{ style?: React.CSSProperties }>;
    title: string;
    text: string;
}) {
    return (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div
                style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    flexShrink: 0,
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: 1,
                }}
            >
                <Icon style={{ width: 16, height: 16 }} />
            </div>
            <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                    {title}
                </div>
                <div
                    style={{
                        fontSize: 12.5,
                        color: "var(--ink-3)",
                        lineHeight: 1.55,
                        marginTop: 3,
                    }}
                >
                    {text}
                </div>
            </div>
        </div>
    );
}

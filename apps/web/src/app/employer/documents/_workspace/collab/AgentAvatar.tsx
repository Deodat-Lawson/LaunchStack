"use client";

/**
 * One way to draw an agent everywhere it appears: its picture when it has
 * one, its initials on its accent colour otherwise. Sized by the caller;
 * round below 22px (chips, mention menus), rounded-square above (cards,
 * transcript rows) — the same rule the old inline avatars followed.
 */

import React, { useState } from "react";

import { cn } from "~/lib/utils";

import { initialsOf, personaColor } from "./types";

export interface AgentAvatarProps {
    agent: { id: string; displayName: string; accent?: string | null; avatarUrl?: string | null };
    size?: number;
    className?: string;
    /** Rounded-square regardless of size. */
    square?: boolean;
    title?: string;
}

/** The ten shipped pictures, offered in the editor for custom agents too. */
export const DEFAULT_AVATARS: ReadonlyArray<{ url: string; label: string }> = [
    { url: "/agents/facilitator.jpg", label: "Kandinsky, Composition 8" },
    { url: "/agents/analyst.jpg", label: "Vermeer, The Astronomer" },
    { url: "/agents/engineer.jpg", label: "Leonardo, Vitruvian Man" },
    { url: "/agents/counsel.jpg", label: "Vermeer, Woman Holding a Balance" },
    { url: "/agents/finance.jpg", label: "Matsys, The Moneylender and His Wife" },
    { url: "/agents/product.jpg", label: "Van Gogh, The Starry Night" },
    { url: "/agents/marketing.jpg", label: "Toulouse-Lautrec, Moulin Rouge" },
    { url: "/agents/sales.jpg", label: "Hokusai, The Great Wave" },
    { url: "/agents/support.jpg", label: "Van Gogh, Almond Blossom" },
    { url: "/agents/critic.jpg", label: "Goya, The Sleep of Reason" },
];

export function AgentAvatar({ agent, size = 26, className, square, title }: AgentAvatarProps) {
    const [broken, setBroken] = useState(false);
    const round = !square && size <= 22;
    const radius = round ? "50%" : Math.max(6, Math.round(size * 0.28));
    const color = personaColor(agent);
    const url = agent.avatarUrl && !broken ? agent.avatarUrl : null;
    return (
        <span
            title={title}
            aria-hidden={title ? undefined : true}
            className={cn(
                "inline-flex shrink-0 items-center justify-center overflow-hidden",
                className
            )}
            style={{
                width: size,
                height: size,
                borderRadius: radius,
                background: color,
                color: "white",
                fontSize: Math.max(7, Math.round(size * 0.36)),
                fontWeight: 700,
                letterSpacing: "0.02em",
            }}
        >
            {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={url}
                    alt=""
                    width={size}
                    height={size}
                    loading="lazy"
                    decoding="async"
                    onError={() => setBroken(true)}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
            ) : (
                initialsOf(agent.displayName)
            )}
        </span>
    );
}

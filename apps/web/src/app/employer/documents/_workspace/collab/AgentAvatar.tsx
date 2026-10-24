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

/** The ten shipped pictures, offered in the editor for custom agents too. Named by `collab.avatars.<key>`. */
export const DEFAULT_AVATARS = [
    { url: "/agents/facilitator.jpg", key: "facilitator" },
    { url: "/agents/analyst.jpg", key: "analyst" },
    { url: "/agents/engineer.jpg", key: "engineer" },
    { url: "/agents/counsel.jpg", key: "counsel" },
    { url: "/agents/finance.jpg", key: "finance" },
    { url: "/agents/product.jpg", key: "product" },
    { url: "/agents/marketing.jpg", key: "marketing" },
    { url: "/agents/sales.jpg", key: "sales" },
    { url: "/agents/support.jpg", key: "support" },
    { url: "/agents/critic.jpg", key: "critic" },
] as const;

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

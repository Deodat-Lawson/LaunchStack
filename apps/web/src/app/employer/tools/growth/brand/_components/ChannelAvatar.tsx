"use client";

import { useTranslations } from "next-intl";

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { cn } from "~/lib/utils";

import { initials } from "../_lib/channels";
import type { BrandChannelKind, BrandPlatform } from "../api";
import { NETWORK_LABEL, NetworkMark } from "./NetworkMark";

/**
 * A channel's face: its logo or photo, with initials in the ink ladder when
 * there is none — never a network's brand colour. A Page is a rounded
 * square, the way a company logo is shown; a person or account is round.
 */
export function ChannelAvatar({
    name,
    kind,
    avatarUrl,
    size = 28,
    muted = false,
    className,
}: {
    name: string;
    kind: BrandChannelKind;
    avatarUrl: string | null;
    size?: number;
    muted?: boolean;
    className?: string;
}) {
    const square = kind === "organization" || kind === "deployment";
    return (
        <Avatar
            className={cn(square ? "rounded-md" : "rounded-full", muted && "opacity-60", className)}
            style={{ width: size, height: size }}
        >
            {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
            <AvatarFallback
                className={cn(square ? "rounded-md" : "rounded-full", "font-medium")}
                style={{ fontSize: Math.max(9, Math.round(size * 0.38)) }}
            >
                {initials(name)}
            </AvatarFallback>
        </Avatar>
    );
}

/**
 * Avatar, name and kind on one line; `network` adds the network's monogram
 * for places that mix networks (the calendar, a post's popover).
 */
export function ChannelLabel({
    channel,
    platform,
    size = 20,
    showKind = true,
    network = false,
    muted = false,
    className,
}: {
    channel: { name: string; kind: BrandChannelKind; avatarUrl: string | null } | null;
    platform: BrandPlatform;
    size?: number;
    showKind?: boolean;
    network?: boolean;
    muted?: boolean;
    className?: string;
}) {
    const t = useTranslations("growth.brand");
    if (!channel) {
        // The server names the deployment account (and posts from before
        // channels) as a channel of kind "deployment"; no channel at all means
        // the one this post was on has since been disconnected.
        return (
            <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
                <NetworkMark platform={platform} size={size} muted />
                <span className="text-ink-3 truncate text-[13px]">{NETWORK_LABEL[platform]}</span>
                {showKind && (
                    <span className="text-ink-3 shrink-0 text-xs">
                        {t("channelLabel.disconnected")}
                    </span>
                )}
            </span>
        );
    }
    return (
        <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
            <ChannelAvatar
                name={channel.name}
                kind={channel.kind}
                avatarUrl={channel.avatarUrl}
                size={size}
                muted={muted}
            />
            <span className={cn("truncate text-[13px]", muted ? "text-ink-3" : "text-ink")}>
                {channel.name}
            </span>
            {showKind && (
                <span className="text-ink-3 shrink-0 text-xs">{t(`kinds.${channel.kind}`)}</span>
            )}
            {network && <NetworkMark platform={platform} size={14} muted className="shrink-0" />}
        </span>
    );
}

"use client";

import { createAvatar } from "@dicebear/core";
import * as notionists from "@dicebear/notionists";
import { Megaphone, Radio } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "~/components/ui/hover-card";
import type { ScenarioPerson, Stance } from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import { atHandle, stanceLabel } from "~/lib/scenarios/words";
import { StanceDot } from "./Bits";

/**
 * Hues the backdrops are drawn from: spread round the wheel, skipping the
 * olive band (≈90–120) where a pale tint reads as dirty.
 */
const HUES = [18, 42, 70, 145, 170, 196, 222, 250, 282, 312, 338] as const;

/** A handle as a seed: no "@", any case, so the same person draws the same everywhere. */
function seedOf(handle: string): string {
    return handle.replace(/^@+/, "").toLowerCase();
}

function hashOf(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** The person's backdrop hue, for the portrait and their profile's cover. */
export function personaHue(handle: string): number {
    return HUES[hashOf(seedOf(handle)) % HUES.length]!;
}

/** `--persona-h` for an element whose classes tint by it (see `PERSONA_TINT`). */
export function personaStyle(handle: string): CSSProperties {
    return { "--persona-h": personaHue(handle) } as CSSProperties;
}

/** A pale backdrop in the person's hue; deeper in the dark theme so the drawing still sits on it. */
export const PERSONA_TINT =
    "bg-[oklch(0.9_0.05_var(--persona-h))] dark:bg-[oklch(0.42_0.07_var(--persona-h))]";

const drawn = new Map<string, string>();

/**
 * A hand-drawn face (Zoish's Notionists, CC0, through DiceBear) picked by the
 * handle: the same person looks the same in the feed, the cast and the
 * report, and in every run they appear in. Drawn, not photographed, on
 * purpose — these people are simulated, and a photo would say otherwise.
 * Nothing is inferred from the name: no beards, so a face never argues with
 * one.
 */
function portraitUri(handle: string): string {
    const seed = seedOf(handle);
    let uri = drawn.get(seed);
    if (!uri) {
        uri = createAvatar(notionists, {
            seed,
            beardProbability: 0,
            bodyIconProbability: 0,
            gestureProbability: 0,
            glassesProbability: 25,
            scale: 118,
            translateY: 6,
        }).toDataUri();
        drawn.set(seed, uri);
    }
    return uri;
}

const STANCE_RING: Record<Stance, string> = {
    [-2]: "ring-danger",
    [-1]: "ring-danger/60",
    [0]: "ring-ink-4/60",
    [1]: "ring-info/60",
    [2]: "ring-info",
};

/**
 * A person's face on their backdrop; the narrator and the draft under test
 * get a glyph instead. With `stance`, a ring in the stance's colour says
 * where they stand now.
 */
export function Portrait({
    handle,
    kind = "agent",
    size = 40,
    stance,
    className,
}: {
    handle: string;
    kind?: "agent" | "narrator" | "brand";
    size?: number;
    stance?: Stance;
    className?: string;
}) {
    const box = { width: size, height: size };
    if (kind !== "agent") {
        return (
            <span
                aria-hidden
                className={cn(
                    "inline-flex shrink-0 items-center justify-center rounded-full",
                    kind === "narrator" ? "bg-ink text-surface" : "bg-brand-soft text-brand-ink",
                    className
                )}
                style={box}
            >
                {kind === "narrator" ? (
                    <Radio className="size-[45%]" />
                ) : (
                    <Megaphone className="size-[45%]" />
                )}
            </span>
        );
    }
    return (
        <span
            aria-hidden
            className={cn(
                "inline-block shrink-0 overflow-hidden rounded-full",
                PERSONA_TINT,
                stance !== undefined && "ring-offset-panel ring-2 ring-offset-2",
                stance !== undefined && STANCE_RING[stance],
                className
            )}
            style={{ ...box, ...personaStyle(handle) }}
        >
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URI drawn in the browser; nothing to optimise */}
            <img
                src={portraitUri(handle)}
                alt=""
                width={size}
                height={size}
                draggable={false}
                className="size-full select-none"
            />
        </span>
    );
}

/**
 * Hovering a name or a face in the feed shows who they are, the way a social
 * network does: face, role, bio, where they stand and their following.
 * Touch has no hover; the name still opens the full profile.
 */
export function PersonHoverCard({
    person,
    children,
}: {
    person: ScenarioPerson | undefined;
    children: ReactNode;
}) {
    const t = useTranslations("scenarios.people");
    const tw = useTranslations("scenarios.words");
    if (!person) return <>{children}</>;
    return (
        <HoverCard openDelay={350} closeDelay={80}>
            <HoverCardTrigger asChild>{children}</HoverCardTrigger>
            <HoverCardContent align="start" className="w-[300px] p-0">
                <div className="flex items-start gap-3 p-4 pb-3">
                    <Portrait handle={person.handle} size={52} />
                    <div className="min-w-0 pt-0.5">
                        <div className="text-ink truncate text-[14px] font-semibold">
                            {person.name}
                        </div>
                        <div className="text-ink-3 truncate text-xs">
                            {atHandle(person.handle)}
                        </div>
                        <div className="text-ink-2 mt-1 line-clamp-2 text-[12.5px] leading-snug">
                            {person.role}
                        </div>
                    </div>
                </div>
                {person.bio && (
                    <p className="text-ink-2 line-clamp-3 px-4 text-[13px] leading-snug">
                        {person.bio}
                    </p>
                )}
                <div className="border-line-2 text-ink-3 mt-3 flex items-center justify-between gap-3 border-t px-4 py-2.5 text-xs">
                    <span className="text-ink-2 inline-flex min-w-0 items-center gap-1.5">
                        <StanceDot stance={person.stance} />
                        <span className="truncate">{stanceLabel(tw, person.stance)}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                        {t("followers", { count: person.followers })}
                    </span>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
}

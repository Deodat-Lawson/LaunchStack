"use client";

import { CornerDownRight } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ScenarioPost } from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import { Portrait } from "./Portrait";

/** A link to a post in the Feed: a face and "Maya, round 3"; the narrator gets an arrow. */
export function PostRef({
    post,
    onJump,
}: {
    post: ScenarioPost | undefined;
    onJump: (postId: string) => void;
}) {
    const t = useTranslations("scenarios.report");
    if (!post) return null;
    const who =
        post.authorKind === "narrator" ? t("narrator") : `@${post.authorHandle.replace(/^@+/, "")}`;
    const when = post.round === 0 ? t("opening") : t("round", { round: post.round });
    return (
        <button
            type="button"
            onClick={() => onJump(post.id)}
            className={cn(
                "border-line bg-panel text-ink-2 hover:bg-panel-2 hover:text-ink focus-visible:ring-brand/50 inline-flex h-7 items-center gap-1.5 rounded-md border pr-2 text-xs outline-none focus-visible:ring-2",
                post.authorKind === "agent" ? "pl-0.5" : "pl-2"
            )}
            aria-label={t("postRefAria", { who, when })}
        >
            {post.authorKind === "agent" ? (
                <Portrait handle={post.authorHandle} size={22} />
            ) : (
                <CornerDownRight className="size-3" aria-hidden />
            )}
            {t("postRef", { who, when })}
        </button>
    );
}

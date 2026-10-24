"use client";

import { Building2, FileText, Layers, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import {
    ASK_STARTER_COUNT,
    type AskStarter,
    type AskStartersPayload,
} from "~/lib/ask-starters/contract";
import { cn } from "~/lib/utils";
import type { WorkspaceSource } from "./types";
import { useAskStarters } from "./useAskStarters";

/**
 * The four starter cards on the Ask panel's empty state.
 *
 * Each card is a real question the workspace can answer today: the server
 * writes them from the company profile and the knowledge base, and clicking
 * one sends it — pinning the document it is about, when it is about one.
 */

export interface AskStartersProps {
    sources: WorkspaceSource[];
    /** Names the evidence the caller can see; a change refetches. */
    revisionKey: string;
    /** True while a message is in flight — the cards wait their turn. */
    disabled?: boolean;
    /** `refs` are the workspace source ids the starter pins (already filtered to ones that exist). */
    onAsk: (starter: AskStarter, refs: string[]) => void;
    /** Opens the company profile so the next set can be sharper. */
    onOpenProfile?: () => void;
}

type StartersTranslator = ReturnType<typeof useTranslations<"chat.starters">>;

/**
 * Shown when the route itself is unreachable. Generic by necessity, but they
 * still send — in the interface language, which the model answers in.
 */
const OFFLINE_STARTER_IDS = ["o1", "o2", "o3", "o4"] as const;

function offlineStarters(t: StartersTranslator): AskStarter[] {
    return OFFLINE_STARTER_IDS.map(id => ({
        id,
        question: t(`offline.${id}.question`),
        hint: t(`offline.${id}.hint`),
        documentIds: [],
    }));
}

function basisLine(
    data: AskStartersPayload | null,
    error: string | null,
    t: StartersTranslator
): string {
    if (!data) return error ? t("offlineLine") : t("loadingLine");
    const { basis } = data;
    const count = basis.sourceCount;
    if (basis.mode === "fallback") {
        return count > 0 ? t("fallbackIndexed", { count }) : t("fallbackEmpty");
    }
    const company = basis.companyName ?? t("yourWorkspace");
    return basis.hasProfile
        ? t("fromProfile", { company, count })
        : t("fromSources", { company, count });
}

function StarterSkeleton() {
    return (
        <div
            aria-hidden
            className="bg-panel border-line animate-pulse rounded-[10px] border px-3.5 py-3"
        >
            <div className="bg-panel-2 h-3.5 w-4/5 rounded" />
            <div className="bg-panel-2 mt-2.5 h-2.5 w-2/5 rounded" />
        </div>
    );
}

interface StarterCardProps {
    starter: AskStarter;
    pinned: boolean;
    disabled: boolean;
    dimmed: boolean;
    onClick: () => void;
}

function StarterCard({ starter, pinned, disabled, dimmed, onClick }: StarterCardProps) {
    const t = useTranslations("chat.starters");
    return (
        <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={onClick}
            data-testid={`ask-starter-${starter.id}`}
            title={pinned ? t("cardPinned") : t("cardAcross")}
            className={cn(
                "bg-panel border-line hover:border-brand hover:bg-panel h-auto w-full flex-col items-start gap-1 whitespace-normal rounded-[10px] px-3.5 py-3 text-left font-normal shadow-none transition-[border-color,opacity]",
                dimmed && "opacity-70"
            )}
        >
            <span className="text-ink text-[13px] font-semibold leading-snug">
                {starter.question}
            </span>
            <span className="text-ink-3 flex min-w-0 max-w-full items-center gap-1.5 text-[11px] leading-snug">
                {pinned ? (
                    <FileText className="size-3 shrink-0" aria-hidden />
                ) : (
                    <Layers className="size-3 shrink-0" aria-hidden />
                )}
                <span className="truncate">{starter.hint}</span>
            </span>
        </Button>
    );
}

export function AskStarters({
    sources,
    revisionKey,
    disabled = false,
    onAsk,
    onOpenProfile,
}: AskStartersProps) {
    const t = useTranslations("chat.starters");
    const { data, loading, refreshing, error, refresh } = useAskStarters(revisionKey);
    const starters = data?.starters ?? (error ? offlineStarters(t) : null);
    const sourceIds = new Set(sources.map(s => s.id));
    const refsFor = (starter: AskStarter) =>
        starter.documentIds.map(id => `d${id}`).filter(id => sourceIds.has(id));
    const showProfileNudge = Boolean(data && !data.basis.hasProfile && onOpenProfile);

    return (
        <section aria-label={t("sectionLabel")} className="mb-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-ink-3 min-w-0 truncate text-xs" aria-live="polite">
                    {basisLine(data, error, t)}
                </p>
                <div className="flex shrink-0 items-center gap-1">
                    {showProfileNudge && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-ink-3 hover:text-brand-ink h-7 px-2 text-xs"
                            onClick={onOpenProfile}
                            title={t("profileTitle")}
                        >
                            <Building2 className="size-3.5" aria-hidden />
                            <span className="@max-sm:sr-only">{t("addProfile")}</span>
                        </Button>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-ink-2 h-7 px-2 text-xs"
                        onClick={refresh}
                        disabled={disabled || loading || refreshing}
                        title={t("shuffleTitle")}
                    >
                        <RefreshCw
                            className={cn("size-3.5", refreshing && "animate-spin")}
                            aria-hidden
                        />
                        {t("shuffle")}
                    </Button>
                </div>
            </div>

            {/* Two columns when the pane has room for them, by the pane's
                width rather than the window's: a chat in a third of a wide
                screen is still narrow. */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
                {starters === null
                    ? Array.from({ length: ASK_STARTER_COUNT }, (_, i) => (
                          <StarterSkeleton key={i} />
                      ))
                    : starters.map(starter => {
                          const refs = refsFor(starter);
                          return (
                              <StarterCard
                                  key={starter.id}
                                  starter={starter}
                                  pinned={refs.length > 0}
                                  disabled={disabled}
                                  dimmed={refreshing}
                                  onClick={() => onAsk(starter, refs)}
                              />
                          );
                      })}
            </div>
        </section>
    );
}

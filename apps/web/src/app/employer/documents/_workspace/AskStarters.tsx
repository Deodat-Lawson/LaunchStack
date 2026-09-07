"use client";

import { Building2, FileText, Layers, RefreshCw } from "lucide-react";

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

/** Shown when the route itself is unreachable. Generic by necessity, but they still send. */
const OFFLINE_STARTERS: AskStarter[] = [
    {
        id: "o1",
        question: "Summarize what my sources cover",
        hint: "across every source",
        documentIds: [],
    },
    {
        id: "o2",
        question: "What are the key dates and deadlines across my documents?",
        hint: "dates in every source",
        documentIds: [],
    },
    {
        id: "o3",
        question: "Who are the people and organizations mentioned most?",
        hint: "names across every source",
        documentIds: [],
    },
    {
        id: "o4",
        question: "Which decisions, risks, or open questions come up most often?",
        hint: "themes across every source",
        documentIds: [],
    },
];

function basisLine(data: AskStartersPayload | null, error: string | null): string {
    if (!data) {
        return error
            ? "Suggestions are offline — these still work"
            : "Finding questions worth asking…";
    }
    const { basis } = data;
    const n = basis.sourceCount;
    const sources = `${n} source${n === 1 ? "" : "s"}`;
    if (basis.mode === "fallback") {
        return n > 0
            ? `Starter questions · ${sources} indexed`
            : "Starter questions · add a source for grounded answers";
    }
    const who = basis.companyName ?? "your workspace";
    return basis.hasProfile
        ? `Suggested from the ${who} profile and ${sources}`
        : `Suggested from ${sources} in ${who}`;
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
    return (
        <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={onClick}
            data-testid={`ask-starter-${starter.id}`}
            title={pinned ? "Asks over the document this is about" : "Asks across your sources"}
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
    const { data, loading, refreshing, error, refresh } = useAskStarters(revisionKey);
    const starters = data?.starters ?? (error ? OFFLINE_STARTERS : null);
    const sourceIds = new Set(sources.map(s => s.id));
    const refsFor = (starter: AskStarter) =>
        starter.documentIds.map(id => `d${id}`).filter(id => sourceIds.has(id));
    const showProfileNudge = Boolean(data && !data.basis.hasProfile && onOpenProfile);

    return (
        <section aria-label="Starter questions" className="mb-6">
            <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-ink-3 min-w-0 truncate text-xs" aria-live="polite">
                    {basisLine(data, error)}
                </p>
                <div className="flex shrink-0 items-center gap-1">
                    {showProfileNudge && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-ink-3 hover:text-brand-ink h-7 px-2 text-xs"
                            onClick={onOpenProfile}
                            title="Extract a company profile from your documents to sharpen these"
                        >
                            <Building2 className="size-3.5" aria-hidden />
                            Add company profile
                        </Button>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-ink-2 h-7 px-2 text-xs"
                        onClick={refresh}
                        disabled={disabled || loading || refreshing}
                        title="Suggest different questions"
                    >
                        <RefreshCw
                            className={cn("size-3.5", refreshing && "animate-spin")}
                            aria-hidden
                        />
                        Shuffle
                    </Button>
                </div>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
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

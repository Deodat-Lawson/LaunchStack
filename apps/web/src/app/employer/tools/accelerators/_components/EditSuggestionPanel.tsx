"use client";

import { Check, Loader2, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId } from "react";

import { Button } from "~/components/ui/button";

import type { PendingEdit } from "../_lib/context";

export interface EditSuggestionPanelProps {
    edit: PendingEdit;
    /** The saved answer is no longer the one the Suggestion was made for. */
    stale: boolean;
    /** Unsaved local text: applying would leave it conflicting with the new saved answer. */
    dirty: boolean;
    canEdit: boolean;
    credits: number;
    applying: boolean;
    failureText: string | null;
    onApply: () => void;
    onDiscard: () => void;
}

/** The original and proposed text side by side; nothing is saved until Apply. */
export function EditSuggestionPanel({
    edit,
    stale,
    dirty,
    canEdit,
    credits,
    applying,
    failureText,
    onApply,
    onDiscard,
}: EditSuggestionPanelProps) {
    const t = useTranslations("accelerators.field");
    const format = useFormatter();
    const id = useId();
    const { original, replacement, gaps } = edit.suggestion;
    const unchanged = replacement === original;
    const quote =
        "border-line bg-surface text-ink-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 text-sm";
    return (
        <section
            aria-labelledby={`${id}-title`}
            className="border-brand/30 bg-panel-2 space-y-4 rounded-lg border p-4"
        >
            <h3 id={`${id}-title`} className="text-ink text-sm font-semibold">
                {t("suggestionTitle")}
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                    <h4 className="text-ink-3 text-xs font-medium">{t("suggestionOriginal")}</h4>
                    <blockquote className={quote} data-testid="suggestion-original">
                        {original}
                    </blockquote>
                </div>
                <div className="space-y-1">
                    <h4 className="text-ink-3 text-xs font-medium">{t("suggestionProposed")}</h4>
                    <blockquote className={quote} data-testid="suggestion-proposed">
                        {replacement === "" ? (
                            <span className="text-ink-3 italic">{t("suggestionDeletes")}</span>
                        ) : unchanged ? (
                            <span className="text-ink-3 italic">{t("suggestionUnchanged")}</span>
                        ) : (
                            replacement
                        )}
                    </blockquote>
                </div>
            </div>
            {gaps.length > 0 && (
                <div className="space-y-1">
                    <h4 className="text-ink text-sm font-medium">{t("suggestionGaps")}</h4>
                    <ul className="text-ink-2 list-disc space-y-1 pl-5 text-sm">
                        {gaps.map((gap, index) => (
                            <li key={index}>{gap}</li>
                        ))}
                    </ul>
                </div>
            )}
            <p className="text-ink-3 text-xs leading-relaxed">
                {t("suggestionCharged", { credits: format.number(credits) })}
            </p>
            {stale && (
                <p role="alert" className="text-danger text-sm">
                    {t("suggestionStale")}
                </p>
            )}
            {!stale && dirty && <p className="text-warn text-sm">{t("suggestionDirty")}</p>}
            {failureText && (
                <p role="alert" className="text-danger text-sm">
                    {failureText}
                </p>
            )}
            <div className="flex flex-wrap gap-2">
                {!stale && (
                    <Button
                        type="button"
                        size="sm"
                        disabled={dirty || !canEdit || applying || unchanged}
                        onClick={onApply}
                    >
                        {applying ? (
                            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                        ) : (
                            <Check className="size-3.5" />
                        )}
                        {t(applying ? "suggestionApplying" : "suggestionApply")}
                    </Button>
                )}
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={applying}
                    onClick={onDiscard}
                >
                    <X className="size-3.5" />
                    {t("suggestionDiscard")}
                </Button>
            </div>
        </section>
    );
}

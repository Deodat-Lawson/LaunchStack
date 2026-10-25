"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
    SpellCheck,
    Check,
    X,
    Loader2,
    AlertCircle,
    AlertTriangle,
    Lightbulb,
    RefreshCw,
    Wand2,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Badge } from "~/components/ui/badge";
import { Progress } from "~/components/ui/progress";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";

// Suggestion types
interface GrammarSuggestion {
    id: string;
    type:
        | "grammar"
        | "spelling"
        | "punctuation"
        | "style"
        | "clarity"
        | "formality"
        | "consistency";
    severity: "error" | "warning" | "suggestion";
    original: string;
    suggestion: string;
    explanation: string;
}

type CheckAction = "check" | "improve_clarity" | "adjust_formality" | "consistency";
type FormalityLevel = "very_formal" | "formal" | "neutral" | "casual" | "very_casual";

interface GrammarPanelProps {
    content: string;
    onApplySuggestion: (original: string, suggestion: string) => void;
    onClose: () => void;
}

const severityConfig = {
    error: {
        icon: AlertCircle,
        color: "text-red-500",
        bg: "bg-red-50 dark:bg-red-900/20",
        border: "border-red-200 dark:border-red-800",
    },
    warning: {
        icon: AlertTriangle,
        color: "text-amber-500",
        bg: "bg-amber-50 dark:bg-amber-900/20",
        border: "border-amber-200 dark:border-amber-800",
    },
    suggestion: {
        icon: Lightbulb,
        color: "text-blue-500",
        bg: "bg-blue-50 dark:bg-blue-900/20",
        border: "border-blue-200 dark:border-blue-800",
    },
};

/** Each check's label: `generator.grammar.actions.<key>`. */
const ACTION_KEYS = {
    check: "check",
    improve_clarity: "improveClarity",
    adjust_formality: "adjustFormality",
    consistency: "consistency",
} as const satisfies Record<CheckAction, string>;

/** Each level's label: `generator.grammar.formality.<key>`. */
const FORMALITY_KEYS = {
    very_formal: "veryFormal",
    formal: "formal",
    neutral: "neutral",
    casual: "casual",
    very_casual: "veryCasual",
} as const satisfies Record<FormalityLevel, string>;

export function GrammarPanel({ content, onApplySuggestion, onClose }: GrammarPanelProps) {
    const t = useTranslations("generator.grammar");
    const tc = useTranslations("common");
    const [isChecking, setIsChecking] = useState(false);
    const [suggestions, setSuggestions] = useState<GrammarSuggestion[]>([]);
    const [overallScore, setOverallScore] = useState<number | null>(null);
    const [summary, setSummary] = useState<string | null>(null);
    const [action, setAction] = useState<CheckAction>("check");
    const [formalityLevel, setFormalityLevel] = useState<FormalityLevel>("formal");
    const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
    const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

    const runCheck = async () => {
        if (!content.trim()) return;

        setIsChecking(true);
        setAppliedIds(new Set());
        setDismissedIds(new Set());

        try {
            const response = await fetch("/api/document-generator/grammar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action,
                    content,
                    options: {
                        formalityLevel: action === "adjust_formality" ? formalityLevel : undefined,
                    },
                }),
            });

            const data = (await response.json()) as {
                success: boolean;
                suggestions?: GrammarSuggestion[];
                overallScore?: number;
                readabilityScore?: number;
                summary?: string;
            };
            if (data.success) {
                setSuggestions(data.suggestions ?? []);
                setOverallScore(data.overallScore ?? data.readabilityScore ?? null);
                setSummary(data.summary ?? null);
            }
        } catch (error) {
            console.error("Error checking grammar:", error);
        } finally {
            setIsChecking(false);
        }
    };

    const handleApply = (suggestion: GrammarSuggestion) => {
        onApplySuggestion(suggestion.original, suggestion.suggestion);
        setAppliedIds(new Set([...appliedIds, suggestion.id]));
    };

    const handleDismiss = (id: string) => {
        setDismissedIds(new Set([...dismissedIds, id]));
    };

    const handleApplyAll = () => {
        const toApply = visibleSuggestions.filter(
            s => !appliedIds.has(s.id) && !dismissedIds.has(s.id)
        );
        toApply.forEach(s => {
            onApplySuggestion(s.original, s.suggestion);
        });
        setAppliedIds(new Set([...appliedIds, ...toApply.map(s => s.id)]));
    };

    const visibleSuggestions = suggestions.filter(s => !dismissedIds.has(s.id));

    const stats = {
        errors: suggestions.filter(s => s.severity === "error").length,
        warnings: suggestions.filter(s => s.severity === "warning").length,
        suggestions: suggestions.filter(s => s.severity === "suggestion").length,
    };

    const pendingSuggestions = visibleSuggestions.filter(s => !appliedIds.has(s.id));

    return (
        <div className="bg-surface flex h-full flex-col">
            {/* Header */}
            <div className="border-line border-b p-4">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-ink flex items-center gap-2 font-semibold">
                        <SpellCheck className="h-4 w-4" />
                        {t("title")}
                    </h3>
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        {tc("actions.close")}
                    </Button>
                </div>

                {/* Check Controls */}
                <div className="space-y-2">
                    <div className="flex gap-2">
                        <Select value={action} onValueChange={v => setAction(v as CheckAction)}>
                            <SelectTrigger className="flex-1">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {(Object.keys(ACTION_KEYS) as CheckAction[]).map(key => (
                                    <SelectItem key={key} value={key}>
                                        {t(`actions.${ACTION_KEYS[key]}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            onClick={runCheck}
                            disabled={isChecking || !content.trim()}
                            className="bg-brand hover:bg-brand-hi"
                        >
                            {isChecking ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Wand2 className="h-4 w-4" />
                            )}
                        </Button>
                    </div>

                    {action === "adjust_formality" && (
                        <Select
                            value={formalityLevel}
                            onValueChange={v => setFormalityLevel(v as FormalityLevel)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {(Object.keys(FORMALITY_KEYS) as FormalityLevel[]).map(level => (
                                    <SelectItem key={level} value={level}>
                                        {t(`formality.${FORMALITY_KEYS[level]}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </div>
            </div>

            {/* Score & Stats */}
            {overallScore !== null && (
                <div className="border-line border-b p-4">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium">{t("qualityScore")}</span>
                        <span
                            className={cn(
                                "text-lg font-bold",
                                overallScore >= 80
                                    ? "text-green-500"
                                    : overallScore >= 60
                                      ? "text-amber-500"
                                      : "text-red-500"
                            )}
                        >
                            {overallScore}%
                        </span>
                    </div>
                    <Progress value={overallScore} className="h-2" />
                    {summary && <p className="text-ink-3 mt-2 text-xs">{summary}</p>}

                    {/* Stats Badges */}
                    <div className="mt-3 flex gap-2">
                        {stats.errors > 0 && (
                            <Badge variant="destructive" className="text-xs">
                                {t("errorCount", { count: stats.errors })}
                            </Badge>
                        )}
                        {stats.warnings > 0 && (
                            <Badge
                                variant="secondary"
                                className="bg-amber-100 text-xs text-amber-700"
                            >
                                {t("warningCount", { count: stats.warnings })}
                            </Badge>
                        )}
                        {stats.suggestions > 0 && (
                            <Badge variant="secondary" className="text-xs">
                                {t("suggestionCount", { count: stats.suggestions })}
                            </Badge>
                        )}
                    </div>
                </div>
            )}

            {/* Apply All Button */}
            {pendingSuggestions.length > 0 && (
                <div className="border-line border-b p-4">
                    <Button variant="outline" size="sm" className="w-full" onClick={handleApplyAll}>
                        <Check className="mr-2 h-4 w-4" />
                        {t("applyAll", { count: pendingSuggestions.length })}
                    </Button>
                </div>
            )}

            {/* Suggestions List */}
            <ScrollArea className="flex-1">
                <div className="space-y-3 p-4">
                    {!isChecking && suggestions.length === 0 && (
                        <div className="text-ink-3 flex flex-col items-center justify-center py-12">
                            <SpellCheck className="mb-4 h-12 w-12 opacity-20" />
                            <p className="text-sm">{t("empty")}</p>
                            <p className="mt-1 text-xs">{t("emptyHint")}</p>
                        </div>
                    )}

                    {isChecking && (
                        <div className="flex flex-col items-center justify-center py-12">
                            <Loader2 className="text-brand-ink mb-4 h-8 w-8 animate-spin" />
                            <p className="text-ink-3 text-sm">{t("analyzing")}</p>
                        </div>
                    )}

                    {visibleSuggestions.map(suggestion => {
                        const config = severityConfig[suggestion.severity];
                        const Icon = config.icon;
                        const isApplied = appliedIds.has(suggestion.id);

                        return (
                            <div
                                key={suggestion.id}
                                className={cn(
                                    "rounded-lg border p-3 transition-all",
                                    config.border,
                                    config.bg,
                                    isApplied && "opacity-50"
                                )}
                            >
                                <div className="mb-2 flex items-start gap-2">
                                    <Icon className={cn("mt-0.5 h-4 w-4", config.color)} />
                                    <div className="flex-1">
                                        <div className="mb-1 flex items-center gap-2">
                                            <Badge
                                                variant="outline"
                                                className="text-[10px] capitalize"
                                            >
                                                {t.has(`types.${suggestion.type}`)
                                                    ? t(`types.${suggestion.type}`)
                                                    : suggestion.type}
                                            </Badge>
                                            <span className="text-ink-3 text-[10px]">
                                                {t(`severity.${suggestion.severity}`)}
                                            </span>
                                        </div>
                                        <p className="text-sm">
                                            <span className="text-ink-3 line-through">
                                                {suggestion.original}
                                            </span>
                                            {" → "}
                                            <span className="font-medium text-green-600 dark:text-green-400">
                                                {suggestion.suggestion}
                                            </span>
                                        </p>
                                        <p className="text-ink-3 mt-1 text-xs">
                                            {suggestion.explanation}
                                        </p>
                                    </div>
                                </div>

                                {!isApplied && (
                                    <div className="mt-2 flex gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 text-xs"
                                            onClick={() => handleApply(suggestion)}
                                        >
                                            <Check className="mr-1 h-3 w-3" />
                                            {tc("actions.apply")}
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 text-xs"
                                            onClick={() => handleDismiss(suggestion.id)}
                                        >
                                            <X className="mr-1 h-3 w-3" />
                                            {tc("actions.dismiss")}
                                        </Button>
                                    </div>
                                )}

                                {isApplied && (
                                    <div className="mt-2 flex items-center gap-1 text-green-600 dark:text-green-400">
                                        <Check className="h-3 w-3" />
                                        <span className="text-xs">{t("applied")}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </ScrollArea>

            {/* Footer */}
            {suggestions.length > 0 && (
                <div className="border-line border-t p-4">
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={runCheck}
                        disabled={isChecking}
                    >
                        <RefreshCw className={cn("mr-2 h-4 w-4", isChecking && "animate-spin")} />
                        {t("recheck")}
                    </Button>
                </div>
            )}
        </div>
    );
}

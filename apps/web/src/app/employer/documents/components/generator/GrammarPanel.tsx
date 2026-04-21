"use client";

import { useState } from "react";
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
import { Button } from "~/app/employer/documents/components/ui/button";
import { ScrollArea } from "~/app/employer/documents/components/ui/scroll-area";
import { Badge } from "~/app/employer/documents/components/ui/badge";
import { Progress } from "~/app/employer/documents/components/ui/progress";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/app/employer/documents/components/ui/select";
import { cn } from "~/lib/utils";

// Suggestion types
interface GrammarSuggestion {
    id: string;
    type: "grammar" | "spelling" | "punctuation" | "style" | "clarity" | "formality" | "consistency";
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
        label: "Error",
    },
    warning: {
        icon: AlertTriangle,
        color: "text-amber-500",
        bg: "bg-amber-50 dark:bg-amber-900/20",
        border: "border-amber-200 dark:border-amber-800",
        label: "Warning",
    },
    suggestion: {
        icon: Lightbulb,
        color: "text-blue-500",
        bg: "bg-blue-50 dark:bg-blue-900/20",
        border: "border-blue-200 dark:border-blue-800",
        label: "Suggestion",
    },
};

const actionLabels: Record<CheckAction, string> = {
    check: "Full Grammar Check",
    improve_clarity: "Improve Clarity",
    adjust_formality: "Adjust Formality",
    consistency: "Check Consistency",
};

export function GrammarPanel({ content, onApplySuggestion, onClose }: GrammarPanelProps) {
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

            const data = await response.json() as { success: boolean; suggestions?: GrammarSuggestion[]; overallScore?: number; readabilityScore?: number; summary?: string };
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
            (s) => !appliedIds.has(s.id) && !dismissedIds.has(s.id)
        );
        toApply.forEach((s) => {
            onApplySuggestion(s.original, s.suggestion);
        });
        setAppliedIds(new Set([...appliedIds, ...toApply.map((s) => s.id)]));
    };

    const visibleSuggestions = suggestions.filter(
        (s) => !dismissedIds.has(s.id)
    );

    const stats = {
        errors: suggestions.filter((s) => s.severity === "error").length,
        warnings: suggestions.filter((s) => s.severity === "warning").length,
        suggestions: suggestions.filter((s) => s.severity === "suggestion").length,
    };

    const pendingSuggestions = visibleSuggestions.filter(
        (s) => !appliedIds.has(s.id)
    );

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                        <SpellCheck className="w-4 h-4" />
                        Grammar & Style
                    </h3>
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        Close
                    </Button>
                </div>

                {/* Check Controls */}
                <div className="space-y-2">
                    <div className="flex gap-2">
                        <Select value={action} onValueChange={(v) => setAction(v as CheckAction)}>
                            <SelectTrigger className="flex-1">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {Object.entries(actionLabels).map(([key, label]) => (
                                    <SelectItem key={key} value={key}>
                                        {label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            onClick={runCheck}
                            disabled={isChecking || !content.trim()}
                            className="bg-purple-600 hover:bg-purple-700"
                        >
                            {isChecking ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Wand2 className="w-4 h-4" />
                            )}
                        </Button>
                    </div>

                    {action === "adjust_formality" && (
                        <Select
                            value={formalityLevel}
                            onValueChange={(v) => setFormalityLevel(v as FormalityLevel)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="very_formal">Very Formal</SelectItem>
                                <SelectItem value="formal">Formal</SelectItem>
                                <SelectItem value="neutral">Neutral</SelectItem>
                                <SelectItem value="casual">Casual</SelectItem>
                                <SelectItem value="very_casual">Very Casual</SelectItem>
                            </SelectContent>
                        </Select>
                    )}
                </div>
            </div>

            {/* Score & Stats */}
            {overallScore !== null && (
                <div className="p-4 border-b border-border">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">Quality Score</span>
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
                    {summary && (
                        <p className="text-xs text-muted-foreground mt-2">{summary}</p>
                    )}

                    {/* Stats Badges */}
                    <div className="flex gap-2 mt-3">
                        {stats.errors > 0 && (
                            <Badge variant="destructive" className="text-xs">
                                {stats.errors} errors
                            </Badge>
                        )}
                        {stats.warnings > 0 && (
                            <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700">
                                {stats.warnings} warnings
                            </Badge>
                        )}
                        {stats.suggestions > 0 && (
                            <Badge variant="secondary" className="text-xs">
                                {stats.suggestions} suggestions
                            </Badge>
                        )}
                    </div>
                </div>
            )}

            {/* Apply All Button */}
            {pendingSuggestions.length > 0 && (
                <div className="p-4 border-b border-border">
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={handleApplyAll}
                    >
                        <Check className="w-4 h-4 mr-2" />
                        Apply All ({pendingSuggestions.length})
                    </Button>
                </div>
            )}

            {/* Suggestions List */}
            <ScrollArea className="flex-1">
                <div className="p-4 space-y-3">
                    {!isChecking && suggestions.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                            <SpellCheck className="w-12 h-12 mb-4 opacity-20" />
                            <p className="text-sm">No issues found</p>
                            <p className="text-xs mt-1">Run a check to analyze your content</p>
                        </div>
                    )}

                    {isChecking && (
                        <div className="flex flex-col items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-purple-500 mb-4" />
                            <p className="text-sm text-muted-foreground">Analyzing your content...</p>
                        </div>
                    )}

                    {visibleSuggestions.map((suggestion) => {
                        const config = severityConfig[suggestion.severity];
                        const Icon = config.icon;
                        const isApplied = appliedIds.has(suggestion.id);

                        return (
                            <div
                                key={suggestion.id}
                                className={cn(
                                    "p-3 border rounded-lg transition-all",
                                    config.border,
                                    config.bg,
                                    isApplied && "opacity-50"
                                )}
                            >
                                <div className="flex items-start gap-2 mb-2">
                                    <Icon className={cn("w-4 h-4 mt-0.5", config.color)} />
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Badge variant="outline" className="text-[10px] capitalize">
                                                {suggestion.type}
                                            </Badge>
                                            <span className="text-[10px] text-muted-foreground">
                                                {config.label}
                                            </span>
                                        </div>
                                        <p className="text-sm">
                                            <span className="line-through text-muted-foreground">
                                                {suggestion.original}
                                            </span>
                                            {" → "}
                                            <span className="font-medium text-green-600 dark:text-green-400">
                                                {suggestion.suggestion}
                                            </span>
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {suggestion.explanation}
                                        </p>
                                    </div>
                                </div>

                                {!isApplied && (
                                    <div className="flex gap-2 mt-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 text-xs"
                                            onClick={() => handleApply(suggestion)}
                                        >
                                            <Check className="w-3 h-3 mr-1" />
                                            Apply
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 text-xs"
                                            onClick={() => handleDismiss(suggestion.id)}
                                        >
                                            <X className="w-3 h-3 mr-1" />
                                            Dismiss
                                        </Button>
                                    </div>
                                )}

                                {isApplied && (
                                    <div className="flex items-center gap-1 mt-2 text-green-600 dark:text-green-400">
                                        <Check className="w-3 h-3" />
                                        <span className="text-xs">Applied</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </ScrollArea>

            {/* Footer */}
            {suggestions.length > 0 && (
                <div className="p-4 border-t border-border">
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={runCheck}
                        disabled={isChecking}
                    >
                        <RefreshCw className={cn("w-4 h-4 mr-2", isChecking && "animate-spin")} />
                        Re-check
                    </Button>
                </div>
            )}
        </div>
    );
}

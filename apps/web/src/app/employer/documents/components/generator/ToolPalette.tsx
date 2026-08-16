"use client";

import { useState } from "react";
import {
    Sparkles,
    FileSearch,
    Globe,
    SpellCheck,
    ListTree,
    Quote,
    Download,
    ChevronDown,
    ChevronRight,
    Wand2,
    RefreshCw,
    FileText,
    Lightbulb,
    PanelLeftClose,
    PanelLeft,
    GraduationCap,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";

// Tool types
export type ToolType =
    | "ai-generate"
    | "doc-research"
    | "web-research"
    | "arxiv-research"
    | "grammar"
    | "outline"
    | "citation"
    | "export";

// Action types for AI generation
export type AIAction =
    | "generate_section"
    | "expand"
    | "rewrite"
    | "summarize"
    | "change_tone"
    | "continue";

interface ToolPaletteProps {
    activeTool: ToolType | null;
    onToolSelect: (tool: ToolType) => void;
    onAIAction?: (action: AIAction, prompt?: string) => void;
    hasSelection?: boolean;
    className?: string;
    isCollapsed?: boolean;
    onToggleCollapse?: () => void;
}

interface ToolItem {
    id: ToolType;
    name: string;
    shortName: string;
    description: string;
    icon: React.ReactNode;
    color: string;
    bgColor: string;
}

const tools: ToolItem[] = [
    {
        id: "ai-generate",
        name: "AI Content",
        shortName: "AI",
        description: "Generate, expand, or rewrite content",
        icon: <Sparkles className="h-4 w-4" />,
        color: "text-purple-500",
        bgColor: "bg-purple-500/10",
    },
    {
        id: "doc-research",
        name: "Document Research",
        shortName: "Docs",
        description: "Search your uploaded documents",
        icon: <FileSearch className="h-4 w-4" />,
        color: "text-blue-500",
        bgColor: "bg-blue-500/10",
    },
    {
        id: "web-research",
        name: "Web Research",
        shortName: "Web",
        description: "Find information from the web",
        icon: <Globe className="h-4 w-4" />,
        color: "text-green-500",
        bgColor: "bg-green-500/10",
    },
    {
        id: "arxiv-research",
        name: "arXiv Papers",
        shortName: "arXiv",
        description: "Search academic papers from arXiv",
        icon: <GraduationCap className="h-4 w-4" />,
        color: "text-rose-500",
        bgColor: "bg-rose-500/10",
    },
    {
        id: "grammar",
        name: "Grammar & Style",
        shortName: "Grammar",
        description: "Check grammar and improve writing",
        icon: <SpellCheck className="h-4 w-4" />,
        color: "text-orange-500",
        bgColor: "bg-orange-500/10",
    },
    {
        id: "outline",
        name: "Outline",
        shortName: "Outline",
        description: "Generate or view document structure",
        icon: <ListTree className="h-4 w-4" />,
        color: "text-cyan-500",
        bgColor: "bg-cyan-500/10",
    },
    {
        id: "citation",
        name: "Citations",
        shortName: "Cite",
        description: "Manage references and bibliography",
        icon: <Quote className="h-4 w-4" />,
        color: "text-pink-500",
        bgColor: "bg-pink-500/10",
    },
    {
        id: "export",
        name: "Export",
        shortName: "Export",
        description: "Download as PDF, DOCX, or Markdown",
        icon: <Download className="h-4 w-4" />,
        color: "text-slate-500",
        bgColor: "bg-slate-500/10",
    },
];

const quickActions: {
    label: string;
    shortLabel: string;
    action: AIAction;
    icon: React.ReactNode;
    requiresSelection?: boolean;
}[] = [
    {
        label: "Generate Section",
        shortLabel: "Generate",
        action: "generate_section",
        icon: <FileText className="h-3.5 w-3.5" />,
    },
    {
        label: "Continue Writing",
        shortLabel: "Continue",
        action: "continue",
        icon: <Wand2 className="h-3.5 w-3.5" />,
    },
    {
        label: "Expand",
        shortLabel: "Expand",
        action: "expand",
        icon: <Lightbulb className="h-3.5 w-3.5" />,
        requiresSelection: true,
    },
    {
        label: "Rewrite",
        shortLabel: "Rewrite",
        action: "rewrite",
        icon: <RefreshCw className="h-3.5 w-3.5" />,
        requiresSelection: true,
    },
];

export function ToolPalette({
    activeTool,
    onToolSelect,
    onAIAction,
    hasSelection = false,
    className,
    isCollapsed = false,
    onToggleCollapse,
}: ToolPaletteProps) {
    const [isQuickActionsOpen, setIsQuickActionsOpen] = useState(true);

    return (
        <TooltipProvider delayDuration={0}>
            <div
                className={cn(
                    "bg-background border-border flex h-full flex-col border-r transition-all duration-200",
                    isCollapsed ? "w-[60px]" : "w-full min-w-[200px]",
                    className
                )}
            >
                {/* Header */}
                <div
                    className={cn(
                        "border-border flex items-center border-b",
                        isCollapsed ? "justify-center p-2" : "justify-between p-4"
                    )}
                >
                    {!isCollapsed && (
                        <div>
                            <h3 className="text-foreground text-sm font-semibold">Tools</h3>
                            <p className="text-muted-foreground mt-0.5 text-xs">
                                Enhance your document
                            </p>
                        </div>
                    )}
                    {onToggleCollapse && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0"
                                    onClick={onToggleCollapse}
                                >
                                    {isCollapsed ? (
                                        <PanelLeft className="h-4 w-4" />
                                    ) : (
                                        <PanelLeftClose className="h-4 w-4" />
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                                {isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                            </TooltipContent>
                        </Tooltip>
                    )}
                </div>

                {/* Quick Actions - Hidden when collapsed */}
                {!isCollapsed && (
                    <Collapsible
                        open={isQuickActionsOpen}
                        onOpenChange={setIsQuickActionsOpen}
                        className="border-border border-b"
                    >
                        <CollapsibleTrigger asChild>
                            <Button
                                variant="ghost"
                                className="hover:bg-muted/50 h-auto w-full justify-between px-4 py-2"
                            >
                                <span className="flex items-center gap-2 text-sm font-medium">
                                    <Sparkles className="h-4 w-4 text-purple-500" />
                                    Quick Actions
                                </span>
                                {isQuickActionsOpen ? (
                                    <ChevronDown className="text-muted-foreground h-4 w-4" />
                                ) : (
                                    <ChevronRight className="text-muted-foreground h-4 w-4" />
                                )}
                            </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <div className="grid grid-cols-2 gap-1 px-3 pb-3">
                                {quickActions.map(qa => {
                                    const isDisabled = qa.requiresSelection && !hasSelection;
                                    return (
                                        <Tooltip key={qa.action}>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={isDisabled}
                                                    className={cn(
                                                        "h-9 justify-start gap-1.5 px-2 text-xs",
                                                        isDisabled &&
                                                            "cursor-not-allowed opacity-50"
                                                    )}
                                                    onClick={() => onAIAction?.(qa.action)}
                                                >
                                                    {qa.icon}
                                                    <span className="truncate">
                                                        {qa.shortLabel}
                                                    </span>
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom">
                                                {qa.label}
                                                {qa.requiresSelection && !hasSelection && (
                                                    <span className="text-muted-foreground ml-1">
                                                        (select text)
                                                    </span>
                                                )}
                                            </TooltipContent>
                                        </Tooltip>
                                    );
                                })}
                            </div>
                        </CollapsibleContent>
                    </Collapsible>
                )}

                {/* Tool List */}
                <div className={cn("flex-1 overflow-y-auto", isCollapsed ? "p-1.5" : "p-2")}>
                    <div className={cn(isCollapsed ? "space-y-1" : "space-y-1")}>
                        {tools.map(tool => {
                            const isActive = activeTool === tool.id;

                            if (isCollapsed) {
                                // Collapsed mode: Icon only with tooltip
                                return (
                                    <Tooltip key={tool.id}>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className={cn(
                                                    "relative h-11 w-full",
                                                    isActive &&
                                                        "border border-purple-300 bg-purple-100 dark:border-purple-700 dark:bg-purple-900/30"
                                                )}
                                                onClick={() => onToolSelect(tool.id)}
                                            >
                                                <div
                                                    className={cn(
                                                        "rounded-lg p-2 transition-colors",
                                                        isActive
                                                            ? "bg-purple-500 text-white"
                                                            : tool.bgColor
                                                    )}
                                                >
                                                    <span className={cn(!isActive && tool.color)}>
                                                        {tool.icon}
                                                    </span>
                                                </div>
                                                {isActive && (
                                                    <div className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r bg-purple-500" />
                                                )}
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent
                                            side="right"
                                            className="flex flex-col gap-0.5"
                                        >
                                            <span className="font-medium">{tool.name}</span>
                                            <span className="text-muted-foreground text-xs">
                                                {tool.description}
                                            </span>
                                        </TooltipContent>
                                    </Tooltip>
                                );
                            }

                            // Expanded mode: Full button with text
                            return (
                                <Button
                                    key={tool.id}
                                    variant={isActive ? "secondary" : "ghost"}
                                    className={cn(
                                        "h-auto w-full justify-start gap-3 px-3 py-2.5",
                                        isActive &&
                                            "border border-purple-200 bg-purple-100 dark:border-purple-800 dark:bg-purple-900/30"
                                    )}
                                    onClick={() => onToolSelect(tool.id)}
                                >
                                    <div
                                        className={cn(
                                            "shrink-0 rounded-md p-1.5",
                                            isActive ? "bg-purple-500 text-white" : tool.bgColor
                                        )}
                                    >
                                        <span className={cn(!isActive && tool.color)}>
                                            {tool.icon}
                                        </span>
                                    </div>
                                    <div className="min-w-0 flex-1 text-left">
                                        <div className="truncate text-sm font-medium">
                                            {tool.name}
                                        </div>
                                        <div className="text-muted-foreground truncate text-xs">
                                            {tool.description}
                                        </div>
                                    </div>
                                </Button>
                            );
                        })}
                    </div>
                </div>

                {/* Footer Hint - Hidden when collapsed */}
                {!isCollapsed && (
                    <div className="border-border border-t p-3">
                        <div className="text-muted-foreground bg-muted/50 rounded-lg p-2.5 text-xs">
                            <p className="mb-1 font-medium">Shortcuts</p>
                            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                                <p>
                                    <kbd className="bg-background rounded px-1 text-[10px]">⌘K</kbd>{" "}
                                    AI
                                </p>
                                <p>
                                    <kbd className="bg-background rounded px-1 text-[10px]">⌘S</kbd>{" "}
                                    Save
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </TooltipProvider>
    );
}

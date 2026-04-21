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
import { Button } from "~/app/employer/documents/components/ui/button";
import { cn } from "~/lib/utils";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "~/app/employer/documents/components/ui/collapsible";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "~/app/employer/documents/components/ui/tooltip";

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
        icon: <Sparkles className="w-4 h-4" />,
        color: "text-purple-500",
        bgColor: "bg-purple-500/10",
    },
    {
        id: "doc-research",
        name: "Document Research",
        shortName: "Docs",
        description: "Search your uploaded documents",
        icon: <FileSearch className="w-4 h-4" />,
        color: "text-blue-500",
        bgColor: "bg-blue-500/10",
    },
    {
        id: "web-research",
        name: "Web Research",
        shortName: "Web",
        description: "Find information from the web",
        icon: <Globe className="w-4 h-4" />,
        color: "text-green-500",
        bgColor: "bg-green-500/10",
    },
    {
        id: "arxiv-research",
        name: "arXiv Papers",
        shortName: "arXiv",
        description: "Search academic papers from arXiv",
        icon: <GraduationCap className="w-4 h-4" />,
        color: "text-rose-500",
        bgColor: "bg-rose-500/10",
    },
    {
        id: "grammar",
        name: "Grammar & Style",
        shortName: "Grammar",
        description: "Check grammar and improve writing",
        icon: <SpellCheck className="w-4 h-4" />,
        color: "text-orange-500",
        bgColor: "bg-orange-500/10",
    },
    {
        id: "outline",
        name: "Outline",
        shortName: "Outline",
        description: "Generate or view document structure",
        icon: <ListTree className="w-4 h-4" />,
        color: "text-cyan-500",
        bgColor: "bg-cyan-500/10",
    },
    {
        id: "citation",
        name: "Citations",
        shortName: "Cite",
        description: "Manage references and bibliography",
        icon: <Quote className="w-4 h-4" />,
        color: "text-pink-500",
        bgColor: "bg-pink-500/10",
    },
    {
        id: "export",
        name: "Export",
        shortName: "Export",
        description: "Download as PDF, DOCX, or Markdown",
        icon: <Download className="w-4 h-4" />,
        color: "text-slate-500",
        bgColor: "bg-slate-500/10",
    },
];

const quickActions: { label: string; shortLabel: string; action: AIAction; icon: React.ReactNode; requiresSelection?: boolean }[] = [
    {
        label: "Generate Section",
        shortLabel: "Generate",
        action: "generate_section",
        icon: <FileText className="w-3.5 h-3.5" />,
    },
    {
        label: "Continue Writing",
        shortLabel: "Continue",
        action: "continue",
        icon: <Wand2 className="w-3.5 h-3.5" />,
    },
    {
        label: "Expand",
        shortLabel: "Expand",
        action: "expand",
        icon: <Lightbulb className="w-3.5 h-3.5" />,
        requiresSelection: true,
    },
    {
        label: "Rewrite",
        shortLabel: "Rewrite",
        action: "rewrite",
        icon: <RefreshCw className="w-3.5 h-3.5" />,
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
                    "flex flex-col h-full bg-background border-r border-border transition-all duration-200",
                    isCollapsed ? "w-[60px]" : "w-full min-w-[200px]",
                    className
                )}
            >
                {/* Header */}
                <div className={cn(
                    "border-b border-border flex items-center",
                    isCollapsed ? "p-2 justify-center" : "p-4 justify-between"
                )}>
                    {!isCollapsed && (
                        <div>
                            <h3 className="font-semibold text-sm text-foreground">Tools</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
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
                                        <PanelLeft className="w-4 h-4" />
                                    ) : (
                                        <PanelLeftClose className="w-4 h-4" />
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
                        className="border-b border-border"
                    >
                        <CollapsibleTrigger asChild>
                            <Button
                                variant="ghost"
                                className="w-full justify-between px-4 py-2 h-auto hover:bg-muted/50"
                            >
                                <span className="flex items-center gap-2 text-sm font-medium">
                                    <Sparkles className="w-4 h-4 text-purple-500" />
                                    Quick Actions
                                </span>
                                {isQuickActionsOpen ? (
                                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                ) : (
                                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                )}
                            </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <div className="px-3 pb-3 grid grid-cols-2 gap-1">
                                {quickActions.map((qa) => {
                                    const isDisabled = qa.requiresSelection && !hasSelection;
                                    return (
                                        <Tooltip key={qa.action}>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={isDisabled}
                                                    className={cn(
                                                        "h-9 text-xs gap-1.5 justify-start px-2",
                                                        isDisabled && "opacity-50 cursor-not-allowed"
                                                    )}
                                                    onClick={() => onAIAction?.(qa.action)}
                                                >
                                                    {qa.icon}
                                                    <span className="truncate">{qa.shortLabel}</span>
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom">
                                                {qa.label}
                                                {qa.requiresSelection && !hasSelection && (
                                                    <span className="text-muted-foreground ml-1">(select text)</span>
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
                <div className={cn(
                    "flex-1 overflow-y-auto",
                    isCollapsed ? "p-1.5" : "p-2"
                )}>
                    <div className={cn(
                        isCollapsed ? "space-y-1" : "space-y-1"
                    )}>
                        {tools.map((tool) => {
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
                                                    "w-full h-11 relative",
                                                    isActive && "bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700"
                                                )}
                                                onClick={() => onToolSelect(tool.id)}
                                            >
                                                <div
                                                    className={cn(
                                                        "p-2 rounded-lg transition-colors",
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
                                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-purple-500 rounded-r" />
                                                )}
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="right" className="flex flex-col gap-0.5">
                                            <span className="font-medium">{tool.name}</span>
                                            <span className="text-xs text-muted-foreground">{tool.description}</span>
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
                                        "w-full justify-start gap-3 h-auto py-2.5 px-3",
                                        isActive && "bg-purple-100 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800"
                                    )}
                                    onClick={() => onToolSelect(tool.id)}
                                >
                                    <div
                                        className={cn(
                                            "p-1.5 rounded-md shrink-0",
                                            isActive
                                                ? "bg-purple-500 text-white"
                                                : tool.bgColor
                                        )}
                                    >
                                        <span className={cn(!isActive && tool.color)}>
                                            {tool.icon}
                                        </span>
                                    </div>
                                    <div className="flex-1 text-left min-w-0">
                                        <div className="text-sm font-medium truncate">{tool.name}</div>
                                        <div className="text-xs text-muted-foreground truncate">
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
                    <div className="p-3 border-t border-border">
                        <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-2.5">
                            <p className="font-medium mb-1">Shortcuts</p>
                            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                                <p><kbd className="px-1 bg-background rounded text-[10px]">⌘K</kbd> AI</p>
                                <p><kbd className="px-1 bg-background rounded text-[10px]">⌘S</kbd> Save</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </TooltipProvider>
    );
}

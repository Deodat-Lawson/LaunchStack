"use client";

/**
 * Conversation-shaped rendering for stored conversations: imported agent
 * sessions (Claude Code / Codex) and conversations an assistant (Claude,
 * ChatGPT, Gemini) saved over MCP.
 *
 * Both are stored as Markdown, but they read as conversations, not documents
 * — so this viewer parses the fixed grammar back into turns
 * (~/lib/session-transcript) and lays them out as a chat: speaker turns,
 * tool-call chips, collapsible tool output. A saved conversation is labelled
 * with the assistant it came from. The stored Markdown stays one toggle
 * away: a transcript that drifted from the grammar degrades to the ordinary
 * markdown view, never to an error page.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslations } from "next-intl";
import {
    AlertTriangle,
    BookOpen,
    Bot,
    ChevronRight,
    GitBranch,
    Loader2,
    MessageSquarePlus,
    MessagesSquare,
    RotateCw,
    TerminalSquare,
    User,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { useContextTarget } from "~/components/context-menu";
import { copyText } from "~/lib/context-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import {
    agentSessionMeta,
    assistantConversationMeta,
    isAssistantConversationDocument,
    parseSessionTranscript,
    type ParsedSessionTranscript,
    type TranscriptSegment,
} from "~/lib/session-transcript";
import type { DocumentType } from "../types";

const MarkdownViewer = dynamic(() => import("./MarkdownViewer").then(m => m.MarkdownViewer), {
    ssr: false,
});

interface ConversationViewerProps {
    document: DocumentType;
}

/** Badge for an imported agent session, by the tool that wrote it. */
const TOOL_LABELS: Record<string, string> = {
    "claude-code": "Claude Code",
    codex: "Codex",
};
// A saved assistant conversation is badged by its assistant instead:
// Claude / ChatGPT / Gemini / Assistant (ASSISTANT_LABELS in ~/lib/session-transcript).

/** Markdown inside a turn: GFM, tight spacing, token colors. */
function TurnMarkdown({ text }: { text: string }) {
    return (
        <div className="conversation-turn-md text-ink text-[13.5px] leading-relaxed">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    a: ({ href, children, ...props }) => (
                        <a
                            href={href}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-brand-ink decoration-brand/40 underline underline-offset-2"
                            {...props}
                        >
                            {children}
                        </a>
                    ),
                    code: ({ className, children, ...props }) => {
                        const isBlock = (className ?? "").includes("language-");
                        return isBlock ? (
                            <code className={`${className ?? ""} font-mono text-xs`} {...props}>
                                {children}
                            </code>
                        ) : (
                            <code
                                className="bg-panel-2 border-line-2 text-ink rounded border px-1 py-0.5 font-mono text-[11.5px]"
                                {...props}
                            >
                                {children}
                            </code>
                        );
                    },
                    pre: ({ children }) => (
                        <pre className="bg-panel-2 border-line-2 my-2 overflow-x-auto rounded-lg border p-3 font-mono text-xs leading-relaxed">
                            {children}
                        </pre>
                    ),
                    ul: ({ children }) => (
                        <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>
                    ),
                    ol: ({ children }) => (
                        <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>
                    ),
                    p: ({ children }) => <p className="my-1.5">{children}</p>,
                }}
            >
                {text}
            </ReactMarkdown>
        </div>
    );
}

function SpeakerTurn({
    role,
    at,
    assistantName,
    children,
}: {
    role: "user" | "assistant";
    at?: string | null;
    /** What to call the assistant: its name for a saved conversation. */
    assistantName?: string;
    children: React.ReactNode;
}) {
    const t = useTranslations("viewers.conversation");
    const isUser = role === "user";
    const Icon = isUser ? User : Bot;
    const assistant = assistantName ?? t("assistant");
    const bubble = useRef<HTMLDivElement>(null);
    const ctxTarget = useContextTarget({
        kind: "transcript-turn",
        label: isUser ? t("userTurn") : t("assistantTurn", { name: assistant }),
        items: () => [
            {
                type: "item",
                id: "copy",
                label: t("copyTurn"),
                icon: "copy",
                onSelect: () => {
                    void copyText(bubble.current?.innerText ?? "");
                },
            },
        ],
    });
    return (
        <div className="flex gap-3" {...ctxTarget}>
            <div
                className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${
                    isUser ? "bg-brand text-brand-fg" : "bg-panel-2 text-ink-2 border-line border"
                }`}
            >
                <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-ink text-xs font-semibold">
                        {isUser ? t("user") : assistant}
                    </span>
                    {at && <span className="text-ink-4 font-mono text-[10px]">{at}</span>}
                </div>
                <div
                    ref={bubble}
                    className={`rounded-xl border px-4 py-3 ${
                        isUser ? "border-brand/25 bg-brand-soft/60" : "border-line bg-panel"
                    }`}
                >
                    {children}
                </div>
            </div>
        </div>
    );
}

function ToolCallRow({
    name,
    summary,
    result,
}: {
    name: string;
    summary: string;
    result: string | null;
}) {
    const t = useTranslations("viewers.conversation");
    const [open, setOpen] = useState(false);
    const row = (
        <div className="text-ink-3 flex min-w-0 items-center gap-2 font-mono text-[11.5px]">
            <TerminalSquare className="text-ink-4 h-3.5 w-3.5 flex-shrink-0" />
            <span className="text-ink-2 font-semibold">{name}</span>
            {summary && <span className="truncate">{summary}</span>}
        </div>
    );

    if (result === null) {
        return (
            <div className="border-line-2 bg-panel-2/50 ml-10 rounded-lg border px-3 py-2">
                {row}
            </div>
        );
    }

    return (
        <Collapsible
            open={open}
            onOpenChange={setOpen}
            className="border-line-2 bg-panel-2/50 ml-10 rounded-lg border"
        >
            <CollapsibleTrigger asChild>
                <button
                    type="button"
                    className="hover:bg-panel-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors"
                >
                    <ChevronRight
                        className={`text-ink-4 h-3.5 w-3.5 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                    />
                    {row}
                    <span className="text-ink-4 ml-auto flex-shrink-0 font-mono text-[10px]">
                        {t("chars", { count: result.length })}
                    </span>
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <pre className="text-ink-2 border-line-2 max-h-72 overflow-auto border-t px-3 py-2 font-mono text-[11px] leading-relaxed">
                    {result}
                </pre>
            </CollapsibleContent>
        </Collapsible>
    );
}

/** Pair each tool call with the result that directly follows it. */
function pairSegments(
    segments: readonly TranscriptSegment[]
): (TranscriptSegment | { kind: "tool-pair"; name: string; summary: string; result: string })[] {
    const out: ReturnType<typeof pairSegments> = [];
    for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i]!;
        const next = segments[i + 1];
        if (segment.kind === "tool-call" && next?.kind === "tool-result") {
            out.push({
                kind: "tool-pair",
                name: segment.name,
                summary: segment.summary,
                result: next.text,
            });
            i += 1;
        } else {
            out.push(segment);
        }
    }
    return out;
}

export function ConversationViewer({ document }: ConversationViewerProps) {
    const t = useTranslations("viewers.conversation");
    const tc = useTranslations("common");
    const router = useRouter();
    const [content, setContent] = useState<string | null>(null);
    // "" when the failure carried no message — the fallback is worded at render.
    const [error, setError] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<"conversation" | "markdown">("conversation");

    const fetchContent = useCallback(async () => {
        setError(null);
        try {
            const res = await fetch(document.url);
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            setContent(await res.text());
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "");
        }
    }, [document.url]);

    useEffect(() => {
        setContent(null);
        void fetchContent();
    }, [fetchContent]);

    const saved = isAssistantConversationDocument(document);
    const parsed: ParsedSessionTranscript | null = useMemo(
        () =>
            content === null
                ? null
                : parseSessionTranscript(content, {
                      format: saved ? "assistant-conversation" : "agent-session",
                  }),
        [content, saved]
    );
    const meta = useMemo(() => agentSessionMeta(document), [document]);
    const savedMeta = useMemo(() => assistantConversationMeta(document), [document]);
    // Claude, ChatGPT and Gemini are names; anything else is "the assistant".
    const assistantName =
        saved && savedMeta.assistant && savedMeta.assistant !== "other"
            ? savedMeta.label
            : t("assistant");
    const badge = saved
        ? assistantName
        : meta.tool
          ? (TOOL_LABELS[meta.tool] ?? meta.tool)
          : t("agentSession");

    const stats = useMemo(() => {
        if (!parsed) return { turns: 0, toolCalls: 0 };
        return {
            turns: parsed.segments.filter(s => s.kind === "user" || s.kind === "assistant").length,
            toolCalls: parsed.segments.filter(s => s.kind === "tool-call").length,
        };
    }, [parsed]);

    const continueHref =
        typeof document.id === "number"
            ? `/employer/documents?feature=chat&continue=${document.id}`
            : null;

    if (viewMode === "markdown") {
        return (
            <div className="bg-surface flex h-full flex-col overflow-hidden">
                <div className="border-line bg-panel flex flex-shrink-0 items-center justify-between border-b px-4 py-1.5">
                    <span className="text-ink-3 font-mono text-[10px]">{t("storedMarkdown")}</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-brand-ink hover:bg-brand-soft h-7 gap-1.5 text-xs"
                        onClick={() => setViewMode("conversation")}
                    >
                        <MessagesSquare className="h-3.5 w-3.5" />
                        {t("conversationView")}
                    </Button>
                </div>
                <div className="min-h-0 flex-1">
                    <MarkdownViewer url={document.url} title={document.title} />
                </div>
            </div>
        );
    }

    return (
        <div className="bg-surface flex h-full flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="border-line bg-panel flex flex-shrink-0 items-center justify-between gap-3 border-b px-4 py-2">
                <div className="text-ink-3 flex min-w-0 items-center gap-2 font-mono text-[10px]">
                    <span className="bg-brand-soft text-brand-ink rounded px-1.5 py-0.5 font-semibold">
                        {badge}
                    </span>
                    <span>
                        {saved
                            ? t("messageCount", { count: stats.turns })
                            : t("turnStats", { turns: stats.turns, toolCalls: stats.toolCalls })}
                    </span>
                    {saved && savedMeta.clientName && savedMeta.clientName !== savedMeta.label && (
                        <span className="hidden truncate sm:inline">{savedMeta.clientName}</span>
                    )}
                    {saved && savedMeta.model && (
                        <span className="hidden truncate lg:inline">{savedMeta.model}</span>
                    )}
                    {meta.gitBranch && (
                        <span className="hidden items-center gap-1 sm:inline-flex">
                            <GitBranch className="h-3 w-3" />
                            {meta.gitBranch}
                        </span>
                    )}
                    {meta.projectPath && (
                        <span className="hidden truncate lg:inline">{meta.projectPath}</span>
                    )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                    {continueHref && (
                        <Button
                            size="sm"
                            className="bg-brand hover:bg-brand-hi text-brand-fg h-7 gap-1.5 text-xs"
                            onClick={() => router.push(continueHref)}
                        >
                            <MessageSquarePlus className="h-3.5 w-3.5" />
                            {t("continue")}
                        </Button>
                    )}
                    <TooltipProvider delayDuration={300}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-ink-3 hover:bg-brand-soft hover:text-brand-ink h-7 w-7 rounded-md"
                                    onClick={() => setViewMode("markdown")}
                                >
                                    <BookOpen className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                <p className="text-xs">{t("viewStoredMarkdown")}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto">
                {content === null && error === null && (
                    <div className="flex h-full flex-col items-center justify-center gap-3">
                        <Loader2 className="text-brand-ink h-7 w-7 animate-spin" />
                        <p className="text-ink-3 text-sm font-medium">{t("loading")}</p>
                    </div>
                )}
                {error !== null && (
                    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                        <div className="bg-danger/10 flex h-12 w-12 items-center justify-center rounded-2xl">
                            <AlertTriangle className="text-danger h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-ink mb-1 text-sm font-medium">{t("loadFailed")}</p>
                            <p className="text-ink-3 mb-4 text-xs">
                                {error || t("loadFailedFallback")}
                            </p>
                            <Button size="sm" variant="outline" onClick={() => void fetchContent()}>
                                <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                                {tc("actions.retry")}
                            </Button>
                        </div>
                    </div>
                )}
                {parsed && (
                    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
                        {/* Provenance header */}
                        <div className="border-line bg-panel rounded-xl border px-4 py-3">
                            <h1 className="text-ink text-base font-semibold leading-snug">
                                {parsed.title ?? document.title}
                            </h1>
                            {parsed.provenance.length > 0 && (
                                <div className="text-ink-3 mt-1.5 space-y-0.5 text-xs">
                                    {parsed.provenance.map((line, i) => (
                                        <p key={i}>{line}</p>
                                    ))}
                                </div>
                            )}
                        </div>

                        {pairSegments(parsed.segments).map((segment, i) => {
                            if (segment.kind === "user" || segment.kind === "assistant") {
                                return (
                                    <SpeakerTurn
                                        key={i}
                                        role={segment.kind}
                                        at={segment.at}
                                        assistantName={assistantName}
                                    >
                                        <TurnMarkdown text={segment.text} />
                                    </SpeakerTurn>
                                );
                            }
                            if (segment.kind === "tool-pair") {
                                return (
                                    <ToolCallRow
                                        key={i}
                                        name={segment.name}
                                        summary={segment.summary}
                                        result={segment.result}
                                    />
                                );
                            }
                            if (segment.kind === "tool-call") {
                                return (
                                    <ToolCallRow
                                        key={i}
                                        name={segment.name}
                                        summary={segment.summary}
                                        result={null}
                                    />
                                );
                            }
                            return (
                                <ToolCallRow
                                    key={i}
                                    name={t("output")}
                                    summary=""
                                    result={segment.text}
                                />
                            );
                        })}

                        {parsed.segments.length === 0 && (
                            <div className="border-line text-ink-3 flex items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-[13px]">
                                <MessagesSquare className="h-4 w-4" />
                                {t("empty")}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

"use client";

import React, {
    type Dispatch,
    type SetStateAction,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useEmployerWorkspaceSwitcher } from "../../_chrome/EmployerWorkspaceSwitcherContext";
import {
    SOURCE_META,
    type ComposerSend,
    type EphemeralAttachment,
    type ThreadMessage,
    type ThreadReference,
    type WorkspaceSource,
} from "./types";
import {
    Plus,
    Copy,
    Quote,
    Pencil,
    RotateCcw,
    GitBranch,
    Bookmark,
    ArrowDown,
    ChevronUp,
    ChevronDown,
    Zap as IconBolt,
    ChevronRight as IconChevronRight,
    Plus as IconPlus,
    Shield as IconShield,
    User as IconUser,
    X as IconX,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import type { ChatSendResult } from "~/lib/chat-turns";
import { AgentAvatar } from "./collab/AgentAvatar";
import { type ChatAgentOption } from "./collab/types";
import { useContextTarget } from "~/components/context-menu";
import { copyText } from "~/lib/context-menu";
import {
    buildAnswerMenuItems,
    buildChatPaneMenuItems,
    buildCitationMenuItems,
    buildContextChipMenuItems,
    buildQuestionMenuItems,
} from "./chatContextMenu";
import {
    downloadTextFile,
    parseQuotedMessage,
    quoteBlock,
    transcriptFilename,
    transcriptMarkdown,
    plainTextOfAnswer,
} from "./transcript";
import type { AskStarter } from "~/lib/ask-starters/contract";
import { AskStarters } from "./AskStarters";
import { WORKSPACE_HEADER_HEIGHT_PX } from "./workspaceHeader";
import { Composer } from "./ChatComposer";
import { ChatAttachmentChip as AttachmentChip } from "./ChatAttachmentChip";
import { ChatMarkdown } from "./ChatMarkdown";
import { ProposedPlan } from "./ProposedPlan";
import { messageAnchor, useChatTimeline } from "./useChatTimeline";

/** Chat transcript column and composer share this width. */
const CHAT_COLUMN_MAX_PX = 760;
/** Horizontal gutter: main-area header bar, scroll column, and composer share this inset. */
const CHAT_GUTTER_X_PX = 24;

/** Shared chrome for AskPanel and ExpandedFeatureView top bars (padding aligns with chat body). */
export function workspaceMainHeaderBarStyle(leadingChromeInsetPx = 0): React.CSSProperties {
    return {
        flexShrink: 0,
        // Fixed, so the rule under it lines up with the next column's.
        height: WORKSPACE_HEADER_HEIGHT_PX,
        boxSizing: "border-box",
        borderBottom: "1px solid var(--line)",
        background: "var(--panel)",
        paddingTop: 10,
        paddingBottom: 10,
        paddingRight: CHAT_GUTTER_X_PX,
        paddingLeft: CHAT_GUTTER_X_PX + leadingChromeInsetPx,
        display: "flex",
        alignItems: "center",
        gap: 12,
    };
}

/** Text to put in the composer: a quote to reply around, or a question to edit. */
export interface ComposerSeed {
    /** The conversation that requested this edit or quote. */
    draftKey?: string;
    webSearch?: boolean;
    thinking?: boolean;
    agentKey?: string | null;
    text: string;
    mode: "append" | "replace";
    /** Distinguishes repeat seeds with the same text. */
    nonce: number;
    attachments?: EphemeralAttachment[];
    refs?: string[];
    modelRoute?: ComposerSend["modelRoute"];
    modelRoutes?: ComposerSend["modelRoutes"];
    threadRefs?: string[];
    reasoningEffort?: string;
    chatMode?: ComposerSend["chatMode"];
}

async function copyWithToast(text: string, what = "Copied"): Promise<void> {
    if (await copyText(text)) toast.success(what);
    else toast.error("Couldn't copy");
}

interface SourceChipProps {
    source: WorkspaceSource;
    onRemove?: () => void;
    onOpen?: () => void;
    size?: "sm" | "md";
}

export function SourceChip({ source, onRemove, onOpen, size = "md" }: SourceChipProps) {
    const meta = SOURCE_META[source.type] ?? SOURCE_META.doc;
    const Icon = meta.Icon;
    const small = size === "sm";
    const ctxTarget = useContextTarget(
        onOpen || onRemove
            ? {
                  kind: "context-chip",
                  id: source.id,
                  label: `Actions for ${source.title}`,
                  data: source,
                  items: () => buildContextChipMenuItems(source, { onOpen, onRemove }),
              }
            : null
    );
    return (
        <span
            {...ctxTarget}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: small ? "2px 8px" : "4px 10px",
                background: "var(--accent-soft)",
                border: "1px solid transparent",
                borderRadius: 999,
                fontSize: small ? 11 : 12,
                fontWeight: 500,
                color: "var(--accent-ink)",
                maxWidth: 260,
            }}
        >
            <span style={{ color: meta.color, flexShrink: 0 }}>
                <Icon size={small ? 11 : 12} />
            </span>
            {onOpen ? (
                <button
                    type="button"
                    aria-label={`Open ${source.title}`}
                    onClick={onOpen}
                    style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        textAlign: "left",
                    }}
                >
                    {source.title}
                </button>
            ) : (
                <span
                    style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                    {source.title}
                </span>
            )}
            {onRemove && (
                <button
                    type="button"
                    aria-label={`Remove ${source.title} from context`}
                    onClick={onRemove}
                    style={{ color: "var(--ink-3)", display: "flex", alignItems: "center" }}
                >
                    <IconX size={10} />
                </button>
            )}
        </span>
    );
}

/**
 * A layout-neutral wrapper that gives one citation its own right-click
 * target; the button inside keeps its markup and its click.
 */
function CitationTarget({
    cite,
    source,
    inContext,
    onOpen,
    onToggleContext,
    children,
}: {
    cite: ThreadReference;
    source: WorkspaceSource;
    inContext: boolean;
    onOpen?: (cite: ThreadReference) => void;
    onToggleContext: (source: WorkspaceSource) => void;
    children: React.ReactNode;
}) {
    const ctxTarget = useContextTarget({
        kind: "citation",
        id: `${source.id}:${cite.page ?? ""}`,
        label: `Citation from ${source.title}`,
        data: { cite, source },
        items: () =>
            buildCitationMenuItems(cite, source, {
                onOpen,
                onCopy: text => void copyWithToast(text),
                inContext,
                onToggleContext,
            }),
    });
    return (
        <div {...ctxTarget} style={{ display: "contents" }}>
            {children}
        </div>
    );
}

interface MessageProps {
    msg: ThreadMessage;
    /** The live roster, so a stored handle renders with its current name. */
    agents?: ChatAgentOption[];
    /** Position in the thread — what session-level verbs (branch, ask again) act on. */
    index: number;
    sources: WorkspaceSource[];
    selected: string[];
    setSelected: Dispatch<SetStateAction<string[]>>;
    /** Opens the cited document scrolled to (and highlighting) the cited passage. */
    onOpenCitation?: (cite: ThreadReference) => void;
    onOpenSource?: (source: WorkspaceSource) => void;
    /** Puts a quote of this text in the composer. */
    onQuote: (text: string) => void;
    /** Puts this text in the composer to change and resend. */
    onEdit: (text: string) => void;
    onCite?: (text: string) => void;
    onEditMessage?: (index: number) => void;
    onRetryMessage?: (index: number) => void;
    onForkMessage?: (index: number) => void;
    onSaveMessage?: (index: number) => void;
    onImplementPlan?: (text: string) => void;
    isPlan?: boolean;
    active?: boolean;
}

/**
 * A question, with any quoted passage drawn as one.
 *
 * Quoting writes a Markdown blockquote into the message, but this turn is
 * rendered as plain text — so the `>` markers were visible and, under
 * `white-space: normal`, a multi-line passage collapsed onto a single line
 * indistinguishable from the question. Both halves are now drawn for what they
 * are, and `pre-wrap` keeps the line breaks in either.
 */
function QuestionProse({ text }: { text: string }) {
    const parts = text.split(/(\[Source message\]\(#chat-message-[\w-]+\))/g);
    return (
        <>
            {parts.map((part, i) => {
                const source = /^\[Source message\]\((#chat-message-[\w-]+)\)$/.exec(part);
                return source ? (
                    <a key={i} href={source[1]} className="text-[var(--accent)] underline">
                        Source message
                    </a>
                ) : (
                    <React.Fragment key={i}>{part}</React.Fragment>
                );
            })}
        </>
    );
}

function QuestionBody({ text }: { text: string }) {
    const [expanded, setExpanded] = useState(false);
    const long = text.length > 900 || text.split("\n").length > 12;
    const { lead, quote, trail } = useMemo(() => parseQuotedMessage(text), [text]);
    const prose: React.CSSProperties = {
        fontSize: 17,
        lineHeight: 1.55,
        color: "var(--ink)",
        fontWeight: 400,
        whiteSpace: "pre-wrap",
    };

    if (!quote) {
        return (
            <div>
                <div
                    style={{
                        ...prose,
                        maxHeight: long && !expanded ? 230 : undefined,
                        overflow: "hidden",
                        maskImage:
                            long && !expanded
                                ? "linear-gradient(black 80%, transparent)"
                                : undefined,
                    }}
                >
                    <QuestionProse text={text} />
                </div>
                {long && (
                    <button
                        type="button"
                        className="mt-2 rounded py-1 text-xs text-[var(--accent)]"
                        aria-expanded={expanded}
                        onClick={() => setExpanded(v => !v)}
                    >
                        {expanded ? "Show less" : "Show full message"}
                    </button>
                )}
            </div>
        );
    }

    return (
        <div>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    maxHeight: long && !expanded ? 230 : undefined,
                    overflow: "hidden",
                    maskImage:
                        long && !expanded ? "linear-gradient(black 80%, transparent)" : undefined,
                }}
            >
                {lead && (
                    <div style={prose}>
                        <QuestionProse text={lead} />
                    </div>
                )}
                <blockquote
                    data-testid="question-quote"
                    style={{
                        margin: 0,
                        paddingLeft: 12,
                        borderLeft: "2px solid var(--line-2)",
                        color: "var(--ink-2)",
                        fontSize: 14.5,
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                    }}
                >
                    {quote}
                </blockquote>
                {trail && (
                    <div style={prose}>
                        <QuestionProse text={trail} />
                    </div>
                )}
            </div>
            {long && (
                <button
                    type="button"
                    className="mt-2 rounded py-1 text-xs text-[var(--accent)]"
                    aria-expanded={expanded}
                    onClick={() => setExpanded(v => !v)}
                >
                    {expanded ? "Show less" : "Show full message"}
                </button>
            )}
        </div>
    );
}

const Message = React.memo(function Message({
    msg,
    index,
    sources,
    selected,
    setSelected,
    onOpenCitation,
    onOpenSource,
    onQuote,
    onEdit,
    agents,
    onEditMessage,
    onRetryMessage,
    onForkMessage,
    onSaveMessage,
    onImplementPlan,
    onCite,
    isPlan,
    active,
}: MessageProps) {
    const isUser = msg.role === "user";
    const bodyRef = useRef<HTMLDivElement>(null);
    const [selectedPassage, setSelectedPassage] = useState("");
    const [quoteComment, setQuoteComment] = useState("");
    const [dismissedError, setDismissedError] = useState(false);
    const anchor = messageAnchor(msg, index);
    const created = msg.createdAt ? new Date(msg.createdAt) : null;
    const timestamp =
        created && Number.isFinite(created.getTime()) ? (
            <time
                dateTime={created.toISOString()}
                title={created.toLocaleString()}
                className="ml-auto shrink-0 text-[10px] font-normal text-[var(--ink-3)]"
            >
                {created.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </time>
        ) : null;
    const captureSelection = () => {
        const selection = window.getSelection();
        const text = selection?.toString().trim() ?? "";
        if (
            selection?.anchorNode &&
            selection.focusNode &&
            bodyRef.current?.contains(selection.anchorNode) &&
            bodyRef.current.contains(selection.focusNode)
        )
            setSelectedPassage(text);
    };
    const actions = (
        <div
            role="toolbar"
            aria-label={isUser ? "Question actions" : "Answer actions"}
            className="mt-3 flex flex-wrap items-center gap-1 text-[var(--ink-3)]"
        >
            <button
                type="button"
                title="Copy message"
                aria-label="Copy message"
                className="rounded p-1.5 hover:bg-[var(--line-2)] focus-visible:outline"
                onClick={() => void copyWithToast(msg.text)}
            >
                <Copy size={14} />
            </button>
            <button
                type="button"
                title="Quote in reply"
                aria-label="Quote in reply"
                className="rounded p-1.5 hover:bg-[var(--line-2)] focus-visible:outline"
                onClick={() => onQuote(isUser ? msg.text : plainTextOfAnswer(msg.text))}
            >
                <Quote size={14} />
            </button>
            {isUser && (
                <button
                    type="button"
                    title={onEditMessage ? "Edit from here" : "Edit and ask again"}
                    aria-label={onEditMessage ? "Edit from here" : "Edit and ask again"}
                    disabled={active}
                    className="rounded p-1.5 hover:bg-[var(--line-2)] focus-visible:outline disabled:opacity-50"
                    onClick={() => (onEditMessage ? onEditMessage(index) : onEdit(msg.text))}
                >
                    <Pencil size={14} />
                </button>
            )}
            {!isUser && onRetryMessage && (
                <button
                    type="button"
                    title="Retry answer"
                    aria-label="Retry answer"
                    disabled={active}
                    className="rounded p-1.5 hover:bg-[var(--line-2)] focus-visible:outline disabled:opacity-50"
                    onClick={() => onRetryMessage(index)}
                >
                    <RotateCcw size={14} />
                </button>
            )}
            {onForkMessage && (
                <button
                    type="button"
                    title="Fork new chat from here"
                    aria-label="Fork new chat from here"
                    disabled={active}
                    className="rounded p-1.5 hover:bg-[var(--line-2)] focus-visible:outline disabled:opacity-50"
                    onClick={() => onForkMessage(index)}
                >
                    <GitBranch size={14} />
                </button>
            )}
            {!isUser && onSaveMessage && (
                <button
                    type="button"
                    title="Save answer as a note"
                    aria-label="Save answer as a note"
                    className="rounded p-1.5 hover:bg-[var(--line-2)] focus-visible:outline"
                    onClick={() => onSaveMessage(index)}
                >
                    <Bookmark size={14} />
                </button>
            )}
        </div>
    );
    // Stored turns carry only the handle; the live roster supplies the name
    // and colour, and a retired agent still shows under its handle.
    const agent = msg.agent
        ? (() => {
              const live = agents?.find(a => a.id === msg.agent!.key);
              return live
                  ? {
                        ...msg.agent,
                        displayName: live.displayName,
                        role: live.role,
                        accent: live.accent ?? null,
                        avatarUrl: live.avatarUrl ?? null,
                    }
                  : { ...msg.agent, displayName: msg.agent.displayName || `@${msg.agent.key}` };
          })()
        : null;
    const refs = (msg.refs ?? [])
        .map(id => sources.find(s => s.id === id))
        .filter((s): s is WorkspaceSource => Boolean(s));
    const cites = msg.citations ?? [];
    const ctxTarget = useContextTarget(
        isUser
            ? {
                  kind: "chat-user-message",
                  id: String(index),
                  label: "Question actions",
                  data: { msg, index },
                  items: () =>
                      buildQuestionMenuItems(msg, {
                          onCopy: text => void copyWithToast(text),
                          onQuote,
                          onEdit,
                      }),
              }
            : {
                  kind: "chat-message",
                  id: String(index),
                  label: "Answer actions",
                  data: { msg, index },
                  items: () =>
                      buildAnswerMenuItems(msg, {
                          onCopy: text => void copyWithToast(text),
                          onQuote,
                      }),
              }
    );
    const toggleContext = (source: WorkspaceSource) =>
        setSelected(prev =>
            prev.includes(source.id) ? prev.filter(id => id !== source.id) : [...prev, source.id]
        );

    if (isUser) {
        return (
            <div
                {...ctxTarget}
                id={anchor}
                data-chat-message={index}
                style={{
                    marginBottom: 28,
                    contentVisibility: "auto",
                    containIntrinsicSize: "auto 220px",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 8,
                        marginBottom: 8,
                    }}
                >
                    <div
                        style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            background: "var(--ink)",
                            color: "var(--panel)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <IconUser size={12} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>You</span>
                    {msg.intent && (
                        <span className="border-line bg-panel text-ink-3 rounded border px-1.5 py-0.5 text-[10px] font-normal">
                            {msg.intent === "interrupt" ? "Immediate follow-up" : "Queued"}
                        </span>
                    )}
                    {timestamp}
                    {agent && (
                        <span
                            title={`Asked ${agent.displayName}${agent.role ? ` (${agent.role})` : ""}`}
                            className="mono"
                            style={{ fontSize: 10, color: "var(--ink-3)" }}
                        >
                            · to @{agent.key}
                        </span>
                    )}
                    {refs.length > 0 && (
                        <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                            · asking over {refs.length} source{refs.length !== 1 ? "s" : ""}
                        </span>
                    )}
                </div>
                <QuestionBody text={msg.text} />
                {refs.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                        {refs.map(s => (
                            <SourceChip
                                key={s.id}
                                source={s}
                                size="sm"
                                onOpen={onOpenSource ? () => onOpenSource(s) : undefined}
                            />
                        ))}
                    </div>
                )}
                {msg.attachments && msg.attachments.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                        {msg.attachments.map(a => (
                            <AttachmentChip
                                key={a.id}
                                attachment={a}
                                galleryItems={msg.attachments}
                            />
                        ))}
                    </div>
                )}
                {actions}
            </div>
        );
    }

    return (
        <div
            {...ctxTarget}
            id={anchor}
            data-chat-message={index}
            style={{
                marginBottom: 28,
                contentVisibility: "auto",
                containIntrinsicSize: "auto 220px",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                    marginBottom: 8,
                }}
            >
                {agent ? (
                    <AgentAvatar
                        agent={{
                            id: agent.key,
                            displayName: agent.displayName,
                            accent: agent.accent,
                            avatarUrl: agent.avatarUrl ?? null,
                        }}
                        size={22}
                        title={`${agent.displayName}${agent.role ? ` — ${agent.role}` : ""}`}
                    />
                ) : (
                    <div
                        style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            background: "var(--accent-soft)",
                            color: "var(--accent)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <IconBolt size={12} />
                    </div>
                )}
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {agent ? agent.displayName : "Launchstack"}
                </span>
                {timestamp}
                {agent?.role && (
                    <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{agent.role}</span>
                )}
                {msg.model && (
                    <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                        · {msg.model}
                    </span>
                )}
                {msg.gapCheck && (
                    <span
                        title={`Predictive gap analysis ran across ${msg.gapCheck.domain} docs`}
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            marginLeft: 4,
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "2px 7px",
                            borderRadius: 999,
                            color: "oklch(0.5 0.16 40)",
                            background: "oklch(0.95 0.06 70)",
                            border: "1px solid oklch(0.86 0.11 75)",
                        }}
                    >
                        <IconShield size={9} />
                        {msg.gapCheck.missing} missing · {msg.gapCheck.conflicts} conflict
                    </span>
                )}
            </div>
            <MessageActivity msg={msg} />
            {msg.status === "error" && !dismissedError && (
                <div
                    role="alert"
                    className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]"
                >
                    <span>
                        This answer could not finish. Your prompt and attachments are retained.
                    </span>
                    {onRetryMessage && (
                        <button
                            type="button"
                            disabled={active}
                            className="font-semibold underline"
                            onClick={() => onRetryMessage(index)}
                        >
                            Retry
                        </button>
                    )}
                    <button
                        type="button"
                        aria-label="Dismiss answer error"
                        className="ml-auto p-1"
                        onClick={() => setDismissedError(true)}
                    >
                        <IconX size={12} />
                    </button>
                </div>
            )}
            <div
                ref={bodyRef}
                onMouseUp={captureSelection}
                onKeyUp={captureSelection}
                style={{ fontSize: 14, lineHeight: 1.65, color: "var(--ink-2)" }}
            >
                {isPlan ? (
                    <ProposedPlan
                        text={msg.text}
                        onRefine={onEdit}
                        onImplement={onImplementPlan}
                        active={active}
                    />
                ) : (
                    <ChatMarkdown text={msg.text} />
                )}
            </div>
            {selectedPassage && (
                <div
                    role="group"
                    aria-label="Selected passage citation"
                    className="my-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3 text-xs"
                >
                    <div className="mb-2 flex items-center gap-2">
                        <span className="font-semibold">Cite selected passage</span>
                        <a href={`#${anchor}`} className="text-[var(--accent)] underline">
                            Source message
                        </a>
                        <button
                            type="button"
                            aria-label="Dismiss selected passage"
                            className="ml-auto p-1"
                            onClick={() => setSelectedPassage("")}
                        >
                            <IconX size={12} />
                        </button>
                    </div>
                    <label className="block">
                        Comment (optional)
                        <input
                            aria-label="Citation comment"
                            value={quoteComment}
                            onChange={e => setQuoteComment(e.target.value)}
                            className="mt-1 block w-full rounded border border-[var(--line)] bg-[var(--bg)] p-2"
                        />
                    </label>
                    <button
                        type="button"
                        className="mt-2 rounded bg-[var(--accent-soft)] px-2 py-1 font-semibold text-[var(--accent)]"
                        onClick={() => {
                            (onCite ?? onEdit)(
                                `${quoteBlock(selectedPassage)}[Source message](#${anchor})${quoteComment.trim() ? `\n\nComment: ${quoteComment.trim()}` : ""}\n\n`
                            );
                            setSelectedPassage("");
                            setQuoteComment("");
                        }}
                    >
                        Cite in composer
                    </button>
                </div>
            )}
            {cites.length > 0 && (
                <div
                    style={{
                        marginTop: 14,
                        padding: "12px 14px",
                        borderRadius: 10,
                        background: "var(--line-2)",
                        border: "1px solid var(--line)",
                    }}
                >
                    <div
                        className="mono"
                        style={{
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: "0.08em",
                            color: "var(--ink-3)",
                            textTransform: "uppercase",
                            marginBottom: 8,
                        }}
                    >
                        Grounded in {cites.length} source{cites.length !== 1 ? "s" : ""}
                    </div>
                    {cites.map((c, i) => {
                        const s = sources.find(x => x.id === c.sourceId);
                        if (!s) return null;
                        const meta = SOURCE_META[s.type];
                        const Icon = meta.Icon;
                        return (
                            <CitationTarget
                                key={i}
                                cite={c}
                                source={s}
                                inContext={selected.includes(s.id)}
                                onOpen={onOpenCitation}
                                onToggleContext={toggleContext}
                            >
                                <button
                                    type="button"
                                    onClick={() => onOpenCitation?.(c)}
                                    title="Open the source at this passage"
                                    style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 10,
                                        width: "100%",
                                        textAlign: "left",
                                        padding: "8px 8px",
                                        margin: "0 -8px",
                                        borderRadius: 8,
                                        borderTop: i > 0 ? "1px solid var(--line)" : "none",
                                        background: "transparent",
                                        cursor: onOpenCitation ? "pointer" : "default",
                                        transition: "background 120ms",
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.background = "var(--panel)";
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.background = "transparent";
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 22,
                                            height: 22,
                                            borderRadius: 5,
                                            background: "var(--panel)",
                                            border: "1px solid var(--line)",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            color: meta.color,
                                            flexShrink: 0,
                                            marginTop: 1,
                                        }}
                                    >
                                        <Icon size={12} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 6,
                                                fontSize: 12,
                                                fontWeight: 600,
                                                color: "var(--ink)",
                                            }}
                                        >
                                            <span
                                                style={{
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    whiteSpace: "nowrap",
                                                }}
                                            >
                                                {s.title}
                                            </span>
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 12,
                                                color: "var(--ink-3)",
                                                marginTop: 2,
                                                lineHeight: 1.5,
                                            }}
                                        >
                                            {c.snippet}
                                        </div>
                                    </div>
                                    <span
                                        style={{
                                            color: "var(--ink-3)",
                                            flexShrink: 0,
                                            alignSelf: "center",
                                        }}
                                    >
                                        <IconChevronRight size={12} />
                                    </span>
                                </button>
                            </CitationTarget>
                        );
                    })}
                </div>
            )}
            {actions}
            {(typeof msg.tokens === "number" || typeof msg.chunksAnalyzed === "number") && (
                <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                    <span style={{ marginLeft: "auto" }} className="mono">
                        <span
                            style={{ fontSize: 10, color: "var(--ink-3)" }}
                            title={
                                msg.tokenBreakdown
                                    ? `${msg.tokenBreakdown.inputTokens.toLocaleString()} prompt + ${msg.tokenBreakdown.outputTokens.toLocaleString()} completion`
                                    : undefined
                            }
                        >
                            {/* Two different numbers, told apart: tokens are what
                                the model billed, chunks are what it read. */}
                            {typeof msg.tokens === "number"
                                ? `${msg.tokens.toLocaleString()} tokens`
                                : null}
                            {typeof msg.tokens === "number" &&
                            typeof msg.chunksAnalyzed === "number"
                                ? " · "
                                : null}
                            {typeof msg.chunksAnalyzed === "number"
                                ? `${msg.chunksAnalyzed} ${msg.chunksAnalyzed === 1 ? "chunk" : "chunks"}`
                                : null}
                        </span>
                    </span>
                </div>
            )}
        </div>
    );
});

function MessageActivity({ msg }: { msg: ThreadMessage }) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (msg.status !== "streaming") return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [msg.status]);
    const start = msg.createdAt ? Date.parse(msg.createdAt) : NaN;
    const elapsed =
        msg.status === "streaming" && Number.isFinite(start)
            ? Math.max(0, now - start)
            : msg.elapsedMs;
    return (
        <>
            {msg.status && (
                <div
                    role="status"
                    className="my-2 flex items-center gap-2 text-xs text-[var(--ink-3)]"
                >
                    <span>
                        {msg.status === "streaming"
                            ? msg.stage?.trim()
                                ? msg.stage
                                : "Working…"
                            : msg.status === "stopped"
                              ? "Stopped"
                              : msg.status === "error"
                                ? "Failed"
                                : "Completed"}
                    </span>
                    {elapsed !== undefined && (
                        <span>{(elapsed / 1000).toFixed(elapsed < 10000 ? 1 : 0)}s</span>
                    )}
                </div>
            )}
            {msg.reasoning && (
                <details className="my-2 rounded-lg border border-[var(--line)] p-3 text-xs text-[var(--ink-3)]">
                    <summary className="cursor-pointer font-semibold">Reasoning</summary>
                    <ChatMarkdown text={msg.reasoning} />
                </details>
            )}
        </>
    );
}

function TypingIndicator() {
    return (
        <div role="status" className="mb-7 flex items-center gap-2 text-xs text-[var(--ink-3)]">
            <IconBolt size={16} />
            Working…
        </div>
    );
}

export { Composer } from "./ChatComposer";

interface EmptyStateProps {
    onOpenAdd: () => void;
    sources: WorkspaceSource[];
    /** Names the evidence behind the starter questions; a change refetches them. */
    startersRevisionKey: string;
    /** True while a message is in flight. */
    disabled: boolean;
    onAsk: (starter: AskStarter, refs: string[]) => void;
    onOpenProfile: () => void;
}

function EmptyState({
    onOpenAdd,
    sources,
    startersRevisionKey,
    disabled,
    onAsk,
    onOpenProfile,
}: EmptyStateProps) {
    const sourceCount = sources.length;
    return (
        <div className="pt-10" style={{ animation: "lsw-fadeIn 300ms" }}>
            <div className="mb-10 text-center">
                <div className="display text-ink @max-md:text-[34px] @max-sm:text-[28px] mb-2.5 text-[42px] leading-[1.15] tracking-[-0.02em]">
                    What do you want to <em className="text-brand">ask</em> yourself?
                </div>
                <div className="text-ink-3 text-sm">
                    {sourceCount} source{sourceCount !== 1 ? "s" : ""} indexed · ready to query
                </div>
            </div>
            <AskStarters
                sources={sources}
                revisionKey={startersRevisionKey}
                disabled={disabled}
                onAsk={onAsk}
                onOpenProfile={onOpenProfile}
            />
            <div className="bg-line-2 border-line text-ink-3 flex items-center justify-center gap-2.5 rounded-xl border border-dashed px-[18px] py-3.5 text-[13px]">
                <span>Need something new?</span>
                <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="text-brand h-auto gap-1.5 p-0 text-[13px] font-semibold"
                    onClick={onOpenAdd}
                >
                    <Plus className="size-3" aria-hidden /> Add a source
                </Button>
            </div>
        </div>
    );
}

/** Public README — same destination as the public site's footer "Documentation"
 *  link (apps/landing, MarketingShell). */
export interface AskPanelProps {
    sources: WorkspaceSource[];
    selected: string[];
    setSelected: Dispatch<SetStateAction<string[]>>;
    thread: ThreadMessage[];
    sendMessage: (
        send: ComposerSend
    ) => void | boolean | ChatSendResult | Promise<boolean | ChatSendResult>;
    isSending: boolean;
    /** Opens the cited document scrolled to (and highlighting) the cited passage. */
    onOpenCitation?: (cite: ThreadReference) => void;
    /** Opens a source from a context chip. */
    onOpenSource?: (source: WorkspaceSource) => void;
    /** Text the shell wants in the composer — a passage to ask about. */
    composerSeed?: ComposerSeed | null;
    onOpenAdd: () => void;
    onNewChat: () => void;
    openPalette: () => void;
    onStudioNavigate: (href: string) => void;
    /** Composer options persisted across turns — owned by WorkspaceShell. */
    webSearch: boolean;
    onToggleWebSearch: () => void;
    thinking: boolean;
    onToggleThinking: () => void;
    /** The roster, for the agent picker, `@handle` completion and attribution. */
    agents?: ChatAgentOption[];
    /** The agent the chat is held with; null = the default assistant. */
    agentKey?: string | null;
    onChangeAgent?: (key: string | null) => void;
    /** Extra pixels added to header `padding-left` when an overlay chrome control (e.g. show sidebar) sits at the viewport edge — see WorkspaceShell. */
    leadingChromeInsetPx?: number;
    /** Durable session identity scopes drafts and remembered reading position. */
    draftKey?: string;
    promptHistory?: string[];
    onStop?: () => void;
    queuedCount?: number;
    onQueueEditLatest?: () => void;
    onQueueSendOldest?: () => void;
    threadContextOptions?: { id: string; title: string }[];
    folderContextOptions?: { id: string; name: string }[];
    onOpenThreadContext?: (id: string) => void;
    editingQueued?: boolean;
    queuedEditUnavailable?: boolean;
    onCancelQueueEdit?: () => void;
    queueContent?: React.ReactNode;
    title?: string;
    onRename?: (title: string) => void;
    onRetryMessage?: (index: number) => void;
    onOpenParentChat?: () => void;
    onForkMessage?: (index: number) => void;
    onEditMessage?: (index: number) => void;
    onSaveMessage?: (index: number) => void;
    onImplementPlan?: (text: string) => void;
    disabled?: boolean;
}

export function AskPanel({
    sources,
    selected,
    setSelected,
    thread,
    sendMessage,
    isSending,
    onOpenCitation,
    onOpenSource,
    composerSeed,
    onOpenAdd,
    onNewChat,
    openPalette,
    onStudioNavigate,
    webSearch,
    onToggleWebSearch,
    thinking,
    onToggleThinking,
    agents = [],
    agentKey = null,
    onChangeAgent,
    leadingChromeInsetPx = 0,
    draftKey: suppliedDraftKey,
    promptHistory = [],
    onStop,
    queuedCount = 0,
    onQueueEditLatest,
    onQueueSendOldest,
    threadContextOptions,
    folderContextOptions,
    onOpenThreadContext,
    editingQueued,
    queuedEditUnavailable,
    onCancelQueueEdit,
    queueContent,
    title,
    onRename,
    onRetryMessage,
    onOpenParentChat,
    onForkMessage,
    onEditMessage,
    onSaveMessage,
    onImplementPlan,
    disabled = false,
}: AskPanelProps) {
    const draftKey = suppliedDraftKey ?? "new-chat";
    const { scrollRef, contentRef, following, currentIndex, onScroll, latest, navigate } =
        useChatTimeline(thread, draftKey, isSending);
    const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
    const visibleCount = visibleCounts[draftKey] ?? 100;
    const setVisibleCount = useCallback(
        (value: number | ((previous: number) => number)) =>
            setVisibleCounts(previous => ({
                ...previous,
                [draftKey]: typeof value === "function" ? value(previous[draftKey] ?? 100) : value,
            })),
        [draftKey]
    );
    const previousLengths = useRef(new Map<string, number>());
    useLayoutEffect(() => {
        const previous = previousLengths.current.get(draftKey);
        previousLengths.current.set(draftKey, thread.length);
        if (previous !== undefined && previous > 0 && thread.length > previous)
            setVisibleCount(count => count + thread.length - previous);
    }, [draftKey, thread.length, setVisibleCount]);
    const firstVisible = Math.max(0, thread.length - visibleCount);
    const [pendingNavigate, setPendingNavigate] = useState<number | null>(null);
    const goToMessage = (index: number) => {
        if (index < firstVisible) {
            setVisibleCount(thread.length - index);
            setPendingNavigate(index);
        } else navigate(index);
    };
    useEffect(() => {
        if (pendingNavigate !== null && pendingNavigate >= firstVisible) {
            navigate(pendingNavigate);
            setPendingNavigate(null);
        }
    }, [pendingNavigate, firstVisible, navigate]);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    useEffect(() => {
        setRenaming(false);
    }, [draftKey]);
    const rename = () => {
        const next = renameValue.trim();
        if (next && next !== title) onRename?.(next);
        setRenaming(false);
    };

    const isEmpty = thread.length === 0;

    // One seed channel for the composer: the shell's seed and the panel's own
    // quote / edit verbs both land here, latest wins.
    const [seed, setSeed] = useState<ComposerSeed | null>(null);
    const seedScope = useRef(suppliedDraftKey);
    seedScope.current = suppliedDraftKey;
    useEffect(() => {
        if (composerSeed && (!composerSeed.draftKey || composerSeed.draftKey === suppliedDraftKey))
            setSeed({ ...composerSeed, draftKey: suppliedDraftKey });
    }, [composerSeed, suppliedDraftKey]);
    const cite = useCallback(
        (text: string) =>
            setSeed({ text, mode: "append", nonce: Date.now(), draftKey: seedScope.current }),
        []
    );
    const messageActions = useRef({
        onEditMessage,
        onRetryMessage,
        onForkMessage,
        onSaveMessage,
        onImplementPlan,
    });
    messageActions.current = {
        onEditMessage,
        onRetryMessage,
        onForkMessage,
        onSaveMessage,
        onImplementPlan,
    };
    const editMessage = useCallback(
        (index: number) => messageActions.current.onEditMessage?.(index),
        []
    );
    const retryMessage = useCallback(
        (index: number) => messageActions.current.onRetryMessage?.(index),
        []
    );
    const forkMessage = useCallback(
        (index: number) => messageActions.current.onForkMessage?.(index),
        []
    );
    const saveMessage = useCallback(
        (index: number) => messageActions.current.onSaveMessage?.(index),
        []
    );
    const implementPlan = useCallback(
        (text: string) => messageActions.current.onImplementPlan?.(text),
        []
    );
    const planModes = useMemo(() => {
        let planning = false;
        return thread.map(msg => {
            if (msg.role === "user") planning = msg.send?.chatMode === "plan";
            return msg.role === "assistant" && planning && msg.status !== "error";
        });
    }, [thread]);
    const quoteThread = useRef(thread);
    quoteThread.current = thread;
    const quote = useCallback((text: string) => {
        const index = quoteThread.current.findIndex(
            message => plainTextOfAnswer(message.text) === text
        );
        const anchor =
            index >= 0
                ? `[Source message](#chat-message-${quoteThread.current[index]?.id ?? index})`
                : "[Quoted context](#launchstack-quoted-context)";
        setSeed({
            text: `${quoteBlock(text)}${anchor}\n\n`,
            mode: "append",
            nonce: Date.now(),
            draftKey: seedScope.current,
        });
    }, []);
    const edit = useCallback(
        (text: string) =>
            setSeed({ text, mode: "replace", nonce: Date.now(), draftKey: seedScope.current }),
        []
    );

    const paneTarget = useContextTarget({
        kind: "chat",
        label: "Chat actions",
        data: { thread, sources },
        items: () =>
            buildChatPaneMenuItems({
                isEmpty,
                hasContext: selected.length > 0,
                onNewChat,
                onClearContext: () => setSelected([]),
                onExportMarkdown: () =>
                    downloadTextFile(
                        transcriptFilename(thread),
                        transcriptMarkdown(thread, sources)
                    ),
                onOpenPalette: openPalette,
            }),
    });

    const [dismissedErrors, setDismissedErrors] = useState<Record<string, string>>({});
    const latestError = [...thread].reverse().find(message => message.status === "error");
    const errorIdentity = latestError
        ? `${latestError.id ?? thread.indexOf(latestError)}:${latestError.text}`
        : undefined;
    const showError = errorIdentity && dismissedErrors[draftKey] !== errorIdentity;
    const latestRole = thread.at(-1)?.role;
    const showTyping = isSending && latestRole === "user";

    const titleText = title?.trim()
        ? title
        : isEmpty
          ? "New conversation"
          : "Ask over your sources";
    const subText = isEmpty
        ? "Ask anything, or add sources for grounded answers."
        : `${thread.length} message${thread.length !== 1 ? "s" : ""}${isSending ? " · working" : ""}`;

    const handleSend = useCallback((send: ComposerSend) => sendMessage(send), [sendMessage]);

    // A starter question is a send with the question as its text. When the
    // starter is about specific documents they become the pinned sources —
    // visible in the composer, and the scope of any follow-up — otherwise
    // whatever the user already pinned stays in force.
    const switcher = useEmployerWorkspaceSwitcher();
    const startersRevisionKey = `${switcher?.name ?? "workspace"}:${sources.length}`;
    const handleAskStarter = useCallback(
        (starter: AskStarter, refs: string[]) => {
            if (refs.length > 0) setSelected(refs);
            void sendMessage({
                text: starter.question,
                refs: refs.length > 0 ? refs : selected,
                attachments: [],
                webSearch,
                thinking,
                agentKey,
            });
        },
        [selected, setSelected, sendMessage, webSearch, thinking, agentKey]
    );

    return (
        <main
            {...paneTarget}
            style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                height: "100%",
                overflow: "hidden",
                background: "var(--bg)",
            }}
        >
            <div style={workspaceMainHeaderBarStyle(leadingChromeInsetPx)}>
                {/* One line each, cut short rather than wrapped: the bar is a
                    fixed height so its rule meets the next column's, and a
                    wrapped subtitle ran out of the top of it. */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    {renaming ? (
                        <input
                            autoFocus
                            aria-label="Conversation title"
                            value={renameValue}
                            maxLength={200}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={rename}
                            onKeyDown={e => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    rename();
                                }
                                if (e.key === "Escape") {
                                    e.preventDefault();
                                    setRenaming(false);
                                }
                            }}
                            className="w-full rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-sm"
                        />
                    ) : (
                        <div
                            className="flex min-w-0 items-center gap-1"
                            onDoubleClick={() => {
                                if (onRename) {
                                    setRenameValue(titleText);
                                    setRenaming(true);
                                }
                            }}
                        >
                            <span className="truncate text-[13px] font-semibold">{titleText}</span>
                            {onRename && (
                                <button
                                    type="button"
                                    aria-label="Rename conversation"
                                    title="Rename conversation"
                                    className="shrink-0 rounded p-1 text-[var(--ink-3)]"
                                    onClick={() => {
                                        setRenameValue(titleText);
                                        setRenaming(true);
                                    }}
                                >
                                    <Pencil size={11} />
                                </button>
                            )}
                        </div>
                    )}
                    <div className="truncate" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                        {subText}
                    </div>
                </div>

                {onOpenParentChat && (
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Open original conversation"
                        title="Forked conversation · open original"
                        onClick={onOpenParentChat}
                    >
                        <GitBranch size={14} />
                        <span className="hidden sm:inline">Original chat</span>
                    </Button>
                )}
                <button
                    onClick={onNewChat}
                    title="New chat"
                    disabled={isEmpty}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 10px",
                        borderRadius: 7,
                        border: "1px solid var(--line)",
                        background: "var(--panel)",
                        fontSize: 12,
                        fontWeight: 500,
                        color: isEmpty ? "var(--ink-4)" : "var(--ink-2)",
                        cursor: isEmpty ? "not-allowed" : "pointer",
                        opacity: isEmpty ? 0.6 : 1,
                    }}
                    onMouseEnter={e => {
                        if (!isEmpty) {
                            e.currentTarget.style.borderColor = "var(--accent)";
                            e.currentTarget.style.color = "var(--accent)";
                        }
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.borderColor = "var(--line)";
                        e.currentTarget.style.color = "var(--ink-2)";
                    }}
                >
                    <IconPlus size={12} />
                    New chat
                </button>
            </div>

            {showError && (
                <div
                    role="alert"
                    className="border-line bg-panel text-ink-2 flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs"
                >
                    <span className="min-w-0 flex-1">{latestError!.text}</span>
                    {onRetryMessage && (
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={isSending}
                            onClick={() => onRetryMessage(thread.indexOf(latestError!))}
                        >
                            Retry
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label="Dismiss conversation error"
                        onClick={() =>
                            setDismissedErrors(previous => ({
                                ...previous,
                                [draftKey]: errorIdentity,
                            }))
                        }
                    >
                        <IconX size={14} />
                    </Button>
                </div>
            )}
            <div
                ref={scrollRef}
                aria-label="Conversation messages"
                tabIndex={0}
                onScroll={onScroll}
                onClickCapture={event => {
                    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
                        'a[href^="#chat-message-"]'
                    );
                    const hash = link?.getAttribute("href");
                    const index = hash
                        ? thread.findIndex((message, i) => `#${messageAnchor(message, i)}` === hash)
                        : -1;
                    if (hash) {
                        event.preventDefault();
                        if (index >= 0) goToMessage(index);
                        else
                            toast.info("Source message is unavailable in this conversation.", {
                                description:
                                    "The saved quoted passage is preserved so you can still reply.",
                            });
                    }
                }}
                style={{
                    flex: isEmpty ? "0 1 auto" : 1,
                    overflowY: "auto",
                    paddingTop: 28,
                    paddingBottom: 20,
                    paddingLeft: CHAT_GUTTER_X_PX + leadingChromeInsetPx,
                    paddingRight: CHAT_GUTTER_X_PX,
                }}
            >
                <div ref={contentRef} style={{ maxWidth: CHAT_COLUMN_MAX_PX, margin: "0 auto" }}>
                    {isEmpty ? (
                        <EmptyState
                            onOpenAdd={onOpenAdd}
                            sources={sources}
                            startersRevisionKey={startersRevisionKey}
                            disabled={isSending}
                            onAsk={handleAskStarter}
                            onOpenProfile={() => onStudioNavigate("/employer/settings#company")}
                        />
                    ) : (
                        <>
                            {firstVisible > 0 && (
                                <button
                                    type="button"
                                    className="mb-5 w-full rounded-lg border border-[var(--line)] py-2 text-xs text-[var(--ink-3)]"
                                    onClick={() => setVisibleCount(n => n + 100)}
                                >
                                    Show {Math.min(100, firstVisible)} earlier messages (
                                    {firstVisible} earlier)
                                </button>
                            )}
                            {thread.slice(firstVisible).map((m, visibleIndex) => {
                                const i = firstVisible + visibleIndex;
                                return (
                                    <Message
                                        key={m.id ?? i}
                                        msg={m}
                                        index={i}
                                        sources={sources}
                                        selected={selected}
                                        setSelected={setSelected}
                                        onOpenCitation={onOpenCitation}
                                        onOpenSource={onOpenSource}
                                        onQuote={quote}
                                        onEdit={edit}
                                        onCite={cite}
                                        onEditMessage={onEditMessage ? editMessage : undefined}
                                        onRetryMessage={onRetryMessage ? retryMessage : undefined}
                                        onForkMessage={onForkMessage ? forkMessage : undefined}
                                        onSaveMessage={onSaveMessage ? saveMessage : undefined}
                                        onImplementPlan={
                                            onImplementPlan ? implementPlan : undefined
                                        }
                                        isPlan={planModes[i]}
                                        active={isSending}
                                        agents={agents}
                                    />
                                );
                            })}
                            {showTyping && <TypingIndicator />}
                        </>
                    )}
                </div>
            </div>

            {!isEmpty && (
                <div className="flex items-center gap-2 border-t border-[var(--line)] px-4 py-1.5 text-[var(--ink-3)]">
                    <button
                        type="button"
                        aria-label="Previous message"
                        disabled={currentIndex <= 0}
                        className="rounded p-1 disabled:opacity-30"
                        onClick={() => {
                            const index = Math.max(0, currentIndex - 1);
                            goToMessage(index);
                        }}
                    >
                        <ChevronUp size={14} />
                    </button>
                    <nav
                        aria-label="Conversation minimap"
                        className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
                        onKeyDown={e => {
                            const keys = ["ArrowUp", "ArrowDown", "Home", "End"];
                            if (!keys.includes(e.key)) return;
                            e.preventDefault();
                            const index =
                                e.key === "Home"
                                    ? 0
                                    : e.key === "End"
                                      ? thread.length - 1
                                      : Math.min(
                                            thread.length - 1,
                                            Math.max(
                                                0,
                                                currentIndex + (e.key === "ArrowUp" ? -1 : 1)
                                            )
                                        );
                            goToMessage(index);
                        }}
                    >
                        {thread.map((msg, i) => (
                            <button
                                type="button"
                                key={msg.id ?? i}
                                aria-label={`Message ${i + 1}: ${msg.role === "user" ? "You" : "Assistant"} — ${msg.text.slice(0, 80)}`}
                                aria-current={i === currentIndex ? "true" : undefined}
                                title={msg.text.slice(0, 160)}
                                className="my-1 h-2 min-w-2 rounded-full focus-visible:outline"
                                style={{
                                    background:
                                        i === currentIndex
                                            ? "var(--accent)"
                                            : msg.role === "user"
                                              ? "var(--ink-3)"
                                              : "var(--line-2)",
                                }}
                                onClick={() => {
                                    goToMessage(i);
                                }}
                            />
                        ))}
                    </nav>
                    <button
                        type="button"
                        aria-label="Next message"
                        disabled={currentIndex >= thread.length - 1}
                        className="rounded p-1 disabled:opacity-30"
                        onClick={() => goToMessage(Math.min(thread.length - 1, currentIndex + 1))}
                    >
                        <ChevronDown size={14} />
                    </button>
                    {!following && (
                        <button
                            type="button"
                            className="flex shrink-0 items-center gap-1 rounded bg-[var(--accent-soft)] px-2 py-1 text-xs text-[var(--accent)]"
                            onClick={latest}
                        >
                            <ArrowDown size={12} />
                            Jump to latest
                        </button>
                    )}
                </div>
            )}

            <div
                style={{
                    paddingTop: 12,
                    paddingBottom: 20,
                    paddingLeft: CHAT_GUTTER_X_PX + leadingChromeInsetPx,
                    paddingRight: CHAT_GUTTER_X_PX,
                    flexShrink: 0,
                }}
            >
                {queueContent && (
                    <div className="mx-auto mb-2" style={{ maxWidth: CHAT_COLUMN_MAX_PX }}>
                        {queueContent}
                    </div>
                )}
                <Composer
                    sources={sources}
                    selected={selected}
                    setSelected={setSelected}
                    onSend={handleSend}
                    disabled={disabled}
                    draftKey={suppliedDraftKey}
                    promptHistory={promptHistory}
                    active={isSending}
                    onStop={onStop}
                    onNewChat={onNewChat}
                    queuedCount={queuedCount}
                    onQueueEditLatest={onQueueEditLatest}
                    onQueueSendOldest={onQueueSendOldest}
                    threadContextOptions={threadContextOptions}
                    folderContextOptions={folderContextOptions}
                    onOpenThreadContext={onOpenThreadContext}
                    editingQueued={editingQueued}
                    queuedEditUnavailable={queuedEditUnavailable}
                    onCancelQueueEdit={onCancelQueueEdit}
                    webSearch={webSearch}
                    onToggleWebSearch={onToggleWebSearch}
                    thinking={thinking}
                    onToggleThinking={onToggleThinking}
                    onOpenSource={onOpenSource}
                    seed={seed?.draftKey === suppliedDraftKey ? seed : null}
                    agents={agents}
                    agentKey={agentKey}
                    onChangeAgent={onChangeAgent ?? (() => undefined)}
                />
                <div
                    style={{
                        maxWidth: CHAT_COLUMN_MAX_PX,
                        margin: "8px auto 0",
                        textAlign: "center",
                        fontSize: 11,
                        color: "var(--ink-3)",
                    }}
                >
                    {agentKey && agents.find(a => a.id === agentKey)
                        ? `Answering as ${agents.find(a => a.id === agentKey)!.displayName} — grounded in your sources, cited.`
                        : selected.length
                          ? "Answers use your selected sources and cite what they rely on."
                          : "General chat · add sources to ground your answers."}
                </div>
            </div>
        </main>
    );
}

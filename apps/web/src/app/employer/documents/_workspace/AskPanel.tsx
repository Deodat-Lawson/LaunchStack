"use client";

import React, {
    type Dispatch,
    type SetStateAction,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useTheme } from "next-themes";
import { writeSettingValue } from "~/lib/settings/useSettings";
import { useEmployerWorkspaceSwitcher } from "../../_chrome/EmployerWorkspaceSwitcherContext";
import { WorkspaceSwitcherDropdownRow } from "../../_chrome/WorkspaceSwitcherDropdownRow";
import { useChatRoutes } from "../hooks/useChatRoutes";
import {
    SOURCE_META,
    type ComposerSend,
    type EphemeralAttachment,
    type ThreadMessage,
    type ThreadReference,
    type WorkspaceSource,
} from "./types";
import {
    Bot,
    Check,
    Plus,
    ArrowUp as IconArrowUp,
    Zap as IconBolt,
    Brain as IconBrain,
    ChevronRight as IconChevronRight,
    File as IconFile,
    Globe as IconGlobe,
    Image as IconImage,
    LogOut as IconLogout,
    Moon as IconMoon,
    Paperclip as IconPaperclip,
    Plus as IconPlus,
    Search as IconSearch,
    Settings as IconSettings,
    Shield as IconShield,
    Sun as IconSun,
    User as IconUser,
    X as IconX,
} from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import {
    mentionQueryAt,
    mentionedAgentKeys,
    resolveChatTurn,
    usableAsPrimary,
    usableAsSubagent,
} from "~/lib/agents/definition";
import { AgentAvatar } from "./collab/AgentAvatar";
import { personaColor, type ChatAgentOption } from "./collab/types";
import { useContextTarget } from "~/components/context-menu";
import { copyText, readClipboardText } from "~/lib/context-menu";
import {
    buildAnswerMenuItems,
    buildAttachmentMenuItems,
    buildChatPaneMenuItems,
    buildCitationMenuItems,
    buildComposerMenuItems,
    buildContextChipMenuItems,
    buildQuestionMenuItems,
} from "./chatContextMenu";
import {
    downloadTextFile,
    parseQuotedMessage,
    quoteBlock,
    transcriptFilename,
    transcriptMarkdown,
} from "./transcript";
import { Button } from "~/components/ui/button";
import type { AskStarter } from "~/lib/ask-starters/contract";
import { AskStarters } from "./AskStarters";

/** Chat transcript column and composer share this width. */
const CHAT_COLUMN_MAX_PX = 760;
/** Horizontal gutter: main-area header bar, scroll column, and composer share this inset. */
const CHAT_GUTTER_X_PX = 24;

/** Shared chrome for AskPanel and ExpandedFeatureView top bars (padding aligns with chat body). */
export function workspaceMainHeaderBarStyle(leadingChromeInsetPx = 0): React.CSSProperties {
    return {
        flexShrink: 0,
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
    text: string;
    mode: "append" | "replace";
    /** Distinguishes repeat seeds with the same text. */
    nonce: number;
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
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {source.title}
            </span>
            {onRemove && (
                <button
                    onClick={onRemove}
                    style={{ color: "var(--ink-3)", display: "flex", alignItems: "center" }}
                >
                    <IconX size={10} />
                </button>
            )}
        </span>
    );
}

function renderInline(line: string) {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
            <strong key={i} style={{ fontWeight: 700, color: "var(--ink)" }}>
                {p.slice(2, -2)}
            </strong>
        ) : (
            <span key={i}>{p}</span>
        )
    );
}

function renderText(txt: string) {
    const lines = txt.split("\n");
    return lines.map((line, i) => {
        if (line.startsWith("> ")) {
            return (
                <div
                    key={i}
                    style={{
                        borderLeft: "3px solid var(--accent)",
                        paddingLeft: 12,
                        margin: "8px 0",
                        fontStyle: "italic",
                        color: "var(--ink)",
                        fontSize: 16,
                    }}
                >
                    {renderInline(line.slice(2))}
                </div>
            );
        }
        if (!line.trim()) return <div key={i} style={{ height: 8 }} />;
        return (
            <div key={i} style={{ marginBottom: 4 }}>
                {renderInline(line)}
            </div>
        );
    });
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
function QuestionBody({ text }: { text: string }) {
    const { lead, quote, trail } = useMemo(() => parseQuotedMessage(text), [text]);
    const prose: React.CSSProperties = {
        fontSize: 17,
        lineHeight: 1.55,
        color: "var(--ink)",
        fontWeight: 400,
        whiteSpace: "pre-wrap",
    };

    if (!quote) {
        return <div style={prose}>{text}</div>;
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {lead && <div style={prose}>{lead}</div>}
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
            {trail && <div style={prose}>{trail}</div>}
        </div>
    );
}

function Message({
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
}: MessageProps) {
    const isUser = msg.role === "user";
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
                style={{ animation: "lsw-fadeIn 200ms ease-out", marginBottom: 28 }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
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
                            <AttachmentChip key={a.id} attachment={a} />
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div {...ctxTarget} style={{ animation: "lsw-fadeIn 240ms ease-out", marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
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
            <div style={{ fontSize: 14, lineHeight: 1.65, color: "var(--ink-2)" }}>
                {renderText(msg.text)}
            </div>
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
}

function TypingIndicator() {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
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
            <div style={{ display: "flex", gap: 3 }}>
                {[0, 1, 2].map(i => (
                    <span
                        key={i}
                        style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "var(--accent)",
                            animation: `lsw-shimmer 1s ease-in-out ${i * 0.15}s infinite`,
                        }}
                    />
                ))}
            </div>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Searching your sources…</span>
        </div>
    );
}

interface ComposerProps {
    sources: WorkspaceSource[];
    selected: string[];
    setSelected: Dispatch<SetStateAction<string[]>>;
    onSend: (send: ComposerSend) => void;
    disabled?: boolean;
    webSearch: boolean;
    onToggleWebSearch: () => void;
    thinking: boolean;
    onToggleThinking: () => void;
    onOpenSource?: (source: WorkspaceSource) => void;
    /** Text handed in from outside: a quote to reply around, or a question to edit. */
    seed?: ComposerSeed | null;
    /** The roster, for the agent picker and `@handle` completion. */
    agents: ChatAgentOption[];
    /** The agent the chat is held with; null = the default assistant. */
    agentKey: string | null;
    onChangeAgent: (key: string | null) => void;
}

const ATTACH_MAX_COUNT = 5;
const ATTACH_MAX_BYTES = 20 * 1024 * 1024;

// Mime + extension whitelist for ephemeral attachments. Anything here the
// backend can extract text from (or send as a vision block). Media files
// (audio/video) are intentionally excluded — those belong in Sources where
// the transcription pipeline runs; ephemeral is for "look at this one thing
// for this turn" docs and images.
const ATTACH_TEXT_MIMES = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/json",
    "application/xml",
    "application/x-ndjson",
    "application/yaml",
    "application/x-yaml",
    "application/rtf",
]);
const ATTACH_TEXT_EXTS = new Set([
    "pdf",
    "doc",
    "docx",
    "txt",
    "md",
    "markdown",
    "csv",
    "tsv",
    "json",
    "jsonl",
    "xml",
    "yaml",
    "yml",
    "rtf",
    "log",
    "html",
    "htm",
]);

function extOf(filename: string): string {
    const i = filename.lastIndexOf(".");
    return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

function kindForFile(file: File): "image" | "text" | null {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("text/")) return "text";
    if (ATTACH_TEXT_MIMES.has(file.type)) return "text";
    if (ATTACH_TEXT_EXTS.has(extOf(file.name))) return "text";
    return null;
}

function Composer({
    sources,
    selected,
    setSelected,
    onSend,
    disabled,
    webSearch,
    onToggleWebSearch,
    thinking,
    onToggleThinking,
    onOpenSource,
    seed,
    agents,
    agentKey,
    onChangeAgent,
}: ComposerProps) {
    const [text, setText] = useState("");
    const [focus, setFocus] = useState(false);
    const [attachments, setAttachments] = useState<EphemeralAttachment[]>([]);
    const [uploading, setUploading] = useState(false);
    const [attachError, setAttachError] = useState<string | null>(null);
    const chatRoutes = useChatRoutes();
    const ref = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const selSources = selected
        .map(id => sources.find(s => s.id === id))
        .filter((s): s is WorkspaceSource => Boolean(s));

    // The agent for the *next* send: an `@handle` in the box summons that agent
    // for one turn (OpenCode's subagent mention); otherwise the picked agent.
    const agent = agents.find(a => a.id === agentKey) ?? null;
    const mentionable = useMemo(() => agents.filter(usableAsSubagent), [agents]);
    const mentionedKey = mentionedAgentKeys(
        text,
        mentionable.map(a => a.id)
    )[0];
    const turnAgent = (mentionedKey ? agents.find(a => a.id === mentionedKey) : null) ?? agent;
    const turnEffects = resolveChatTurn(
        turnAgent ? { tools: turnAgent.tools, route: null, style: null, temperature: null } : null,
        { webSearch, thinking, hasAttachments: attachments.length > 0 }
    );

    // `@` completion: the handle being typed at the caret, and the matches.
    const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
    const [mentionIndex, setMentionIndex] = useState(0);
    const mentionMatches = useMemo(() => {
        if (!mention) return [];
        return mentionable
            .filter(
                a =>
                    a.id.startsWith(mention.query) ||
                    a.displayName.toLowerCase().startsWith(mention.query)
            )
            .slice(0, 6);
    }, [mention, mentionable]);

    const syncMention = (value: string) => {
        const el = ref.current;
        setMention(el ? mentionQueryAt(value, el.selectionStart ?? value.length) : null);
        setMentionIndex(0);
    };

    const insertMention = (option: ChatAgentOption) => {
        if (!mention) return;
        const el = ref.current;
        const caret = el?.selectionStart ?? text.length;
        const next = `${text.slice(0, mention.start)}@${option.id} ${text.slice(caret)}`;
        setText(next);
        setMention(null);
        const position = mention.start + option.id.length + 2;
        window.requestAnimationFrame(() => {
            el?.focus();
            el?.setSelectionRange(position, position);
        });
    };

    const handleSend = () => {
        if (!text.trim() || disabled || uploading) return;
        onSend({
            text: text.trim(),
            refs: selected,
            attachments,
            webSearch,
            thinking,
            agentKey: mentionedKey ?? agentKey,
        });
        setText("");
        setMention(null);
        setAttachments([]);
        setAttachError(null);
    };

    useEffect(() => {
        if (ref.current) {
            ref.current.style.height = "auto";
            ref.current.style.height = Math.min(ref.current.scrollHeight, 200) + "px";
        }
    }, [text]);

    const handleFilesPicked = useCallback(
        async (files: FileList | null) => {
            if (!files || files.length === 0) return;

            if (attachments.length + files.length > ATTACH_MAX_COUNT) {
                setAttachError(`You can attach up to ${ATTACH_MAX_COUNT} files per message.`);
                return;
            }

            setUploading(true);
            setAttachError(null);
            const next: EphemeralAttachment[] = [];
            try {
                for (const file of Array.from(files)) {
                    if (file.size > ATTACH_MAX_BYTES) {
                        setAttachError(`"${file.name}" is too large (max 20MB per file).`);
                        continue;
                    }
                    const kind = kindForFile(file);
                    if (!kind) {
                        setAttachError(
                            `"${file.name}" isn't a supported attachment type. Use PDFs, DOCX, images, or text files — audio/video belong in Sources.`
                        );
                        continue;
                    }
                    if (kind === "image" && !chatRoutes.visionEnabled) {
                        setAttachError(
                            chatRoutes.visionDisabledReason ??
                                `"${file.name}" needs a vision route. Assign an image-capable model to the "vision" route in the chat model configuration.`
                        );
                        continue;
                    }
                    const maxImages = chatRoutes.config.routes.vision.vision?.maxImages;
                    if (
                        kind === "image" &&
                        maxImages !== undefined &&
                        attachments.filter(a => a.kind === "image").length +
                            next.filter(a => a.kind === "image").length >=
                            maxImages
                    ) {
                        setAttachError(
                            `The configured vision model accepts at most ${maxImages} image(s) per message.`
                        );
                        continue;
                    }
                    const form = new FormData();
                    form.append("file", file);
                    const res = await fetch("/api/storage/upload", { method: "POST", body: form });
                    if (!res.ok) {
                        const body = (await res.json().catch(() => ({}))) as { error?: string };
                        setAttachError(body.error ?? `Upload failed for "${file.name}"`);
                        continue;
                    }
                    const data = (await res.json()) as { url: string; objectKey: string };
                    next.push({
                        id: data.objectKey || `${Date.now()}-${file.name}`,
                        name: file.name,
                        mimeType: file.type,
                        size: file.size,
                        url: data.url,
                        kind,
                    });
                }
                if (next.length > 0) {
                    setAttachments(prev => [...prev, ...next]);
                }
            } finally {
                setUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        },
        [attachments, chatRoutes.visionEnabled, chatRoutes.visionDisabledReason, chatRoutes.config]
    );

    const removeAttachment = (id: string) => {
        setAttachments(prev => prev.filter(a => a.id !== id));
        setAttachError(null);
    };

    // A seed lands in the box and puts the caret at its end, so the person can
    // keep typing: a quote goes under whatever is there, an edit replaces it.
    useEffect(() => {
        if (!seed) return;
        setText(prev =>
            seed.mode === "replace" || !prev.trim()
                ? seed.text
                : `${prev.replace(/\s+$/, "")}\n\n${seed.text}`
        );
        const el = ref.current;
        if (!el) return;
        window.requestAnimationFrame(() => {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
        });
    }, [seed]);

    const selectedText = () => {
        const el = ref.current;
        return el ? el.value.slice(el.selectionStart, el.selectionEnd) : "";
    };
    const replaceSelection = (insert: string) => {
        const el = ref.current;
        if (!el) {
            setText(prev => prev + insert);
            return;
        }
        const start = el.selectionStart;
        const end = el.selectionEnd;
        setText(el.value.slice(0, start) + insert + el.value.slice(end));
        window.requestAnimationFrame(() => {
            el.focus();
            el.setSelectionRange(start + insert.length, start + insert.length);
        });
    };
    // The box opts into right-click (the browser's menu has nothing to offer a
    // plain textarea that this one lacks); chips inside it stay their own targets.
    const composerTarget = useContextTarget({
        kind: "composer",
        label: "Composer actions",
        editable: true,
        items: () =>
            buildComposerMenuItems(
                {
                    hasSelection: selectedText().length > 0,
                    hasContent: text.trim().length > 0 || attachments.length > 0,
                    uploading,
                    disabled: Boolean(disabled),
                    webSearch,
                    thinking,
                    reasoningEnabled: Boolean(chatRoutes.reasoningEnabled),
                    reasoningDisabledReason: chatRoutes.reasoningDisabledReason ?? undefined,
                },
                {
                    onCut: () => {
                        const cut = selectedText();
                        void copyText(cut).then(ok => {
                            if (ok) replaceSelection("");
                            else toast.error("Couldn't cut");
                        });
                    },
                    onCopy: () => void copyWithToast(selectedText()),
                    onPaste: () =>
                        void readClipboardText().then(clip => {
                            if (clip === null) {
                                toast.info("Clipboard access was refused — paste with ⌘V instead");
                            } else {
                                replaceSelection(clip);
                            }
                        }),
                    onAttach: () => fileInputRef.current?.click(),
                    onToggleWebSearch,
                    onToggleThinking,
                    onClear: () => {
                        setText("");
                        setAttachments([]);
                        setAttachError(null);
                    },
                }
            ),
    });

    return (
        <div
            {...composerTarget}
            style={{
                margin: "0 auto",
                maxWidth: CHAT_COLUMN_MAX_PX,
                width: "100%",
                padding: 14,
                borderRadius: 14,
                background: "var(--panel)",
                border: `1px solid ${focus ? "var(--accent)" : "var(--line)"}`,
                boxShadow: focus
                    ? "0 0 0 4px oklch(0.56 0.19 var(--accent-h) / 0.1)"
                    : "0 2px 8px var(--scrim-shadow)",
                transition: "border-color 140ms, box-shadow 140ms",
            }}
        >
            {selSources.length > 0 && (
                <div
                    style={{
                        display: "flex",
                        gap: 6,
                        flexWrap: "wrap",
                        marginBottom: 10,
                        paddingBottom: 10,
                        borderBottom: "1px dashed var(--line)",
                    }}
                >
                    <span
                        className="mono"
                        style={{
                            fontSize: 10,
                            color: "var(--ink-3)",
                            alignSelf: "center",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            fontWeight: 600,
                        }}
                    >
                        Context
                    </span>
                    {selSources.map(s => (
                        <SourceChip
                            key={s.id}
                            source={s}
                            size="sm"
                            onOpen={onOpenSource ? () => onOpenSource(s) : undefined}
                            onRemove={() => setSelected(selected.filter(x => x !== s.id))}
                        />
                    ))}
                </div>
            )}
            {attachments.length > 0 && (
                <div
                    style={{
                        display: "flex",
                        gap: 6,
                        flexWrap: "wrap",
                        marginBottom: 10,
                        paddingBottom: 10,
                        borderBottom: "1px dashed var(--line)",
                    }}
                >
                    <span
                        className="mono"
                        style={{
                            fontSize: 10,
                            color: "var(--ink-3)",
                            alignSelf: "center",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            fontWeight: 600,
                        }}
                    >
                        Attached
                    </span>
                    {attachments.map(a => (
                        <AttachmentChip
                            key={a.id}
                            attachment={a}
                            onRemove={() => removeAttachment(a.id)}
                        />
                    ))}
                </div>
            )}
            {attachError && (
                <div
                    style={{
                        fontSize: 11,
                        color: "oklch(0.55 0.18 25)",
                        marginBottom: 8,
                    }}
                >
                    {attachError}
                </div>
            )}
            {mentionMatches.length > 0 && (
                <div
                    role="listbox"
                    aria-label="Agents"
                    className="border-line bg-panel mb-2 overflow-hidden rounded-lg border shadow-md"
                >
                    {mentionMatches.map((option, index) => (
                        <button
                            key={option.id}
                            type="button"
                            role="option"
                            aria-selected={index === mentionIndex}
                            onMouseDown={e => {
                                e.preventDefault();
                                insertMention(option);
                            }}
                            onMouseEnter={() => setMentionIndex(index)}
                            className={cn(
                                "flex w-full items-center gap-2.5 px-3 py-1.5 text-left",
                                index === mentionIndex
                                    ? "bg-brand-soft text-brand-ink"
                                    : "text-ink-2"
                            )}
                        >
                            <AgentAvatar agent={option} size={20} />
                            <span className="text-[12.5px] font-medium">{option.displayName}</span>
                            <span className="mono text-[11px] opacity-70">@{option.id}</span>
                            <span className="ml-auto truncate text-[11px] opacity-70">
                                {option.description || option.role}
                            </span>
                        </button>
                    ))}
                </div>
            )}
            <textarea
                ref={ref}
                value={text}
                onChange={e => {
                    setText(e.target.value);
                    syncMention(e.target.value);
                }}
                onClick={() => syncMention(text)}
                onFocus={() => setFocus(true)}
                onBlur={() => {
                    setFocus(false);
                    setMention(null);
                }}
                onKeyDown={e => {
                    if (mentionMatches.length > 0) {
                        if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setMentionIndex(i => (i + 1) % mentionMatches.length);
                            return;
                        }
                        if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setMentionIndex(
                                i => (i - 1 + mentionMatches.length) % mentionMatches.length
                            );
                            return;
                        }
                        if (e.key === "Enter" || e.key === "Tab") {
                            e.preventDefault();
                            insertMention(mentionMatches[mentionIndex] ?? mentionMatches[0]!);
                            return;
                        }
                        if (e.key === "Escape") {
                            e.preventDefault();
                            setMention(null);
                            return;
                        }
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                    }
                }}
                placeholder={
                    agent
                        ? `Ask ${agent.displayName}, your ${agent.role.toLowerCase()}… or @mention another agent`
                        : selSources.length > 0
                          ? `Ask anything about ${selSources.length === 1 ? "this source" : `these ${selSources.length} sources`}…`
                          : "Ask anything. Pick sources on the left, type @ to bring in an agent."
                }
                style={{
                    width: "100%",
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    resize: "none",
                    fontSize: 15,
                    lineHeight: 1.5,
                    color: "var(--ink)",
                    fontFamily: "inherit",
                    minHeight: 44,
                }}
            />
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*,.pdf,.doc,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.xml,.yaml,.yml,.rtf,.log,.html,.htm"
                style={{ display: "none" }}
                onChange={e => void handleFilesPicked(e.target.files)}
            />
            <div
                style={{
                    marginTop: 8,
                    paddingTop: 12,
                    borderTop: "1px solid var(--line-2)",
                    width: "100%",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        flexWrap: "wrap",
                        rowGap: 8,
                        minHeight: 40,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: 8,
                            minWidth: 0,
                            flex: "1 1 auto",
                        }}
                    >
                        <AgentPill
                            agents={agents}
                            agent={agent}
                            mentioned={
                                mentionedKey && mentionedKey !== agentKey
                                    ? (agents.find(a => a.id === mentionedKey) ?? null)
                                    : null
                            }
                            onChange={onChangeAgent}
                        />
                        <ToolbarPill
                            label="Attach"
                            title={`Attach up to ${ATTACH_MAX_COUNT} files to this message only (PDFs, DOCX, images, text)`}
                            icon={<IconPaperclip size={12} />}
                            active={attachments.length > 0}
                            disabled={uploading || disabled}
                            onClick={() => fileInputRef.current?.click()}
                            badge={
                                uploading
                                    ? "…"
                                    : attachments.length > 0
                                      ? String(attachments.length)
                                      : undefined
                            }
                        />
                        <ToolbarPill
                            label="Web"
                            title="Search the web in addition to your sources"
                            icon={<IconGlobe size={12} />}
                            active={webSearch}
                            onClick={onToggleWebSearch}
                        />
                        <ToolbarPill
                            label="Think"
                            title={
                                chatRoutes.reasoningEnabled
                                    ? "Let the configured reasoning model reason before answering"
                                    : (chatRoutes.reasoningDisabledReason ??
                                      'Assign a reasoning-capable model to the "reasoning" route to enable this')
                            }
                            icon={<IconBrain size={12} />}
                            active={thinking && chatRoutes.reasoningEnabled}
                            disabled={!chatRoutes.reasoningEnabled}
                            onClick={onToggleThinking}
                        />
                    </div>
                    {turnEffects.notes.length > 0 && (
                        <div className="text-ink-3 basis-full text-[11px]" role="status">
                            {turnAgent?.displayName ?? "This agent"}: {turnEffects.notes.join("; ")}
                            .
                        </div>
                    )}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 8,
                            flexShrink: 0,
                        }}
                    >
                        <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                            <kbd
                                style={{
                                    padding: "1.5px 5px",
                                    border: "1px solid var(--line)",
                                    borderRadius: 4,
                                }}
                            >
                                ⏎
                            </kbd>{" "}
                            to send
                        </span>
                        <button
                            type="button"
                            onClick={handleSend}
                            disabled={!text.trim() || (disabled ?? false) || uploading}
                            style={{
                                width: 34,
                                height: 34,
                                borderRadius: 8,
                                background:
                                    text.trim() && !disabled && !uploading
                                        ? "var(--accent)"
                                        : "var(--line)",
                                color:
                                    text.trim() && !disabled && !uploading
                                        ? "white"
                                        : "var(--ink-3)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor:
                                    text.trim() && !disabled && !uploading
                                        ? "pointer"
                                        : "not-allowed",
                            }}
                        >
                            <IconArrowUp size={15} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

interface ToolbarPillProps {
    label: string;
    title: string;
    icon: React.ReactNode;
    active: boolean;
    disabled?: boolean;
    onClick: () => void;
    badge?: string;
}

/**
 * The composer's agent picker — OpenCode's Tab-to-switch primary agent, as a
 * pill. Shows who answers next: the picked agent, or the one an `@handle` in
 * the box summons for this turn.
 */
function AgentPill({
    agents,
    agent,
    mentioned,
    onChange,
}: {
    agents: ChatAgentOption[];
    agent: ChatAgentOption | null;
    /** An agent an `@handle` in the draft summons for the next turn only. */
    mentioned: ChatAgentOption | null;
    onChange: (key: string | null) => void;
}) {
    const [open, setOpen] = useState(false);
    const primaries = agents.filter(usableAsPrimary);
    const shown = mentioned ?? agent;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    title={
                        mentioned
                            ? `@${mentioned.id} answers this turn (mentioned)`
                            : agent
                              ? `${agent.displayName} — ${agent.role}. Click to change.`
                              : "Pick an agent to hold this chat with"
                    }
                    aria-label="Agent"
                    style={{
                        fontSize: 12,
                        padding: shown ? "4px 10px 4px 4px" : "6px 10px",
                        borderRadius: 8,
                        color: shown ? "var(--ink)" : "var(--ink-2)",
                        background: shown ? "var(--panel-2)" : "transparent",
                        border: `1px solid ${shown ? (shown.accent ?? personaColor(shown)) : "var(--line)"}`,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        transition: "background 120ms, border-color 120ms, color 120ms",
                    }}
                >
                    {shown ? (
                        <>
                            <AgentAvatar agent={shown} size={18} />
                            <span style={{ fontWeight: 600 }}>{shown.displayName}</span>
                            {mentioned && (
                                <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                                    this turn
                                </span>
                            )}
                        </>
                    ) : (
                        <>
                            <Bot size={12} />
                            Agent
                        </>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[320px] p-1.5">
                <div className="text-ink-3 px-2 pb-1.5 pt-1 text-[11px]">
                    Who holds this chat. Type <span className="mono">@handle</span> in a message to
                    bring another agent in for one turn.
                </div>
                <button
                    type="button"
                    role="option"
                    aria-selected={agent === null}
                    onClick={() => {
                        onChange(null);
                        setOpen(false);
                    }}
                    className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
                        agent === null
                            ? "bg-brand-soft text-brand-ink"
                            : "text-ink-2 hover:bg-line-2"
                    )}
                >
                    <span className="bg-brand-soft text-brand inline-flex size-6 items-center justify-center rounded-full">
                        <IconBolt size={11} />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-medium">Launchstack</span>
                        <span className="block text-[11px] opacity-70">
                            The workspace assistant
                        </span>
                    </span>
                    {agent === null && <Check className="size-3.5" />}
                </button>
                <div className="max-h-[320px] overflow-y-auto">
                    {primaries.map(option => (
                        <button
                            key={option.id}
                            type="button"
                            role="option"
                            aria-selected={agent?.id === option.id}
                            onClick={() => {
                                onChange(option.id);
                                setOpen(false);
                            }}
                            className={cn(
                                "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
                                agent?.id === option.id
                                    ? "bg-brand-soft text-brand-ink"
                                    : "text-ink-2 hover:bg-line-2"
                            )}
                        >
                            <AgentAvatar agent={option} size={24} />
                            <span className="min-w-0 flex-1">
                                <span className="flex items-baseline gap-1.5">
                                    <span className="text-[12.5px] font-medium">
                                        {option.displayName}
                                    </span>
                                    <span className="mono text-[10.5px] opacity-70">
                                        @{option.id}
                                    </span>
                                </span>
                                <span className="block truncate text-[11px] opacity-70">
                                    {option.description || option.role}
                                </span>
                            </span>
                            {agent?.id === option.id && <Check className="size-3.5 shrink-0" />}
                        </button>
                    ))}
                    {primaries.length === 0 && (
                        <div className="text-ink-3 px-2 py-2 text-[12px]">No agents yet.</div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

function ToolbarPill({ label, title, icon, active, disabled, onClick, badge }: ToolbarPillProps) {
    return (
        <button
            onClick={onClick}
            title={title}
            disabled={disabled}
            style={{
                fontSize: 12,
                padding: "6px 10px",
                borderRadius: 8,
                color: active ? "white" : "var(--ink-2)",
                background: active ? "var(--accent)" : "transparent",
                border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                display: "flex",
                alignItems: "center",
                gap: 5,
                opacity: disabled ? 0.5 : 1,
                cursor: disabled ? "not-allowed" : "pointer",
                transition: "background 120ms, border-color 120ms, color 120ms",
            }}
        >
            {icon}
            {label}
            {badge && (
                <span
                    style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "0 5px",
                        borderRadius: 999,
                        background: active ? "rgba(255,255,255,0.25)" : "var(--line-2)",
                        color: active ? "white" : "var(--ink-3)",
                        minWidth: 14,
                        textAlign: "center",
                    }}
                >
                    {badge}
                </span>
            )}
        </button>
    );
}

interface AttachmentChipProps {
    attachment: EphemeralAttachment;
    onRemove?: () => void;
}

function AttachmentChip({ attachment, onRemove }: AttachmentChipProps) {
    const isImage = attachment.kind === "image";
    const ctxTarget = useContextTarget({
        kind: "attachment",
        id: attachment.id,
        label: `Actions for ${attachment.name}`,
        data: attachment,
        items: () =>
            buildAttachmentMenuItems(attachment, {
                onOpen: () => window.open(attachment.url, "_blank", "noopener,noreferrer"),
                onRemove,
            }),
    });
    return (
        <span
            {...ctxTarget}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 8px 2px 4px",
                background: "var(--line-2)",
                border: "1px dashed var(--line)",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 500,
                color: "var(--ink-2)",
                maxWidth: 260,
            }}
        >
            {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={attachment.url}
                    alt={attachment.name}
                    style={{ width: 18, height: 18, borderRadius: 4, objectFit: "cover" }}
                />
            ) : (
                <span
                    style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        background: "var(--panel)",
                        border: "1px solid var(--line)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--ink-3)",
                    }}
                >
                    <IconImage size={10} />
                </span>
            )}
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {attachment.name}
            </span>
            {onRemove && (
                <button
                    onClick={onRemove}
                    style={{ color: "var(--ink-3)", display: "flex", alignItems: "center" }}
                    title="Remove attachment"
                >
                    <IconX size={10} />
                </button>
            )}
        </span>
    );
}

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
                <div className="display text-ink mb-2.5 text-[42px] leading-[1.15] tracking-[-0.02em]">
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
const EMPLOYER_DOCS_URL = "https://github.com/Deodat-Lawson/LaunchStack#readme";

export interface AvatarMenuProps {
    userInitials: string;
    userName?: string;
    userEmail?: string;
    onOpenSettings: () => void;
    onSignOut?: () => void;
}

/** Matches the workspace header “jump” control (⌘K) — reused in ExpandedFeatureView. */
export function JumpToPaletteButton({ onClick }: { onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            title="Jump to anything  ⌘K"
            type="button"
            style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 9px",
                borderRadius: 7,
                border: "1px solid var(--line)",
                background: "var(--line-2)",
                fontSize: 12,
                color: "var(--ink-3)",
            }}
        >
            <IconSearch size={12} />
            <span
                className="mono"
                style={{
                    fontSize: 10,
                    padding: "1px 5px",
                    border: "1px solid var(--line)",
                    borderRadius: 4,
                    background: "var(--panel)",
                }}
            >
                ⌘K
            </span>
        </button>
    );
}

export function AvatarMenu({
    userInitials,
    userName,
    userEmail,
    onOpenSettings,
    onSignOut,
}: AvatarMenuProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const { resolvedTheme, setTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const workspaceSwitcher = useEmployerWorkspaceSwitcher();

    useEffect(() => {
        const onClick = (e: globalThis.MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onClick);
        return () => document.removeEventListener("mousedown", onClick);
    }, []);

    return (
        <div ref={ref} style={{ position: "relative" }}>
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background:
                        "linear-gradient(135deg, oklch(0.7 0.12 282), oklch(0.55 0.18 260))",
                    color: "white",
                    fontSize: 12,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                    border: "none",
                    cursor: "pointer",
                }}
            >
                {userInitials}
            </button>
            {open && (
                <div
                    style={{
                        position: "absolute",
                        top: "calc(100% + 8px)",
                        right: 0,
                        width: 240,
                        background: "var(--panel)",
                        border: "1px solid var(--line)",
                        borderRadius: 12,
                        boxShadow: "0 16px 40px var(--scrim-shadow)",
                        padding: 6,
                        zIndex: 50,
                        animation: "lsw-fadeIn 120ms",
                    }}
                >
                    <div
                        style={{
                            padding: "10px 10px 10px",
                            borderBottom: workspaceSwitcher ? "none" : "1px solid var(--line)",
                            marginBottom: workspaceSwitcher ? 0 : 6,
                        }}
                    >
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                            {userName ?? "Your account"}
                        </div>
                        {userEmail && (
                            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{userEmail}</div>
                        )}
                    </div>
                    {workspaceSwitcher && (
                        <WorkspaceSwitcherDropdownRow
                            payload={workspaceSwitcher}
                            onNavigate={() => setOpen(false)}
                        />
                    )}
                    <button
                        type="button"
                        onClick={() => {
                            const next = isDark ? "light" : "dark";
                            setTheme(next);
                            // Remembered as a preference, so the choice follows
                            // the person to their next browser. Best effort.
                            void writeSettingValue({
                                key: "appearance.theme",
                                scope: "member",
                                value: next,
                            }).catch(() => undefined);
                        }}
                        style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "7px 10px",
                            borderRadius: 7,
                            fontSize: 13,
                            color: "var(--ink-2)",
                            cursor: "pointer",
                            background: "transparent",
                            border: "none",
                            textAlign: "left",
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = "var(--line-2)";
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = "transparent";
                        }}
                    >
                        {isDark ? <IconSun size={14} /> : <IconMoon size={14} />}
                        <span style={{ flex: 1 }}>Switch to {isDark ? "light" : "dark"} theme</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setOpen(false);
                            onOpenSettings();
                        }}
                        style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "7px 10px",
                            borderRadius: 7,
                            fontSize: 13,
                            color: "var(--ink-2)",
                            cursor: "pointer",
                            background: "transparent",
                            border: "none",
                            textAlign: "left",
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = "var(--line-2)";
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = "transparent";
                        }}
                    >
                        <IconSettings size={14} />
                        <span style={{ flex: 1 }}>Settings</span>
                    </button>
                    <a
                        href={EMPLOYER_DOCS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setOpen(false)}
                        style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "7px 10px",
                            borderRadius: 7,
                            fontSize: 13,
                            color: "var(--ink-2)",
                            cursor: "pointer",
                            background: "transparent",
                            textDecoration: "none",
                            boxSizing: "border-box",
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = "var(--line-2)";
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = "transparent";
                        }}
                    >
                        <IconFile size={14} />
                        <span style={{ flex: 1 }}>Documentation</span>
                        <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                            ↗
                        </span>
                    </a>
                    {onSignOut && (
                        <button
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                onSignOut();
                            }}
                            style={{
                                width: "100%",
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "7px 10px",
                                borderRadius: 7,
                                fontSize: 13,
                                color: "var(--ink-2)",
                                cursor: "pointer",
                                background: "transparent",
                                border: "none",
                                textAlign: "left",
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = "var(--line-2)";
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = "transparent";
                            }}
                        >
                            <IconLogout size={14} />
                            <span style={{ flex: 1 }}>Log out</span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

export interface AskPanelProps {
    sources: WorkspaceSource[];
    selected: string[];
    setSelected: Dispatch<SetStateAction<string[]>>;
    thread: ThreadMessage[];
    sendMessage: (send: ComposerSend) => void;
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
}: AskPanelProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [thread, isSending]);

    const isEmpty = thread.length === 0;

    // One seed channel for the composer: the shell's seed and the panel's own
    // quote / edit verbs both land here, latest wins.
    const [seed, setSeed] = useState<ComposerSeed | null>(null);
    useEffect(() => {
        if (composerSeed) setSeed(composerSeed);
    }, [composerSeed]);
    const quote = useCallback(
        (text: string) => setSeed({ text: quoteBlock(text), mode: "append", nonce: Date.now() }),
        []
    );
    const edit = useCallback(
        (text: string) => setSeed({ text, mode: "replace", nonce: Date.now() }),
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

    const latestRole = thread.at(-1)?.role;
    const showTyping = isSending && latestRole === "user";

    const titleText = isEmpty ? "New conversation" : "Ask over your sources";
    const subText = isEmpty
        ? "Pick sources on the left, then ask."
        : `${thread.length} message${thread.length !== 1 ? "s" : ""} · updated just now`;

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
            sendMessage({
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
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{titleText}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{subText}</div>
                </div>

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

            <div
                ref={scrollRef}
                style={{
                    flex: 1,
                    overflowY: "auto",
                    paddingTop: 28,
                    paddingBottom: 20,
                    paddingLeft: CHAT_GUTTER_X_PX + leadingChromeInsetPx,
                    paddingRight: CHAT_GUTTER_X_PX,
                }}
            >
                <div style={{ maxWidth: CHAT_COLUMN_MAX_PX, margin: "0 auto" }}>
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
                            {thread.map((m, i) => (
                                <Message
                                    key={i}
                                    msg={m}
                                    index={i}
                                    sources={sources}
                                    selected={selected}
                                    setSelected={setSelected}
                                    onOpenCitation={onOpenCitation}
                                    onOpenSource={onOpenSource}
                                    onQuote={quote}
                                    onEdit={edit}
                                    agents={agents}
                                />
                            ))}
                            {showTyping && <TypingIndicator />}
                        </>
                    )}
                </div>
            </div>

            <div
                style={{
                    paddingTop: 12,
                    paddingBottom: 20,
                    paddingLeft: CHAT_GUTTER_X_PX + leadingChromeInsetPx,
                    paddingRight: CHAT_GUTTER_X_PX,
                    flexShrink: 0,
                }}
            >
                <Composer
                    sources={sources}
                    selected={selected}
                    setSelected={setSelected}
                    onSend={handleSend}
                    disabled={isSending}
                    webSearch={webSearch}
                    onToggleWebSearch={onToggleWebSearch}
                    thinking={thinking}
                    onToggleThinking={onToggleThinking}
                    onOpenSource={onOpenSource}
                    seed={seed}
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
                        : "Grounded answers only — cites every source it uses."}
                </div>
            </div>
        </main>
    );
}

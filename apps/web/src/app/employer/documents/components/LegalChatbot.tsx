"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
    ArrowLeft,
    Send,
    Scale,
    FileText,
    CheckCircle2,
    ChevronRight,
    RotateCcw,
    RefreshCw,
    AlertCircle,
    Sparkles,
    Eye,
    Settings,
    Link as LinkIcon,
} from "lucide-react";
import { TEMPLATE_REGISTRY } from "@launchstack/pipelines/legal-templates";
import MarkdownMessage from "~/app/_components/MarkdownMessage";
import { legalTheme as s } from "./LegalGeneratorTheme";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface RecommendedTemplate {
    templateId: string;
    confidence: number;
    reason: string;
    name: string;
    description: string;
    fieldCount: number;
    requiredFieldCount: number;
    requiredFieldLabels?: string[];
}

interface ChatResponse {
    message: string;
    phase: "recommending" | "confirmed" | "collecting" | "ready";
    recommendedTemplates: RecommendedTemplate[];
    selectedTemplateId: string | null;
    extractedFields: Record<string, string>;
    missingRequiredFields: string[];
    companyDefaults: Record<string, string>;
}

interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    parsed?: ChatResponse;
    isError?: boolean;
}

interface LegalChatbotProps {
    onBack: () => void;
    onContinueToTemplateForm: (templateId: string, prefilled: Record<string, string>) => void;
    initialMessage?: string;
}

// ─── Field carry-over ──────────────────────────────────────────────────────────

function carryOverFields(
    extractedFields: Record<string, string>,
    newTemplateId: string
): Record<string, string> {
    const newTemplate = TEMPLATE_REGISTRY[newTemplateId];
    if (!newTemplate) return extractedFields;
    const validKeys = new Set(newTemplate.fields.map(f => f.key));
    const carried: Record<string, string> = {};
    for (const [key, value] of Object.entries(extractedFields)) {
        if (validKeys.has(key)) {
            carried[key] = value;
        }
    }
    return carried;
}

// ─── Source tag for the field summary table ────────────────────────────────────

function sourceTag(
    key: string,
    hasValue: boolean,
    companyDefaults: Record<string, string>,
    isCurrent: boolean
): { txt: string; ai?: boolean } {
    if (!hasValue) return { txt: isCurrent ? "Asking" : "Awaiting" };
    if (companyDefaults[key]) return { txt: "Company" };
    if (key === "effective_date" || key === "signature_date" || key.endsWith("_date")) {
        return { txt: "AI Assist", ai: true };
    }
    return { txt: "You" };
}

// ─── Confirm / No-match / Ready cards (compact) ────────────────────────────────

function TemplateConfirmCard({
    template,
    onConfirm,
    onPickDifferent,
}: {
    template: RecommendedTemplate;
    onConfirm: () => void;
    onPickDifferent: () => void;
}) {
    return (
        <div className={s.banner} style={{ padding: 14 }}>
            <div className="mb-2 flex items-start gap-3">
                <div className={s.brandMarkSm}>
                    <Scale className="h-[13px] w-[13px]" />
                </div>
                <div className="min-w-0 flex-1">
                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                        {template.name}
                    </h4>
                    <p
                        style={{
                            margin: "2px 0 0",
                            fontSize: 12,
                            color: "var(--ink-3)",
                            lineHeight: 1.5,
                        }}
                    >
                        {template.description}
                    </p>
                </div>
            </div>
            <div
                style={{
                    display: "flex",
                    gap: 12,
                    fontSize: 11,
                    color: "var(--ink-3)",
                    marginBottom: 10,
                }}
            >
                <span>{template.fieldCount} fields</span>
                <span>{template.requiredFieldCount} required</span>
            </div>
            <div className="flex flex-wrap gap-2">
                <button className={`${s.btn} ${s.btnAccent} ${s.btnSm}`} onClick={onConfirm}>
                    <CheckCircle2 className="h-4 w-4" />
                    Use this template
                </button>
                <button className={`${s.btn} ${s.btnOutline} ${s.btnSm}`} onClick={onPickDifferent}>
                    Pick another
                </button>
            </div>
        </div>
    );
}

function NoMatchCard({ onStartOver }: { onStartOver: () => void }) {
    return (
        <div className={`${s.banner} ${s.bannerWarn}`} style={{ padding: 14 }}>
            <div className="mb-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" style={{ color: "var(--warn)" }} />
                <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                    No exact match
                </h4>
            </div>
            <p
                style={{
                    margin: "0 0 10px",
                    fontSize: 12,
                    color: "var(--ink-2)",
                    lineHeight: 1.55,
                }}
            >
                None of our templates are a perfect fit. Try describing differently, or browse the
                library.
            </p>
            <button className={`${s.btn} ${s.btnOutline} ${s.btnSm}`} onClick={onStartOver}>
                <RotateCcw className="h-3 w-3" />
                Start over
            </button>
        </div>
    );
}

function GenerateActionCard({
    templateName,
    extractedFields,
    onContinue,
}: {
    templateName: string;
    extractedFields: Record<string, string>;
    onContinue: () => void;
}) {
    const fieldCount = Object.keys(extractedFields).length;
    return (
        <div className={`${s.banner} ${s.bannerSuccess}`} style={{ padding: 14 }}>
            <div className="mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" style={{ color: "var(--success)" }} />
                <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                    Ready for the field form
                </h4>
            </div>
            <p
                style={{
                    margin: "0 0 10px",
                    fontSize: 12,
                    color: "var(--ink-2)",
                    lineHeight: 1.55,
                }}
            >
                <strong>{templateName}</strong> · {fieldCount} fields collected. Review on the next
                screen, then your document opens for editing.
            </p>
            <button className={`${s.btn} ${s.btnAccent} ${s.btnSm}`} onClick={onContinue}>
                <ChevronRight className="h-3 w-3" />
                Continue to template fields
            </button>
        </div>
    );
}

function ErrorBubble({ content, onRetry }: { content: string; onRetry: () => void }) {
    return (
        <div className="space-y-2">
            <div
                style={{
                    borderRadius: 14,
                    borderBottomLeftRadius: 4,
                    padding: "10px 14px",
                    fontSize: 14,
                    lineHeight: 1.55,
                    background: "var(--danger-soft)",
                    color: "var(--danger)",
                    border: "1px solid oklch(from var(--danger) l c h / 0.3)",
                }}
            >
                {content}
            </div>
            <button className={`${s.btn} ${s.btnOutline} ${s.btnSm}`} onClick={onRetry}>
                <RefreshCw className="h-3 w-3" />
                Retry
            </button>
        </div>
    );
}

// ─── Recommended template tile (in chat) ───────────────────────────────────────

function TemplateTile({
    template,
    onSelect,
}: {
    template: RecommendedTemplate;
    onSelect: (templateId: string) => void;
}) {
    return (
        <button
            onClick={() => onSelect(template.templateId)}
            className={s.tplRow}
            style={{ padding: 10 }}
        >
            <div className={s.tplRowIcon}>
                <FileText className="h-[13px] w-[13px]" />
            </div>
            <div style={{ minWidth: 0 }}>
                <div className={s.tplRowName}>{template.name}</div>
                <div className={s.tplRowCat}>
                    {template.requiredFieldCount} required · {Math.round(template.confidence * 100)}
                    % match
                </div>
            </div>
            <ChevronRight className="h-4 w-4 flex-shrink-0" style={{ color: "var(--ink-3)" }} />
        </button>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LegalChatbot({
    onBack,
    onContinueToTemplateForm,
    initialMessage,
}: LegalChatbotProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [pendingConfirm, setPendingConfirm] = useState<RecommendedTemplate | null>(null);
    const [currentResponse, setCurrentResponse] = useState<ChatResponse | null>(null);
    const [accumulatedFields, setAccumulatedFields] = useState<Record<string, string>>({});
    const [confirmedTemplateId, setConfirmedTemplateId] = useState<string | null>(null);
    const feedRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const hasSentInitial = useRef(false);
    const hasShownIntro = useRef(false);
    const currentResponseRef = useRef<ChatResponse | null>(null);

    useEffect(() => {
        currentResponseRef.current = currentResponse;
    }, [currentResponse]);

    useEffect(() => {
        if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }, [messages, pendingConfirm, isLoading]);

    const activeTemplateId = confirmedTemplateId ?? currentResponse?.selectedTemplateId ?? null;

    const sendMessage = useCallback(
        async (text: string) => {
            if (!text.trim() || isLoading) return;

            const userMessage: ChatMessage = { role: "user", content: text };
            const updatedMessages = [...messages, userMessage];
            setMessages(updatedMessages);
            setInput("");
            setPendingConfirm(null);
            setIsLoading(true);

            try {
                const apiMessages = updatedMessages
                    .filter(m => !m.isError)
                    .map(m => ({
                        role: m.role,
                        content:
                            m.role === "assistant" && m.parsed
                                ? JSON.stringify(m.parsed)
                                : m.content,
                    }));

                const response = await fetch("/api/document-generator/legal-chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        messages: apiMessages,
                        accumulatedFields,
                    }),
                });

                if (!response.ok) {
                    setMessages(prev => [
                        ...prev,
                        {
                            role: "assistant",
                            content: `Server error (${response.status}). Please try again.`,
                            isError: true,
                        },
                    ]);
                    return;
                }

                const data = (await response.json()) as {
                    success: boolean;
                    data?: ChatResponse;
                    message?: string;
                };

                if (data.success && data.data) {
                    const parsed = data.data;

                    if (
                        !hasShownIntro.current &&
                        parsed.companyDefaults &&
                        Object.keys(parsed.companyDefaults).length > 0
                    ) {
                        hasShownIntro.current = true;
                        const defaults = parsed.companyDefaults;
                        const parts: string[] = [];
                        if (defaults.company_name) parts.push(`**${defaults.company_name}**`);
                        if (defaults.company_address)
                            parts.push(`based in **${defaults.company_address}**`);
                        if (parts.length > 0) {
                            const introContent = `I see your company is ${parts.join(", ")}. I'll pre-fill those details automatically.`;
                            setMessages(prev => [
                                ...prev,
                                { role: "assistant", content: introContent },
                            ]);
                        }
                    }

                    const assistantMessage: ChatMessage = {
                        role: "assistant",
                        content: parsed.message,
                        parsed,
                    };
                    setMessages(prev => [...prev, assistantMessage]);
                    setCurrentResponse(parsed);

                    if (parsed.extractedFields && Object.keys(parsed.extractedFields).length > 0) {
                        const stringified: Record<string, string> = {};
                        for (const [k, v] of Object.entries(parsed.extractedFields)) {
                            stringified[k] = String(v);
                        }
                        setAccumulatedFields(prev => {
                            const prevTemplateId = currentResponseRef.current?.selectedTemplateId;
                            if (
                                parsed.selectedTemplateId &&
                                prevTemplateId &&
                                parsed.selectedTemplateId !== prevTemplateId
                            ) {
                                const carried = carryOverFields(prev, parsed.selectedTemplateId);
                                return { ...carried, ...stringified };
                            }
                            return { ...prev, ...stringified };
                        });
                    }

                    if (
                        parsed.phase === "recommending" &&
                        parsed.recommendedTemplates.length === 1 &&
                        parsed.recommendedTemplates[0]!.confidence >= 0.85
                    ) {
                        setPendingConfirm(parsed.recommendedTemplates[0]!);
                    }
                } else {
                    setMessages(prev => [
                        ...prev,
                        {
                            role: "assistant",
                            content: data.message ?? "Something went wrong. Please try again.",
                            isError: true,
                        },
                    ]);
                }
            } catch {
                setMessages(prev => [
                    ...prev,
                    {
                        role: "assistant",
                        content: "Failed to connect to the server. Please try again.",
                        isError: true,
                    },
                ]);
            } finally {
                setIsLoading(false);
            }
        },
        [messages, isLoading, accumulatedFields]
    );

    useEffect(() => {
        if (initialMessage && !hasSentInitial.current) {
            hasSentInitial.current = true;
            void sendMessage(initialMessage);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- ref guard prevents double-send
    }, [initialMessage]);

    const handleRetry = (errorIndex: number) => {
        const lastUserMsg = [...messages.slice(0, errorIndex)]
            .reverse()
            .find(m => m.role === "user");
        if (!lastUserMsg) return;
        setMessages(prev => prev.filter((_, i) => i !== errorIndex));
        void sendMessage(lastUserMsg.content);
    };

    const handleSelectTemplate = (templateId: string) => {
        let rec = currentResponse?.recommendedTemplates.find(t => t.templateId === templateId);
        if (!rec) {
            for (const msg of messages) {
                if (msg.parsed?.recommendedTemplates) {
                    const found = msg.parsed.recommendedTemplates.find(
                        t => t.templateId === templateId
                    );
                    if (found) {
                        rec = found;
                        break;
                    }
                }
            }
        }
        if (rec) {
            setPendingConfirm(rec);
        }
    };

    const handleConfirmTemplate = () => {
        if (!pendingConfirm) return;
        const carried = carryOverFields(accumulatedFields, pendingConfirm.templateId);
        setAccumulatedFields(carried);
        setConfirmedTemplateId(pendingConfirm.templateId);
        setPendingConfirm(null);
        void sendMessage(`I want to proceed with the "${pendingConfirm.name}" template.`);
    };

    const handlePickDifferent = () => {
        setPendingConfirm(null);
        void sendMessage("Can you suggest other options?");
    };

    const handleStartOver = () => {
        setMessages([]);
        setInput("");
        setPendingConfirm(null);
        setCurrentResponse(null);
        setAccumulatedFields({});
        setConfirmedTemplateId(null);
        hasSentInitial.current = false;
        hasShownIntro.current = false;
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void sendMessage(input);
        }
    };

    const handleContinueToTemplateForm = () => {
        if (!currentResponse?.selectedTemplateId) return;
        const finalFields = {
            ...accumulatedFields,
            ...currentResponse.extractedFields,
        };
        onContinueToTemplateForm(currentResponse.selectedTemplateId, finalFields);
    };

    const lastAssistantMsg = [...messages].reverse().find(m => m.role === "assistant" && m.parsed);
    const isNoMatch =
        lastAssistantMsg?.parsed?.phase === "recommending" &&
        lastAssistantMsg.parsed.recommendedTemplates.length === 0;

    // Merged field state for the live preview
    const mergedFields: Record<string, string> = {
        ...accumulatedFields,
        ...(currentResponse?.extractedFields ?? {}),
    };
    const companyDefaults = currentResponse?.companyDefaults ?? {};

    // Active template for preview — null when nothing chosen yet
    const previewTemplate = activeTemplateId ? TEMPLATE_REGISTRY[activeTemplateId] : null;
    const previewFields = previewTemplate?.fields ?? [];
    const requiredFields = previewFields.filter(f => f.required);
    const filledN = requiredFields.filter(f => mergedFields[f.key]).length;
    const totalN = requiredFields.length;
    const currentField = requiredFields.find(f => !mergedFields[f.key]) ?? null;

    return (
        <div className="flex h-full flex-col" style={{ minHeight: 0 }}>
            {/* Top bar — replaces the drift sidebar with a slim breadcrumb header */}
            <div className={s.assistTopBar}>
                <button
                    className={`${s.btn} ${s.btnGhost} ${s.btnSm}`}
                    onClick={onBack}
                    style={{ paddingLeft: 6, paddingRight: 10 }}
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </button>
                <span className={s.dividerVert} />
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
                    <span className={s.assistTopBarMeta}>Drift Assist · Legal</span>
                </div>
                <div className={s.assistTopBarSpacer} />
                {messages.length > 0 && (
                    <button
                        className={`${s.btn} ${s.btnGhost} ${s.btnSm}`}
                        onClick={handleStartOver}
                    >
                        <RotateCcw className="h-4 w-4" />
                        Start over
                    </button>
                )}
            </div>

            {/* Two-column split: chat | live preview */}
            <div className={s.assist}>
                {/* ─── Chat column ─────────────────────────────────────────────── */}
                <section className={s.assistChat}>
                    <header className={s.assistChatHead}>
                        <div className={s.assistChatAvatar}>
                            <Sparkles />
                        </div>
                        <div className={s.assistChatTitleBlock}>
                            <div className={s.assistChatName}>Drift Assist</div>
                            <div className={s.assistChatSub}>
                                {previewTemplate
                                    ? `filling · ${previewTemplate.name.toLowerCase()}`
                                    : "ready · pick a template to begin"}
                            </div>
                        </div>
                        <div className={s.assistChatMenu}>
                            <button
                                className={`${s.btn} ${s.btnGhost} ${s.btnIconSm}`}
                                title="Show all fields"
                                aria-label="Show all fields"
                            >
                                <Eye />
                            </button>
                            <button
                                className={`${s.btn} ${s.btnGhost} ${s.btnIconSm}`}
                                title="Settings"
                                aria-label="Settings"
                            >
                                <Settings />
                            </button>
                        </div>
                    </header>

                    <div ref={feedRef} className={`${s.assistChatFeed} ${s.scrollbar}`}>
                        {messages.length === 0 && !isLoading && (
                            <WelcomeMessage onSuggest={q => void sendMessage(q)} />
                        )}

                        {messages.map((msg, i) => (
                            <div
                                key={i}
                                className={`${s.assistMsg} ${
                                    msg.role === "user" ? s.assistMsgUser : s.assistMsgBot
                                }`}
                            >
                                <div className={s.assistMsgAvatar}>
                                    {msg.role === "user" ? (
                                        <FileText />
                                    ) : msg.isError ? (
                                        <AlertCircle />
                                    ) : (
                                        <Sparkles />
                                    )}
                                </div>
                                <div className={s.assistMsgBody}>
                                    {msg.isError ? (
                                        <ErrorBubble
                                            content={msg.content}
                                            onRetry={() => handleRetry(i)}
                                        />
                                    ) : (
                                        <div className={s.assistBubble}>
                                            {msg.role === "assistant" ? (
                                                <MarkdownMessage
                                                    content={msg.content}
                                                    className="text-sm"
                                                />
                                            ) : (
                                                msg.content
                                            )}
                                        </div>
                                    )}

                                    {msg.parsed?.phase === "recommending" &&
                                        msg.parsed.recommendedTemplates.length > 0 && (
                                            <div
                                                style={{
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    gap: 6,
                                                }}
                                            >
                                                {msg.parsed.recommendedTemplates.map(rec => (
                                                    <TemplateTile
                                                        key={rec.templateId}
                                                        template={rec}
                                                        onSelect={handleSelectTemplate}
                                                    />
                                                ))}
                                            </div>
                                        )}

                                    {msg.parsed?.phase === "ready" &&
                                        msg.parsed.selectedTemplateId && (
                                            <GenerateActionCard
                                                templateName={
                                                    TEMPLATE_REGISTRY[msg.parsed.selectedTemplateId]
                                                        ?.name ?? msg.parsed.selectedTemplateId
                                                }
                                                extractedFields={msg.parsed.extractedFields}
                                                onContinue={handleContinueToTemplateForm}
                                            />
                                        )}
                                </div>
                            </div>
                        ))}

                        {isNoMatch && !isLoading && (
                            <div className={`${s.assistMsg} ${s.assistMsgBot}`}>
                                <div className={s.assistMsgAvatar}>
                                    <AlertCircle />
                                </div>
                                <div className={s.assistMsgBody} style={{ width: "100%" }}>
                                    <NoMatchCard onStartOver={handleStartOver} />
                                </div>
                            </div>
                        )}

                        {pendingConfirm && (
                            <div className={`${s.assistMsg} ${s.assistMsgBot}`}>
                                <div className={s.assistMsgAvatar}>
                                    <Scale />
                                </div>
                                <div className={s.assistMsgBody} style={{ width: "100%" }}>
                                    <TemplateConfirmCard
                                        template={pendingConfirm}
                                        onConfirm={handleConfirmTemplate}
                                        onPickDifferent={handlePickDifferent}
                                    />
                                </div>
                            </div>
                        )}

                        {isLoading && (
                            <div className={`${s.assistMsg} ${s.assistMsgBot}`}>
                                <div className={s.assistMsgAvatar}>
                                    <Sparkles />
                                </div>
                                <div className={s.assistMsgBody}>
                                    <div className={s.assistBubble}>
                                        <span className={s.assistTyping}>
                                            <span />
                                            <span />
                                            <span />
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Progress strip */}
                    {previewTemplate && totalN > 0 && (
                        <div className={s.assistProgress}>
                            <span>
                                {filledN} / {totalN} filled
                            </span>
                            <div className={s.assistProgressTrack}>
                                <div
                                    className={s.assistProgressFill}
                                    style={{ width: `${(filledN / totalN) * 100}%` }}
                                />
                            </div>
                            <span>
                                {currentField ? `next: ${currentField.label}` : "all filled"}
                            </span>
                        </div>
                    )}

                    <div className={s.assistComposer}>
                        <textarea
                            ref={inputRef}
                            className={s.assistInput}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={
                                previewTemplate
                                    ? `Answer — or describe a change…`
                                    : "Describe what you need…"
                            }
                            rows={1}
                            onInput={e => {
                                const target = e.target as HTMLTextAreaElement;
                                target.style.height = "auto";
                                target.style.height = `${Math.min(target.scrollHeight, 140)}px`;
                            }}
                        />
                        <button
                            className={s.assistSend}
                            onClick={() => void sendMessage(input)}
                            disabled={!input.trim() || isLoading}
                            aria-label="Send message"
                        >
                            <Send />
                        </button>
                    </div>
                    <div className={s.assistHint}>
                        ⌘↵ to send · drift learns your defaults over time
                    </div>
                </section>

                {/* ─── Live preview column ─────────────────────────────────────── */}
                <section className={s.assistPreview}>
                    <header className={s.assistPreviewHead}>
                        <FileText className="previewIcon" />
                        <span className={s.assistPreviewTitle}>
                            {previewTemplate ? previewTemplate.name : "Live document"}
                        </span>
                        <span className={s.assistPreviewLive}>· live preview</span>
                        <div className={s.assistPreviewPills}>
                            <span className={s.assistStatusPill}>
                                {previewTemplate ? `DRAFT · ${filledN}/${totalN}` : "AWAITING"}
                            </span>
                            {previewTemplate && filledN > 0 && (
                                <button className={`${s.btn} ${s.btnOutline} ${s.btnSm}`}>
                                    <Eye className="h-3 w-3" />
                                    Full
                                </button>
                            )}
                        </div>
                    </header>

                    <div className={`${s.assistPreviewBody} ${s.scrollbar}`}>
                        {previewTemplate ? (
                            <>
                                <PreviewDocument
                                    template={previewTemplate}
                                    fields={mergedFields}
                                    currentField={currentField?.key ?? null}
                                />
                                <FieldSummary
                                    template={previewTemplate}
                                    fields={mergedFields}
                                    currentField={currentField?.key ?? null}
                                    companyDefaults={companyDefaults}
                                />
                            </>
                        ) : (
                            <div className={s.assistPreviewEmpty}>
                                <div className={s.assistPreviewEmptyMark}>
                                    <Sparkles />
                                </div>
                                <div className={s.assistPreviewEmptyTitle}>
                                    Pick a template to begin
                                </div>
                                <p className={s.assistPreviewEmptySub}>
                                    Tell the assistant what you need on the left. As you answer
                                    questions, the document fills in here in real time.
                                </p>
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}

// ─── Live preview document ────────────────────────────────────────────────────

function PreviewDocument({
    template,
    fields,
    currentField,
}: {
    template: { id: string; name: string; fields: { key: string; label: string }[] };
    fields: Record<string, string>;
    currentField: string | null;
}) {
    // Render a stylized preview pulling the most descriptive fields if present.
    const Slot = ({ k }: { k: string }) => {
        const f = template.fields.find(x => x.key === k);
        const value = fields[k];
        const isCurrent = currentField === k;
        const cls = value
            ? `${s.assistSlot} ${s.assistSlotFilled}`
            : isCurrent
              ? `${s.assistSlot} ${s.assistSlotCurrent}`
              : s.assistSlot;
        return <span className={cls}>{(value ?? "") || `{${(f?.label ?? k).toLowerCase()}}`}</span>;
    };

    // Effective date if present, else first date-like field
    const titleField = template.fields[0]?.key;
    const partyA = template.fields.find(
        f =>
            f.key.includes("disclosing") ||
            f.key.includes("company") ||
            f.key.includes("party_1") ||
            f.key.includes("founder_1")
    )?.key;
    const partyB = template.fields.find(
        f =>
            f.key.includes("receiving") ||
            f.key.includes("party_2") ||
            f.key.includes("founder_2") ||
            f.key.includes("employee")
    )?.key;
    const dateField = template.fields.find(
        f => f.key.includes("effective_date") || f.key.includes("date")
    )?.key;
    const purposeField = template.fields.find(
        f => f.key.includes("purpose") || f.key.includes("description") || f.key.includes("scope")
    )?.key;

    return (
        <div className={s.assistDoc}>
            <h1>{template.name}</h1>
            <div className={s.assistDocSub}>
                {dateField ? (
                    <>
                        Effective <Slot k={dateField} />
                    </>
                ) : (
                    <>Draft</>
                )}
            </div>
            <p>
                This {template.name} is entered into by and between
                {partyA ? (
                    <>
                        {" "}
                        <Slot k={partyA} />
                    </>
                ) : null}
                {partyB ? (
                    <>
                        , and <Slot k={partyB} />
                    </>
                ) : null}
                , each a &quot;Party&quot; and collectively the &quot;Parties&quot;.
            </p>
            {purposeField && (
                <>
                    <h2>Purpose</h2>
                    <p>
                        The Parties wish to enter into this agreement for the purpose of{" "}
                        <Slot k={purposeField} />.
                    </p>
                </>
            )}
            <h2>Terms</h2>
            <p>
                This agreement shall be governed by the laws of{" "}
                {template.fields.find(
                    f => f.key.includes("jurisdiction") || f.key.includes("governing_law")
                ) ? (
                    <Slot
                        k={
                            template.fields.find(
                                f =>
                                    f.key.includes("jurisdiction") ||
                                    f.key.includes("governing_law")
                            )!.key
                        }
                    />
                ) : (
                    "the applicable jurisdiction"
                )}{" "}
                and continue in effect as set forth in subsequent sections.
            </p>
            {titleField &&
                titleField !== dateField &&
                titleField !== partyA &&
                titleField !== partyB && (
                    <p
                        style={{
                            color: "var(--ink-3)",
                            fontSize: 11,
                            fontFamily:
                                "var(--font-jetbrains-mono, JetBrains Mono), ui-monospace, monospace",
                            letterSpacing: "0.04em",
                        }}
                    >
                        Continued field collection — {template.fields.length} total fields, asked
                        one at a time.
                    </p>
                )}
        </div>
    );
}

// ─── Field summary (under the preview) ────────────────────────────────────────

function FieldSummary({
    template,
    fields,
    currentField,
    companyDefaults,
}: {
    template: { fields: { key: string; label: string; required?: boolean }[] };
    fields: Record<string, string>;
    currentField: string | null;
    companyDefaults: Record<string, string>;
}) {
    const filledN = template.fields.filter(f => fields[f.key]).length;
    const totalN = template.fields.length;

    return (
        <div className={s.assistFields}>
            <div className={s.assistFieldsHead}>
                <span>Field summary · {totalN}</span>
                <span>
                    {filledN} of {totalN} filled
                </span>
            </div>
            {template.fields.map(f => {
                const value = fields[f.key];
                const isCurrent = currentField === f.key;
                const tag = sourceTag(f.key, !!value, companyDefaults, isCurrent);
                return (
                    <div key={f.key} className={s.assistField}>
                        <div className={s.assistFieldLabel}>{f.label}</div>
                        <div className={value ? s.assistFieldValue : s.assistFieldValueEmpty}>
                            {(value ?? "") || (isCurrent ? "asking now…" : "awaiting")}
                        </div>
                        <div className={`${s.assistFieldSrc} ${tag.ai ? s.assistFieldSrcAi : ""}`}>
                            {tag.ai ? <Sparkles /> : <LinkIcon />}
                            {tag.txt}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Welcome (when no messages yet) ──────────────────────────────────────────

function WelcomeMessage({ onSuggest }: { onSuggest: (q: string) => void }) {
    const suggestions = [
        "I need an NDA for new employees",
        "Setting up a contractor agreement",
        "We're raising a seed round",
        "Need a privacy policy for our app",
    ];
    return (
        <div className={s.assistWelcome}>
            <div className={s.brandMark} style={{ width: 52, height: 52, borderRadius: 14 }}>
                <Sparkles className="h-6 w-6" />
            </div>
            <h2 className={s.assistWelcomeTitle}>
                What <em>legal</em> document do you need?
            </h2>
            <p className={s.assistWelcomeSub}>
                Describe your situation — I&apos;ll recommend the right template and help you fill
                it out, with the document filling in live on the right.
            </p>
            <div className={s.assistWelcomeChips}>
                {suggestions.map(q => (
                    <button key={q} className={s.suggestPill} onClick={() => onSuggest(q)}>
                        {q}
                    </button>
                ))}
            </div>
        </div>
    );
}

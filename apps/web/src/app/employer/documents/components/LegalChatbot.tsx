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
  PanelRightOpen,
  PanelRightClose,
  Circle,
  Sparkles,
} from "lucide-react";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "~/app/employer/documents/components/ui/hover-card";
import { TEMPLATE_REGISTRY } from "@launchstack/features/legal-templates";
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
  onContinueToTemplateForm: (
    templateId: string,
    prefilled: Record<string, string>,
  ) => void;
  initialMessage?: string;
}

// ─── Field carry-over helper ───────────────────────────────────────────────────

function carryOverFields(
  extractedFields: Record<string, string>,
  newTemplateId: string,
): Record<string, string> {
  const newTemplate = TEMPLATE_REGISTRY[newTemplateId];
  if (!newTemplate) return extractedFields;
  const validKeys = new Set(newTemplate.fields.map((f) => f.key));
  const carried: Record<string, string> = {};
  for (const [key, value] of Object.entries(extractedFields)) {
    if (validKeys.has(key)) {
      carried[key] = value;
    }
  }
  return carried;
}

// ─── Expandable Field List ─────────────────────────────────────────────────────

function ExpandableFieldList({
  templateId,
  previewCount,
}: {
  templateId: string;
  previewCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const registryTemplate = TEMPLATE_REGISTRY[templateId];
  if (!registryTemplate) return null;

  const requiredFields = registryTemplate.fields.filter((f) => f.required);
  const previewLabels = requiredFields.slice(0, previewCount).map((f) => f.label);
  const remaining = requiredFields.length - previewCount;

  return (
    <p style={{ fontSize: 12, color: "var(--ink-3)", margin: 0, lineHeight: 1.55 }}>
      <span style={{ fontWeight: 600, color: "var(--ink-2)" }}>Fields: </span>
      {previewLabels.join(", ")}
      {remaining > 0 && (
        <>
          {expanded ? (
            <>, {requiredFields.slice(previewCount).map((f) => f.label).join(", ")}</>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
              style={{
                marginLeft: 4,
                color: "var(--accent)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontSize: "inherit",
                fontFamily: "inherit",
              }}
            >
              +{remaining} more
            </button>
          )}
          {expanded && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
              style={{
                marginLeft: 6,
                color: "var(--accent)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontSize: "inherit",
                fontFamily: "inherit",
              }}
            >
              show less
            </button>
          )}
        </>
      )}
    </p>
  );
}

// ─── Template Mini Card ────────────────────────────────────────────────────────

function TemplateMiniCard({
  template,
  onSelect,
}: {
  template: RecommendedTemplate;
  onSelect: (templateId: string) => void;
}) {
  const registryTemplate = TEMPLATE_REGISTRY[template.templateId];
  const requiredFields = registryTemplate?.fields.filter((f) => f.required) ?? [];
  const previewLabels = requiredFields.slice(0, 5).map((f) => f.label);
  const [expanded, setExpanded] = useState(false);

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          onClick={() => onSelect(template.templateId)}
          onTouchStart={() => setExpanded((p) => !p)}
          className="group"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: 14,
            borderRadius: 14,
            border: "1px solid var(--line-2)",
            background: "var(--panel)",
            textAlign: "left",
            width: "100%",
            cursor: "pointer",
            fontFamily: "inherit",
            color: "inherit",
            transition: "all .2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow = "0 12px 28px var(--accent-glow)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--line-2)";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <div className={s.brandMarkSm}>
            <FileText className="h-[13px] w-[13px]" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--ink)",
                letterSpacing: "-0.01em",
              }}
            >
              {template.name}
            </div>
            <div
              style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}
            >
              {template.requiredFieldCount} required fields
            </div>
            {expanded && (
              <div
                className="md:hidden"
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: "1px solid var(--line-2)",
                }}
              >
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--ink-3)",
                    margin: "0 0 4px",
                    lineHeight: 1.55,
                  }}
                >
                  {template.description}
                </p>
                {previewLabels.length > 0 && (
                  <p style={{ fontSize: 12, color: "var(--ink-3)", margin: 0 }}>
                    <span style={{ fontWeight: 600, color: "var(--ink-2)" }}>
                      Fields:{" "}
                    </span>
                    {previewLabels.join(", ")}
                    {requiredFields.length > 5
                      ? `, +${requiredFields.length - 5} more`
                      : ""}
                  </p>
                )}
              </div>
            )}
          </div>
          <ChevronRight
            className="h-4 w-4 flex-shrink-0 transition-opacity"
            style={{ color: "var(--ink-3)", marginTop: 3 }}
          />
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="right" className="hidden w-80 md:block">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4" style={{ color: "var(--accent)" }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>{template.name}</span>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: "var(--ink-3)",
              lineHeight: 1.55,
            }}
          >
            {template.description}
          </p>
          {registryTemplate && (
            <div style={{ paddingTop: 6, borderTop: "1px solid var(--line-2)" }}>
              <p
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--ink-2)",
                  margin: "0 0 4px",
                }}
              >
                Required fields:
              </p>
              <ExpandableFieldList
                templateId={template.templateId}
                previewCount={5}
              />
            </div>
          )}
          <div
            style={{
              display: "flex",
              gap: 12,
              fontSize: 12,
              color: "var(--ink-3)",
            }}
          >
            <span>{template.fieldCount} fields total</span>
            <span>{template.requiredFieldCount} required</span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

// ─── Confirm / No-match / Ready cards ──────────────────────────────────────────

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
    <div className={s.banner} style={{ padding: 16 }}>
      <div className="mb-2 flex items-start gap-3">
        <div className={s.brandMarkSm}>
          <Scale className="h-[13px] w-[13px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h4
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: "var(--ink)",
            }}
          >
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
          fontSize: 12,
          color: "var(--ink-3)",
          marginBottom: 6,
        }}
      >
        <span>{template.fieldCount} fields</span>
        <span>{template.requiredFieldCount} required</span>
      </div>
      <div style={{ marginBottom: 12 }}>
        <ExpandableFieldList templateId={template.templateId} previewCount={6} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={`${s.btn} ${s.btnAccent} ${s.btnSm}`} onClick={onConfirm}>
          <CheckCircle2 className="h-4 w-4" />
          Proceed with this template
        </button>
        <button
          className={`${s.btn} ${s.btnOutline} ${s.btnSm}`}
          onClick={onPickDifferent}
        >
          Pick a different one
        </button>
      </div>
    </div>
  );
}

function NoMatchCard({ onStartOver }: { onStartOver: () => void }) {
  return (
    <div className={`${s.banner} ${s.bannerWarn}`} style={{ padding: 16 }}>
      <div className="mb-2 flex items-center gap-2">
        <AlertCircle className="h-5 w-5" style={{ color: "var(--warn)" }} />
        <h4
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--ink)",
          }}
        >
          No exact match found
        </h4>
      </div>
      <p
        style={{
          margin: "0 0 12px",
          fontSize: 13,
          color: "var(--ink-2)",
          lineHeight: 1.55,
        }}
      >
        None of our templates are a perfect fit. Try describing your needs
        differently, or browse the template library manually.
      </p>
      <button className={`${s.btn} ${s.btnOutline} ${s.btnSm}`} onClick={onStartOver}>
        <RotateCcw className="h-4 w-4" />
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
    <div className={`${s.banner} ${s.bannerSuccess}`} style={{ padding: 16 }}>
      <div className="mb-2 flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5" style={{ color: "var(--success)" }} />
        <h4
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--ink)",
          }}
        >
          Ready for the field form
        </h4>
      </div>
      <p
        style={{
          margin: "0 0 12px",
          fontSize: 13,
          color: "var(--ink-2)",
          lineHeight: 1.55,
        }}
      >
        {templateName} · {fieldCount} fields collected from chat. Next, confirm
        and complete fields on the template form, then your document opens for
        editing.
      </p>
      <button className={`${s.btn} ${s.btnAccent} ${s.btnSm}`} onClick={onContinue}>
        <ChevronRight className="h-4 w-4" />
        Continue to template fields
      </button>
    </div>
  );
}

function ErrorBubble({
  content,
  onRetry,
}: {
  content: string;
  onRetry: () => void;
}) {
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

// ─── Fields Sidebar ────────────────────────────────────────────────────────────

function FieldsSidebar({
  templateId,
  accumulatedFields,
  extractedFields,
}: {
  templateId: string;
  accumulatedFields: Record<string, string>;
  extractedFields: Record<string, string>;
}) {
  const template = TEMPLATE_REGISTRY[templateId];
  if (!template) return null;

  const merged = { ...accumulatedFields, ...extractedFields };
  const requiredFields = template.fields.filter((f) => f.required);
  const filledCount = requiredFields.filter((f) => merged[f.key]).length;

  return (
    <div className="flex h-full flex-col">
      <div
        style={{
          padding: 14,
          borderBottom: "1px solid var(--line-2)",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: "-0.01em",
          }}
          className="truncate"
        >
          {template.name}
        </h3>
        <div className="mt-2 flex items-center gap-2">
          <div className={s.progressTrack}>
            <div
              className={s.progressFill}
              style={{
                width: `${requiredFields.length > 0 ? (filledCount / requiredFields.length) * 100 : 0}%`,
              }}
            />
          </div>
          <span
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              whiteSpace: "nowrap",
            }}
          >
            {filledCount}/{requiredFields.length}
          </span>
        </div>
      </div>
      <div className={`flex-1 overflow-y-auto p-3 ${s.scrollbar}`}>
        {template.fields.map((field) => {
          const value = merged[field.key];
          const isFilled = Boolean(value);
          return (
            <div
              key={field.key}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                fontSize: 12,
                background: isFilled
                  ? "oklch(from var(--success) l c h / 0.1)"
                  : "transparent",
                marginBottom: 2,
              }}
            >
              {isFilled ? (
                <CheckCircle2
                  className="h-[14px] w-[14px] flex-shrink-0"
                  style={{ color: "var(--success)", marginTop: 2 }}
                />
              ) : (
                <Circle
                  className="h-[14px] w-[14px] flex-shrink-0"
                  style={{ color: "var(--ink-4)", marginTop: 2 }}
                />
              )}
              <div className="min-w-0 flex-1">
                <span
                  style={{
                    fontWeight: 500,
                    color: isFilled ? "var(--ink)" : "var(--ink-3)",
                  }}
                >
                  {field.label}
                </span>
                {!field.required && (
                  <span style={{ color: "var(--ink-4)", marginLeft: 4 }}>
                    (optional)
                  </span>
                )}
                {isFilled && (
                  <p
                    style={{
                      margin: "2px 0 0",
                      color: "var(--ink-3)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {String(value).replace(/_/g, " ")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Chatbot Component ────────────────────────────────────────────────────

export function LegalChatbot({
  onBack,
  onContinueToTemplateForm,
  initialMessage,
}: LegalChatbotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<RecommendedTemplate | null>(
    null,
  );
  const [currentResponse, setCurrentResponse] = useState<ChatResponse | null>(null);
  const [accumulatedFields, setAccumulatedFields] = useState<Record<string, string>>(
    {},
  );
  const [confirmedTemplateId, setConfirmedTemplateId] = useState<string | null>(
    null,
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasSentInitial = useRef(false);
  const hasShownIntro = useRef(false);
  const currentResponseRef = useRef<ChatResponse | null>(null);

  useEffect(() => {
    currentResponseRef.current = currentResponse;
  }, [currentResponse]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, pendingConfirm]);

  const activeTemplateId =
    confirmedTemplateId ?? currentResponse?.selectedTemplateId ?? null;

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
          .filter((m) => !m.isError)
          .map((m) => ({
            role: m.role,
            content:
              m.role === "assistant" && m.parsed ? JSON.stringify(m.parsed) : m.content,
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
          setMessages((prev) => [
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
              setMessages((prev) => [
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
          setMessages((prev) => [...prev, assistantMessage]);
          setCurrentResponse(parsed);

          if (
            parsed.extractedFields &&
            Object.keys(parsed.extractedFields).length > 0
          ) {
            const stringified: Record<string, string> = {};
            for (const [k, v] of Object.entries(parsed.extractedFields)) {
              stringified[k] = String(v);
            }
            setAccumulatedFields((prev) => {
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
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: data.message ?? "Something went wrong. Please try again.",
              isError: true,
            },
          ]);
        }
      } catch {
        setMessages((prev) => [
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
    [messages, isLoading, accumulatedFields],
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
      .find((m) => m.role === "user");
    if (!lastUserMsg) return;
    setMessages((prev) => prev.filter((_, i) => i !== errorIndex));
    void sendMessage(lastUserMsg.content);
  };

  const handleSelectTemplate = (templateId: string) => {
    let rec = currentResponse?.recommendedTemplates.find(
      (t) => t.templateId === templateId,
    );
    if (!rec) {
      for (const msg of messages) {
        if (msg.parsed?.recommendedTemplates) {
          const found = msg.parsed.recommendedTemplates.find(
            (t) => t.templateId === templateId,
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
    setSidebarOpen(true);
    setPendingConfirm(null);
    void sendMessage(
      `I want to proceed with the "${pendingConfirm.name}" template.`,
    );
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
    setSidebarOpen(false);
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

  const lastAssistantMsg = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.parsed);
  const isNoMatch =
    lastAssistantMsg?.parsed?.phase === "recommending" &&
    lastAssistantMsg.parsed.recommendedTemplates.length === 0;

  const showSidebar = sidebarOpen && activeTemplateId;

  return (
    <div className="flex h-full">
      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div
          className="flex-shrink-0"
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--line-2)",
            background: "oklch(from var(--bg) l c h / 0.6)",
            backdropFilter: "blur(14px) saturate(140%)",
          }}
        >
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <button
              className={`${s.btn} ${s.btnGhost} ${s.btnSm}`}
              onClick={onBack}
              style={{ paddingLeft: 6, paddingRight: 10 }}
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <div className={s.dividerVert} />
            <div className="flex items-center gap-2">
              <div className={s.brandMarkSm}>
                <Scale className="h-[14px] w-[14px]" />
              </div>
              <span
                style={{
                  fontWeight: 600,
                  color: "var(--ink)",
                  fontSize: 14,
                  letterSpacing: "-0.01em",
                }}
              >
                Legal Document Assistant
              </span>
            </div>
            <div className="flex-1" />
            {activeTemplateId && (
              <button
                className={`${s.btn} ${s.btnGhost} ${s.btnSm}`}
                onClick={() => setSidebarOpen((p) => !p)}
              >
                {sidebarOpen ? (
                  <PanelRightClose className="h-4 w-4" />
                ) : (
                  <PanelRightOpen className="h-4 w-4" />
                )}
                Fields
              </button>
            )}
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
        </div>

        {/* Messages */}
        <div className={`flex-1 overflow-y-auto ${s.scrollbar}`}>
          <div className="mx-auto max-w-3xl space-y-5 px-5 py-6">
            {messages.length === 0 && !isLoading && <WelcomeScreen onSuggest={(q) => void sendMessage(q)} />}

            {messages.map((msg, i) => (
              <div
                key={i}
                className="flex gap-3"
                style={{
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                {msg.role === "assistant" && (
                  <div
                    className={`${s.chatAvatar} ${msg.isError ? s.chatAvatarError : ""}`}
                    style={{ marginTop: 2 }}
                  >
                    {msg.isError ? (
                      <AlertCircle className="h-[14px] w-[14px]" />
                    ) : (
                      <Scale className="h-[14px] w-[14px]" />
                    )}
                  </div>
                )}
                <div
                  className="space-y-3"
                  style={{
                    maxWidth: "80%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                  }}
                >
                  {msg.isError ? (
                    <ErrorBubble
                      content={msg.content}
                      onRetry={() => handleRetry(i)}
                    />
                  ) : msg.role === "user" ? (
                    <div className={s.chatBubbleUser}>{msg.content}</div>
                  ) : (
                    <div className={s.chatBubbleAssistant}>
                      <MarkdownMessage content={msg.content} className="text-sm" />
                    </div>
                  )}

                  {msg.parsed?.phase === "recommending" &&
                    msg.parsed.recommendedTemplates.length > 0 && (
                      <div className="w-full space-y-2">
                        {msg.parsed.recommendedTemplates.map((rec) => (
                          <TemplateMiniCard
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
                          TEMPLATE_REGISTRY[msg.parsed.selectedTemplateId]?.name ??
                          msg.parsed.selectedTemplateId
                        }
                        extractedFields={msg.parsed.extractedFields}
                        onContinue={handleContinueToTemplateForm}
                      />
                    )}
                </div>
              </div>
            ))}

            {isNoMatch && !isLoading && (
              <div className="flex gap-3">
                <div className={s.chatAvatar} style={{ marginTop: 2 }}>
                  <AlertCircle className="h-[14px] w-[14px]" />
                </div>
                <div style={{ maxWidth: "80%" }}>
                  <NoMatchCard onStartOver={handleStartOver} />
                </div>
              </div>
            )}

            {pendingConfirm && (
              <div className="flex gap-3">
                <div className={s.chatAvatar} style={{ marginTop: 2 }}>
                  <Scale className="h-[14px] w-[14px]" />
                </div>
                <div style={{ maxWidth: "80%" }}>
                  <TemplateConfirmCard
                    template={pendingConfirm}
                    onConfirm={handleConfirmTemplate}
                    onPickDifferent={handlePickDifferent}
                  />
                </div>
              </div>
            )}

            {isLoading && (
              <div className="flex gap-3">
                <div className={s.chatAvatar} style={{ marginTop: 2 }}>
                  <Scale className="h-[14px] w-[14px]" />
                </div>
                <div className={s.chatBubbleAssistant}>
                  <div className="flex items-center gap-2" style={{ color: "var(--ink-3)" }}>
                    <span className={s.loadingDot} />
                    <span className={s.loadingDot} />
                    <span className={s.loadingDot} />
                    <span style={{ marginLeft: 4, fontSize: 13 }}>Thinking…</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Composer */}
        <div
          className="flex-shrink-0"
          style={{
            padding: "12px 20px 20px",
            borderTop: "1px solid var(--line-2)",
          }}
        >
          <div className="mx-auto max-w-3xl">
            <div className={s.composer}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe what you need…"
                rows={1}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height = `${Math.min(target.scrollHeight, 160)}px`;
                }}
              />
              <button
                className={`${s.btn} ${s.btnAccent} ${s.btnIcon}`}
                onClick={() => void sendMessage(input)}
                disabled={!input.trim() || isLoading}
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Fields Sidebar */}
      {showSidebar && activeTemplateId && (
        <div
          className="hidden flex-shrink-0 flex-col md:flex"
          style={{
            width: 288,
            borderLeft: "1px solid var(--line-2)",
            background: "oklch(from var(--bg) l c h / 0.6)",
            backdropFilter: "blur(12px)",
          }}
        >
          <FieldsSidebar
            templateId={activeTemplateId}
            accumulatedFields={accumulatedFields}
            extractedFields={currentResponse?.extractedFields ?? {}}
          />
        </div>
      )}
    </div>
  );
}

// ─── Welcome screen ────────────────────────────────────────────────────────────

function WelcomeScreen({ onSuggest }: { onSuggest: (q: string) => void }) {
  const suggestions = [
    "I need an NDA for new employees",
    "Setting up a contractor agreement",
    "We're raising a seed round",
    "Need a privacy policy for our app",
  ];
  return (
    <div className="flex flex-col items-center py-12 text-center">
      <div className={s.brandMark} style={{ width: 52, height: 52, borderRadius: 14 }}>
        <Sparkles className="h-6 w-6" />
      </div>
      <h2
        style={{
          margin: "18px 0 6px",
          fontSize: 24,
          fontWeight: 600,
          color: "var(--ink)",
          letterSpacing: "-0.02em",
        }}
      >
        What legal document do you need?
      </h2>
      <p
        style={{
          margin: 0,
          maxWidth: 420,
          fontSize: 15,
          color: "var(--ink-2)",
          lineHeight: 1.55,
        }}
      >
        Describe your situation and I&apos;ll recommend the right template and
        help you fill it out.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {suggestions.map((q) => (
          <button
            key={q}
            className={s.suggestPill}
            onClick={() => onSuggest(q)}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  ArrowLeft,
  Send,
  Loader2,
  Scale,
  FileText,
  CheckCircle2,
  ChevronRight,
  Sparkles,
  RotateCcw,
  RefreshCw,
  AlertCircle,
  PanelRightOpen,
  PanelRightClose,
  Circle,
} from "lucide-react";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Card } from "~/app/employer/documents/components/ui/card";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "~/app/employer/documents/components/ui/hover-card";
import { cn } from "~/lib/utils";
import { TEMPLATE_REGISTRY } from "~/lib/legal-templates/template-registry";
import MarkdownMessage from "~/app/_components/MarkdownMessage";

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
  onGenerate: (templateId: string, data: Record<string, string>) => void;
  onReviewFields: (templateId: string, prefilled: Record<string, string>) => void;
  initialMessage?: string;
}

// ─── Field carry-over helper ───────────────────────────────────────────────────

function carryOverFields(
  extractedFields: Record<string, string>,
  newTemplateId: string
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
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Fields: </span>
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
              className="ml-1 text-primary hover:text-primary/80 hover:underline cursor-pointer"
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
              className="ml-1 text-primary hover:text-primary/80 hover:underline cursor-pointer"
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
          className={cn(
            "flex items-start gap-3 p-3 rounded-lg border border-border",
            "hover:border-ring hover:shadow-md transition-all",
            "bg-card text-left w-full cursor-pointer group"
          )}
        >
          <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded shrink-0 mt-0.5">
            <FileText className="w-4 h-4 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm text-foreground truncate">
              {template.name}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {template.requiredFieldCount} required fields
            </div>
            {expanded && (
              <div className="mt-2 pt-2 border-t border-border md:hidden">
                <p className="text-xs text-muted-foreground mb-1">
                  {template.description}
                </p>
                {previewLabels.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Fields: </span>
                    {previewLabels.join(", ")}
                    {requiredFields.length > 5
                      ? `, +${requiredFields.length - 5} more`
                      : ""}
                  </p>
                )}
              </div>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="right" className="w-80 hidden md:block">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4 text-blue-600" />
            <span className="font-semibold text-sm">{template.name}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {template.description}
          </p>
          {registryTemplate && (
            <div className="pt-1 border-t border-border">
              <p className="text-xs font-medium text-foreground mb-1">
                Required fields:
              </p>
              <ExpandableFieldList templateId={template.templateId} previewCount={5} />
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{template.fieldCount} fields total</span>
            <span>{template.requiredFieldCount} required</span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

// ─── Template Confirmation Card ────────────────────────────────────────────────

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
    <Card className="p-4 border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
      <div className="flex items-start gap-3 mb-2">
        <div className="p-1.5 bg-blue-100 dark:bg-blue-900/40 rounded-lg">
          <Scale className="w-4 h-4 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-sm text-foreground">{template.name}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            {template.description}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-1.5">
        <span>{template.fieldCount} fields</span>
        <span>{template.requiredFieldCount} required</span>
      </div>
      <div className="mb-2.5">
        <ExpandableFieldList templateId={template.templateId} previewCount={6} />
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 text-white"
          onClick={onConfirm}
        >
          <CheckCircle2 className="w-4 h-4 mr-1.5" />
          Proceed with this template
        </Button>
        <Button size="sm" variant="outline" onClick={onPickDifferent}>
          Pick a different one
        </Button>
      </div>
    </Card>
  );
}

// ─── No Match Card ─────────────────────────────────────────────────────────────

function NoMatchCard({ onStartOver }: { onStartOver: () => void }) {
  return (
    <Card className="p-4 border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
      <div className="flex items-center gap-2 mb-2">
        <AlertCircle className="w-5 h-5 text-amber-600" />
        <h4 className="font-semibold text-foreground">No exact match found</h4>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        None of our templates are a perfect fit. Try describing your needs
        differently, or browse the template library manually.
      </p>
      <Button size="sm" variant="outline" onClick={onStartOver}>
        <RotateCcw className="w-4 h-4 mr-1.5" />
        Start over
      </Button>
    </Card>
  );
}

// ─── Generate Action Card ──────────────────────────────────────────────────────

function GenerateActionCard({
  templateName,
  extractedFields,
  onGenerate,
  onReview,
  isGenerating,
}: {
  templateName: string;
  extractedFields: Record<string, string>;
  onGenerate: () => void;
  onReview: () => void;
  isGenerating: boolean;
}) {
  const fieldCount = Object.keys(extractedFields).length;
  return (
    <Card className="p-4 border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
      <div className="flex items-center gap-2 mb-2">
        <CheckCircle2 className="w-5 h-5 text-green-600" />
        <h4 className="font-semibold text-foreground">Ready to generate</h4>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        {templateName} &middot; {fieldCount} fields collected
      </p>
      <div className="flex gap-2 flex-wrap">
        <Button
          className="bg-blue-600 hover:bg-blue-700 text-white"
          onClick={onGenerate}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-1.5" />
              Generate Document
            </>
          )}
        </Button>
        <Button variant="outline" onClick={onReview} disabled={isGenerating}>
          Review & Edit Fields
        </Button>
      </div>
    </Card>
  );
}

// ─── Error Message with Retry ──────────────────────────────────────────────────

function ErrorBubble({
  content,
  onRetry,
}: {
  content: string;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
        {content}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onRetry}
        className="text-xs"
      >
        <RefreshCw className="w-3 h-3 mr-1.5" />
        Retry
      </Button>
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
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <h3 className="font-semibold text-sm text-foreground truncate">
          {template.name}
        </h3>
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-300"
              style={{
                width: `${requiredFields.length > 0 ? (filledCount / requiredFields.length) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {filledCount}/{requiredFields.length}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {template.fields.map((field) => {
          const value = merged[field.key];
          const isFilled = Boolean(value);
          return (
            <div
              key={field.key}
              className={cn(
                "flex items-start gap-2 py-1.5 px-2 rounded-md text-xs",
                isFilled
                  ? "bg-green-50 dark:bg-green-950/20"
                  : "bg-transparent"
              )}
            >
              {isFilled ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" />
              ) : (
                <Circle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <span className={cn(
                  "font-medium",
                  isFilled ? "text-foreground" : "text-muted-foreground"
                )}>
                  {field.label}
                </span>
                {!field.required && (
                  <span className="text-muted-foreground/50 ml-1">(optional)</span>
                )}
                {isFilled && (
                  <p className="text-muted-foreground truncate mt-0.5">
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
  onGenerate,
  onReviewFields,
  initialMessage,
}: LegalChatbotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<RecommendedTemplate | null>(null);
  const [currentResponse, setCurrentResponse] = useState<ChatResponse | null>(null);
  const [accumulatedFields, setAccumulatedFields] = useState<Record<string, string>>({});
  const [confirmedTemplateId, setConfirmedTemplateId] = useState<string | null>(null);
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

  // Track the active template from either client confirmation or LLM response
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
          .filter((m) => !m.isError)
          .map((m) => ({
            role: m.role,
            content: m.role === "assistant" && m.parsed
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

          // Show company intro on first successful response
          if (!hasShownIntro.current && parsed.companyDefaults && Object.keys(parsed.companyDefaults).length > 0) {
            hasShownIntro.current = true;
            const defaults = parsed.companyDefaults;
            const parts: string[] = [];
            if (defaults.company_name) parts.push(`**${defaults.company_name}**`);
            if (defaults.company_address) parts.push(`based in **${defaults.company_address}**`);
            if (parts.length > 0) {
              const introContent = `I see your company is ${parts.join(", ")}. I'll pre-fill those details automatically.`;
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: introContent },
              ]);
            }
          }

          // Detect if the LLM is asking about a select field
          const assistantMessage: ChatMessage = {
            role: "assistant",
            content: parsed.message,
            parsed,
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setCurrentResponse(parsed);

          // Update accumulated fields
          if (parsed.extractedFields && Object.keys(parsed.extractedFields).length > 0) {
            setAccumulatedFields((prev) => {
              const prevTemplateId = currentResponseRef.current?.selectedTemplateId;
              if (
                parsed.selectedTemplateId &&
                prevTemplateId &&
                parsed.selectedTemplateId !== prevTemplateId
              ) {
                const carried = carryOverFields(prev, parsed.selectedTemplateId);
                return { ...carried, ...parsed.extractedFields };
              }
              return { ...prev, ...parsed.extractedFields };
            });
          }

          // Auto-show confirm card for single high-confidence match
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
    [messages, isLoading, accumulatedFields]
  );

  // Send initial message if provided (only runs once via ref guard)
  useEffect(() => {
    if (initialMessage && !hasSentInitial.current) {
      hasSentInitial.current = true;
      void sendMessage(initialMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sendMessage changes every render; ref guard prevents double-send
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
      (t) => t.templateId === templateId
    );
    if (!rec) {
      for (const msg of messages) {
        if (msg.parsed?.recommendedTemplates) {
          const found = msg.parsed.recommendedTemplates.find(
            (t) => t.templateId === templateId
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
      `I want to proceed with the "${pendingConfirm.name}" template.`
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
    setIsGenerating(false);
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

  const handleGenerate = () => {
    if (!currentResponse?.selectedTemplateId) return;
    setIsGenerating(true);
    try {
      const finalFields = { ...accumulatedFields, ...currentResponse.extractedFields };
      onGenerate(currentResponse.selectedTemplateId, finalFields);
    } catch {
      setIsGenerating(false);
    }
  };

  const handleReview = () => {
    if (!currentResponse?.selectedTemplateId) return;
    const finalFields = { ...accumulatedFields, ...currentResponse.extractedFields };
    onReviewFields(currentResponse.selectedTemplateId, finalFields);
  };

  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant" && m.parsed);
  const isNoMatch =
    lastAssistantMsg?.parsed?.phase === "recommending" &&
    lastAssistantMsg.parsed.recommendedTemplates.length === 0;

  const showSidebar = sidebarOpen && activeTemplateId;

  return (
    <div className="flex h-full bg-background">
      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-border p-4">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Back to templates
            </Button>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-600 rounded-lg">
                <Scale className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-foreground">
                Legal Document Assistant
              </span>
            </div>
            <div className="flex-1" />
            {activeTemplateId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSidebarOpen((p) => !p)}
                className="text-muted-foreground hover:text-foreground"
              >
                {sidebarOpen ? (
                  <PanelRightClose className="w-4 h-4 mr-1.5" />
                ) : (
                  <PanelRightOpen className="w-4 h-4 mr-1.5" />
                )}
                Fields
              </Button>
            )}
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleStartOver}
                className="text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="w-4 h-4 mr-1.5" />
                Start over
              </Button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto p-4 space-y-4">
            {/* Welcome message */}
            {messages.length === 0 && !isLoading && (
              <div className="text-center py-12">
                <div className="inline-flex p-3 bg-blue-100 dark:bg-blue-900/30 rounded-2xl mb-4">
                  <Scale className="w-8 h-8 text-blue-600" />
                </div>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  What legal document do you need?
                </h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Describe your situation and I&apos;ll recommend the right
                  template and help you fill it out.
                </p>
                <div className="flex flex-wrap justify-center gap-2 mt-6">
                  {[
                    "I need an NDA for new employees",
                    "Setting up a contractor agreement",
                    "We're raising a seed round",
                    "Need a privacy policy for our app",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => void sendMessage(suggestion)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-sm border border-border",
                        "text-muted-foreground hover:text-foreground hover:border-ring",
                        "transition-colors cursor-pointer"
                      )}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Chat messages */}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "flex gap-3",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {msg.role === "assistant" && (
                  <div className="shrink-0 mt-1">
                    <div className={cn(
                      "p-1.5 rounded-lg",
                      msg.isError
                        ? "bg-red-100 dark:bg-red-900/30"
                        : "bg-blue-100 dark:bg-blue-900/30"
                    )}>
                      {msg.isError ? (
                        <AlertCircle className="w-4 h-4 text-red-600" />
                      ) : (
                        <Scale className="w-4 h-4 text-blue-600" />
                      )}
                    </div>
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[80%] space-y-3",
                    msg.role === "user" ? "items-end" : "items-start"
                  )}
                >
                  {msg.isError ? (
                    <ErrorBubble
                      content={msg.content}
                      onRetry={() => handleRetry(i)}
                    />
                  ) : (
                    <div
                      className={cn(
                        "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                        msg.role === "user"
                          ? "bg-blue-600 text-white rounded-br-md"
                          : "bg-muted text-foreground rounded-bl-md"
                      )}
                    >
                      {msg.role === "assistant" ? (
                        <MarkdownMessage content={msg.content} className="text-sm" />
                      ) : (
                        msg.content
                      )}
                    </div>
                  )}



                  {/* Template recommendations */}
                  {msg.parsed?.phase === "recommending" &&
                    msg.parsed.recommendedTemplates.length > 0 && (
                      <div className="space-y-2 w-full">
                        {msg.parsed.recommendedTemplates.map((rec) => (
                          <TemplateMiniCard
                            key={rec.templateId}
                            template={rec}
                            onSelect={handleSelectTemplate}
                          />
                        ))}
                      </div>
                    )}

                  {/* Ready to generate card */}
                  {msg.parsed?.phase === "ready" &&
                    msg.parsed.selectedTemplateId && (
                      <GenerateActionCard
                        templateName={
                          TEMPLATE_REGISTRY[msg.parsed.selectedTemplateId]?.name ??
                          msg.parsed.selectedTemplateId
                        }
                        extractedFields={msg.parsed.extractedFields}
                        onGenerate={handleGenerate}
                        onReview={handleReview}
                        isGenerating={isGenerating}
                      />
                    )}
                </div>
              </div>
            ))}

            {/* No match card */}
            {isNoMatch && !isLoading && (
              <div className="flex gap-3">
                <div className="shrink-0 mt-1">
                  <div className="p-1.5 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                  </div>
                </div>
                <div className="max-w-[80%]">
                  <NoMatchCard onStartOver={handleStartOver} />
                </div>
              </div>
            )}

            {/* Pending confirmation card */}
            {pendingConfirm && (
              <div className="flex gap-3">
                <div className="shrink-0 mt-1">
                  <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                    <Scale className="w-4 h-4 text-blue-600" />
                  </div>
                </div>
                <div className="max-w-[80%]">
                  <TemplateConfirmCard
                    template={pendingConfirm}
                    onConfirm={handleConfirmTemplate}
                    onPickDifferent={handlePickDifferent}
                  />
                </div>
              </div>
            )}

            {/* Loading indicator */}
            {isLoading && (
              <div className="flex gap-3">
                <div className="shrink-0 mt-1">
                  <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                    <Scale className="w-4 h-4 text-blue-600" />
                  </div>
                </div>
                <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Thinking...
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="flex-shrink-0 border-t border-border p-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-2 items-end">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Describe what you need..."
                  rows={1}
                  disabled={isGenerating}
                  className={cn(
                    "w-full resize-none rounded-xl border border-border bg-background px-4 py-3 pr-12",
                    "text-sm text-foreground placeholder:text-muted-foreground",
                    "focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring",
                    "max-h-32 disabled:opacity-50"
                  )}
                  style={{
                    height: "auto",
                    minHeight: "44px",
                  }}
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = "auto";
                    target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
                  }}
                />
              </div>
              <Button
                size="icon"
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-11 w-11 shrink-0"
                onClick={() => void sendMessage(input)}
                disabled={!input.trim() || isLoading || isGenerating}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Fields Sidebar */}
      {showSidebar && activeTemplateId && (
        <div className="hidden md:flex w-72 border-l border-border bg-background flex-shrink-0 flex-col overflow-hidden">
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

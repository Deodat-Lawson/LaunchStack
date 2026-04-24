"use client";

import React, { useState, useCallback, useEffect } from "react";
import {
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Sparkles,
  Eye,
  Settings,
  FileText,
  RotateCw,
  Check,
} from "lucide-react";
import { RewritePreviewPanel } from "./RewritePreviewPanel";
import { LegalGeneratorTheme, legalTheme as s } from "../LegalGeneratorTheme";

interface RewriteWorkflowProps {
  initialText?: string;
  onComplete: (rewrittenText: string) => void;
  onCancel: () => void;
  persistedState?: Partial<RewriteWorkflowStateSnapshot>;
  onStateChange?: (state: RewriteWorkflowStateSnapshot) => void;
}

export type WorkflowStep = "input" | "options" | "preview" | "complete";

export interface RewriteOptions {
  tone:
    | "professional"
    | "casual"
    | "formal"
    | "technical"
    | "creative"
    | "persuasive";
  length: "brief" | "medium" | "detailed" | "comprehensive";
  audience:
    | "general"
    | "technical"
    | "executives"
    | "students"
    | "customers"
    | "team";
  customPrompt?: string;
}

export interface RewriteWorkflowStateSnapshot {
  currentStep: WorkflowStep;
  text: string;
  options: RewriteOptions;
  rewrittenText: string;
  isDraftMode: boolean;
}

const TONE_OPTIONS = [
  { value: "professional", label: "Professional", desc: "Clear, business-appropriate language" },
  { value: "casual", label: "Casual", desc: "Friendly and conversational tone" },
  { value: "formal", label: "Formal", desc: "Academic or official style" },
  { value: "technical", label: "Technical", desc: "Precise, detail-oriented language" },
  { value: "creative", label: "Creative", desc: "Engaging and expressive style" },
  { value: "persuasive", label: "Persuasive", desc: "Compelling and convincing" },
] as const;

const LENGTH_OPTIONS = [
  { value: "brief", label: "Brief", desc: "Concise and to the point" },
  { value: "medium", label: "Medium", desc: "Balanced detail level" },
  { value: "detailed", label: "Detailed", desc: "Comprehensive coverage" },
  { value: "comprehensive", label: "Comprehensive", desc: "Thorough and complete" },
] as const;

const AUDIENCE_OPTIONS = [
  { value: "general", label: "General", desc: "Accessible to everyone" },
  { value: "technical", label: "Technical experts", desc: "Industry professionals" },
  { value: "executives", label: "Executives", desc: "Decision makers and leaders" },
  { value: "students", label: "Students", desc: "Learning-focused audience" },
  { value: "customers", label: "Customers", desc: "External clients" },
  { value: "team", label: "Team members", desc: "Internal colleagues" },
] as const;

const STEP_ORDER: WorkflowStep[] = ["input", "options", "preview", "complete"];
const STEP_LABEL: Record<WorkflowStep, string> = {
  input: "Input",
  options: "Options",
  preview: "Preview",
  complete: "Done",
};

export function RewriteWorkflow({
  initialText = "",
  onComplete,
  onCancel,
  persistedState,
  onStateChange,
}: RewriteWorkflowProps) {
  const persistedStep = persistedState?.currentStep;
  const effectiveStep: WorkflowStep =
    persistedStep === "complete"
      ? initialText
        ? "options"
        : "input"
      : persistedStep ?? (initialText ? "options" : "input");

  const [currentStep, setCurrentStep] = useState<WorkflowStep>(effectiveStep);
  const [text, setText] = useState(
    persistedStep === "complete" ? initialText : persistedState?.text ?? initialText,
  );
  const [options, setOptions] = useState<RewriteOptions>({
    tone: persistedState?.options?.tone ?? "professional",
    length: persistedState?.options?.length ?? "medium",
    audience: persistedState?.options?.audience ?? "general",
    customPrompt: persistedState?.options?.customPrompt ?? "",
  });
  const [rewrittenText, setRewrittenText] = useState(
    persistedStep === "complete" ? "" : persistedState?.rewrittenText ?? "",
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDraftMode, setIsDraftMode] = useState(persistedState?.isDraftMode ?? true);

  useEffect(() => {
    if (!onStateChange) return;
    onStateChange({
      currentStep,
      text,
      options,
      rewrittenText,
      isDraftMode,
    });
  }, [currentStep, isDraftMode, onStateChange, options, rewrittenText, text]);

  const handleRewrite = useCallback(async () => {
    if (!text.trim()) return;

    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch("/api/document-generator/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rewrite",
          content: text,
          prompt: options.customPrompt,
          options: {
            tone: options.tone,
            length: options.length,
            audience: options.audience,
          },
        }),
      });

      const responseText = await response.text();
      let data: {
        success: boolean;
        message?: string;
        generatedContent?: string;
        error?: string;
      };
      try {
        data = JSON.parse(responseText);
      } catch {
        setError(
          responseText?.slice(0, 120) ||
            "Server returned an invalid response. Please try again.",
        );
        return;
      }

      if (
        data.success &&
        typeof data.generatedContent === "string" &&
        data.generatedContent.trim().length > 0
      ) {
        if (isDraftMode) {
          setRewrittenText(data.generatedContent);
          setCurrentStep("preview");
        } else {
          onComplete(data.generatedContent);
        }
      } else {
        setError(data.message ?? data.error ?? "Failed to rewrite text");
      }
    } catch (err) {
      console.error("Rewrite request failed", err);
      setError("Network error occurred");
    } finally {
      setIsProcessing(false);
    }
  }, [isDraftMode, onComplete, options, text]);

  const handleAcceptRewrite = useCallback(() => {
    onComplete(rewrittenText);
    setCurrentStep("complete");
  }, [rewrittenText, onComplete]);

  const handleRetry = useCallback(() => {
    setCurrentStep("options");
    setRewrittenText("");
    setError(null);
  }, []);

  const stepIndex = STEP_ORDER.indexOf(currentStep);

  return (
    <LegalGeneratorTheme ambient={false}>
      <div className="flex h-full flex-col">
        {/* Header — step indicator */}
        <div
          className="flex-shrink-0 px-6 pt-6 pb-4 md:px-10"
          style={{ borderBottom: "1px solid var(--line-2)" }}
        >
          <div className="mx-auto flex w-full max-w-5xl items-center gap-4">
            <button
              className={`${s.btn} ${s.btnGhost} ${s.btnSm}`}
              onClick={onCancel}
            >
              <ArrowLeft className="h-4 w-4" />
              Exit
            </button>
            <div className={s.dividerVert} />
            <div
              className="flex flex-1 items-center gap-2 overflow-x-auto"
              style={{ minWidth: 0 }}
            >
              {STEP_ORDER.map((step, idx) => {
                const isActive = step === currentStep;
                const isDone = idx < stepIndex;
                return (
                  <React.Fragment key={step}>
                    <div className="flex items-center gap-2">
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 999,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12,
                          fontWeight: 600,
                          background: isDone
                            ? "var(--success)"
                            : isActive
                            ? "var(--accent)"
                            : "var(--panel-2)",
                          color: isDone || isActive ? "white" : "var(--ink-3)",
                          border:
                            isDone || isActive
                              ? "none"
                              : "1px solid var(--line-2)",
                          boxShadow: isActive
                            ? "0 4px 12px var(--accent-glow)"
                            : "none",
                        }}
                      >
                        {isDone ? (
                          <CheckCircle className="h-3.5 w-3.5" />
                        ) : (
                          idx + 1
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: isActive ? "var(--ink)" : "var(--ink-3)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {STEP_LABEL[step]}
                      </span>
                    </div>
                    {idx < STEP_ORDER.length - 1 && (
                      <ArrowRight
                        className="h-3.5 w-3.5"
                        style={{ color: "var(--ink-4)" }}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className={`flex-1 overflow-y-auto ${s.scrollbar}`}>
          <div className="mx-auto w-full max-w-5xl px-6 py-8 md:px-10">
            {currentStep === "input" && (
              <div className="space-y-6">
                <SectionHeader
                  icon={<FileText className="h-[14px] w-[14px]" />}
                  eyebrow="Step 1"
                  title="Paste or type your source text"
                  description="Drop in the text you want to rewrite. You can refine it with options in the next step."
                />

                <div className={s.panel} style={{ padding: 20 }}>
                  <textarea
                    placeholder="Paste the text you want to rewrite…"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className={s.textarea}
                    style={{ minHeight: 220 }}
                  />
                  <div
                    className="mt-3 flex items-center justify-between"
                    style={{ fontSize: 12, color: "var(--ink-3)" }}
                  >
                    <span>
                      {text.trim() ? `${text.trim().split(/\s+/).length} words` : "Empty"}
                    </span>
                    <span>{text.length} characters</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    className={`${s.btn} ${s.btnOutline}`}
                    onClick={onCancel}
                  >
                    Cancel
                  </button>
                  <button
                    className={`${s.btn} ${s.btnAccent} ${s.btnLg}`}
                    onClick={() => setCurrentStep("options")}
                    disabled={!text.trim()}
                  >
                    Next: Options
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {currentStep === "options" && (
              <div className="space-y-6">
                <SectionHeader
                  icon={<Settings className="h-[14px] w-[14px]" />}
                  eyebrow="Step 2"
                  title="Shape how it reads"
                  description="Pick a tone, length, and audience. Add extra instructions if you have any."
                />

                {error && (
                  <div className={`${s.banner} ${s.bannerDanger}`} style={{ padding: 14 }}>
                    <p style={{ margin: 0, fontSize: 13, color: "var(--danger)" }}>
                      {error}
                    </p>
                  </div>
                )}

                <div className={s.panel} style={{ padding: 22 }}>
                  <OptionGroup
                    label="Tone"
                    value={options.tone}
                    onChange={(tone) =>
                      setOptions((prev) => ({
                        ...prev,
                        tone: tone as RewriteOptions["tone"],
                      }))
                    }
                    options={[...TONE_OPTIONS]}
                  />
                  <hr className={s.hair} style={{ margin: "20px 0" }} />
                  <OptionGroup
                    label="Length"
                    value={options.length}
                    onChange={(length) =>
                      setOptions((prev) => ({
                        ...prev,
                        length: length as RewriteOptions["length"],
                      }))
                    }
                    options={[...LENGTH_OPTIONS]}
                  />
                  <hr className={s.hair} style={{ margin: "20px 0" }} />
                  <OptionGroup
                    label="Audience"
                    value={options.audience}
                    onChange={(audience) =>
                      setOptions((prev) => ({
                        ...prev,
                        audience: audience as RewriteOptions["audience"],
                      }))
                    }
                    options={[...AUDIENCE_OPTIONS]}
                  />
                  <hr className={s.hair} style={{ margin: "20px 0" }} />

                  <div>
                    <label className={s.label} style={{ marginBottom: 8 }}>
                      Additional instructions
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 11,
                          fontWeight: 400,
                          color: "var(--ink-3)",
                        }}
                      >
                        (optional)
                      </span>
                    </label>
                    <textarea
                      className={s.textarea}
                      placeholder="e.g. Keep bullet structure. Prefer active voice."
                      value={options.customPrompt ?? ""}
                      onChange={(e) =>
                        setOptions((prev) => ({ ...prev, customPrompt: e.target.value }))
                      }
                      rows={3}
                    />
                  </div>
                </div>

                {/* Draft-mode toggle */}
                <button
                  type="button"
                  onClick={() => setIsDraftMode((v) => !v)}
                  className={s.panel}
                  style={{
                    padding: 16,
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                    background: "var(--panel)",
                    fontFamily: "inherit",
                    color: "inherit",
                  }}
                >
                  <div
                    style={{
                      width: 38,
                      height: 22,
                      borderRadius: 999,
                      background: isDraftMode
                        ? "var(--accent)"
                        : "var(--panel-2)",
                      border: isDraftMode
                        ? "none"
                        : "1px solid var(--line)",
                      position: "relative",
                      flexShrink: 0,
                      transition: "all .2s",
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 999,
                        background: "white",
                        position: "absolute",
                        top: 2,
                        left: isDraftMode ? 18 : 3,
                        transition: "left .2s",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                      }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--ink)",
                      }}
                    >
                      Draft mode
                    </p>
                    <p
                      style={{
                        margin: "2px 0 0",
                        fontSize: 12,
                        color: "var(--ink-3)",
                        lineHeight: 1.55,
                      }}
                    >
                      {isDraftMode
                        ? "Preview the rewrite before applying — regenerate or reject if needed."
                        : "Skip the preview and apply the rewrite straight to the document."}
                    </p>
                  </div>
                </button>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    className={`${s.btn} ${s.btnOutline}`}
                    onClick={() => setCurrentStep("input")}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>
                  <button
                    className={`${s.btn} ${s.btnAccent} ${s.btnLg}`}
                    onClick={handleRewrite}
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Rewriting…
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        {isDraftMode ? "Generate draft" : "Generate & apply"}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {currentStep === "preview" && (
              <div className="space-y-6">
                <SectionHeader
                  icon={<Eye className="h-[14px] w-[14px]" />}
                  eyebrow="Step 3"
                  title="Review the rewrite"
                  description="Accept it, regenerate with the same options, or go back and tweak options."
                />

                <RewritePreviewPanel
                  originalText={text}
                  proposedText={rewrittenText}
                  onAccept={handleAcceptRewrite}
                  onReject={onCancel}
                  onTryAgain={handleRewrite}
                  isRetrying={isProcessing}
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    className={`${s.btn} ${s.btnOutline}`}
                    onClick={handleRetry}
                  >
                    <RotateCw className="h-4 w-4" />
                    Edit options
                  </button>
                  <div className="flex gap-2">
                    <button className={`${s.btn} ${s.btnGhost}`} onClick={onCancel}>
                      Discard
                    </button>
                    <button
                      className={`${s.btn} ${s.btnAccent} ${s.btnLg}`}
                      onClick={handleAcceptRewrite}
                    >
                      <Check className="h-4 w-4" />
                      Push to rewrite
                    </button>
                  </div>
                </div>
              </div>
            )}

            {currentStep === "complete" && (
              <div
                className={`${s.banner} ${s.bannerSuccess} mx-auto`}
                style={{
                  padding: 32,
                  maxWidth: 520,
                  textAlign: "center",
                }}
              >
                <div
                  className={s.brandMark}
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    margin: "0 auto 16px",
                    background:
                      "linear-gradient(135deg, var(--success) 0%, oklch(from var(--success) calc(l - 0.08) c h) 100%)",
                    boxShadow:
                      "0 6px 18px oklch(from var(--success) l c h / 0.4)",
                  }}
                >
                  <CheckCircle className="h-6 w-6" />
                </div>
                <h2
                  className={s.title}
                  style={{ fontSize: 24, marginBottom: 8 }}
                >
                  Rewrite applied
                </h2>
                <p className={s.sub} style={{ marginBottom: 20 }}>
                  Your text was rewritten and pushed into the editor.
                </p>
                <button className={`${s.btn} ${s.btnAccent}`} onClick={onCancel}>
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </LegalGeneratorTheme>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  eyebrow,
  title,
  description,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={s.brandMarkSm}>{icon}</div>
      <div className="min-w-0 space-y-1">
        <span className={s.eyebrow}>{eyebrow}</span>
        <h2
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)", lineHeight: 1.55 }}>
          {description}
        </p>
      </div>
    </div>
  );
}

function OptionGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; desc: string }[];
}) {
  return (
    <div>
      <p
        style={{
          margin: "0 0 10px",
          fontSize: 12,
          fontWeight: 700,
          color: "var(--ink-3)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </p>
      <div
        className="grid grid-cols-2 gap-2 md:grid-cols-3"
      >
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 10,
                border: active
                  ? "1px solid var(--accent)"
                  : "1px solid var(--line-2)",
                background: active ? "var(--accent-soft)" : "var(--panel)",
                cursor: "pointer",
                transition: "all .15s",
                boxShadow: active
                  ? "0 0 0 3px var(--accent-glow)"
                  : "0 1px 0 oklch(1 0 0 / 0.3) inset",
                fontFamily: "inherit",
                color: "inherit",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: active ? "var(--accent-ink)" : "var(--ink)",
                  letterSpacing: "-0.005em",
                }}
              >
                {opt.label}
              </div>
              <div
                style={{
                  fontSize: 11,
                  marginTop: 2,
                  color: active ? "var(--accent-ink)" : "var(--ink-3)",
                  lineHeight: 1.4,
                  opacity: active ? 0.85 : 1,
                }}
              >
                {opt.desc}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

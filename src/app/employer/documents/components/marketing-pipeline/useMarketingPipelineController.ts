"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RewriteWorkflowStateSnapshot } from "~/app/employer/documents/components/generator/RewriteWorkflow";
import {
  MARKETING_ACTIVE_SESSION_KEY,
  MARKETING_SESSIONS_STORAGE_KEY,
  MAX_MARKETING_SESSIONS,
  PENDING_REWRITE_STORAGE_KEY,
  PIPELINE_STEP_ORDER,
  PLATFORM_OPTIONS,
  markdownToHtml,
  markdownToPlainText,
  type ContentType,
  type FormalityLevel,
  type MarketingSession,
  type MessageVariant,
  type PipelineData,
  type PipelineSSEEvent,
  type PipelineStepState,
  type PlatformMeta,
  type ThinkingEntry,
} from "./shared";

function buildInitialSteps(): PipelineStepState[] {
  return PIPELINE_STEP_ORDER.map((s) => ({
    id: s.id,
    label: s.label,
    status: "pending" as const,
  }));
}

export function useMarketingPipelineController(options: { debug: boolean }) {
  const { debug } = options;
  const router = useRouter();
  const [platform, setPlatform] = useState<MarketingSession["platform"]>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineData | null>(null);
  const [editableMessage, setEditableMessage] = useState("");
  const [showRewriteSheet, setShowRewriteSheet] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [viewMode, setViewMode] = useState<"preview" | "edit">("preview");
  const [sessions, setSessions] = useState<MarketingSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStepState[]>([]);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null);
  const [platformMeta, setPlatformMeta] = useState<PlatformMeta>({});
  const [messageVariants, setMessageVariants] = useState<MessageVariant[]>([]);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [toneOverride, setToneOverride] = useState<FormalityLevel | undefined>(undefined);
  const [targetAudience, setTargetAudience] = useState("");
  const [contentType, setContentType] = useState<ContentType | undefined>(undefined);
  const [thinkingLog, setThinkingLog] = useState<ThinkingEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const selectedPlatform = PLATFORM_OPTIONS.find((option) => option.id === platform) ?? null;

  const applySession = useCallback((session: MarketingSession) => {
    setPlatform(session.platform);
    setPrompt(session.prompt);
    setResult(session.result);
    setEditableMessage(session.editableMessage);
    setViewMode(session.viewMode);
    setPlatformMeta(session.platformMeta ?? {});
    setMessageVariants(session.messageVariants ?? []);
    setActiveVariantId(session.activeVariantId ?? null);
    setToneOverride(session.toneOverride);
    setTargetAudience(session.targetAudience ?? "");
    setContentType(session.contentType);
    setError(null);
    setShowRewriteSheet(false);
  }, []);

  useEffect(() => {
    try {
      const rawSessions = sessionStorage.getItem(MARKETING_SESSIONS_STORAGE_KEY);
      if (!rawSessions) return;

      const parsed = JSON.parse(rawSessions) as MarketingSession[];
      if (!Array.isArray(parsed) || parsed.length === 0) return;

      setSessions(parsed);
      const storedActiveSessionId = sessionStorage.getItem(MARKETING_ACTIVE_SESSION_KEY);
      const targetSession = storedActiveSessionId
        ? parsed.find((session) => session.id === storedActiveSessionId)
        : parsed[0];

      if (targetSession) {
        setActiveSessionId(targetSession.id);
        applySession(targetSession);
      }
    } catch {
      // Ignore malformed cached sessions.
    }
  }, [applySession]);

  useEffect(() => {
    try {
      sessionStorage.setItem(MARKETING_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
      if (activeSessionId) {
        sessionStorage.setItem(MARKETING_ACTIVE_SESSION_KEY, activeSessionId);
      } else {
        sessionStorage.removeItem(MARKETING_ACTIVE_SESSION_KEY);
      }
    } catch {
      // Ignore storage write failures.
    }
  }, [activeSessionId, sessions]);

  useEffect(() => {
    if (!activeSessionId || !result) return;

    setSessions((prev) =>
      prev.map((session) =>
        session.id === activeSessionId
          ? {
              ...session,
              prompt,
              platform: result.platform,
              result,
              editableMessage,
              viewMode,
              platformMeta,
              messageVariants,
              activeVariantId: activeVariantId ?? undefined,
              updatedAt: Date.now(),
            }
          : session,
      ),
    );
  }, [activeSessionId, activeVariantId, editableMessage, messageVariants, platform, platformMeta, prompt, result, viewMode]);

  const handleSelectSession = useCallback(
    (session: MarketingSession) => {
      setActiveSessionId(session.id);
      applySession(session);
    },
    [applySession],
  );

  const handleStartNewSession = useCallback(() => {
    const now = Date.now();
    const newSession: MarketingSession = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `session-${now}`,
      createdAt: now,
      updatedAt: now,
      platform: null,
      prompt: "",
      result: null,
      editableMessage: "",
      viewMode: "preview",
      rewriteWorkflowState: undefined,
      platformMeta: undefined,
      messageVariants: undefined,
      activeVariantId: undefined,
    };
    setActiveSessionId(newSession.id);
    setSessions((prev) => [newSession, ...prev].slice(0, MAX_MARKETING_SESSIONS));
    setPlatform(null);
    setPrompt("");
    setResult(null);
    setEditableMessage("");
    setViewMode("preview");
    setError(null);
    setShowRewriteSheet(false);
    setPipelineSteps([]);
    setPlatformMeta({});
    setMessageVariants([]);
    setActiveVariantId(null);
    setToneOverride(undefined);
    setTargetAudience("");
    setContentType(undefined);
  }, []);

  const handleRewriteComplete = useCallback(
    (rewrittenText: string) => {
      const variantId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `variant-${Date.now()}`;

      setMessageVariants((prev) => {
        const newVariant: MessageVariant = {
          id: variantId,
          label: `Rewrite ${prev.length}`,
          text: rewrittenText,
          createdAt: Date.now(),
        };
        return [...prev, newVariant];
      });
      setActiveVariantId(variantId);
      setEditableMessage(rewrittenText);
      setShowRewriteSheet(false);

      if (activeSessionId) {
        setSessions((prev) =>
          prev.map((session) =>
            session.id === activeSessionId
              ? { ...session, editableMessage: rewrittenText, updatedAt: Date.now() }
              : session,
          ),
        );
      }
    },
    [activeSessionId],
  );

  const selectVariant = useCallback(
    (variantId: string) => {
      setActiveVariantId(variantId);
      setMessageVariants((prev) => {
        const variant = prev.find((v) => v.id === variantId);
        if (variant) setEditableMessage(variant.text);
        return prev;
      });
    },
    [],
  );

  const handleRewriteWorkflowStateChange = useCallback(
    (state: RewriteWorkflowStateSnapshot) => {
      if (!activeSessionId) return;
      setSessions((prev) =>
        prev.map((session) =>
          session.id === activeSessionId
            ? { ...session, rewriteWorkflowState: state, updatedAt: Date.now() }
            : session,
        ),
      );
    },
    [activeSessionId],
  );

  const handlePushToRewriteDocument = useCallback(() => {
    if (!editableMessage.trim()) return;
    try {
      sessionStorage.setItem(
        PENDING_REWRITE_STORAGE_KEY,
        JSON.stringify({
          title: `Campaign Draft (${selectedPlatform?.label ?? "Marketing"})`,
          content: editableMessage,
          createdAt: Date.now(),
          source: "marketing-pipeline",
        }),
      );
    } catch {
      // Ignore storage errors and still navigate.
    }
    router.push("/employer/documents?view=rewrite");
  }, [editableMessage, router, selectedPlatform?.label]);

  const handleCopy = useCallback(async () => {
    if (!editableMessage.trim()) return;
    try {
      const targetPlatform = result?.platform;
      const plainText =
        targetPlatform === "reddit" ? editableMessage : markdownToPlainText(editableMessage);
      const html = markdownToHtml(editableMessage);

      if (typeof navigator.clipboard.write === "function") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([plainText], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      setCopySuccess(false);
    }
  }, [editableMessage, result?.platform]);

  const handleSSEEvent = useCallback((event: PipelineSSEEvent) => {
    switch (event.type) {
      case "step_start":
        setPipelineSteps((prev) =>
          prev.map((s) =>
            s.id === event.step
              ? { ...s, status: "active" as const, label: event.label, parallelGroup: event.parallelGroup }
              : s,
          ),
        );
        break;
      case "step_complete":
        setPipelineSteps((prev) =>
          prev.map((s) =>
            s.id === event.step
              ? {
                  ...s,
                  status: (event.status ?? "completed") as PipelineStepState["status"],
                  durationMs: event.durationMs,
                  detail: event.detail,
                }
              : s,
          ),
        );
        break;
      case "step_data":
        setPipelineSteps((prev) =>
          prev.map((s) =>
            s.id === event.step ? { ...s, stepData: event.data } : s,
          ),
        );
        break;
      case "step_thinking":
        setThinkingLog((prev) => [
          ...prev,
          { step: event.step, text: event.text, timestamp: Date.now() },
        ]);
        break;
    }
  }, []);

  const runPipeline = useCallback(async () => {
    setError(null);
    setResult(null);

    if (!platform) {
      setError("Choose a platform to continue.");
      return;
    }

    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      setError("Add a short description of what you want to promote.");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setPipelineSteps(buildInitialSteps());
    setThinkingLog([]);
    setGenerationStartTime(Date.now());

    try {
      const apiUrl = debug ? "/api/marketing-pipeline?debug=true" : "/api/marketing-pipeline";
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          prompt: normalizedPrompt,
          platformMeta: Object.keys(platformMeta).length > 0 ? platformMeta : undefined,
          toneOverride: toneOverride ?? undefined,
          targetAudience: targetAudience.trim() || undefined,
          contentType: contentType ?? undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        let message = "We couldn't generate a campaign right now. Please try again.";
        try {
          const payload = JSON.parse(text) as { message?: string; error?: string };
          message = payload.message ?? message;
          if (payload.error) message += ` ${payload.error}`;
        } catch {
          if (text) message = text.slice(0, 200);
        }
        setError(message);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let pipelineResult: PipelineData | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const json = trimmed.slice(6);
          try {
            const event = JSON.parse(json) as PipelineSSEEvent;

            if (event.type === "step_start" || event.type === "step_complete" || event.type === "step_data" || event.type === "step_thinking") {
              handleSSEEvent(event);
            } else if (event.type === "result" && event.success) {
              pipelineResult = event.data;
            } else if (event.type === "error") {
              const detail = event.error ? ` ${event.error}` : "";
              setError((event.message ?? "Pipeline failed") + detail);
              return;
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      if (!pipelineResult) {
        setError("Server returned an incomplete response. Please try again.");
        return;
      }

      const now = Date.now();
      const sessionId =
        activeSessionId ??
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `session-${now}`);

      const pipelineVariants = pipelineResult.variants;
      let initialVariants: MessageVariant[];
      let initialActiveId: string;

      if (pipelineVariants && pipelineVariants.length > 0) {
        initialVariants = pipelineVariants.map((v, i) => ({
          id: v.variantId,
          label: i === 0 ? "Best" : `Variant ${i + 1}: ${v.variantId.replace(/-/g, " ")}`,
          text: v.message,
          createdAt: now + i,
        }));
        initialActiveId = initialVariants[0]!.id;
      } else {
        const originalVariantId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `variant-${now}`;
        initialVariants = [{
          id: originalVariantId,
          label: "Original",
          text: pipelineResult.message,
          createdAt: now,
        }];
        initialActiveId = originalVariantId;
      }

      const nextSession: MarketingSession = {
        id: sessionId,
        createdAt: now,
        updatedAt: now,
        platform,
        prompt: normalizedPrompt,
        result: pipelineResult,
        editableMessage: pipelineResult.message,
        viewMode: "preview",
        rewriteWorkflowState: undefined,
        platformMeta: Object.keys(platformMeta).length > 0 ? platformMeta : undefined,
        messageVariants: initialVariants,
        activeVariantId: initialActiveId,
        toneOverride,
        targetAudience: targetAudience.trim() || undefined,
        contentType,
      };

      setResult(pipelineResult);
      setEditableMessage(pipelineResult.message);
      setViewMode("preview");
      setMessageVariants(initialVariants);
      setActiveVariantId(initialActiveId);
      setActiveSessionId(nextSession.id);
      setSessions((prev) => {
        const existingIndex = prev.findIndex((session) => session.id === nextSession.id);
        if (existingIndex === -1) {
          return [nextSession, ...prev].slice(0, MAX_MARKETING_SESSIONS);
        }

        const updated = [...prev];
        const existing = updated[existingIndex];
        updated[existingIndex] = {
          ...nextSession,
          createdAt: existing?.createdAt ?? nextSession.createdAt,
        };
        return updated;
      });
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      console.error("[marketing-pipeline] request error:", requestError);
      setError("Something went wrong talking to the marketing engine. Try again.");
    } finally {
      setLoading(false);
      setGenerationStartTime(null);
      // Pipeline steps are intentionally NOT cleared here so the stepper
      // remains visible after generation completes (transparency).
    }
  }, [activeSessionId, contentType, debug, handleSSEEvent, platform, platformMeta, prompt, targetAudience, toneOverride]);

  const cancelPipeline = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setPipelineSteps([]);
    setThinkingLog([]);
    setGenerationStartTime(null);
  }, []);

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;

  return {
    platform,
    setPlatform,
    prompt,
    setPrompt,
    loading,
    error,
    setError,
    result,
    setResult,
    editableMessage,
    setEditableMessage,
    showRewriteSheet,
    setShowRewriteSheet,
    copySuccess,
    viewMode,
    setViewMode,
    sessions,
    activeSessionId,
    setActiveSessionId,
    selectedPlatform,
    activeSession,
    pipelineSteps,
    thinkingLog,
    generationStartTime,
    platformMeta,
    setPlatformMeta,
    messageVariants,
    activeVariantId,
    selectVariant,
    toneOverride,
    setToneOverride,
    targetAudience,
    setTargetAudience,
    contentType,
    setContentType,
    handleSelectSession,
    handleStartNewSession,
    handleRewriteComplete,
    handleRewriteWorkflowStateChange,
    handlePushToRewriteDocument,
    handleCopy,
    runPipeline,
    cancelPipeline,
  };
}

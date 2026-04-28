"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { diffWords } from "diff";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { LegalGeneratorTheme, legalTheme as s } from "../LegalGeneratorTheme";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

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

type SectionStatus = "pending" | "accepted" | "rejected" | "unchanged";

interface Section {
  id: string;
  index: number;
  title: string;
  original: string;
  proposed: string;
  status: SectionStatus;
  selected: boolean;
}

interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Static config
// ─────────────────────────────────────────────────────────────────────────────

const PRESETS: { id: string; label: string; instruction: string }[] = [
  {
    id: "tighten",
    label: "Tighten language",
    instruction: "Cut redundant words. Prefer concise phrasing.",
  },
  {
    id: "casual",
    label: "More casual",
    instruction: "Use a friendlier, more conversational tone.",
  },
  {
    id: "formal",
    label: "More formal",
    instruction: "Use a professional, formal register.",
  },
  {
    id: "plain",
    label: "Plain English",
    instruction: "Avoid jargon. Use plain English.",
  },
  {
    id: "detail",
    label: "Add detail",
    instruction: "Expand with additional context where helpful.",
  },
  {
    id: "active",
    label: "Active voice",
    instruction: "Prefer active voice over passive.",
  },
];

const GUARDRAILS: { id: string; label: string; sub: string }[] = [
  {
    id: "structure",
    label: "Preserve structure",
    sub: "Keep paragraph breaks intact",
  },
  {
    id: "voice",
    label: "Match my voice",
    sub: "Don't drift from existing tone",
  },
  {
    id: "conflict",
    label: "Stop on conflict",
    sub: "Flag rather than guess",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

function wordCountOf(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function deriveSourceTitle(text: string): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "Untitled source";
  const firstLine = trimmed.split("\n")[0]?.trim() ?? "";
  const stripped = firstLine.replace(/^#{1,6}\s*/, "").trim();
  if (!stripped) return "Untitled source";
  return stripped.length > 48 ? `${stripped.slice(0, 48)}…` : stripped;
}

function sectionTitleOf(chunk: string, index: number): string {
  const firstLine = chunk.split("\n")[0]?.trim() ?? "";
  const stripped = firstLine.replace(/^#{1,6}\s*/, "").trim();
  const truncated =
    stripped.length > 56 ? `${stripped.slice(0, 56)}…` : stripped;
  return truncated.length > 0
    ? `${index + 1}. ${truncated}`
    : `${index + 1}. Section`;
}

function sectionShortName(title: string): string {
  // Strip leading "1. " ordering for display in the diff header
  return title.replace(/^\d+\.\s*/, "");
}

function splitIntoSections(text: string): Pick<
  Section,
  "id" | "index" | "title" | "original"
>[] {
  const safe = (text ?? "").trim();
  if (!safe) return [];
  const parts = safe
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const chunks = parts.length > 0 ? parts : [safe];
  return chunks.map((chunk, i) => ({
    id: `s${i + 1}`,
    index: i,
    title: sectionTitleOf(chunk, i),
    original: chunk,
  }));
}

function mapResponseToProposals(
  baseSections: Section[],
  response: string,
): Section[] {
  const safe = (response ?? "").trim();
  if (!safe) {
    return baseSections.map((sec) => ({ ...sec, proposed: "" }));
  }
  const parts = safe
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length === baseSections.length) {
    return baseSections.map((sec, i) => ({
      ...sec,
      proposed: parts[i] ?? "",
    }));
  }
  if (baseSections.length === 1) {
    const only = baseSections[0]!;
    return [{ ...only, proposed: safe }];
  }
  // Mismatched chunk count — assign proposals 1:1 up to the shorter list and
  // dump any overflow into the last source section so nothing gets lost.
  return baseSections.map((sec, i) => {
    if (i < parts.length - 1) return { ...sec, proposed: parts[i] ?? "" };
    if (i === baseSections.length - 1) {
      return { ...sec, proposed: parts.slice(i).join("\n\n") };
    }
    return { ...sec, proposed: "" };
  });
}

function deriveDelta(original: string, proposed: string): string {
  if (!proposed.trim()) return "—";
  const parts = diffWords(original, proposed);
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    const wc = wordCountOf(part.value);
    if (part.added) added += wc;
    else if (part.removed) removed += wc;
  }
  if (added === 0 && removed === 0) return "no edits";
  return `+${added} / -${removed}`;
}

function deriveChangeCount(parts: DiffPart[]): number {
  return parts.filter((p) => p.added || p.removed).length;
}

function summarizeSection(parts: DiffPart[]): string {
  const editCount = deriveChangeCount(parts);
  if (editCount === 0) {
    return "No edits proposed for this section — the rewrite matches the source.";
  }
  let added = 0;
  let removed = 0;
  for (const p of parts) {
    const wc = wordCountOf(p.value);
    if (p.added) added += wc;
    else if (p.removed) removed += wc;
  }
  const delta = added - removed;
  if (delta > 0) {
    return `Expanded by ${delta} word${delta === 1 ? "" : "s"} across ${editCount} edit${editCount === 1 ? "" : "s"}.`;
  }
  if (delta < 0) {
    return `Tightened by ${Math.abs(delta)} word${Math.abs(delta) === 1 ? "" : "s"} across ${editCount} edit${editCount === 1 ? "" : "s"}.`;
  }
  return `${editCount} edit${editCount === 1 ? "" : "s"} without changing the overall length.`;
}

function assembleFinalText(sections: Section[]): string {
  return sections
    .map((sec) => {
      if (sec.status === "accepted" && sec.proposed.trim()) return sec.proposed;
      return sec.original;
    })
    .join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main workspace
// ─────────────────────────────────────────────────────────────────────────────

export function RewriteWorkflow({
  initialText = "",
  onComplete,
  onCancel,
  persistedState,
  onStateChange,
}: RewriteWorkflowProps) {
  const [text, setText] = useState<string>(
    persistedState?.text ?? initialText,
  );
  const [customPrompt, setCustomPrompt] = useState<string>(
    persistedState?.options?.customPrompt ?? "",
  );
  const [activePresets, setActivePresets] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [guardrailState, setGuardrailState] = useState<Record<string, boolean>>(
    {
      structure: true,
      voice: true,
      conflict: true,
    },
  );
  const [proposedText, setProposedText] = useState<string>(
    persistedState?.rewrittenText ?? "",
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseDescriptors = useMemo(() => splitIntoSections(text), [text]);

  const [sections, setSections] = useState<Section[]>(() => {
    const base: Section[] = baseDescriptors.map((d) => ({
      ...d,
      proposed: "",
      status: "unchanged" as SectionStatus,
      selected: true,
    }));
    // Resume from a persisted rewrite: re-map the proposals onto the sections
    // so the diff and review rail come back in the right state.
    const resume = persistedState?.rewrittenText?.trim() ?? "";
    if (!resume) return base;
    return mapResponseToProposals(base, resume).map((sec) => ({
      ...sec,
      status:
        sec.proposed.trim() && sec.proposed.trim() !== sec.original.trim()
          ? "pending"
          : "unchanged",
    }));
  });

  const [currentSectionId, setCurrentSectionId] = useState<string>(
    baseDescriptors[0]?.id ?? "",
  );

  // Re-derive sections whenever the source text changes (preserve flags)
  const previousTextRef = useRef(text);
  useEffect(() => {
    if (previousTextRef.current === text) return;
    previousTextRef.current = text;
    setSections((prev) => {
      return baseDescriptors.map((d) => {
        const existing = prev.find((p) => p.id === d.id);
        return {
          ...d,
          proposed: existing?.proposed ?? "",
          status: existing?.status ?? "unchanged",
          selected: existing?.selected ?? true,
        };
      });
    });
    setCurrentSectionId((prev) => {
      if (baseDescriptors.find((d) => d.id === prev)) return prev;
      return baseDescriptors[0]?.id ?? "";
    });
  }, [baseDescriptors, text]);

  // Persist state up to the parent so the workflow can be paused / resumed
  useEffect(() => {
    if (!onStateChange) return;
    onStateChange({
      currentStep: proposedText ? "preview" : "options",
      text,
      options: {
        tone: "professional",
        length: "medium",
        audience: "general",
        customPrompt,
      },
      rewrittenText: proposedText,
      isDraftMode: true,
    });
  }, [customPrompt, onStateChange, proposedText, text]);

  // ── derived values ────────────────────────────────────────────────────────
  const wordCount = wordCountOf(text);
  const selectedCount = sections.filter((sec) => sec.selected).length;
  const currentSection =
    sections.find((sec) => sec.id === currentSectionId) ?? sections[0];
  const currentIndex = currentSection
    ? sections.findIndex((sec) => sec.id === currentSection.id)
    : -1;

  const currentDiffParts: DiffPart[] = useMemo(() => {
    if (!currentSection?.proposed.trim()) return [];
    return diffWords(currentSection.original, currentSection.proposed);
  }, [currentSection?.original, currentSection?.proposed]);

  const counts = useMemo(() => {
    let acc = 0;
    let rej = 0;
    let pen = 0;
    let unc = 0;
    for (const sec of sections) {
      if (sec.status === "accepted") acc += 1;
      else if (sec.status === "rejected") rej += 1;
      else if (sec.status === "pending") pen += 1;
      else unc += 1;
    }
    return { acc, rej, pen, unc, total: sections.length };
  }, [sections]);

  const totalReviewable = counts.acc + counts.rej + counts.pen;
  const acceptedPct =
    totalReviewable > 0 ? (counts.acc / totalReviewable) * 100 : 0;
  const rejectedPct =
    totalReviewable > 0 ? (counts.rej / totalReviewable) * 100 : 0;

  const composedPrompt = useMemo(() => {
    const lines: string[] = [];
    const base = customPrompt.trim();
    if (base) lines.push(base);
    for (const id of activePresets) {
      const preset = PRESETS.find((p) => p.id === id);
      if (preset) lines.push(preset.instruction);
    }
    if (guardrailState.structure)
      lines.push("Preserve paragraph structure and breaks.");
    if (guardrailState.voice)
      lines.push("Match the existing tone of voice as closely as possible.");
    if (guardrailState.conflict)
      lines.push("If unsure about a phrasing, flag it rather than guessing.");
    return lines.join("\n");
  }, [activePresets, customPrompt, guardrailState]);

  // ── handlers ──────────────────────────────────────────────────────────────
  const togglePreset = useCallback((id: string) => {
    setActivePresets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleGuardrail = useCallback((id: string) => {
    setGuardrailState((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const toggleSectionSelected = useCallback((id: string) => {
    setSections((prev) =>
      prev.map((sec) =>
        sec.id === id ? { ...sec, selected: !sec.selected } : sec,
      ),
    );
  }, []);

  const setSectionStatus = useCallback(
    (id: string, status: SectionStatus) => {
      setSections((prev) =>
        prev.map((sec) => (sec.id === id ? { ...sec, status } : sec)),
      );
    },
    [],
  );

  const advanceToNextPending = useCallback(() => {
    setCurrentSectionId((prevId) => {
      const idx = sections.findIndex((sec) => sec.id === prevId);
      const after = sections.slice(idx + 1).find((sec) => sec.status === "pending");
      if (after) return after.id;
      const before = sections.slice(0, idx).find((sec) => sec.status === "pending");
      if (before) return before.id;
      return prevId;
    });
  }, [sections]);

  const handleAcceptCurrent = useCallback(() => {
    if (!currentSection) return;
    setSectionStatus(currentSection.id, "accepted");
    advanceToNextPending();
  }, [advanceToNextPending, currentSection, setSectionStatus]);

  const handleRejectCurrent = useCallback(() => {
    if (!currentSection) return;
    setSectionStatus(currentSection.id, "rejected");
    advanceToNextPending();
  }, [advanceToNextPending, currentSection, setSectionStatus]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      const prevSection = sections[currentIndex - 1];
      if (prevSection) setCurrentSectionId(prevSection.id);
    }
  }, [currentIndex, sections]);

  const goNext = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < sections.length - 1) {
      const nextSection = sections[currentIndex + 1];
      if (nextSection) setCurrentSectionId(nextSection.id);
    }
  }, [currentIndex, sections]);

  const handleRunRewrite = useCallback(async () => {
    if (!text.trim() || selectedCount === 0) return;
    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch("/api/document-generator/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rewrite",
          content: text,
          prompt: composedPrompt,
          options: {
            tone: "professional",
            length: "medium",
            audience: "general",
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
          responseText.slice(0, 120) ||
            "Server returned an invalid response. Please try again.",
        );
        return;
      }

      if (
        data.success &&
        typeof data.generatedContent === "string" &&
        data.generatedContent.trim().length > 0
      ) {
        const generated = data.generatedContent;
        setProposedText(generated);
        setSections((prev) => {
          const proposals = mapResponseToProposals(prev, generated);
          return proposals.map((sec) => {
            // Sections the user did not select: preserve original, mark unchanged.
            if (!sec.selected) {
              return { ...sec, proposed: "", status: "unchanged" as const };
            }
            // Sections that came back blank or matched the source: nothing to review.
            if (
              !sec.proposed.trim() ||
              sec.proposed.trim() === sec.original.trim()
            ) {
              return { ...sec, status: "unchanged" as const };
            }
            return { ...sec, status: "pending" as const };
          });
        });
        // Jump the user to the first pending section so they can start reviewing.
        setCurrentSectionId((prev) => {
          const proposals = mapResponseToProposals(sections, generated);
          const pending = proposals.find(
            (sec) =>
              sec.selected &&
              sec.proposed.trim() &&
              sec.proposed.trim() !== sec.original.trim(),
          );
          return pending?.id ?? prev;
        });
      } else {
        setError(data.message ?? data.error ?? "Failed to rewrite text");
      }
    } catch (err) {
      console.error("Rewrite request failed", err);
      setError("Network error occurred");
    } finally {
      setIsProcessing(false);
    }
  }, [composedPrompt, sections, selectedCount, text]);

  const handleApply = useCallback(() => {
    onComplete(assembleFinalText(sections));
  }, [onComplete, sections]);

  const handleRejectAll = useCallback(() => {
    setSections((prev) =>
      prev.map((sec) =>
        sec.status === "pending" || sec.status === "accepted"
          ? { ...sec, status: "rejected" }
          : sec,
      ),
    );
  }, []);

  // ── render ────────────────────────────────────────────────────────────────
  const hasProposal = !!proposedText.trim();
  const breadcrumbLast = hasProposal ? "Review v2" : "New rewrite";

  return (
    <LegalGeneratorTheme ambient={false}>
      <div className="flex h-full flex-col">
        {/* Top bar */}
        <div className={s.rwsTop}>
          <button
            type="button"
            className={`${s.btn} ${s.btnGhost} ${s.btnSm}`}
            onClick={onCancel}
          >
            <ArrowLeft className="h-4 w-4" />
            Exit
          </button>
          <span className={s.rwsNavSep} />
          <div className={s.rwsCrumbs}>
            <span>Documents</span>
            <span className={s.rwsCrumbsSep}>›</span>
            <span>Rewrite</span>
            <span className={s.rwsCrumbsSep}>›</span>
            <span className={s.rwsCrumbsLast}>{breadcrumbLast}</span>
          </div>
          <div className={s.rwsTopSpacer} />
          <span className={s.rwsTopPill}>
            <FileText />v1 · {wordCount.toLocaleString()} words
          </span>
        </div>

        {/* Three-pane workspace */}
        <div className={s.rwsWorkspace}>
          <ScopeRail
            text={text}
            onTextChange={setText}
            sourceTitle={deriveSourceTitle(text)}
            wordCount={wordCount}
            sections={sections}
            customPrompt={customPrompt}
            onCustomPromptChange={setCustomPrompt}
            activePresets={activePresets}
            onTogglePreset={togglePreset}
            guardrailState={guardrailState}
            onToggleGuardrail={toggleGuardrail}
            onToggleSection={toggleSectionSelected}
            error={error}
            isProcessing={isProcessing}
            selectedCount={selectedCount}
            onRunRewrite={handleRunRewrite}
          />

          <main className={s.rwsPipe}>
            {hasProposal && currentSection && currentSection.proposed.trim() ? (
              <DiffPipeline
                section={currentSection}
                index={currentIndex}
                total={sections.length}
                parts={currentDiffParts}
                onPrev={currentIndex > 0 ? goPrev : undefined}
                onNext={
                  currentIndex >= 0 && currentIndex < sections.length - 1
                    ? goNext
                    : undefined
                }
                onAcceptSection={handleAcceptCurrent}
                onRejectSection={handleRejectCurrent}
                disabled={isProcessing}
              />
            ) : (
              <PipelineEmpty
                hasText={!!text.trim()}
                isProcessing={isProcessing}
                selectedCount={selectedCount}
              />
            )}
          </main>

          <ReviewRail
            sections={sections}
            currentSectionId={currentSection?.id ?? ""}
            counts={counts}
            acceptedPct={acceptedPct}
            rejectedPct={rejectedPct}
            hasProposal={hasProposal}
            onSelect={setCurrentSectionId}
            onAcceptOne={(id) => setSectionStatus(id, "accepted")}
            onRejectOne={(id) => setSectionStatus(id, "rejected")}
            onApply={handleApply}
            onRejectAll={handleRejectAll}
          />
        </div>
      </div>
    </LegalGeneratorTheme>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Left pane — Scope rail
// ─────────────────────────────────────────────────────────────────────────────

interface ScopeRailProps {
  text: string;
  onTextChange: (t: string) => void;
  sourceTitle: string;
  wordCount: number;
  sections: Section[];
  customPrompt: string;
  onCustomPromptChange: (t: string) => void;
  activePresets: Set<string>;
  onTogglePreset: (id: string) => void;
  guardrailState: Record<string, boolean>;
  onToggleGuardrail: (id: string) => void;
  onToggleSection: (id: string) => void;
  error: string | null;
  isProcessing: boolean;
  selectedCount: number;
  onRunRewrite: () => void;
}

function ScopeRail({
  text,
  onTextChange,
  sourceTitle,
  wordCount,
  sections,
  customPrompt,
  onCustomPromptChange,
  activePresets,
  onTogglePreset,
  guardrailState,
  onToggleGuardrail,
  onToggleSection,
  error,
  isProcessing,
  selectedCount,
  onRunRewrite,
}: ScopeRailProps) {
  return (
    <aside className={s.rwsCfg}>
      <div className={s.rwsCfgHead}>
        <h2 className={s.rwsCfgHeadTitle}>Rewrite scope</h2>
        <p className={s.rwsCfgHeadSub}>
          Drift will rewrite only the sections you choose, keeping defined
          terms and citations intact.
        </p>
      </div>

      {/* Source */}
      <div className={s.rwsCfgSection}>
        <h3 className={s.rwsCfgSectionH}>Source</h3>
        <div className={s.rwsSourceItem}>
          <div className={s.rwsSourceIcon}>
            <FileText />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className={s.rwsSourceName}>{sourceTitle}</div>
            <div className={s.rwsSourceMeta}>
              v1 · {wordCount.toLocaleString()} words
            </div>
          </div>
          <div className={s.rwsSourceUsed}>
            {sections.length} §
          </div>
        </div>
        <textarea
          className={s.rwsTextarea}
          style={{ marginTop: 10, minHeight: 120 }}
          placeholder="Paste or type the source text here…"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
        />
      </div>

      {/* Instruction */}
      <div className={s.rwsCfgSection}>
        <h3 className={s.rwsCfgSectionH}>Instruction</h3>
        <textarea
          className={s.rwsTextarea}
          placeholder="Describe how you want it rewritten…"
          value={customPrompt}
          onChange={(e) => onCustomPromptChange(e.target.value)}
        />
        <div className={s.rwsPresets}>
          {PRESETS.map((p) => {
            const active = activePresets.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`${s.rwsPreset}${active ? ` ${s.rwsPresetActive}` : ""}`}
                onClick={() => onTogglePreset(p.id)}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sections to rewrite */}
      {sections.length > 0 && (
        <div className={s.rwsCfgSection}>
          <h3 className={s.rwsCfgSectionH}>Sections to rewrite</h3>
          <div className={s.rwsSectionList}>
            {sections.map((sec) => {
              const delta = sec.proposed.trim()
                ? deriveDelta(sec.original, sec.proposed)
                : "—";
              return (
                <label key={sec.id} className={s.rwsSectionCheck}>
                  <input
                    type="checkbox"
                    checked={sec.selected}
                    onChange={() => onToggleSection(sec.id)}
                  />
                  <span className={s.rwsSectionCheckLabel}>{sec.title}</span>
                  <span className={s.rwsSectionDelta}>{delta}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Guardrails */}
      <div className={s.rwsCfgSection}>
        <h3 className={s.rwsCfgSectionH}>Guardrails</h3>
        {GUARDRAILS.map((g) => {
          const on = !!guardrailState[g.id];
          return (
            <div key={g.id} className={s.rwsToggleRow}>
              <div>
                <div className={s.rwsToggleLabel}>{g.label}</div>
                <div className={s.rwsToggleSub}>{g.sub}</div>
              </div>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${g.label}: ${on ? "on" : "off"}`}
                className={`${s.rwsToggle}${on ? ` ${s.rwsToggleOn}` : ""}`}
                onClick={() => onToggleGuardrail(g.id)}
              />
            </div>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className={s.rwsCfgSection}>
          <div
            style={{
              fontSize: 12,
              color: "var(--danger)",
              padding: "8px 10px",
              borderRadius: 8,
              background: "oklch(from var(--danger) l c h / 0.08)",
              border: "1px solid oklch(from var(--danger) l c h / 0.28)",
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className={s.rwsCta}>
        <button
          type="button"
          className={s.rwsCtaBtn}
          onClick={onRunRewrite}
          disabled={isProcessing || !text.trim() || selectedCount === 0}
        >
          {isProcessing ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Wand2 />
          )}
          {isProcessing
            ? "Rewriting…"
            : `Run rewrite · ${selectedCount} section${selectedCount === 1 ? "" : "s"}`}
        </button>
        <div className={s.rwsCtaMeta}>
          ~10s · {wordCount.toLocaleString()} words
        </div>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Center pane — Diff pipeline (when there's a proposal for the current section)
// ─────────────────────────────────────────────────────────────────────────────

interface DiffPipelineProps {
  section: Section;
  index: number;
  total: number;
  parts: DiffPart[];
  onPrev?: () => void;
  onNext?: () => void;
  onAcceptSection: () => void;
  onRejectSection: () => void;
  disabled?: boolean;
}

function DiffPipeline({
  section,
  index,
  total,
  parts,
  onPrev,
  onNext,
  onAcceptSection,
  onRejectSection,
  disabled = false,
}: DiffPipelineProps) {
  const changeCount = deriveChangeCount(parts);
  const dotColor =
    section.status === "accepted"
      ? "var(--success)"
      : section.status === "rejected"
        ? "var(--danger)"
        : section.status === "unchanged"
          ? "var(--ink-4)"
          : "var(--accent)";
  const statusText =
    section.status === "accepted"
      ? "accepted"
      : section.status === "rejected"
        ? "rejected"
        : section.status === "unchanged"
          ? "unchanged"
          : `${changeCount} change${changeCount === 1 ? "" : "s"} · pending review`;

  return (
    <>
      <div className={s.rwsPipeHead}>
        <div style={{ minWidth: 0 }}>
          <h1 className={s.rwsPipeTitle}>
            Section {index + 1} ·{" "}
            <em>{sectionShortName(section.title)}</em>
          </h1>
          <p className={s.rwsPipeSub}>
            <span
              className={`${s.statusDot}${
                section.status === "pending" ? "" : ` ${s.statusDotIdle}`
              }`}
              style={
                {
                  ["--dot-color" as string]: dotColor,
                } as React.CSSProperties
              }
            />
            {statusText}
          </p>
        </div>
        <div className={s.rwsPipeNav}>
          <button
            type="button"
            className={`${s.btn} ${s.btnGhost} ${s.btnSm}`}
            onClick={onPrev}
            disabled={!onPrev || disabled}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev
          </button>
          <span className={s.rwsNavCount}>
            {index + 1} / {total}
          </span>
          <button
            type="button"
            className={`${s.btn} ${s.btnGhost} ${s.btnSm}`}
            onClick={onNext}
            disabled={!onNext || disabled}
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <span className={s.rwsNavSep} />
          <button
            type="button"
            className={`${s.btn} ${s.btnOutline} ${s.btnSm}`}
            onClick={onRejectSection}
            disabled={disabled || section.status === "rejected"}
          >
            <X className="h-3.5 w-3.5" />
            Reject section
          </button>
          <button
            type="button"
            className={`${s.btn} ${s.btnAccent} ${s.btnSm}`}
            onClick={onAcceptSection}
            disabled={disabled || section.status === "accepted"}
          >
            <Check className="h-3.5 w-3.5" />
            Accept section
          </button>
        </div>
      </div>

      <div className={s.rwsPipeBody}>
        {/* Original pane */}
        <div className={`${s.rwsPane} ${s.rwsPaneOriginal}`}>
          <div className={s.rwsPaneEyebrow}>Original · v1</div>
          <DiffProse parts={parts} mode="original" />
        </div>

        {/* Proposed pane */}
        <div className={`${s.rwsPane} ${s.rwsPaneProposed}`}>
          <div
            className={`${s.rwsPaneEyebrow} ${s.rwsPaneEyebrowProposed}`}
          >
            Proposed · v2
          </div>
          <DiffProse parts={parts} mode="proposed" />

          {changeCount > 0 && (
            <div className={s.rwsWhyCard}>
              <div className={s.rwsWhyHead}>
                <Sparkles />
                <span>Why this change</span>
              </div>
              {summarizeSection(parts)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function DiffProse({
  parts,
  mode,
}: {
  parts: DiffPart[];
  mode: "original" | "proposed";
}) {
  const isOriginal = mode === "original";
  const visibleParts = parts.filter((p) =>
    isOriginal ? !p.added : !p.removed,
  );

  const hasContent = visibleParts.some((p) => p.value.length > 0);
  if (!hasContent) {
    return (
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--ink-4)",
          fontStyle: "italic",
        }}
      >
        {isOriginal ? "No source text in this section." : "The rewrite is empty."}
      </p>
    );
  }

  return (
    <div
      className={`${s.rwsPaneText}${isOriginal ? "" : ` ${s.rwsPaneTextProposed}`}`}
      style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
    >
      {visibleParts.map((part, i) => {
        if (isOriginal && part.removed) {
          return (
            <span key={i} className={s.rwsHlDel}>
              {part.value}
            </span>
          );
        }
        if (!isOriginal && part.added) {
          return (
            <span key={i} className={s.rwsHlAdd}>
              {part.value}
            </span>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Center pane — Empty state (before generation, or while generating)
// ─────────────────────────────────────────────────────────────────────────────

interface PipelineEmptyProps {
  hasText: boolean;
  isProcessing: boolean;
  selectedCount: number;
}

function PipelineEmpty({
  hasText,
  isProcessing,
  selectedCount,
}: PipelineEmptyProps) {
  let title = "Ready to ";
  let serif = "rewrite";
  let sub: string;

  if (isProcessing) {
    title = "Drafting the ";
    serif = "rewrite";
    sub = "Drift is reading every selected section and proposing changes. This usually takes about 10 seconds.";
  } else if (!hasText) {
    title = "Paste a ";
    serif = "source";
    sub = "Drop in the text you want to rewrite using the source field on the left, then run the rewrite.";
  } else if (selectedCount === 0) {
    title = "Pick a ";
    serif = "section";
    sub = "Select at least one section in the left rail. Drift only rewrites the parts you ask for.";
  } else {
    sub = "Adjust the instruction and presets on the left, then click Run rewrite. Drift will lay the proposal out side-by-side with the source.";
  }

  return (
    <div className={s.rwsPipeEmpty}>
      <div className={s.rwsPipeEmptyMark}>
        {isProcessing ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Sparkles />
        )}
      </div>
      <h1 className={s.rwsPipeEmptyTitle}>
        {title}
        <em>{serif}</em>
      </h1>
      <p className={s.rwsPipeEmptySub}>{sub}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Right pane — Review rail
// ─────────────────────────────────────────────────────────────────────────────

interface ReviewRailProps {
  sections: Section[];
  currentSectionId: string;
  counts: { acc: number; rej: number; pen: number; unc: number; total: number };
  acceptedPct: number;
  rejectedPct: number;
  hasProposal: boolean;
  onSelect: (id: string) => void;
  onAcceptOne: (id: string) => void;
  onRejectOne: (id: string) => void;
  onApply: () => void;
  onRejectAll: () => void;
}

function ReviewRail({
  sections,
  currentSectionId,
  counts,
  acceptedPct,
  rejectedPct,
  hasProposal,
  onSelect,
  onAcceptOne,
  onRejectOne,
  onApply,
  onRejectAll,
}: ReviewRailProps) {
  const sectionLabel = `Review · ${counts.total} section${counts.total === 1 ? "" : "s"}`;
  const subLabel = hasProposal
    ? `${counts.acc} accepted · ${counts.rej} rejected · ${counts.pen} pending`
    : `${counts.total} section${counts.total === 1 ? "" : "s"} ready · run to start review`;
  const finalCta =
    counts.acc === 0
      ? "Apply 0 accepted → v2"
      : `Apply ${counts.acc} accepted → v2`;
  const finalApplyDisabled = counts.acc === 0;
  const finalRejectDisabled = counts.pen === 0 && counts.acc === 0;

  return (
    <aside className={s.rwsOut}>
      <div className={s.rwsOutHead}>
        <div className={s.rwsOutTitle}>{sectionLabel}</div>
        <div className={s.rwsOutSub}>{subLabel}</div>
      </div>

      {/* Progress bar */}
      <div className={s.rwsProgress}>
        <div
          className={s.rwsProgressAccepted}
          style={{ width: `${acceptedPct}%` }}
        />
        <div
          className={s.rwsProgressRejected}
          style={{ width: `${rejectedPct}%` }}
        />
      </div>

      <div className={s.rwsOutBody}>
        <span className={s.rwsOutEyebrow}>Sections</span>

        {sections.length === 0 ? (
          <p
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              margin: "8px 0 0",
              lineHeight: 1.5,
            }}
          >
            No sections yet — paste source text on the left to get started.
          </p>
        ) : (
          sections.map((sec) => {
            const isPending = sec.status === "pending";
            const isAccepted = sec.status === "accepted";
            const isRejected = sec.status === "rejected";
            const isUnchanged = sec.status === "unchanged";
            const dotColor = isAccepted
              ? "var(--success)"
              : isRejected
                ? "var(--danger)"
                : isUnchanged
                  ? "var(--ink-4)"
                  : "var(--accent)";
            const metaColor = isAccepted
              ? "var(--success)"
              : isRejected
                ? "var(--danger)"
                : isUnchanged
                  ? "var(--ink-4)"
                  : "var(--ink-3)";
            const meta = isUnchanged
              ? "unchanged"
              : isAccepted
                ? `accepted · ${deriveDelta(sec.original, sec.proposed)}`
                : isRejected
                  ? `rejected · ${deriveDelta(sec.original, sec.proposed)}`
                  : `pending · ${deriveDelta(sec.original, sec.proposed)}`;
            const isActive = sec.id === currentSectionId;

            return (
              <button
                key={sec.id}
                type="button"
                className={`${s.rwsReviewRow}${
                  isActive ? ` ${s.rwsReviewRowActive}` : ""
                }`}
                onClick={() => onSelect(sec.id)}
              >
                <span
                  className={`${s.rwsReviewDot}${
                    isPending ? ` ${s.rwsReviewDotPulse}` : ""
                  }`}
                  style={
                    {
                      background: dotColor,
                      ["--dot-color" as string]: dotColor,
                    } as React.CSSProperties
                  }
                />
                <span style={{ minWidth: 0 }}>
                  <span className={s.rwsReviewName}>{sec.title}</span>
                  <span
                    className={s.rwsReviewMeta}
                    style={{ display: "block", color: metaColor }}
                  >
                    {meta}
                  </span>
                </span>
                {isPending && (
                  <span className={s.rwsReviewActions}>
                    <button
                      type="button"
                      className={s.rwsIconBtn}
                      title="Reject section"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRejectOne(sec.id);
                      }}
                    >
                      <X />
                    </button>
                    <button
                      type="button"
                      className={`${s.rwsIconBtn} ${s.rwsIconBtnSuccess}`}
                      title="Accept section"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAcceptOne(sec.id);
                      }}
                    >
                      <Check />
                    </button>
                  </span>
                )}
              </button>
            );
          })
        )}

        {/* Final review */}
        {hasProposal && (
          <div className={s.rwsFinal}>
            <div className={s.rwsFinalHead}>
              <span className={s.rwsFinalTitle}>Final review</span>
              <span className={s.rwsFinalScore}>
                {counts.pen === 0 ? "ready" : "in progress"}
              </span>
            </div>
            <div className={s.rwsFinalBody}>
              {counts.pen === 0
                ? "All sections reviewed. Apply the accepted proposals to produce v2."
                : `${counts.pen} section${counts.pen === 1 ? "" : "s"} still pending. Accept or reject before applying.`}
            </div>
            <div className={s.rwsFinalActions}>
              <button
                type="button"
                className={`${s.btn} ${s.btnOutline} ${s.btnSm}`}
                onClick={onRejectAll}
                disabled={finalRejectDisabled}
              >
                Reject all
              </button>
              <button
                type="button"
                className={`${s.btn} ${s.btnAccent} ${s.btnSm}`}
                onClick={onApply}
                disabled={finalApplyDisabled}
                style={{ flex: 1, justifyContent: "center" }}
              >
                <Check className="h-3.5 w-3.5" />
                {finalCta}
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

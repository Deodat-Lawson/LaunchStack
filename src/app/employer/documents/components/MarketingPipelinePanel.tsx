"use client";

import { useMemo, useState, useCallback } from "react";
import Image from "next/image";
import {
  Loader2,
  MessageSquareText,
  Megaphone,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Send,
  ShieldCheck,
  Users,
  Mic,
  FileText,
  BarChart3,
  Target,
  Lightbulb,
} from "lucide-react";
import styles from "~/styles/Employer/MarketingPipeline.module.css";

// ---------------------------------------------------------------------------
// Types mirroring the backend response
// ---------------------------------------------------------------------------

type Platform = "x" | "linkedin" | "reddit" | "bluesky";
type FormalityLevel = "formal" | "conversational" | "technical" | "bold";
type ContentType = "post" | "thread" | "ad_copy" | "email" | "multi_platform";

interface ContentVariant {
  variantId: string;
  angleRationale: string;
  message: string;
  mediaType: "image" | "video";
}

interface StrategyVariant {
  variantId: string;
  angleRationale: string;
  angle: string;
  keyProof: string[];
  humanHook: string;
  avoidList: string[];
}

interface BrandVoice {
  toneDescriptor: string;
  vocabularyExamples: string[];
  sentenceStyle: string;
  formalityLevel: FormalityLevel;
}

interface TargetPersona {
  role: string;
  painPoints: string[];
  priorities: string[];
  languageStyle: string;
}

interface ClaimSource {
  claim: string;
  sourceDoc: string;
  chunk: string;
  confidence: number;
}

interface CompanyDNA {
  coreMission: string;
  keyDifferentiators: string[];
  provenResults: string[];
  humanStory: string;
  technicalEdge: string;
}

interface CompetitorAnalysis {
  competitors: Array<{ name: string; positioning: string; weaknesses: string[] }>;
  ourAdvantages: string[];
  marketGaps: string[];
  messagingAntiPatterns: string[];
}

interface PipelineStages {
  dna: CompanyDNA;
  competitors: CompetitorAnalysis;
  trends: Array<{ title: string; url: string; snippet: string; source: Platform }>;
  strategies: StrategyVariant[];
  brandVoice?: BrandVoice;
  targetPersona?: TargetPersona;
  performanceInsights?: string[];
}

interface PipelineData {
  platform: Platform;
  message: string;
  "image/video": "image" | "video";
  research: Array<{ title: string; url: string; snippet: string; source: Platform }>;
  variants: ContentVariant[];
  pipelineStages: PipelineStages;
  claimSources?: ClaimSource[];
}

interface PipelineResponse {
  success: boolean;
  message?: string;
  data?: PipelineData;
}

interface RefinementResponse {
  success: boolean;
  data?: { variantId: string; message: string; mediaType: "image" | "video"; feedbackApplied: string };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REDDIT_SNOO_URL = "/images/reddit-snoo.png";

const PLATFORM_OPTIONS: Array<{
  id: Platform; label: string; subtitle: string; logoText: string; logoImg?: string;
}> = [
  { id: "reddit", label: "Reddit", subtitle: "Community-first threads", logoText: "reddit", logoImg: REDDIT_SNOO_URL },
  { id: "x", label: "Twitter / X", subtitle: "Fast-moving trends", logoText: "𝕏" },
  { id: "linkedin", label: "LinkedIn", subtitle: "B2B + thought leadership", logoText: "in" },
  { id: "bluesky", label: "Bluesky", subtitle: "Decentralized trends", logoText: "🦋" },
];

const TONE_OPTIONS: Array<{ id: FormalityLevel; label: string }> = [
  { id: "formal", label: "Formal" },
  { id: "conversational", label: "Conversational" },
  { id: "technical", label: "Technical" },
  { id: "bold", label: "Bold" },
];

const CONTENT_TYPE_OPTIONS: Array<{ id: ContentType; label: string; desc: string }> = [
  { id: "post", label: "Single Post", desc: "Standard social media post" },
  { id: "thread", label: "Thread", desc: "Multi-part connected posts" },
  { id: "ad_copy", label: "Ad Copy", desc: "Headline + body + CTA variations" },
  { id: "email", label: "Email", desc: "Subject line + body + CTA" },
];

function usePlatformLogoClassNames() {
  return useMemo(() => ({
    reddit: styles.platformLogoReddit,
    x: styles.platformLogoX,
    linkedin: styles.platformLogoLinkedin,
    bluesky: styles.platformLogoBluesky,
  }), []);
}

// ---------------------------------------------------------------------------
// Collapsible section helper
// ---------------------------------------------------------------------------

function CollapsibleSection({ title, icon, defaultOpen, children }: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div style={{ borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: "0.5rem", marginTop: "0.5rem" }}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        style={{
          display: "flex", alignItems: "center", gap: "0.375rem",
          background: "none", border: "none", cursor: "pointer", padding: "0.25rem 0",
          fontSize: "0.8125rem", fontWeight: 600, color: "var(--foreground, #374151)", width: "100%",
        }}
      >
        {icon}
        {title}
        <span style={{ marginLeft: "auto" }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && <div style={{ marginTop: "0.5rem", fontSize: "0.8125rem", lineHeight: 1.6 }}>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline stage stepper types
// ---------------------------------------------------------------------------

interface StageStatus {
  stage: string;
  label: string;
  status: "pending" | "running" | "completed" | "skipped" | "failed";
  durationMs?: number;
}

const PIPELINE_STAGE_ORDER = [
  "context",
  "dna",
  "competitors",
  "trends",
  "brand_voice",
  "persona",
  "performance",
  "strategies",
  "variants",
  "claims",
] as const;

function StageIcon({ status }: { status: StageStatus["status"] }) {
  if (status === "running") return <Loader2 size={14} className={styles.spinIcon} />;
  if (status === "completed") return <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "0.875rem" }}>&#10003;</span>;
  if (status === "failed") return <span style={{ color: "#dc2626", fontWeight: 700, fontSize: "0.875rem" }}>&#10007;</span>;
  if (status === "skipped") return <span style={{ color: "var(--muted-foreground)", fontSize: "0.75rem" }}>--</span>;
  return <span style={{ color: "var(--muted-foreground)", fontSize: "0.75rem" }}>&#9675;</span>;
}

function PipelineStepper({ stages }: { stages: StageStatus[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <div style={{ fontSize: "0.8125rem", fontWeight: 700, marginBottom: "0.25rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <Sparkles size={14} /> Pipeline Thought Process
      </div>
      {stages.map((s) => (
        <div
          key={s.stage}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.25rem 0.375rem",
            borderRadius: "0.375rem",
            background: s.status === "running" ? "rgba(124,58,237,0.08)" : "transparent",
            transition: "background 0.3s",
          }}
        >
          <StageIcon status={s.status} />
          <span style={{
            fontSize: "0.8125rem",
            fontWeight: s.status === "running" ? 600 : 400,
            color: s.status === "pending" ? "var(--muted-foreground)" : "var(--foreground)",
            flex: 1,
          }}>
            {s.label}
          </span>
          {s.durationMs != null && s.status !== "pending" && s.status !== "running" && (
            <span style={{ fontSize: "0.6875rem", color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }}>
              {(s.durationMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MarketingPipelinePanel() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [prompt, setPrompt] = useState("");
  const [toneOverride, setToneOverride] = useState<FormalityLevel | "">("");
  const [targetAudience, setTargetAudience] = useState("");
  const [contentType, setContentType] = useState<ContentType>("post");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineData | null>(null);
  const [selectedVariant, setSelectedVariant] = useState(0);
  const [refineFeedback, setRefineFeedback] = useState("");
  const [refining, setRefining] = useState(false);
  const [pipelineStages, setPipelineStages] = useState<StageStatus[]>([]);

  const logoClassNames = usePlatformLogoClassNames();
  const selectedPlatform = PLATFORM_OPTIONS.find((o) => o.id === platform) ?? null;

  const runPipeline = useCallback(async () => {
    setError(null);
    setResult(null);
    if (!platform) { setError("Choose a platform to continue."); return; }
    const np = prompt.trim();
    if (!np) { setError("Add a short description of what you want to promote."); return; }

    const initialStages: StageStatus[] = PIPELINE_STAGE_ORDER.map((id) => ({
      stage: id,
      label: {
        context: "Building company knowledge context",
        dna: "Extracting company DNA",
        competitors: "Analyzing competitors",
        trends: "Researching platform trends",
        brand_voice: "Detecting brand voice",
        persona: "Building target persona",
        performance: "Checking performance history",
        strategies: "Building 3 messaging strategies",
        variants: "Generating 3 content variants",
        claims: "Verifying claim sources",
      }[id],
      status: "pending" as const,
    }));
    setPipelineStages(initialStages);
    setLoading(true);

    try {
      const body: Record<string, unknown> = { platform, prompt: np, contentType };
      if (toneOverride) body.toneOverride = toneOverride;
      if (targetAudience.trim()) body.targetAudience = targetAudience.trim();

      const response = await fetch("/api/marketing-pipeline/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        setError("Generation failed. Please try again.");
        setLoading(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ") && eventType) {
            try {
              const data = JSON.parse(line.slice(6)) as Record<string, unknown>;

              if (eventType === "stage") {
                const stage = data as unknown as { stage: string; label: string; status: string; durationMs?: number };
                if (stage.stage === "done") continue;
                setPipelineStages((prev) => {
                  const updated = [...prev];
                  const idx = updated.findIndex((s) => s.stage === stage.stage);
                  if (idx >= 0) {
                    updated[idx] = {
                      ...updated[idx]!,
                      label: stage.label,
                      status: stage.status as StageStatus["status"],
                      durationMs: stage.durationMs,
                    };
                  }
                  return updated;
                });
              } else if (eventType === "result") {
                const payload = data as unknown as PipelineResponse;
                if (payload.success && payload.data) {
                  setResult(payload.data as PipelineData);
                  setSelectedVariant(0);
                } else {
                  setError((payload.message as string) ?? "Generation failed.");
                }
              } else if (eventType === "error") {
                setError((data.message as string) ?? "Pipeline failed.");
              }
            } catch { /* ignore parse errors in stream */ }
            eventType = "";
          }
        }
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }, [platform, prompt, toneOverride, targetAudience, contentType]);

  const handleRefine = useCallback(async () => {
    if (!result || !refineFeedback.trim()) return;
    const variant = result.variants[selectedVariant];
    if (!variant) return;
    const strategy = result.pipelineStages.strategies[selectedVariant];
    if (!strategy) return;

    setRefining(true);
    try {
      const response = await fetch("/api/marketing-pipeline/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: result.platform,
          variantId: variant.variantId,
          previousMessage: variant.message,
          feedback: refineFeedback.trim(),
          pipelineContext: {
            prompt: prompt.trim(),
            companyContext: "",
            research: result.research,
            strategy: { angle: strategy.angle, keyProof: strategy.keyProof, humanHook: strategy.humanHook, avoidList: strategy.avoidList },
            brandVoice: result.pipelineStages.brandVoice,
          },
        }),
      });
      const payload = (await response.json()) as RefinementResponse;
      if (payload.success && payload.data) {
        setResult((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, variants: [...prev.variants] };
          updated.variants[selectedVariant] = {
            ...updated.variants[selectedVariant]!,
            message: payload.data!.message,
            mediaType: payload.data!.mediaType,
          };
          updated.message = selectedVariant === 0 ? payload.data!.message : updated.message;
          return updated;
        });
        setRefineFeedback("");
      }
    } catch {
      /* silently fail refinement */
    } finally {
      setRefining(false);
    }
  }, [result, refineFeedback, selectedVariant, prompt]);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className={styles.main}>
        <div className={styles.pageHeaderRow}>
          <div className={styles.pageTitleIcon}>
            <Megaphone className={styles.pageTitleIconInner} />
          </div>
          <div>
            <h1 className={styles.pageTitle}>Marketing Pipeline</h1>
            <p className={styles.pageSubtitle}>
              Create campaign-ready posts for Reddit, X, LinkedIn & Bluesky from your company knowledge base
            </p>
          </div>
        </div>

        {!platform ? (
          <section className={styles.mainContent}>
            <section className={styles.platformShell}>
              <h2 className={styles.platformShellTitle}>Choose platform</h2>
              <div className={styles.platformGrid}>
                {PLATFORM_OPTIONS.map((option) => (
                  <button key={option.id} type="button" className={styles.platformCard}
                    onClick={() => { setPlatform(option.id); setError(null); setResult(null); }}>
                    <span className={`${styles.platformLogo} ${logoClassNames[option.id]} ${option.logoImg ? styles.platformLogoImgContainer : ""}`}>
                      {option.logoImg ? <Image src={option.logoImg} alt="" width={64} height={64} className={styles.platformLogoImg} /> : option.logoText}
                    </span>
                    <span className={styles.platformName}>{option.label}</span>
                    <span className={styles.platformSubtitle}>{option.subtitle}</span>
                  </button>
                ))}
              </div>
              {error && <p className={styles.errorInline}>{error}</p>}
            </section>
          </section>
        ) : (
          <section className={styles.mainContent}>
            <section className={styles.workspaceShell}>
              <div className={styles.workspaceLeft}>
                <header className={styles.workspaceLeftHeader}>
                  <div className={styles.selectedPlatformPill}>
                    <span className={`${styles.selectedPlatformLogo} ${selectedPlatform ? logoClassNames[selectedPlatform.id] : ""} ${selectedPlatform?.logoImg ? styles.platformLogoImgContainer : ""}`}>
                      {selectedPlatform?.logoImg ? <Image src={selectedPlatform.logoImg} alt="" width={64} height={64} className={styles.platformLogoImg} /> : selectedPlatform?.logoText}
                    </span>
                    <span className={styles.selectedPlatformLabel}>{selectedPlatform?.label}</span>
                  </div>
                  <button type="button" className={styles.changePlatformButton}
                    onClick={() => { setPlatform(null); setPrompt(""); setResult(null); setError(null); }}>
                    Change platform
                  </button>
                </header>

                <div className={styles.promptCard}>
                  <div className={styles.promptHeaderRow}>
                    <h2 className={styles.promptTitle}>Describe what you want to promote</h2>
                    <span className={styles.promptHint}>1-3 sentences is perfect.</span>
                  </div>
                  <textarea className={styles.textarea} value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Example: Promote our AI-powered document workflow for startup operations teams this month." />

                  {/* Customization controls */}
                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                    <div style={{ flex: "1 1 140px" }}>
                      <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: "0.25rem", marginBottom: "0.25rem" }}>
                        <Mic size={12} /> Tone
                      </label>
                      <select value={toneOverride}
                        onChange={(e) => setToneOverride(e.target.value as FormalityLevel | "")}
                        style={{ width: "100%", padding: "0.4rem 0.5rem", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: "0.8125rem" }}>
                        <option value="">Auto-detect</option>
                        {TONE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </div>
                    <div style={{ flex: "1 1 140px" }}>
                      <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: "0.25rem", marginBottom: "0.25rem" }}>
                        <FileText size={12} /> Content type
                      </label>
                      <select value={contentType}
                        onChange={(e) => setContentType(e.target.value as ContentType)}
                        style={{ width: "100%", padding: "0.4rem 0.5rem", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: "0.8125rem" }}>
                        {CONTENT_TYPE_OPTIONS.map((ct) => <option key={ct.id} value={ct.id}>{ct.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <div style={{ marginTop: "0.5rem" }}>
                    <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: "0.25rem", marginBottom: "0.25rem" }}>
                      <Users size={12} /> Target audience (optional)
                    </label>
                    <input type="text" value={targetAudience}
                      onChange={(e) => setTargetAudience(e.target.value)}
                      placeholder="e.g., CTOs at mid-size SaaS companies"
                      style={{ width: "100%", padding: "0.4rem 0.5rem", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: "0.8125rem" }} />
                  </div>

                  {error && <div className={styles.inlineAlert}><span>{error}</span></div>}
                  <button type="button" className={styles.generateButton}
                    onClick={() => void runPipeline()} disabled={loading}>
                    {loading ? (<><Loader2 size={16} className={styles.spinIcon} /> Generating 3 variants...</>)
                      : (<><Sparkles size={16} /> Generate campaign drafts</>)}
                  </button>
                </div>
              </div>

              <aside className={styles.workspaceRight}>
                <div className={styles.assistantCard}>
                  <header className={styles.assistantHeader}>
                    <MessageSquareText size={18} className={styles.assistantIcon} />
                    <h2 className={styles.assistantTitle}>AI Assistant</h2>
                  </header>

                  {!result && !loading && (
                    <p className={styles.assistantEmptyState}>Enter a prompt and click Generate.</p>
                  )}

                  {loading && pipelineStages.length > 0 && (
                    <PipelineStepper stages={pipelineStages} />
                  )}

                  {result && !loading && (
                    <div className={styles.assistantResult}>
                      {/* Variant tabs */}
                      {result.variants.length > 1 && (
                        <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                          {result.variants.map((v, i) => (
                            <button key={v.variantId} type="button"
                              onClick={() => setSelectedVariant(i)}
                              style={{
                                padding: "0.35rem 0.75rem", borderRadius: "999px", fontSize: "0.75rem", fontWeight: 600,
                                border: selectedVariant === i ? "2px solid #7c3aed" : "1px solid var(--border)",
                                background: selectedVariant === i ? "rgba(124,58,237,0.1)" : "transparent",
                                color: selectedVariant === i ? "#7c3aed" : "var(--foreground)",
                                cursor: "pointer", transition: "all 0.2s",
                              }}>
                              {v.variantId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Selected variant */}
                      {result.variants[selectedVariant] && (
                        <>
                          <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", marginBottom: "0.5rem", fontStyle: "italic", display: "flex", alignItems: "flex-start", gap: "0.25rem" }}>
                            <Lightbulb size={12} style={{ flexShrink: 0, marginTop: "0.125rem" }} />
                            {result.variants[selectedVariant]!.angleRationale}
                          </div>
                          <div className={styles.assistantSectionHeader}>Campaign draft</div>
                          <div className={styles.outputBlock}>
                            {result.variants[selectedVariant]!.message}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", marginTop: "0.25rem" }}>
                            Media: {result.variants[selectedVariant]!.mediaType}
                          </div>
                        </>
                      )}

                      {/* Refinement input (Area 7) */}
                      <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.375rem", alignItems: "flex-end" }}>
                        <input type="text" value={refineFeedback}
                          onChange={(e) => setRefineFeedback(e.target.value)}
                          placeholder="Refine: &quot;make it shorter&quot;, &quot;more data-driven&quot;..."
                          onKeyDown={(e) => { if (e.key === "Enter") void handleRefine(); }}
                          style={{ flex: 1, padding: "0.4rem 0.5rem", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: "0.8125rem" }} />
                        <button type="button" onClick={() => void handleRefine()} disabled={refining || !refineFeedback.trim()}
                          style={{ padding: "0.4rem 0.6rem", borderRadius: "0.5rem", border: "none", background: "#7c3aed", color: "white", cursor: "pointer", opacity: refining || !refineFeedback.trim() ? 0.5 : 1, display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8125rem" }}>
                          {refining ? <Loader2 size={14} className={styles.spinIcon} /> : <Send size={14} />}
                        </button>
                      </div>

                      {/* Pipeline stages (Area 3) */}
                      <CollapsibleSection title="Company DNA" icon={<Target size={14} />}>
                        <div style={{ background: "var(--background)", padding: "0.5rem", borderRadius: "0.5rem" }}>
                          <div><strong>Mission:</strong> {result.pipelineStages.dna.coreMission}</div>
                          <div><strong>Differentiators:</strong> {result.pipelineStages.dna.keyDifferentiators.join(", ")}</div>
                          <div><strong>Proven results:</strong> {result.pipelineStages.dna.provenResults.join(", ") || "None specified"}</div>
                          <div><strong>Human story:</strong> {result.pipelineStages.dna.humanStory}</div>
                          <div><strong>Technical edge:</strong> {result.pipelineStages.dna.technicalEdge}</div>
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title={`Competitors (${result.pipelineStages.competitors.competitors.length})`} icon={<BarChart3 size={14} />}>
                        <div style={{ background: "var(--background)", padding: "0.5rem", borderRadius: "0.5rem" }}>
                          {result.pipelineStages.competitors.competitors.map((c) => (
                            <div key={c.name} style={{ marginBottom: "0.375rem" }}>
                              <strong>{c.name}:</strong> {c.positioning}
                              {c.weaknesses.length > 0 && <div style={{ color: "var(--muted-foreground)", marginLeft: "0.5rem" }}>Weaknesses: {c.weaknesses.join(", ")}</div>}
                            </div>
                          ))}
                          <div><strong>Our advantages:</strong> {result.pipelineStages.competitors.ourAdvantages.join(", ")}</div>
                          <div><strong>Market gaps:</strong> {result.pipelineStages.competitors.marketGaps.join(", ")}</div>
                        </div>
                      </CollapsibleSection>

                      <CollapsibleSection title="Messaging Strategies" icon={<Lightbulb size={14} />}>
                        <div style={{ display: "grid", gap: "0.5rem" }}>
                          {result.pipelineStages.strategies.map((s) => (
                            <div key={s.variantId} style={{ background: "var(--background)", padding: "0.5rem", borderRadius: "0.5rem" }}>
                              <div style={{ fontWeight: 600 }}>{s.variantId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</div>
                              <div style={{ fontStyle: "italic", color: "var(--muted-foreground)", marginBottom: "0.25rem" }}>{s.angleRationale}</div>
                              <div><strong>Angle:</strong> {s.angle}</div>
                              <div><strong>Proof:</strong> {s.keyProof.join("; ")}</div>
                              <div><strong>Hook:</strong> {s.humanHook}</div>
                            </div>
                          ))}
                        </div>
                      </CollapsibleSection>

                      {result.pipelineStages.brandVoice && (
                        <CollapsibleSection title="Brand Voice" icon={<Mic size={14} />}>
                          <div style={{ background: "var(--background)", padding: "0.5rem", borderRadius: "0.5rem" }}>
                            <div><strong>Tone:</strong> {result.pipelineStages.brandVoice.toneDescriptor}</div>
                            <div><strong>Style:</strong> {result.pipelineStages.brandVoice.sentenceStyle}</div>
                            <div><strong>Formality:</strong> {result.pipelineStages.brandVoice.formalityLevel}</div>
                            {result.pipelineStages.brandVoice.vocabularyExamples.length > 0 && (
                              <div><strong>Characteristic phrases:</strong> {result.pipelineStages.brandVoice.vocabularyExamples.join(", ")}</div>
                            )}
                          </div>
                        </CollapsibleSection>
                      )}

                      {result.pipelineStages.targetPersona && (
                        <CollapsibleSection title="Target Persona" icon={<Users size={14} />}>
                          <div style={{ background: "var(--background)", padding: "0.5rem", borderRadius: "0.5rem" }}>
                            <div><strong>Role:</strong> {result.pipelineStages.targetPersona.role}</div>
                            <div><strong>Pain points:</strong> {result.pipelineStages.targetPersona.painPoints.join("; ")}</div>
                            <div><strong>Priorities:</strong> {result.pipelineStages.targetPersona.priorities.join("; ")}</div>
                            <div><strong>Language:</strong> {result.pipelineStages.targetPersona.languageStyle}</div>
                          </div>
                        </CollapsibleSection>
                      )}

                      {result.claimSources && result.claimSources.length > 0 && (
                        <CollapsibleSection title="Claim Sources" icon={<ShieldCheck size={14} />}>
                          <div style={{ display: "grid", gap: "0.375rem" }}>
                            {result.claimSources.map((cs, i) => (
                              <div key={i} style={{ background: "var(--background)", padding: "0.5rem", borderRadius: "0.5rem" }}>
                                <div style={{ fontWeight: 600 }}>&ldquo;{cs.claim}&rdquo;</div>
                                <div style={{ color: cs.confidence > 0.5 ? "#16a34a" : cs.confidence > 0 ? "#ca8a04" : "#dc2626", fontSize: "0.75rem" }}>
                                  {cs.confidence > 0.5 ? "Strongly supported" : cs.confidence > 0 ? "Loosely inferred" : "No direct source"}
                                  {cs.sourceDoc !== "No direct source found" && ` — ${cs.sourceDoc}`}
                                </div>
                                {cs.chunk && <div style={{ color: "var(--muted-foreground)", fontSize: "0.75rem", marginTop: "0.125rem" }}>{cs.chunk.slice(0, 150)}...</div>}
                              </div>
                            ))}
                          </div>
                        </CollapsibleSection>
                      )}

                      {result.pipelineStages.performanceInsights && result.pipelineStages.performanceInsights.length > 0 && (
                        <CollapsibleSection title="Performance Insights" icon={<BarChart3 size={14} />}>
                          <ul style={{ margin: 0, paddingLeft: "1rem" }}>
                            {result.pipelineStages.performanceInsights.map((insight, i) => (
                              <li key={i} style={{ marginBottom: "0.25rem" }}>{insight}</li>
                            ))}
                          </ul>
                        </CollapsibleSection>
                      )}

                      {/* Trend references */}
                      {result.research.length > 0 && (
                        <CollapsibleSection title={`Trend References (${result.research.length})`} icon={<Sparkles size={14} />} defaultOpen>
                          <div className={styles.researchList}>
                            {result.research.map((item) => (
                              <article key={`${item.url}-${item.source}`} className={styles.researchItem}>
                                <div className={styles.researchTitle}>{item.title}</div>
                                <a className={styles.researchLink} href={item.url} target="_blank" rel="noreferrer">{item.url}</a>
                                <p className={styles.researchSnippet}>{item.snippet}</p>
                              </article>
                            ))}
                          </div>
                        </CollapsibleSection>
                      )}
                    </div>
                  )}
                </div>
              </aside>
            </section>
          </section>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  FileText,
  Hash,
  Loader2,
  Megaphone,
  MessageSquareText,
  Pencil,
  Plus,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "~/app/employer/documents/components/ui/sheet";
import { RewriteWorkflow } from "~/app/employer/documents/components/generator/RewriteWorkflow";
import styles from "~/styles/Employer/MarketingPipeline.module.css";
import {
  PIPELINE_STEP_ORDER,
  PLATFORM_OPTIONS,
  REDDIT_SNOO_URL,
  type MessageVariant,
  type PipelineStepState,
  type PlatformFieldConfig,
  type PlatformMeta,
} from "./shared";
import { useMarketingPipelineController } from "./useMarketingPipelineController";

export interface MarketingPipelineWorkspaceProps {
  debug?: boolean;
  showDnaDebugSection?: boolean;
}

function usePlatformLogoClassNames() {
  return useMemo(
    () => ({
      reddit: styles.platformLogoReddit,
      x: styles.platformLogoX,
      linkedin: styles.platformLogoLinkedin,
      bluesky: styles.platformLogoBluesky,
    }),
    [],
  );
}

/* ─── How-it-works explainer (Fix 1) ─── */

function HowItWorks() {
  return (
    <div className={styles.howItWorks}>
      <div className={styles.howItWorksStep}>
        <span className={styles.howItWorksNumber}>1</span>
        <span className={styles.howItWorksText}>Pick a platform</span>
      </div>
      <div className={styles.howItWorksDivider} />
      <div className={styles.howItWorksStep}>
        <span className={styles.howItWorksNumber}>2</span>
        <span className={styles.howItWorksText}>Describe what to promote</span>
      </div>
      <div className={styles.howItWorksDivider} />
      <div className={styles.howItWorksStep}>
        <span className={styles.howItWorksNumber}>3</span>
        <span className={styles.howItWorksText}>Get a campaign-ready draft in ~30s</span>
      </div>
    </div>
  );
}

/* ─── Pipeline stepper with progress fraction (Fix 3) ─── */

function PipelineStepper({
  steps,
  generationStartTime,
}: {
  steps: PipelineStepState[];
  generationStartTime: number | null;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!generationStartTime) return;
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - generationStartTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [generationStartTime]);

  const completedCount = steps.filter((s) => s.status === "completed").length;
  const totalSteps = steps.length;

  return (
    <div className={styles.pipelineStepper}>
      <div className={styles.stepperHeader}>
        <span className={styles.stepperProgress}>
          Step {Math.min(completedCount + 1, totalSteps)} of {totalSteps}
        </span>
        <span className={styles.stepperElapsed}>{elapsed}s elapsed</span>
      </div>
      {steps.map((step) => (
        <div
          key={step.id}
          className={`${styles.stepperItem} ${
            step.status === "completed"
              ? styles.stepperCompleted
              : step.status === "active"
                ? styles.stepperActive
                : styles.stepperPending
          }`}
        >
          <div className={styles.stepperIndicator}>
            {step.status === "completed" ? (
              <Check size={14} />
            ) : step.status === "active" ? (
              <Loader2 size={14} className={styles.spinIcon} />
            ) : (
              <Circle size={10} />
            )}
          </div>
          <div className={styles.stepperContent}>
            <span className={styles.stepperLabel}>{step.label}</span>
            <div className={styles.stepperMeta}>
              {step.status === "completed" && step.durationMs != null && (
                <span className={styles.stepperDuration}>
                  {(step.durationMs / 1000).toFixed(1)}s
                </span>
              )}
              {step.detail && (
                <span className={styles.stepperDetail}>{step.detail}</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Strategy insights card (Fix 6) ─── */

function StrategyInsights({
  strategyUsed,
  competitiveAngle,
}: {
  strategyUsed?: { angle: string; keyProof: string[]; humanHook: string; avoidList: string[] };
  competitiveAngle?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!strategyUsed && !competitiveAngle) return null;

  return (
    <div className={styles.strategyCard}>
      <button
        type="button"
        className={styles.strategyToggle}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Target size={14} />
        <span>Strategy used</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && strategyUsed && (
        <div className={styles.strategyContent}>
          <div className={styles.strategySection}>
            <div className={styles.strategySectionLabel}>Positioning angle</div>
            <p className={styles.strategySectionText}>{strategyUsed.angle}</p>
          </div>
          {strategyUsed.keyProof.length > 0 && (
            <div className={styles.strategySection}>
              <div className={styles.strategySectionLabel}>Key proof points</div>
              <ul className={styles.strategyList}>
                {strategyUsed.keyProof.map((proof, i) => (
                  <li key={i}>{proof}</li>
                ))}
              </ul>
            </div>
          )}
          <div className={styles.strategySection}>
            <div className={styles.strategySectionLabel}>Human hook</div>
            <p className={styles.strategySectionText}>{strategyUsed.humanHook}</p>
          </div>
          {strategyUsed.avoidList.length > 0 && (
            <div className={styles.strategySection}>
              <div className={styles.strategySectionLabel}>What to avoid</div>
              <ul className={styles.strategyList}>
                {strategyUsed.avoidList.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Platform-specific fields (subreddit / hashtags) ─── */

function SubredditField({
  config,
  value,
  onChange,
}: {
  config: PlatformFieldConfig;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value.replace(/^r\//, ""));

  const filtered = config.suggestions.filter((s) =>
    s.toLowerCase().includes(inputValue.toLowerCase()),
  );

  const handleSelect = (subreddit: string) => {
    const normalized = subreddit.startsWith("r/") ? subreddit : `r/${subreddit}`;
    onChange(normalized);
    setInputValue(subreddit.replace(/^r\//, ""));
    setOpen(false);
  };

  return (
    <div className={styles.platformFieldGroup}>
      <label className={styles.platformFieldLabel}>{config.label}</label>
      <div className={styles.subredditInputWrapper}>
        <span className={styles.subredditPrefix}>r/</span>
        <input
          type="text"
          className={styles.subredditInput}
          value={inputValue}
          placeholder="startups"
          onChange={(e) => {
            setInputValue(e.target.value);
            onChange(e.target.value ? `r/${e.target.value}` : "");
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {open && filtered.length > 0 && (
        <div className={styles.subredditDropdown}>
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.subredditOption}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HashtagField({
  config,
  values,
  onChange,
}: {
  config: PlatformFieldConfig;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const atLimit = values.length >= config.maxItems;

  const addTag = (raw: string) => {
    const tag = raw.startsWith("#") ? raw : `#${raw}`;
    const normalized = tag.replace(/\s+/g, "");
    if (!normalized || normalized === "#") return;
    if (values.includes(normalized) || atLimit) return;
    onChange([...values, normalized]);
    setInputValue("");
  };

  const removeTag = (tag: string) => {
    onChange(values.filter((t) => t !== tag));
  };

  const unusedSuggestions = config.suggestions.filter((s) => !values.includes(s));

  return (
    <div className={styles.platformFieldGroup}>
      <label className={styles.platformFieldLabel}>
        {config.label}
        <span className={styles.platformFieldCount}>
          {values.length}/{config.maxItems}
        </span>
      </label>
      <div className={styles.hashtagInputContainer}>
        {values.map((tag) => (
          <span key={tag} className={styles.hashtagTag}>
            {tag}
            <button
              type="button"
              className={styles.hashtagTagRemove}
              onClick={() => removeTag(tag)}
              aria-label={`Remove ${tag}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {!atLimit && (
          <input
            type="text"
            className={styles.hashtagInput}
            value={inputValue}
            placeholder={values.length === 0 ? "Add a hashtag..." : ""}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag(inputValue);
              } else if (e.key === "Backspace" && !inputValue && values.length > 0) {
                removeTag(values[values.length - 1]!);
              }
            }}
          />
        )}
      </div>
      {unusedSuggestions.length > 0 && !atLimit && (
        <div className={styles.hashtagSuggestions}>
          {unusedSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.hashtagSuggestionChip}
              onClick={() => addTag(s)}
            >
              <Hash size={10} />
              {s.replace(/^#/, "")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PlatformFields({
  fields,
  meta,
  onMetaChange,
}: {
  fields: PlatformFieldConfig[];
  meta: PlatformMeta;
  onMetaChange: (next: PlatformMeta) => void;
}) {
  if (!fields.length) return null;

  return (
    <div className={styles.platformFieldsSection}>
      {fields.map((field) => {
        if (field.type === "subreddit") {
          return (
            <SubredditField
              key={field.type}
              config={field}
              value={meta.subreddit ?? ""}
              onChange={(v) => onMetaChange({ ...meta, subreddit: v || undefined })}
            />
          );
        }
        return (
          <HashtagField
            key={field.type}
            config={field}
            values={meta.hashtags ?? []}
            onChange={(v) => onMetaChange({ ...meta, hashtags: v.length ? v : undefined })}
          />
        );
      })}
    </div>
  );
}

/* ─── Stacked rewrite variants ─── */

function VariantStack({
  variants,
  activeVariantId,
  onSelect,
}: {
  variants: MessageVariant[];
  activeVariantId: string | null;
  onSelect: (id: string) => void;
}) {
  if (variants.length < 2) return null;

  return (
    <div className={styles.variantStack}>
      <div className={styles.variantStackHeader}>
        Variants ({variants.length})
      </div>
      {variants.map((v) => {
        const isActive = v.id === activeVariantId;
        return (
          <div
            key={v.id}
            className={`${styles.variantCard} ${isActive ? styles.variantCardActive : ""}`}
          >
            <div className={styles.variantCardHeader}>
              <span className={styles.variantLabel}>{v.label}</span>
              {isActive ? (
                <span className={styles.variantActiveBadge}>
                  <Check size={10} />
                  Active
                </span>
              ) : (
                <button
                  type="button"
                  className={styles.variantUseButton}
                  onClick={() => onSelect(v.id)}
                >
                  Use this
                </button>
              )}
            </div>
            <p className={styles.variantPreview}>
              {v.text.length > 140 ? `${v.text.slice(0, 140)}...` : v.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Main workspace ─── */

export function MarketingPipelineWorkspace({
  debug = false,
  showDnaDebugSection = false,
}: MarketingPipelineWorkspaceProps) {
  const [debugOpen, setDebugOpen] = useState(false);
  const [confirmNewCampaign, setConfirmNewCampaign] = useState(false);
  const logoClassNames = usePlatformLogoClassNames();

  const {
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
    selectedPlatform,
    activeSession,
    handleSelectSession,
    handleStartNewSession,
    handleRewriteComplete,
    handleRewriteWorkflowStateChange,
    handlePushToRewriteDocument,
    handleCopy,
    runPipeline,
    cancelPipeline,
    pipelineSteps,
    generationStartTime,
    platformMeta,
    setPlatformMeta,
    messageVariants,
    activeVariantId,
    selectVariant,
  } = useMarketingPipelineController({ debug });

  const hasSessions = sessions.length > 0;

  const handleNewCampaignClick = () => {
    if (result) {
      setConfirmNewCampaign(true);
    } else {
      handleStartNewSession();
    }
  };

  const confirmAndStartNew = () => {
    setConfirmNewCampaign(false);
    handleStartNewSession();
  };

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <div className={styles.pageTitleIcon}>
          <Megaphone className={styles.pageTitleIconInner} />
        </div>
        <div>
          <h1 className={styles.pageTitle}>Marketing Pipeline</h1>
          <p className={styles.pageSubtitle}>
            Create campaign-ready posts for Reddit, X, LinkedIn & Bluesky from your company
            knowledge base
          </p>
        </div>
      </div>

      {!platform ? (
        <section className={styles.mainContent}>
          <section className={styles.platformShell}>
            <h2 className={styles.platformShellTitle}>Choose platform</h2>
            <HowItWorks />
            <div className={styles.platformGrid}>
              {PLATFORM_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.platformCard}
                  onClick={() => {
                    setPlatform(option.id);
                    setError(null);
                    setResult(null);
                  }}
                >
                  <span
                    className={`${styles.platformLogo} ${logoClassNames[option.id]} ${
                      option.logoImg ? styles.platformLogoImgContainer : ""
                    }`}
                  >
                    {option.logoImg ? (
                      <Image
                        src={option.logoImg}
                        alt=""
                        width={64}
                        height={64}
                        className={styles.platformLogoImg}
                      />
                    ) : (
                      option.logoText
                    )}
                  </span>
                  <span className={styles.platformName}>{option.label}</span>
                  <span className={styles.platformSubtitle}>{option.subtitle}</span>
                  <span className={styles.platformBestFor}>{option.bestFor}</span>
                  <span className={styles.platformCharLimit}>{option.charLimit}</span>
                </button>
              ))}
            </div>
            {error && <p className={styles.errorInline}>{error}</p>}
          </section>
        </section>
      ) : (
        <section className={styles.mainContent}>
          <div className={hasSessions ? styles.workspaceLayout : styles.workspaceLayoutSingle}>
            {/* Fix 5: Only show sidebar when sessions exist */}
            {hasSessions && (
              <aside className={styles.sessionSidebar}>
                <div className={styles.sessionPanel}>
                  <div className={styles.sessionPanelHeader}>
                    <h3 className={styles.sessionPanelTitle}>Sessions</h3>
                    <button type="button" className={styles.newSessionButton} onClick={handleNewCampaignClick}>
                      <Plus size={12} />
                      New
                    </button>
                  </div>
                  <div className={styles.sessionList}>
                    {sessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        className={`${styles.sessionItem} ${
                          activeSessionId === session.id ? styles.sessionItemActive : ""
                        }`}
                        onClick={() => handleSelectSession(session)}
                      >
                        <span className={styles.sessionItemTitle}>
                          {session.prompt
                            ? session.prompt.length > 80
                              ? `${session.prompt.slice(0, 80)}...`
                              : session.prompt
                            : "Untitled session"}
                        </span>
                        <span className={styles.sessionItemMeta}>
                          {session.platform
                            ? PLATFORM_OPTIONS.find((p) => p.id === session.platform)?.label ??
                              session.platform
                            : "No platform"}{" "}
                          &bull; {new Date(session.updatedAt).toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </aside>
            )}

            <section className={styles.workspaceShell}>
              <div className={`${styles.workspaceMain} ${styles.workspaceMainSingle}`}>
                <div className={styles.workspaceMainHeader}>
                  <MessageSquareText size={18} className={styles.assistantIcon} />
                  <h2 className={styles.assistantTitle}>AI Assistant</h2>
                </div>
                <div className={styles.workspaceLeft}>
                  <header className={styles.workspaceLeftHeader}>
                    <div className={styles.selectedPlatformPill}>
                      <span
                        className={`${styles.selectedPlatformLogo} ${
                          selectedPlatform ? logoClassNames[selectedPlatform.id] : ""
                        } ${selectedPlatform?.logoImg ? styles.platformLogoImgContainer : ""}`}
                      >
                        {selectedPlatform?.logoImg ? (
                          <Image
                            src={selectedPlatform.logoImg}
                            alt=""
                            width={64}
                            height={64}
                            className={styles.platformLogoImg}
                          />
                        ) : (
                          selectedPlatform?.logoText
                        )}
                      </span>
                      <span className={styles.selectedPlatformLabel}>{selectedPlatform?.label}</span>
                    </div>
                    {/* Fix 7: Renamed to "New campaign" with confirmation */}
                    <button
                      type="button"
                      className={styles.changePlatformButton}
                      onClick={handleNewCampaignClick}
                    >
                      <Plus size={14} />
                      New campaign
                    </button>
                  </header>

                  {/* Fix 7: Confirmation dialog */}
                  {confirmNewCampaign && (
                    <div className={styles.confirmBar}>
                      <span>Start a new campaign? Your current draft is saved in sessions.</span>
                      <div className={styles.confirmBarActions}>
                        <button type="button" className={styles.confirmBarYes} onClick={confirmAndStartNew}>
                          Yes, start new
                        </button>
                        <button type="button" className={styles.confirmBarNo} onClick={() => setConfirmNewCampaign(false)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <div className={styles.promptCard}>
                    <div className={styles.promptHeaderRow}>
                      <h2 className={styles.promptTitle}>Describe what you want to promote</h2>
                      <span className={styles.promptHint}>1-3 sentences is perfect.</span>
                    </div>
                    <textarea
                      className={styles.textarea}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={selectedPlatform?.placeholder ?? "Example: Promote our AI-powered document workflow for startup operations teams this month."}
                    />

                    {!prompt.trim() && selectedPlatform?.promptTemplates && (
                      <div className={styles.promptChips}>
                        {selectedPlatform.promptTemplates.map((template) => (
                          <button
                            key={template}
                            type="button"
                            className={styles.promptChip}
                            onClick={() => setPrompt(template)}
                          >
                            {template}
                          </button>
                        ))}
                      </div>
                    )}

                    {selectedPlatform?.platformFields && (
                      <PlatformFields
                        fields={selectedPlatform.platformFields}
                        meta={platformMeta}
                        onMetaChange={setPlatformMeta}
                      />
                    )}

                    {error && (
                      <div className={styles.inlineAlert}>
                        <span>{error}</span>
                      </div>
                    )}

                    {/* Fix 3: Cancel button alongside generate */}
                    <div className={styles.generateRow}>
                      <button
                        type="button"
                        className={styles.generateButton}
                        onClick={() => void runPipeline()}
                        disabled={loading}
                      >
                        {loading ? (
                          <>
                            <Loader2 size={16} className={styles.spinIcon} />
                            Generating campaign...
                          </>
                        ) : (
                          <>
                            <Sparkles size={16} />
                            Generate campaign draft
                          </>
                        )}
                      </button>
                      {loading && (
                        <button
                          type="button"
                          className={styles.cancelButton}
                          onClick={cancelPipeline}
                        >
                          <X size={14} />
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                  <div className={styles.assistantContent}>
                    {loading && (
                      <PipelineStepper
                        steps={pipelineSteps}
                        generationStartTime={generationStartTime}
                      />
                    )}

                    {result && !loading && (
                      <div className={styles.assistantResult}>
                        <div className={styles.assistantSectionHeader}>Campaign draft</div>
                        <div className={styles.platformPreviewCard}>
                          <div className={styles.platformPreviewHeader}>
                            <span
                              className={`${styles.platformPreviewBadge} ${
                                result.platform === "reddit"
                                  ? styles.platformPreviewBadgeReddit
                                  : result.platform === "x"
                                    ? styles.platformPreviewBadgeX
                                    : result.platform === "linkedin"
                                      ? styles.platformPreviewBadgeLinkedin
                                      : styles.platformPreviewBadgeBluesky
                              }`}
                            >
                              {result.platform === "reddit" ? (
                                <Image
                                  src={REDDIT_SNOO_URL}
                                  alt=""
                                  width={18}
                                  height={18}
                                  className={styles.platformPreviewBadgeImg}
                                />
                              ) : result.platform === "x" ? (
                                "𝕏"
                              ) : result.platform === "linkedin" ? (
                                "in"
                              ) : (
                                "🦋"
                              )}
                            </span>
                            <span className={styles.platformPreviewLabel}>
                              {PLATFORM_OPTIONS.find((p) => p.id === result.platform)?.label ??
                                result.platform}{" "}
                              preview
                            </span>
                            <button
                              type="button"
                              className={styles.viewModeToggle}
                              onClick={() => setViewMode((m) => (m === "preview" ? "edit" : "preview"))}
                              title={viewMode === "preview" ? "Edit" : "Preview"}
                            >
                              <Pencil size={14} />
                            </button>
                          </div>
                          <div className={styles.platformPreviewBody}>
                            {viewMode === "preview" ? (
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{editableMessage}</ReactMarkdown>
                            ) : (
                              <textarea
                                className={styles.editableMessageTextarea}
                                value={editableMessage}
                                onChange={(e) => setEditableMessage(e.target.value)}
                                placeholder="Your campaign message..."
                              />
                            )}
                          </div>
                        </div>

                        {/* Fix 4: Button hierarchy -- tertiary / secondary / primary */}
                        <div className={styles.draftActions}>
                          <button
                            type="button"
                            className={styles.actionTertiary}
                            onClick={handlePushToRewriteDocument}
                            disabled={!editableMessage.trim()}
                            title="Save this draft to your documents workspace for further editing"
                          >
                            <FileText size={14} />
                            Save as document
                          </button>
                          <button
                            type="button"
                            className={styles.actionSecondary}
                            onClick={() => setShowRewriteSheet((open) => !open)}
                            disabled={!editableMessage.trim()}
                          >
                            <Sparkles size={14} />
                            {showRewriteSheet ? "Hide Rewrite" : "Refine with AI"}
                          </button>
                          <button
                            type="button"
                            className={styles.actionPrimary}
                            onClick={handleCopy}
                            disabled={!editableMessage.trim()}
                          >
                            <Copy size={14} />
                            {copySuccess
                              ? "Copied!"
                              : `Copy to ${PLATFORM_OPTIONS.find((p) => p.id === result.platform)?.label ?? "platform"}`}
                          </button>
                        </div>

                        <Sheet open={showRewriteSheet} onOpenChange={setShowRewriteSheet}>
                          <SheetContent
                            forceMount
                            side="right"
                            className="w-full sm:max-w-2xl overflow-y-auto p-0 flex flex-col"
                          >
                            <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
                              <SheetTitle className="text-lg font-semibold">Refine your campaign</SheetTitle>
                              <p className="text-sm text-muted-foreground">
                                Use tone, length, and audience options to refine the message. Preview and accept
                                when you&apos;re happy.
                              </p>
                            </SheetHeader>
                            <div className="flex-1 overflow-y-auto px-6 py-4">
                              <RewriteWorkflow
                                initialText={editableMessage}
                                persistedState={activeSession?.rewriteWorkflowState}
                                onStateChange={handleRewriteWorkflowStateChange}
                                onComplete={handleRewriteComplete}
                                onCancel={() => setShowRewriteSheet(false)}
                              />
                            </div>
                          </SheetContent>
                        </Sheet>

                        <VariantStack
                          variants={messageVariants}
                          activeVariantId={activeVariantId}
                          onSelect={selectVariant}
                        />

                        <StrategyInsights
                          strategyUsed={result.strategyUsed}
                          competitiveAngle={result.competitiveAngle}
                        />

                        {showDnaDebugSection && result.dnaDebug && (
                          <div
                            style={{
                              marginTop: "1rem",
                              borderTop: "1px solid var(--border-color, #e5e7eb)",
                              paddingTop: "0.75rem",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => setDebugOpen((prev) => !prev)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.375rem",
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                padding: 0,
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                color: "var(--text-muted, #6b7280)",
                              }}
                            >
                              {debugOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              Debug: DNA Source
                              <span
                                style={{
                                  marginLeft: "0.5rem",
                                  padding: "0.125rem 0.5rem",
                                  borderRadius: "9999px",
                                  fontSize: "0.625rem",
                                  fontWeight: 700,
                                  textTransform: "uppercase",
                                  letterSpacing: "0.05em",
                                  background:
                                    result.dnaDebug.source === "metadata" ? "#dcfce7" : "#fef3c7",
                                  color: result.dnaDebug.source === "metadata" ? "#166534" : "#92400e",
                                }}
                              >
                                {result.dnaDebug.source}
                              </span>
                            </button>

                            {debugOpen && (
                              <div style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>
                                <div
                                  style={{
                                    fontWeight: 600,
                                    marginBottom: "0.25rem",
                                    color: "var(--text-muted, #6b7280)",
                                  }}
                                >
                                  CompanyDNA
                                </div>
                                <pre
                                  style={{
                                    background: "var(--bg-secondary, #f9fafb)",
                                    padding: "0.5rem",
                                    borderRadius: "0.375rem",
                                    overflow: "auto",
                                    maxHeight: "12rem",
                                    fontSize: "0.6875rem",
                                    lineHeight: 1.5,
                                  }}
                                >
                                  {JSON.stringify(result.dnaDebug.dna, null, 2)}
                                </pre>

                                <div
                                  style={{
                                    fontWeight: 600,
                                    marginTop: "0.5rem",
                                    marginBottom: "0.25rem",
                                    color: "var(--text-muted, #6b7280)",
                                  }}
                                >
                                  Raw context sent to LLM
                                </div>
                                <pre
                                  style={{
                                    background: "var(--bg-secondary, #f9fafb)",
                                    padding: "0.5rem",
                                    borderRadius: "0.375rem",
                                    overflow: "auto",
                                    maxHeight: "16rem",
                                    fontSize: "0.6875rem",
                                    lineHeight: 1.5,
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {result.dnaDebug.contextUsed}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}

                        <div className={styles.assistantSectionHeader}>Trend references</div>
                        <div className={styles.researchList}>
                          {(result.research ?? []).length > 0 ? (
                            (result.research ?? []).map((item, index) => (
                              <article
                                key={`${item.url}-${item.source}-${index}`}
                                className={styles.researchItem}
                              >
                                <div className={styles.researchTitle}>{item.title}</div>
                                <a
                                  className={styles.researchLink}
                                  href={item.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {item.url}
                                </a>
                                <p className={styles.researchSnippet}>{item.snippet}</p>
                              </article>
                            ))
                          ) : (
                            <p className={styles.sessionEmpty}>
                              No trend references available for this campaign.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>
      )}
    </>
  );
}

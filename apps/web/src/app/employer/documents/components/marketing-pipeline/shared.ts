import type { RewriteWorkflowStateSnapshot } from "~/app/employer/documents/components/generator/RewriteWorkflow";

export type MarketingPlatform = "x" | "linkedin" | "reddit" | "bluesky";

/* ──────────────────────────────────────────────────────────────
 * Pipeline progress types (mirrors backend PipelineStepId)
 * ────────────────────────────────────────────────────────────── */

export type PipelineStepId =
    | "loading-context"
    | "extracting-dna"
    | "analyzing-competitors"
    | "researching-trends"
    | "extracting-voice"
    | "extracting-persona"
    | "checking-performance"
    | "building-strategy"
    | "generating-content"
    | "verifying-claims";

export interface PipelineStepInfo {
    id: PipelineStepId;
    /** The step's name is `growth.marketingPipeline.steps.<key>` in the catalogue. */
    key: PipelineStepKey;
}

export type PipelineStepKey =
    | "loadingContext"
    | "extractingDna"
    | "analyzingCompetitors"
    | "researchingTrends"
    | "extractingVoice"
    | "extractingPersona"
    | "checkingPerformance"
    | "buildingStrategy"
    | "generatingContent"
    | "verifyingClaims";

export const PIPELINE_STEP_ORDER: PipelineStepInfo[] = [
    { id: "loading-context", key: "loadingContext" },
    { id: "extracting-dna", key: "extractingDna" },
    { id: "analyzing-competitors", key: "analyzingCompetitors" },
    { id: "researching-trends", key: "researchingTrends" },
    { id: "extracting-voice", key: "extractingVoice" },
    { id: "extracting-persona", key: "extractingPersona" },
    { id: "checking-performance", key: "checkingPerformance" },
    { id: "building-strategy", key: "buildingStrategy" },
    { id: "generating-content", key: "generatingContent" },
    { id: "verifying-claims", key: "verifyingClaims" },
];

/** A step id's catalogue key. */
export const PIPELINE_STEP_KEY = Object.fromEntries(
    PIPELINE_STEP_ORDER.map(step => [step.id, step.key])
) as Record<PipelineStepId, PipelineStepKey>;

export type StepStatus = "pending" | "active" | "completed" | "skipped" | "failed";

export interface PipelineStepState {
    id: PipelineStepId;
    /** The server's own name for the step (English); the screen says `PIPELINE_STEP_KEY[id]`. */
    label: string;
    status: StepStatus;
    durationMs?: number;
    detail?: string;
    /** Structured intermediate result streamed as the step completes. */
    stepData?: Record<string, unknown>;
    /** Steps sharing the same parallelGroup number ran concurrently. */
    parallelGroup?: number;
}

export type PipelineSSEEvent =
    | { type: "step_start"; step: PipelineStepId; label: string; parallelGroup?: number }
    | {
          type: "step_complete";
          step: PipelineStepId;
          durationMs: number;
          detail?: string;
          status?: "completed" | "skipped" | "failed";
      }
    | { type: "step_data"; step: PipelineStepId; data: Record<string, unknown> }
    | { type: "step_thinking"; step: PipelineStepId; text: string }
    | { type: "result"; success: true; data: PipelineData }
    | { type: "error"; success: false; message: string; error?: string };

export interface ThinkingEntry {
    step: PipelineStepId;
    text: string;
    timestamp: number;
}

export interface DNADebugInfo {
    source: "metadata" | "rag";
    contextUsed: string;
    dna: {
        coreMission: string;
        keyDifferentiators: string[];
        provenResults: string[];
        humanStory: string;
        technicalEdge: string;
    };
}

export interface ContentVariantUI {
    variantId: string;
    angleRationale: string;
    message: string;
    mediaType: "image" | "video";
}

export interface ClaimSourceMatchUI {
    sourceDoc: string;
    excerpt: string;
    /** Retrieval score of the match — relevance, not a truth judgment. */
    relevance: number | null;
}

export interface ClaimSourceUI {
    claim: string;
    /** Best knowledge-base match; null when no source was found. */
    match: ClaimSourceMatchUI | null;
    error?: boolean;
}

export interface StrategyVariantUI {
    variantId: string;
    angleRationale: string;
    angle: string;
    keyProof: string[];
    humanHook: string;
    avoidList: string[];
}

export interface BrandVoiceUI {
    toneDescriptor: string;
    vocabularyExamples: string[];
    sentenceStyle: string;
    formalityLevel: string;
}

export interface TargetPersonaUI {
    role: string;
    painPoints: string[];
    priorities: string[];
    languageStyle: string;
}

export interface PipelineStagesUI {
    dna: DNADebugInfo["dna"];
    competitors: {
        competitors: Array<{ name: string; positioning: string; weaknesses: string[] }>;
        ourAdvantages: string[];
        marketGaps: string[];
        messagingAntiPatterns: string[];
    };
    trends: Array<{ title: string; url: string; snippet: string; source: string }>;
    strategies: StrategyVariantUI[];
    brandVoice?: BrandVoiceUI;
    targetPersona?: TargetPersonaUI;
    performanceInsights?: string[];
    /** Exact knowledge context the generator used (for evaluation). */
    companyContext?: string;
}

/** Mirrors API success payload fields used by the marketing UI. */
export interface PipelineData {
    platform: MarketingPlatform;
    message: string;
    "image/video": "image" | "video";
    normalizedInput?: { platform: MarketingPlatform; prompt: string };
    research: Array<{
        title: string;
        url: string;
        snippet: string;
        source: MarketingPlatform;
    }>;
    dnaDebug?: DNADebugInfo;
    competitiveAngle?: string;
    strategyUsed?: {
        angle: string;
        keyProof: string[];
        humanHook: string;
        avoidList: string[];
    };
    variants?: ContentVariantUI[];
    pipelineStages?: PipelineStagesUI;
    claimSources?: ClaimSourceUI[];
}

export interface PipelineResponse {
    success: boolean;
    message?: string;
    error?: string;
    data?: PipelineData;
}

export type FormalityLevel = "formal" | "conversational" | "technical" | "bold";
export type ContentType = "post" | "thread" | "ad_copy" | "email" | "multi_platform";

export interface MarketingSession {
    id: string;
    createdAt: number;
    updatedAt: number;
    platform: MarketingPlatform | null;
    prompt: string;
    result: PipelineData | null;
    editableMessage: string;
    viewMode: "preview" | "edit";
    rewriteWorkflowState?: Partial<RewriteWorkflowStateSnapshot>;
    platformMeta?: PlatformMeta;
    messageVariants?: MessageVariant[];
    activeVariantId?: string;
    toneOverride?: FormalityLevel;
    targetAudience?: string;
    contentType?: ContentType;
}

export const PENDING_REWRITE_STORAGE_KEY = "pdr.pendingRewriteDraft";
export const MARKETING_SESSIONS_STORAGE_KEY = "pdr.marketingPipeline.sessions";
export const MARKETING_ACTIVE_SESSION_KEY = "pdr.marketingPipeline.activeSessionId";
export const MAX_MARKETING_SESSIONS = 25;

export interface PlatformFieldConfig {
    /** Its label is `growth.marketingPipeline.fields.<type>`. */
    type: "subreddit" | "hashtags";
    maxItems: number;
    suggestions: string[];
}

export interface PlatformMeta {
    subreddit?: string;
    hashtags?: string[];
}

export interface MessageVariant {
    id: string;
    label: string;
    text: string;
    createdAt: number;
}

/**
 * A platform the generator writes for. Its name is a brand and stays as it
 * is; the card's words (subtitle, best for, length, prompt placeholder and
 * the three prompt templates) are `growth.marketingPipeline.platforms.<id>`.
 */
export interface PlatformOption {
    id: MarketingPlatform;
    label: string;
    platformFields?: PlatformFieldConfig[];
}

/** The prompt templates each platform card offers: `platforms.<id>.templates.<key>`. */
export const PROMPT_TEMPLATE_KEYS = ["t1", "t2", "t3"] as const;

export const PLATFORM_OPTIONS: PlatformOption[] = [
    {
        id: "reddit",
        label: "Reddit",
        platformFields: [
            {
                type: "subreddit",
                maxItems: 1,
                suggestions: [
                    "r/startups",
                    "r/SaaS",
                    "r/programming",
                    "r/webdev",
                    "r/Entrepreneur",
                    "r/smallbusiness",
                    "r/artificial",
                ],
            },
        ],
    },
    {
        id: "x",
        label: "Twitter / X",
        platformFields: [
            {
                type: "hashtags",
                maxItems: 2,
                suggestions: ["#AI", "#Tech", "#SaaS", "#Startup", "#DevTools", "#OpenSource"],
            },
        ],
    },
    {
        id: "linkedin",
        label: "LinkedIn",
        platformFields: [
            {
                type: "hashtags",
                maxItems: 5,
                suggestions: [
                    "#AI",
                    "#SaaS",
                    "#Leadership",
                    "#StartupLife",
                    "#TechFounders",
                    "#Innovation",
                    "#Marketing",
                    "#B2B",
                ],
            },
        ],
    },
    {
        id: "bluesky",
        label: "Bluesky",
        platformFields: [
            {
                type: "hashtags",
                maxItems: 3,
                suggestions: ["#OpenWeb", "#Tech", "#AI", "#IndieWeb", "#OpenSource", "#Fediverse"],
            },
        ],
    },
];

/** Strip Markdown to plain text for platforms that don't render it (LinkedIn, X, Bluesky). */
export function markdownToPlainText(text: string): string {
    return text
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/_(.+?)_/g, "$1")
        .replace(/`(.+?)`/g, "$1")
        .trim();
}

/** Convert Markdown to HTML for rich-text paste (LinkedIn composer, etc.). */
export function markdownToHtml(text: string): string {
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return escaped
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/__(.+?)__/g, "<strong>$1</strong>")
        .replace(/_(.+?)_/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br/>");
}

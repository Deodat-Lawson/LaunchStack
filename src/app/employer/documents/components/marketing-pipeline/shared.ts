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
  | "building-strategy"
  | "generating-content";

export interface PipelineStepInfo {
  id: PipelineStepId;
  label: string;
}

export const PIPELINE_STEP_ORDER: PipelineStepInfo[] = [
  { id: "loading-context", label: "Loading company knowledge" },
  { id: "extracting-dna", label: "Extracting company DNA" },
  { id: "analyzing-competitors", label: "Analyzing competitors" },
  { id: "researching-trends", label: "Researching platform trends" },
  { id: "building-strategy", label: "Building messaging strategy" },
  { id: "generating-content", label: "Generating campaign draft" },
];

export type StepStatus = "pending" | "active" | "completed";

export interface PipelineStepState {
  id: PipelineStepId;
  label: string;
  status: StepStatus;
  durationMs?: number;
  detail?: string;
}

export type PipelineSSEEvent =
  | { type: "step_start"; step: PipelineStepId; label: string }
  | { type: "step_complete"; step: PipelineStepId; durationMs: number; detail?: string }
  | { type: "result"; success: true; data: PipelineData }
  | { type: "error"; success: false; message: string; error?: string };

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

/** Mirrors API success payload fields used by the marketing UI. */
export interface PipelineData {
  platform: MarketingPlatform;
  message: string;
  "image/video": "image" | "video";
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
}

export interface PipelineResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: PipelineData;
}

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
}

export const REDDIT_SNOO_URL = "/images/reddit-snoo.png";
export const PENDING_REWRITE_STORAGE_KEY = "pdr.pendingRewriteDraft";
export const MARKETING_SESSIONS_STORAGE_KEY = "pdr.marketingPipeline.sessions";
export const MARKETING_ACTIVE_SESSION_KEY = "pdr.marketingPipeline.activeSessionId";
export const MAX_MARKETING_SESSIONS = 25;

export interface PlatformFieldConfig {
  type: "subreddit" | "hashtags";
  label: string;
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

export interface PlatformOption {
  id: MarketingPlatform;
  label: string;
  subtitle: string;
  bestFor: string;
  charLimit: string;
  logoText: string;
  logoImg?: string;
  placeholder: string;
  promptTemplates: string[];
  platformFields?: PlatformFieldConfig[];
}

export const PLATFORM_OPTIONS: PlatformOption[] = [
  {
    id: "reddit",
    label: "Reddit",
    subtitle: "Community-first threads",
    bestFor: "Developer communities, authentic discussion",
    charLimit: "~10,000 chars",
    logoText: "reddit",
    logoImg: REDDIT_SNOO_URL,
    placeholder: "What do you want to share or discuss with the Reddit community?",
    promptTemplates: [
      "Share how we solved a common pain point in our industry",
      "Ask for feedback on our new open-source tool",
      "Tell the story behind why we built this product",
    ],
    platformFields: [
      {
        type: "subreddit",
        label: "Target subreddit",
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
    subtitle: "Fast-moving trends",
    bestFor: "Viral reach, real-time engagement",
    charLimit: "~280 chars",
    logoText: "𝕏",
    placeholder: "What quick insight or announcement do you want to share?",
    promptTemplates: [
      "Announce a new feature launch with a bold hook",
      "Share a surprising metric or result from our product",
      "React to a trending topic in our industry",
    ],
    platformFields: [
      {
        type: "hashtags",
        label: "Hashtags",
        maxItems: 2,
        suggestions: ["#AI", "#Tech", "#SaaS", "#Startup", "#DevTools", "#OpenSource"],
      },
    ],
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    subtitle: "B2B + thought leadership",
    bestFor: "Professional audience, long-form storytelling",
    charLimit: "~1,300 chars",
    logoText: "in",
    placeholder: "What insight or story do you want to share with your professional network?",
    promptTemplates: [
      "Promote our new feature to CTOs and engineering leaders",
      "Share a customer success story about improving workflows",
      "Thought leadership post about AI in our industry",
    ],
    platformFields: [
      {
        type: "hashtags",
        label: "Hashtags",
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
    subtitle: "Decentralized trends",
    bestFor: "Early adopters, open-web advocates",
    charLimit: "~300 chars",
    logoText: "🦋",
    placeholder: "What do you want to share with the Bluesky community?",
    promptTemplates: [
      "Introduce our product to the open-source community",
      "Share a behind-the-scenes look at what we're building",
      "Start a conversation about a trend in our space",
    ],
    platformFields: [
      {
        type: "hashtags",
        label: "Hashtags",
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
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br/>");
}

import type { ComponentType } from "react";
import {
  IconAudio,
  IconBolt,
  IconBuilding,
  IconChart,
  IconDropbox,
  IconDrive,
  IconFile,
  IconFolder,
  IconGithub,
  IconGlobe,
  IconGmail,
  IconImage,
  IconLink,
  IconMegaphone,
  IconNote,
  IconNotion,
  IconPaste,
  IconPen,
  IconSettings,
  IconShield,
  IconSlack,
  IconSparkle,
  IconUsers,
  IconVideo,
  IconWorkflow,
  IconYoutube,
  type IconProps,
} from "./icons";

export type SourceTypeId =
  | "doc"
  | "audio"
  | "video"
  | "github"
  | "notion"
  | "gmail"
  | "drive"
  | "slack"
  | "dropbox"
  | "web"
  | "youtube"
  | "paste";

export interface SourceMeta {
  label: string;
  Icon: ComponentType<IconProps>;
  color: string;
}

export const SOURCE_META: Record<SourceTypeId, SourceMeta> = {
  doc:     { label: "File",     Icon: IconFile,    color: "oklch(0.55 0.14 250)" },
  audio:   { label: "Audio",    Icon: IconAudio,   color: "oklch(0.6 0.17 30)"   },
  video:   { label: "Video",    Icon: IconVideo,   color: "oklch(0.55 0.17 0)"   },
  github:  { label: "GitHub",   Icon: IconGithub,  color: "oklch(0.35 0.01 280)" },
  notion:  { label: "Notion",   Icon: IconNotion,  color: "oklch(0.35 0.01 280)" },
  gmail:   { label: "Gmail",    Icon: IconGmail,   color: "oklch(0.55 0.18 25)"  },
  drive:   { label: "Drive",    Icon: IconDrive,   color: "oklch(0.6 0.15 140)"  },
  slack:   { label: "Slack",    Icon: IconSlack,   color: "oklch(0.55 0.17 330)" },
  dropbox: { label: "Dropbox",  Icon: IconDropbox, color: "oklch(0.55 0.17 240)" },
  web:     { label: "Website",  Icon: IconGlobe,   color: "oklch(0.55 0.08 200)" },
  youtube: { label: "YouTube",  Icon: IconYoutube, color: "oklch(0.55 0.18 25)"  },
  paste:   { label: "Note",     Icon: IconPaste,   color: "oklch(0.5 0.02 280)"  },
};

export type DocDomain =
  | "Contract"
  | "Financial"
  | "Technical"
  | "Compliance"
  | "Educational"
  | "HR"
  | "Research"
  | "General";

export const DOC_DOMAINS: Record<DocDomain, { color: string; desc: string }> = {
  Contract:    { color: "oklch(0.55 0.18 285)", desc: "Exhibits, schedules, addendums" },
  Financial:   { color: "oklch(0.58 0.15 165)", desc: "Balance sheets, audit reports" },
  Technical:   { color: "oklch(0.55 0.14 225)", desc: "Specs, manuals, diagrams" },
  Compliance:  { color: "oklch(0.6 0.17 50)",   desc: "Regulatory filings, certifications" },
  Educational: { color: "oklch(0.55 0.16 330)", desc: "Syllabi, handouts, readings" },
  HR:          { color: "oklch(0.6 0.15 25)",   desc: "Policies, forms, handbooks" },
  Research:    { color: "oklch(0.55 0.14 270)", desc: "Papers, datasets, sources" },
  General:     { color: "oklch(0.5 0.02 280)",  desc: "Cross-references and attachments" },
};

export interface WorkspaceSource {
  /** Unique within the UI — DB-backed rows prefix with "d", staged locals with "s". */
  id: string;
  /** DB primary key if this source came from the document table. */
  documentId?: number;
  title: string;
  type: SourceTypeId;
  size: string;
  added: string;
  folder: string;
  tags: string[];
  domain: DocDomain;
  gaps?: string[];
  syncing?: boolean;
  /** When true, row is optimistically-rendered and backend hasn't confirmed yet. */
  pending?: boolean;
}

export interface WorkspaceFolder {
  id: string;
  name: string;
  color: string;
}

export interface ThreadReference {
  sourceId: string;
  snippet: string;
}

/**
 * A file attached to a single chat turn — NOT persisted as a Source. Images
 * are shown as thumbnails in the user bubble and streamed as multimodal
 * content to vision models; text attachments are inlined into the prompt.
 */
export interface EphemeralAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  kind: "image" | "text";
}

export interface ThreadMessage {
  role: "user" | "assistant";
  text: string;
  /** Source IDs the user pinned for a user turn, or cited documents for an assistant turn. */
  refs?: string[];
  citations?: ThreadReference[];
  model?: string;
  tokens?: number;
  gapCheck?: { domain: DocDomain; missing: number; conflicts: number };
  /** Files attached to THIS turn only — not added to the Sources library. */
  attachments?: EphemeralAttachment[];
}

/**
 * Full payload a Composer send produces, so per-turn toggles (web search,
 * thinking, attachments, model) can flow to the API without growing the
 * argument list to sendMessage further.
 */
export interface ComposerSend {
  text: string;
  refs: string[];
  attachments: EphemeralAttachment[];
  webSearch: boolean;
  thinking: boolean;
  model: string;
  provider: string;
}

export interface ComposerModelOption {
  /** Wire value — matches AIModelType in @launchstack/core/llm/types. */
  id: string;
  /** Provider the model is routed through. */
  provider: "openai" | "anthropic" | "google" | "ollama";
  /** Display name shown in the dropdown. */
  label: string;
  /** True when the model accepts extended-thinking / reasoning-effort. */
  supportsThinking: boolean;
  /** True when the model accepts image inputs. */
  supportsVision: boolean;
}

/**
 * Canonical list of models surfaced in the composer dropdown. Must stay in
 * sync with ProviderModelMap in @launchstack/core/llm/types; the capability
 * flags mirror THINKING_CAPABLE_MODELS / VISION_CAPABLE_MODELS there.
 */
export const COMPOSER_MODELS: readonly ComposerModelOption[] = [
  // OpenAI
  { id: "gpt-5.2",       provider: "openai",    label: "GPT-5.2",          supportsThinking: true,  supportsVision: true  },
  { id: "gpt-5.1",       provider: "openai",    label: "GPT-5.1",          supportsThinking: true,  supportsVision: true  },
  { id: "gpt-5-mini",    provider: "openai",    label: "GPT-5 Mini",       supportsThinking: true,  supportsVision: true  },
  { id: "gpt-5-nano",    provider: "openai",    label: "GPT-5 Nano",       supportsThinking: true,  supportsVision: true  },
  { id: "gpt-4o",        provider: "openai",    label: "GPT-4o",           supportsThinking: false, supportsVision: true  },
  // Anthropic
  { id: "claude-opus-4.5",   provider: "anthropic", label: "Claude Opus 4.5",     supportsThinking: true,  supportsVision: true  },
  { id: "claude-sonnet-4",   provider: "anthropic", label: "Claude Sonnet 4",     supportsThinking: true,  supportsVision: true  },
  // Google
  { id: "gemini-3-pro",    provider: "google",    label: "Gemini 3 Pro",      supportsThinking: true,  supportsVision: true  },
  { id: "gemini-3-flash",  provider: "google",    label: "Gemini 3 Flash",    supportsThinking: true,  supportsVision: true  },
  { id: "gemini-2.5-flash",provider: "google",    label: "Gemini 2.5 Flash",  supportsThinking: false, supportsVision: true  },
  // Ollama (local)
  { id: "llama3.1:8b",   provider: "ollama",    label: "Llama 3.1 8B",    supportsThinking: false, supportsVision: false },
  { id: "llama3.2:3b",   provider: "ollama",    label: "Llama 3.2 3B",    supportsThinking: false, supportsVision: false },
  { id: "mistral:7b",    provider: "ollama",    label: "Mistral 7B",      supportsThinking: false, supportsVision: false },
  { id: "qwen2.5:7b",    provider: "ollama",    label: "Qwen 2.5 7B",     supportsThinking: false, supportsVision: false },
] as const;

export const DEFAULT_COMPOSER_MODEL: ComposerModelOption = COMPOSER_MODELS.find(
  (m) => m.id === "claude-sonnet-4",
)!;

export function findComposerModel(id: string | undefined): ComposerModelOption {
  return COMPOSER_MODELS.find((m) => m.id === id) ?? DEFAULT_COMPOSER_MODEL;
}

export interface DemotedFeature {
  id: string;
  label: string;
  Icon: ComponentType<IconProps>;
  kbd?: string;
  desc: string;
  href: string;
}

/**
 * The 9 features demoted out of primary chrome into the Studio menu + ⌘K palette.
 * Each links to a real employer route so the feature is "relocated, not deleted".
 */
export const DEMOTED_FEATURES: readonly DemotedFeature[] = [
  { id: "draft",     label: "Draft",             Icon: IconPen,       kbd: "⌘D", desc: "Generate a new document with AI",
    href: "/employer/documents?feature=draft" },
  { id: "rewrite",   label: "Rewrite",           Icon: IconSparkle,   kbd: "⌘R", desc: "Improve existing content",
    href: "/employer/documents?feature=rewrite" },
  { id: "workflows", label: "Workflows",         Icon: IconWorkflow,  kbd: "⌘W", desc: "Automate recurring tasks across your sources",
    href: "/employer/documents?feature=workflows" },
  { id: "notes",     label: "Notebook",          Icon: IconNote,      kbd: "⌘N", desc: "Freeform notes that span every source",
    href: "/employer/documents?feature=notes" },
  { id: "audit",     label: "Predictive gaps",   Icon: IconShield,              desc: "Missing exhibits, schedules, and compliance gaps",
    href: "/employer/documents?feature=audit" },
  { id: "analytics", label: "Analytics",         Icon: IconChart,               desc: "Queries, accuracy, gap trends",
    href: "/employer/statistics" },
  { id: "team",      label: "Workspace",         Icon: IconUsers,               desc: "Invite codes, roles, approvals",
    href: "/employer/employees" },
  { id: "profile",   label: "Company profile",   Icon: IconBuilding,            desc: "AI-extracted company intel",
    href: "/employer/settings" },
  { id: "deploy",    label: "Self-host / BYOK",  Icon: IconBolt,                desc: "Vercel, Docker, your own keys",
    href: "/employer/settings#byok" },
] as const;

/**
 * Studio drawer features grouped by purpose. Tools render interactive panes
 * (or a "coming soon" placeholder if `comingSoon` is true); Management entries
 * link out to their dedicated employer routes.
 */
export interface StudioFeature {
  id: string;
  label: string;
  Icon: ComponentType<IconProps>;
  desc: string;
  /** Destination for link-out features. Required when no interactive pane exists. */
  href?: string;
  /** When true, renders a "coming soon" pane instead of an interactive one. */
  comingSoon?: boolean;
  /** When true, only visible to employer/owner roles — company-level management. */
  companyOnly?: boolean;
}

export interface StudioGroup {
  id: string;
  label: string;
  features: StudioFeature[];
}

export const STUDIO_GROUPS: readonly StudioGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    features: [
      { id: "chat", label: "Chat", Icon: IconBolt, desc: "Ask grounded questions over your sources" },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    features: [
      { id: "draft",       label: "Templated Drafts",    Icon: IconPen,        desc: "Generate new docs from templates tuned to your sources" },
      { id: "rewrite",     label: "Rewrite",             Icon: IconSparkle,    desc: "Improve existing prose with a diff-first rewrite" },
      { id: "notes",       label: "Notebook",            Icon: IconNote,       desc: "Freeform notes that span every source" },
      { id: "workflows",   label: "Workflow Generation", Icon: IconWorkflow,   desc: "Chain source-aware steps across your sources", comingSoon: true },
      { id: "video-gen",   label: "Video Generation",    Icon: IconVideo,      desc: "Generate videos grounded in your knowledge base",     comingSoon: true },
      { id: "image-gen",   label: "Image Generation",    Icon: IconImage,      desc: "Generate images from prompts grounded in your sources", comingSoon: true },
      { id: "audio-gen",   label: "Audio Generation",    Icon: IconAudio,      desc: "Narrate, summarize, or voice-over your content",      comingSoon: true },
      { id: "marketing",   label: "Marketing Pipeline",  Icon: IconMegaphone,  desc: "Multi-channel campaigns from your company knowledge" },
    ],
  },
  {
    id: "management",
    label: "Management",
    features: [
      { id: "metadata",   label: "Company Metadata",  Icon: IconBuilding,   desc: "AI-extracted company profile, industry, people, markets",
        companyOnly: true },
      { id: "settings",   label: "Company Settings",  Icon: IconSettings,   desc: "Embedding model, API keys, workspace preferences",
        companyOnly: true },
      { id: "analytics",  label: "Analytics",         Icon: IconChart,      desc: "Queries, accuracy, gap trends" },
    ],
  },
];

/** Flat lookup of every Studio feature, for routing and deep-link handling. */
export const STUDIO_FEATURES_BY_ID: Record<string, StudioFeature> =
  STUDIO_GROUPS.reduce<Record<string, StudioFeature>>((acc, g) => {
    g.features.forEach((f) => {
      acc[f.id] = f;
    });
    return acc;
  }, {});

/** Add-source modal tabs, grouped Upload / Connect. */
export interface AddSourceTab {
  id: string;
  label: string;
  Icon: ComponentType<IconProps>;
  desc: string;
}

export const ADD_TABS: { group: string; items: AddSourceTab[] }[] = [
  {
    group: "Upload",
    items: [
      { id: "files",   label: "Files",       Icon: IconFile,    desc: "PDF, DOCX, XLSX, images" },
      { id: "folder",  label: "Folder",      Icon: IconFolder,  desc: "Bulk — keeps structure" },
      { id: "audio",   label: "Audio",       Icon: IconAudio,   desc: "MP3, WAV, M4A — transcribed" },
      { id: "video",   label: "Video",       Icon: IconVideo,   desc: "MP4, MOV — transcribed" },
      { id: "paste",   label: "Paste text",  Icon: IconPaste,   desc: "Drop in notes or excerpts" },
      { id: "url",     label: "URL",         Icon: IconLink,    desc: "Crawls the page" },
      { id: "youtube", label: "YouTube",     Icon: IconYoutube, desc: "Pulls the transcript" },
    ],
  },
  {
    group: "Connect",
    items: [
      { id: "gmail",   label: "Gmail",        Icon: IconGmail,   desc: "Sync labeled threads" },
      { id: "notion",  label: "Notion",       Icon: IconNotion,  desc: "Pick pages or databases" },
      { id: "drive",   label: "Google Drive", Icon: IconDrive,   desc: "Folders stay in sync" },
      { id: "slack",   label: "Slack",        Icon: IconSlack,   desc: "Selected channels" },
      { id: "github",  label: "GitHub",       Icon: IconGithub,  desc: "Repos + issues + PRs" },
      { id: "dropbox", label: "Dropbox",      Icon: IconDropbox, desc: "Folders stay in sync" },
    ],
  },
];

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
  IconLink,
  IconNote,
  IconNotion,
  IconPaste,
  IconPen,
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

export interface ThreadMessage {
  role: "user" | "assistant";
  text: string;
  /** Source IDs the user pinned for a user turn, or cited documents for an assistant turn. */
  refs?: string[];
  citations?: ThreadReference[];
  model?: string;
  tokens?: number;
  gapCheck?: { domain: DocDomain; missing: number; conflicts: number };
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
    href: "/employer/documents?view=generator" },
  { id: "rewrite",   label: "Rewrite",           Icon: IconSparkle,   kbd: "⌘R", desc: "Improve existing content",
    href: "/employer/documents?view=rewrite" },
  { id: "workflows", label: "Workflows",         Icon: IconWorkflow,  kbd: "⌘W", desc: "Automate recurring tasks across your sources",
    href: "/employer/documents?view=workflows" },
  { id: "notes",     label: "Notes",             Icon: IconNote,      kbd: "⌘N", desc: "Jot ideas, attached to sources",
    href: "/employer/documents?view=notes" },
  { id: "audit",     label: "Predictive gaps",   Icon: IconShield,              desc: "Missing exhibits, schedules, and compliance gaps",
    href: "/employer/documents?view=predictive-analysis" },
  { id: "analytics", label: "Analytics",         Icon: IconChart,               desc: "Queries, accuracy, gap trends",
    href: "/employer/statistics" },
  { id: "team",      label: "Workspace",         Icon: IconUsers,               desc: "Invite codes, roles, approvals",
    href: "/employer/employees" },
  { id: "profile",   label: "Company profile",   Icon: IconBuilding,            desc: "AI-extracted company intel",
    href: "/employer/settings" },
  { id: "deploy",    label: "Self-host / BYOK",  Icon: IconBolt,                desc: "Vercel, Docker, your own keys",
    href: "/employer/settings#byok" },
] as const;

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

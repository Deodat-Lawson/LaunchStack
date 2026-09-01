import type { ComponentType } from "react";
// New icons come from lucide-react; `./icons` below is the deprecated legacy
// set kept for this file's existing entries (see apps/web/README.md).
import {
    AppWindow as IconArtifact,
    MessagesSquare as IconSessions,
    Network as IconMindmap,
} from "lucide-react";
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
    doc: { label: "File", Icon: IconFile, color: "oklch(0.55 0.14 250)" },
    audio: { label: "Audio", Icon: IconAudio, color: "oklch(0.6 0.17 30)" },
    video: { label: "Video", Icon: IconVideo, color: "oklch(0.55 0.17 0)" },
    github: { label: "GitHub", Icon: IconGithub, color: "oklch(0.35 0.01 280)" },
    notion: { label: "Notion", Icon: IconNotion, color: "oklch(0.35 0.01 280)" },
    gmail: { label: "Gmail", Icon: IconGmail, color: "oklch(0.55 0.18 25)" },
    drive: { label: "Drive", Icon: IconDrive, color: "oklch(0.6 0.15 140)" },
    slack: { label: "Slack", Icon: IconSlack, color: "oklch(0.55 0.17 330)" },
    dropbox: { label: "Dropbox", Icon: IconDropbox, color: "oklch(0.55 0.17 240)" },
    web: { label: "Website", Icon: IconGlobe, color: "oklch(0.55 0.08 200)" },
    youtube: { label: "YouTube", Icon: IconYoutube, color: "oklch(0.55 0.18 25)" },
    paste: { label: "Note", Icon: IconPaste, color: "oklch(0.5 0.02 280)" },
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
    Contract: { color: "oklch(0.55 0.18 285)", desc: "Exhibits, schedules, addendums" },
    Financial: { color: "oklch(0.58 0.15 165)", desc: "Balance sheets, audit reports" },
    Technical: { color: "oklch(0.55 0.14 225)", desc: "Specs, manuals, diagrams" },
    Compliance: { color: "oklch(0.6 0.17 50)", desc: "Regulatory filings, certifications" },
    Educational: { color: "oklch(0.55 0.16 330)", desc: "Syllabi, handouts, readings" },
    HR: { color: "oklch(0.6 0.15 25)", desc: "Policies, forms, handbooks" },
    Research: { color: "oklch(0.55 0.14 270)", desc: "Papers, datasets, sources" },
    General: { color: "oklch(0.5 0.02 280)", desc: "Cross-references and attachments" },
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
    /** Page number (1-based) in the cited document, when the chunk carried one. */
    page?: number;
    /** The retrieval match phrase — a more precise highlight target than the snippet. */
    matchText?: string;
}

/**
 * A "jump to the cited passage" request for the document viewer. `nonce`
 * distinguishes repeat clicks on the same citation so the viewer re-scrolls.
 */
export interface CitationHighlight {
    /** The cited snippet — the primary text to locate and highlight. */
    text: string;
    /** Narrower match phrase to fall back to when the snippet can't be located. */
    matchText?: string;
    /** Page hint for paginated documents (1-based). */
    page?: number | null;
    nonce: number;
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
 * thinking, and attachments) can flow to the API without growing the
 * argument list to sendMessage further.
 */
export interface ComposerSend {
    text: string;
    refs: string[];
    attachments: EphemeralAttachment[];
    webSearch: boolean;
    thinking: boolean;
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
 * Quick links for the ⌘K command palette (draft, rewrite, notebooks, etc.).
 * Each links to a real employer route.
 */
export const DEMOTED_FEATURES: readonly DemotedFeature[] = [
    {
        id: "knowledge",
        label: "Knowledge",
        Icon: IconFolder,
        desc: "Browse and grow everything the workspace can cite",
        href: "/employer/documents?feature=knowledge",
    },
    {
        id: "meetings",
        label: "Meetings",
        Icon: IconUsers,
        desc: "Agents work an objective in a channel you can join",
        href: "/employer/documents?feature=meetings",
    },
    {
        id: "draft",
        label: "Draft",
        Icon: IconPen,
        kbd: "⌘D",
        desc: "Generate a new document with AI",
        href: "/employer/documents?feature=draft",
    },
    {
        id: "rewrite",
        label: "Rewrite",
        Icon: IconSparkle,
        kbd: "⌘R",
        desc: "Improve existing content",
        href: "/employer/documents?feature=rewrite",
    },
    {
        id: "workflows",
        label: "Workflows",
        Icon: IconWorkflow,
        kbd: "⌘W",
        desc: "Automate recurring tasks across your sources",
        href: "/employer/documents?feature=workflows",
    },
    {
        id: "notes",
        label: "Notebook",
        Icon: IconNote,
        kbd: "⌘N",
        desc: "Freeform notes that span every source",
        href: "/employer/documents?feature=notes",
    },
    {
        id: "mindmap",
        label: "Mindmap",
        Icon: IconMindmap,
        desc: "Diagrams, mindmaps and flowcharts you can cite",
        href: "/employer/mindmap",
    },
    {
        id: "artifacts",
        label: "Claude Artifacts",
        Icon: IconArtifact,
        desc: "Pages and diagrams imported from Claude",
        href: "/employer/artifacts",
    },
    {
        id: "agent-sessions",
        label: "Coding sessions",
        Icon: IconSessions,
        desc: "Import Claude Code and Codex conversations",
        href: "/employer/agent-sessions",
    },
    {
        id: "audit",
        label: "Predictive gaps",
        Icon: IconShield,
        desc: "Missing exhibits, schedules, and compliance gaps",
        href: "/employer/documents?feature=audit",
    },
    {
        id: "analytics",
        label: "Analytics",
        Icon: IconChart,
        desc: "Documents, queries, and activity",
        href: "/employer/settings#analytics",
    },
    {
        id: "team",
        label: "Workspace",
        Icon: IconUsers,
        desc: "Invite codes, roles, approvals",
        href: "/employer/employees",
    },
    {
        id: "profile",
        label: "Company profile",
        Icon: IconBuilding,
        desc: "AI-extracted company intel",
        href: "/employer/settings#company",
    },
    {
        id: "agents",
        label: "Agents & nodes",
        Icon: IconUsers,
        desc: "The meeting roster, and the machines that run it",
        href: "/employer/settings#agents",
    },
    {
        id: "deploy",
        label: "Self-host / BYOK",
        Icon: IconBolt,
        desc: "Vercel, Docker, your own keys",
        href: "/employer/settings#byok",
    },
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
    /**
     * The feature is a separate app with its own route. Picking it navigates
     * rather than expanding a pane inside the workspace.
     */
    external?: boolean;
    /** When true, only visible to owner/admin membership roles — company-level management. */
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
            {
                id: "chat",
                label: "Chat",
                Icon: IconBolt,
                desc: "Ask grounded questions over your knowledge",
            },
            {
                id: "knowledge",
                label: "Knowledge",
                Icon: IconFolder,
                desc: "Browse, filter, and grow everything the workspace can cite",
            },
            {
                id: "meetings",
                label: "Meetings",
                Icon: IconUsers,
                desc: "Agents work an objective in a channel — step in whenever you want",
            },
        ],
    },
    {
        id: "tools",
        label: "Tools",
        features: [
            {
                id: "draft",
                label: "Templated Drafts",
                Icon: IconPen,
                desc: "Generate new docs from templates tuned to your sources",
            },
            {
                id: "rewrite",
                label: "Rewrite",
                Icon: IconSparkle,
                desc: "Improve existing prose with a diff-first rewrite",
            },
            {
                id: "notes",
                label: "Notebook",
                Icon: IconNote,
                desc: "Freeform notes that span every source",
            },
            {
                id: "mindmap",
                label: "Mindmap",
                Icon: IconMindmap,
                desc: "Diagrams, mindmaps and flowcharts — publishable as sources",
                href: "/employer/mindmap",
                external: true,
            },
            {
                id: "artifacts",
                label: "Claude Artifacts",
                Icon: IconArtifact,
                desc: "Import pages and diagrams built in Claude, and manage them here",
                href: "/employer/artifacts",
                external: true,
            },
            {
                id: "agent-sessions",
                label: "Coding sessions",
                Icon: IconSessions,
                desc: "Browse Claude Code / Codex sessions on this machine, import them, continue them in chat",
                href: "/employer/agent-sessions",
                external: true,
            },
            {
                id: "workflows",
                label: "Workflow Generation",
                Icon: IconWorkflow,
                desc: "Chain source-aware steps across your sources",
                comingSoon: true,
            },
            {
                id: "video-gen",
                label: "Video Generation",
                Icon: IconVideo,
                desc: "Generate videos grounded in your knowledge base",
                comingSoon: true,
            },
            {
                id: "image-gen",
                label: "Image Generation",
                Icon: IconImage,
                desc: "Generate images from prompts grounded in your sources",
                comingSoon: true,
            },
            {
                id: "audio-gen",
                label: "Audio Generation",
                Icon: IconAudio,
                desc: "Narrate, summarize, or voice-over your content",
                comingSoon: true,
            },
            {
                id: "marketing",
                label: "Marketing Pipeline",
                Icon: IconMegaphone,
                desc: "Multi-channel campaigns from your company knowledge",
            },
        ],
    },
    {
        id: "management",
        label: "Management",
        features: [
            // Processing, agents and nodes, integrations, company profile, and
            // analytics are all sections of one Settings surface — see `SettingsHub`.
            // `metadata` and `analytics` remain as ids so existing deep links open
            // the right section instead of 404ing.
            {
                id: "settings",
                label: "Settings",
                Icon: IconSettings,
                desc: "Processing, agents and nodes, integrations, company profile, analytics",
                companyOnly: true,
            },
        ],
    },
];

/** Flat lookup of every Studio feature, for routing and deep-link handling. */
export const STUDIO_FEATURES_BY_ID: Record<string, StudioFeature> = STUDIO_GROUPS.reduce<
    Record<string, StudioFeature>
>((acc, g) => {
    g.features.forEach(f => {
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
        // Authoring, not ingesting: these open the Mindmap app, and the diagram
        // becomes a citable source once it is published back here.
        group: "Create",
        items: [
            {
                id: "mindmap",
                label: "Mindmap",
                Icon: IconMindmap,
                desc: "Diagram it, then cite it",
            },
        ],
    },
    {
        group: "Upload",
        items: [
            { id: "files", label: "Files", Icon: IconFile, desc: "PDF, DOCX, XLSX, images" },
            { id: "folder", label: "Folder", Icon: IconFolder, desc: "Bulk — keeps structure" },
            { id: "audio", label: "Audio", Icon: IconAudio, desc: "MP3, WAV, M4A — transcribed" },
            { id: "video", label: "Video", Icon: IconVideo, desc: "MP4, MOV — transcribed" },
            {
                id: "paste",
                label: "Paste text",
                Icon: IconPaste,
                desc: "Drop in notes or excerpts",
            },
            { id: "url", label: "URL", Icon: IconLink, desc: "Crawls the page" },
            { id: "youtube", label: "YouTube", Icon: IconYoutube, desc: "Pulls the transcript" },
        ],
    },
    {
        group: "Connect",
        items: [
            { id: "gmail", label: "Gmail", Icon: IconGmail, desc: "Sync labeled threads" },
            { id: "notion", label: "Notion", Icon: IconNotion, desc: "Pick pages or databases" },
            { id: "drive", label: "Google Drive", Icon: IconDrive, desc: "Folders stay in sync" },
            { id: "slack", label: "Slack", Icon: IconSlack, desc: "Selected channels" },
            { id: "github", label: "GitHub", Icon: IconGithub, desc: "Repos + issues + PRs" },
            {
                id: "agent-sessions",
                label: "Coding sessions",
                Icon: IconSessions,
                desc: "Claude Code & Codex transcripts",
            },
            { id: "dropbox", label: "Dropbox", Icon: IconDropbox, desc: "Folders stay in sync" },
        ],
    },
];

import { SHORTCUT_COMMANDS_BY_ID, formatKeys } from "~/lib/shortcuts/commands";
import type { ComponentType } from "react";
import type { Permission } from "~/lib/authz/permissions";
// Icons: lucide-react for glyphs, ~/components/icons/brand for brand marks.
import {
    AppWindow as IconArtifact,
    Bot as IconAgents,
    MessagesSquare as IconSessions,
    Network as IconMindmap,
    AudioLines as IconAudio,
    Zap as IconBolt,
    Building2 as IconBuilding,
    ChartColumn as IconChart,
    File as IconFile,
    Folder as IconFolder,
    Globe as IconGlobe,
    HandCoins as IconInvestors,
    Link as IconLink,
    Megaphone as IconMegaphone,
    ClipboardList as IconPaste,
    Pen as IconPen,
    Settings as IconSettings,
    Shield as IconShield,
    Sparkles as IconSparkle,
    Users as IconUsers,
    Video as IconVideo,
    Workflow as IconWorkflow,
} from "lucide-react";
import {
    IconGoogleDocs,
    IconDropbox,
    IconDrive,
    IconGithub,
    IconGmail,
    IconNotion,
    IconSlack,
    IconYoutube,
} from "~/components/icons/brand";
import { IconGrowth, IconProspects } from "~/components/icons/prospects";
import type { IconProps } from "~/components/icons/types";

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
    | "paste"
    | "mindmap";

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
    mindmap: { label: "Mindmap", Icon: IconMindmap, color: "oklch(0.55 0.2 290)" },
};

/**
 * Whether a source can be cited by the workspace. Uploads are citable once
 * indexed. A mindmap is citable only after it has been published, and a map
 * edited since its last publish is `stale`: the answer would quote an older
 * revision than the one on screen.
 */
export type SourceCitability = "citable" | "stale" | "none";

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
    /**
     * Unique within the UI — DB-backed rows prefix with "d", staged locals
     * with "s", mindmaps with "m". `sourceApi` is the one place that switches
     * on the prefix.
     */
    id: string;
    /**
     * DB primary key if this source came from the document table. For a
     * mindmap this is the *published* document, when there is one — the row
     * the retrieval layer cites — so citations resolve back to the map.
     */
    documentId?: number;
    /** Mindmap primary key, for sources of type `mindmap`. */
    mindmapId?: number;
    /**
     * Extra text the search boxes should match on beyond the title: a
     * mindmap's node labels, so "the map with the Postgres box" is findable.
     */
    searchText?: string;
    /** Image URL for a card preview, when the source has one. */
    thumbnailUrl?: string;
    /** Defaults to `citable` when absent — uploads become citable as they index. */
    citability?: SourceCitability;
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
    /** Limited to people with an explicit grant, not the whole workspace. */
    restricted?: boolean;
}

export interface WorkspaceFolder {
    id: string;
    name: string;
    color: string;
    /** Visible only to people, groups, or roles granted access. */
    restricted?: boolean;
    /** The `category` row behind a persisted folder; null while only implied by its contents. */
    categoryId?: number | null;
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
    /**
     * Total LLM tokens for the turn. Named for what it is: this used to be set
     * from `chunksAnalyzed`, so the UI reported a retrieval count as a token
     * count and always read far too low.
     */
    tokens?: number;
    /** Prompt/completion split, when the endpoint reported one. */
    tokenBreakdown?: { inputTokens: number; outputTokens: number };
    /** Retrieved chunks the answer was grounded in — a different number. */
    chunksAnalyzed?: number;
    gapCheck?: { domain: DocDomain; missing: number; conflicts: number };
    /** Files attached to THIS turn only — not added to the Sources library. */
    attachments?: EphemeralAttachment[];
    /** The agent that answered (assistant) or was addressed (user). */
    agent?: ThreadAgent;
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
    /** The agent this turn is addressed to; null = the workspace's default assistant. */
    agentKey: string | null;
}

/** How the transcript attributes an agent's answer. */
export interface ThreadAgent {
    key: string;
    displayName: string;
    role: string;
    accent: string | null;
    avatarUrl?: string | null;
    /** What the agent's tool policy changed about the turn (web off, etc.). */
    notes?: string[];
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
        id: "agents",
        label: "Agents",
        Icon: IconAgents,
        desc: "The roster: try an agent, edit its instructions, import one",
        href: "/employer/documents?feature=agents",
    },
    {
        id: "draft",
        label: "Draft",
        Icon: IconPen,
        kbd: formatKeys(SHORTCUT_COMMANDS_BY_ID.get("feature.draft")!.defaultKeys),
        desc: "Generate a new document with AI",
        href: "/employer/documents?feature=draft",
    },
    {
        id: "rewrite",
        label: "Rewrite",
        Icon: IconSparkle,
        kbd: formatKeys(SHORTCUT_COMMANDS_BY_ID.get("feature.rewrite")!.defaultKeys),
        desc: "Improve existing content",
        href: "/employer/documents?feature=rewrite",
    },
    {
        id: "workflows",
        label: "Workflows",
        Icon: IconWorkflow,
        kbd: formatKeys(SHORTCUT_COMMANDS_BY_ID.get("feature.workflows")!.defaultKeys),
        desc: "Automate recurring tasks across your sources",
        href: "/employer/documents?feature=workflows",
    },
    {
        id: "mindmap",
        label: "New mindmap",
        Icon: IconMindmap,
        desc: "Diagrams, mindmaps and flowcharts you can cite",
        href: "/employer/documents?add=1&tab=mindmap",
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
        id: "growth",
        label: "Growth",
        Icon: IconGrowth,
        desc: "Brand and Prospects in one app: schedule and publish posts, find the companies that would buy, run the deals",
        href: "/employer/tools/growth",
    },
    {
        id: "brand",
        label: "Brand",
        Icon: IconMegaphone,
        desc: "Compose once for every network, schedule it, see the calendar, generate campaigns from your documents",
        href: "/employer/tools/growth/brand",
    },
    {
        id: "prospects",
        label: "Prospects",
        Icon: IconProspects,
        desc: "Find the companies that would buy what you sell, profile them with evidence, and run the deal",
        href: "/employer/tools/growth/prospects",
    },
    {
        id: "investors",
        label: "Investor relations",
        Icon: IconInvestors,
        desc: "Find venture funds raising now, and draft the pitch from your sources",
        href: "/employer/documents?feature=investors",
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
        desc: "People, roles, invitations, audit",
        href: "/employer/settings#people",
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
     * The feature is a separate app with its own routes and chrome — Growth,
     * for instance, whose rail and nested pages cannot be mounted in a tab.
     * Picking it navigates instead of opening a Studio tab.
     */
    external?: boolean;
    /**
     * Permission a person must hold to see this feature. Checked through
     * `usePermissions().can(...)`, which answers false until loaded — so a
     * gated tile never flashes for someone who may not open it.
     */
    requires?: Permission;
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
            {
                id: "agents",
                label: "Agents",
                Icon: IconAgents,
                desc: "Who your agents are: try them, edit their instructions, import a definition file",
            },
        ],
    },
    {
        id: "tools",
        label: "Tools",
        features: [
            {
                // One app with its own rail for the whole growth motion: Brand
                // (compose, schedule, calendar, campaigns, accounts) and Prospects
                // (segment, companies, people, deals, runs, sources).
                id: "growth",
                label: "Growth",
                Icon: IconGrowth,
                desc: "Make the company known and find the companies that will buy — Brand schedules and publishes across networks, Prospects finds buyers with cited profiles and runs the deals",
                href: "/employer/tools/growth",
                external: true,
            },
            {
                // Second only to Growth: being known, then being funded. Not
                // `external` — the search and the pitch starters are one pane,
                // and "Draft in chat" is a move to the chat tab beside it.
                id: "investors",
                label: "Investor relations",
                Icon: IconInvestors,
                desc: "Find venture funds raising now from their SEC filings, and draft the one-pager, deck and intro emails from your sources",
                href: "/employer/documents?feature=investors",
            },
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
                id: "artifacts",
                label: "Claude Artifacts",
                Icon: IconArtifact,
                desc: "Import pages and diagrams built in Claude, and manage them here",
                // Not `external`: the gallery and viewer are plain client
                // components, so Studio mounts them in a tab. The route stays
                // for direct links and for opening one in a browser tab.
                href: "/employer/artifacts",
            },
            {
                id: "agent-sessions",
                label: "Coding sessions",
                Icon: IconSessions,
                desc: "Browse Claude Code / Codex sessions on this machine, import them, continue them in chat",
                // Not `external`, like Artifacts: continuing a session in chat
                // is a move between two Studio tabs, not a page load.
                href: "/employer/agent-sessions",
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
                desc: "People and access, processing, agents and nodes, integrations, company profile, analytics",
                requires: "settings.manage",
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

/**
 * Panes that are no longer Studio entries but are still reachable by link:
 * `?feature=metadata` from an old bookmark, `?feature=analytics`, which is where
 * `SettingsHub` sends `#analytics`, and `workflows`, which keeps a pane, a
 * palette row and the `feature.workflows` shortcut but no picker tile. Each
 * renders a real pane; a tab needs a label and an icon, so
 * `resolveStudioFeature` has to be able to name them.
 */
const LINK_ONLY_FEATURES: Record<string, StudioFeature> = {
    // A map is a source, not a tool: it is made from Add knowledge (the
    // Mindmap tab, or "New mindmap" in ⌘K) and lives in the library beside
    // every other source. It was also a Studio tile, which made the thing you
    // draw look like an app you run. The editor still opens as a tab, and a
    // tab needs a name and an icon, so it is named here.
    mindmap: {
        id: "mindmap",
        label: "Mindmap",
        Icon: IconMindmap,
        desc: "Diagrams, mindmaps and flowcharts — sources you draw",
        href: "/employer/documents?add=1&tab=mindmap",
    },
    workflows: {
        id: "workflows",
        label: "Workflows",
        Icon: IconWorkflow,
        desc: "Automate recurring tasks across your sources",
    },
    metadata: {
        id: "metadata",
        label: "Company profile",
        Icon: IconBuilding,
        desc: "What the workspace knows about your company",
    },
    analytics: {
        id: "analytics",
        label: "Analytics",
        Icon: IconChart,
        desc: "Documents, queries, and activity",
    },
};

/**
 * The one lookup the workspace shell opens a tab from. Every id it accepts
 * renders a real pane; anything else answers `undefined` and the caller
 * navigates or does nothing rather than opening a tab with no name.
 */
export function resolveStudioFeature(id: string): StudioFeature | undefined {
    return STUDIO_FEATURES_BY_ID[id] ?? LINK_ONLY_FEATURES[id];
}

/** Where a palette entry that is not a Studio app points. */
export function demotedFeatureHref(id: string): string | undefined {
    const href = DEMOTED_FEATURES.find(f => f.id === id)?.href;
    // A `?feature=` href would come straight back here; those ids have no
    // destination beyond this page and are left alone.
    return href?.startsWith("/employer/documents?feature=") ? undefined : href;
}

/** Add-source modal tabs, grouped Upload / Connect. */
export interface AddSourceTab {
    id: string;
    label: string;
    Icon: ComponentType<IconProps>;
    desc: string;
}

export const ADD_TABS: { group: string; items: AddSourceTab[] }[] = [
    {
        // Authoring, not ingesting: these hand the user an editor rather than
        // asking for a file. A mindmap becomes citable once it is published
        // back here; a Google Doc is citable from the moment it is created and
        // re-syncs as it is edited.
        group: "Create",
        items: [
            {
                id: "mindmap",
                label: "Mindmap",
                Icon: IconMindmap,
                desc: "Diagram it, then cite it",
            },
            {
                id: "google-doc",
                label: "Google Doc",
                Icon: IconGoogleDocs,
                desc: "Write it in Google Docs",
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
            { id: "gmail", label: "Gmail", Icon: IconGmail, desc: "Your mailbox, private to you" },
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

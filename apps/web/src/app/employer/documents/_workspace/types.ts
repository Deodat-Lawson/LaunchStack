import { SHORTCUT_COMMANDS_BY_ID, formatKeys } from "~/lib/shortcuts/commands";
import { useMemo, type ComponentType } from "react";
import { useTranslations } from "next-intl";
import type { Permission } from "~/lib/authz/permissions";
import type { ChatPassage } from "~/lib/chat-passages";
import type { ChatCreatedSource, ChatTurnStep } from "~/lib/chat-turns";
import type { SourceProcessingView } from "~/lib/source-progress";
// Icons: lucide-react for glyphs, ~/components/icons/brand for brand marks.
import {
    AppWindow as IconArtifact,
    Bot as IconAgents,
    MessagesSquare as IconSessions,
    Network as IconMindmap,
    AudioLines as IconAudio,
    Zap as IconBolt,
    Briefcase as IconWorkspace,
    Building2 as IconBuilding,
    ChartColumn as IconChart,
    File as IconFile,
    Folder as IconFolder,
    Globe as IconGlobe,
    HandCoins as IconInvestors,
    KeyRound as IconKey,
    Layers as IconProcessing,
    PenLine as IconProposals,
    Link as IconLink,
    Megaphone as IconMegaphone,
    ClipboardList as IconPaste,
    Pen as IconPen,
    Settings as IconSettings,
    Shield as IconShield,
    Sparkles as IconSparkle,
    Users as IconUsers,
    UsersRound as IconTeam,
    Video as IconVideo,
    Waypoints as IconScenarios,
    Workflow as IconWorkflow,
} from "lucide-react";
import {
    IconGoogleDocs,
    IconDropbox,
    IconDrive,
    IconGithub,
    IconGmail,
    IconNotion,
    IconObsidian,
    IconSlack,
    IconYoutube,
} from "~/components/icons/brand";
import { IconGrowth, IconProspects } from "~/components/icons/prospects";
import { IconVantage } from "~/components/icons/vantage";
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
    | "mindmap"
    | "artifact";

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
    artifact: { label: "Claude artifact", Icon: IconArtifact, color: "var(--accent)" },
};

/**
 * Whether a source can be cited by the workspace. Uploads are citable once
 * indexed. A mindmap is citable only after it has been published, and a map
 * edited since its last publish is `stale`: the answer would quote an older
 * revision than the one on screen.
 */
export type SourceCitability = "citable" | "stale" | "none";

/** Indexing state from the document row, including a mindmap's published copy. */
export type SourceIndexStatus = "ready" | "processing" | "failed";

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

/**
 * Who can see an item, from the signed-in person's point of view (ADR-014):
 * everyone in the workspace, specific people, or only them. The Sources rail
 * files every top-level folder and loose file under the section this names.
 */
export type SourceAudience = "workspace" | "shared" | "private";

/** The caller's access to one folder or file, as `/api/folders` and the documents list report it. */
export interface ItemAccessView {
    audience: SourceAudience;
    /** True when the item sets its own audience; false when it inherits its folder's. */
    ownAudience: boolean;
    /** People, groups and roles the governing grants name — "Shared with 3". */
    principalCount: number;
    /** May add to it (a folder), or rename, move, replace or delete it (a file). */
    canEdit: boolean;
    /** May change who has access; for a folder also rename, move or delete it. */
    canManage: boolean;
    /** Files only: may delete it (manages it, or can edit it and holds `documents.delete`). */
    canDelete?: boolean;
    /** Folders only: the restricted folder that governs it, or null. */
    governingPath?: string | null;
}

/** Who added a file — draw with `usePeople` for their current name in this workspace. */
export interface SourceAddedBy {
    authUserId: string;
    name: string;
}

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
    /** Unset for local sources and mindmaps without a published document. */
    indexStatus?: SourceIndexStatus;
    /**
     * The worker's raw processing failure. Never shown as is:
     * `describeSourceFailure` turns it into words, and the raw text sits
     * behind the failure card's Details.
     */
    errorMessage?: string;
    /** Where processing stands, for sources not ready yet: the progress bar, retries, the job id. */
    processing?: SourceProcessingView | null;
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
    /** The caller's access; absent for rows the server has not described (staged uploads, older servers). */
    access?: ItemAccessView;
    /** Who added it, when a person did. */
    addedBy?: SourceAddedBy | null;
}

export interface WorkspaceFolder {
    id: string;
    name: string;
    color: string;
    /** Visible only to people, groups, or roles granted access. */
    restricted?: boolean;
    /** The `category` row behind a persisted folder; null while only implied by its contents. */
    categoryId?: number | null;
    /** The caller's access; absent for a folder only implied by what is in it. */
    access?: ItemAccessView;
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
    forkedFromSessionId?: string;
    /** Someone else's question, carried over by "Continue in a new chat" (auth subject id). */
    askedBy?: string;
    intent?: "queued" | "interrupt";
    id?: string;
    createdAt?: string;
    status?: "streaming" | "complete" | "stopped" | "error";
    stage?: string;
    reasoning?: string;
    elapsedMs?: number;
    /** The answer's work, shown in its thinking trace. */
    steps?: ChatTurnStep[];
    /** Time from the send to the answer's first word ("Thought for 4s"). */
    thoughtMs?: number;
    send?: ComposerSend;
    role: "user" | "assistant";
    text: string;
    /** Source IDs the user pinned for a user turn, or cited documents for an assistant turn. */
    refs?: string[];
    citations?: ThreadReference[];
    /**
     * Reading someone else's chat (ADR-014): citations the server removed
     * because you can't open their source. Never stored.
     */
    hiddenCitations?: number;
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
    /** Web pages the model read, in the [Source N] order its answer cites. */
    webSources?: { title: string; url: string }[];
    /** Documents the answer created in the workspace, listed under it with a way to open them. */
    createdSources?: ChatCreatedSource[];
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
    recallText?: string;
    origin?: "user" | "attachment" | "plan-implementation";
    text: string;
    refs: string[];
    attachments: EphemeralAttachment[];
    webSearch: boolean;
    thinking: boolean;
    /** The agent this turn is addressed to; null = the workspace's default assistant. */
    agentKey: string | null;
    modelRoute?: "default" | "fast" | "reasoning" | "vision";
    reasoningEffort?: string;
    chatMode?: "default" | "plan";
    followUp?: "queue" | "interrupt";
    modelRoutes?: ("default" | "fast" | "reasoning" | "vision")[];
    threadRefs?: string[];
    /** Passages selected in a document and asked about; never pasted into `text`. */
    passages?: ChatPassage[];
}

/** What a document viewer hands over when the reader asks about a selection. */
export interface PassageSelection {
    text: string;
    /** 1-based page, when the viewer knows it (PDFs do). */
    page?: number;
}

export interface QueuedChatMessage {
    id: string;
    send: ComposerSend;
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
    /** Permission the row's action needs; without it the row is left out. */
    requires?: Permission;
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
        id: "processing",
        label: "Processing queue",
        Icon: IconProcessing,
        desc: "Files being read and indexed, stage by stage",
        href: "/employer/documents?feature=processing",
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
        id: "team",
        label: "Team",
        Icon: IconTeam,
        desc: "People, groups, and who did what across the workspace",
        href: "/employer/documents?feature=team",
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
        // Both are ways of adding a source now, not tools of their own: the
        // palette opens Add a source on their tabs.
        id: "artifacts",
        label: "Import a Claude artifact",
        Icon: IconArtifact,
        desc: "Pages, diagrams and components built in Claude, as sources",
        href: "/employer/documents?add=1&tab=artifact",
    },
    {
        id: "agent-sessions",
        label: "Import coding sessions",
        Icon: IconSessions,
        desc: "Claude Code and Codex conversations, as sources",
        href: "/employer/documents?add=1&tab=agent-sessions",
    },
    {
        id: "growth",
        label: "Growth",
        Icon: IconGrowth,
        desc: "Brand and Prospects in one app: schedule and publish posts, find the companies that would buy, run the deals",
        href: "/employer/documents?feature=growth",
    },
    {
        id: "brand",
        label: "Brand",
        Icon: IconMegaphone,
        desc: "Compose once for every network, schedule it, see the calendar, generate campaigns from your documents",
        href: "/employer/documents?feature=growth&at=%2Fbrand",
    },
    {
        id: "prospects",
        label: "Prospects",
        Icon: IconProspects,
        desc: "Find the companies that would buy what you sell, profile them with evidence, and run the deal",
        href: "/employer/documents?feature=growth&at=%2Fprospects",
    },
    {
        id: "vantage",
        label: "Vantage",
        Icon: IconVantage,
        desc: "Prepare next week's meeting from evidence: cited agenda, decisions, commitments checked the week after",
        href: "/employer/documents?feature=vantage",
    },
    {
        id: "scenarios",
        label: "Scenarios",
        Icon: IconScenarios,
        desc: "Simulate how people built from your records react to a situation",
        href: "/employer/documents?feature=scenarios",
    },
    {
        id: "proposals",
        label: "Proposals",
        Icon: IconProposals,
        desc: "Write grant and funding proposals from what your sources prove: find the funders, turn the call into a checklist, draft every answer with citations",
        href: "/employer/documents?feature=proposals",
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
        href: "/employer/documents?feature=analytics",
    },
    // Screens of the Workspace tab. Each id is a `TOOL_ALIASES` entry, which
    // is how picking the row opens the tab on its screen; the href is the
    // same place as a link.
    {
        id: "workspace",
        label: "Workspace",
        Icon: IconWorkspace,
        desc: "Its name and URL, people and access, your own keys, models, agents, integrations and usage",
        href: "/employer/documents?feature=workspace",
    },
    {
        // A screen of the Workspace tab, so "rename" or "colour" finds it.
        id: "workspace-general",
        label: "Rename the workspace",
        Icon: IconWorkspace,
        desc: "Name, URL, description, industry, team size and colour",
        href: "/employer/documents?feature=workspace&at=%2Fgeneral",
        // Everyone may read General; only those who can change it are offered a rename.
        requires: "settings.manage",
    },
    {
        id: "settings",
        label: "Settings",
        Icon: IconSettings,
        desc: "Yours alone: account, appearance, shortcuts and privacy",
        href: "/employer/documents?feature=settings",
    },
    {
        // Not `team`: that is the Team app above, and the palette keys and
        // routes its rows by id.
        id: "people-access",
        label: "People and access",
        Icon: IconUsers,
        desc: "Roles, invitations, join links, audit",
        href: "/employer/documents?feature=workspace&at=%2Fpeople",
    },
    {
        id: "profile",
        label: "Company profile",
        Icon: IconBuilding,
        desc: "AI-extracted company intel",
        href: "/employer/documents?feature=workspace&at=%2Fcompany",
    },
    {
        // Not `agents`: that is the Agents app above, and the palette keys
        // and routes its rows by id.
        id: "agents-nodes",
        label: "Agents & nodes",
        Icon: IconUsers,
        desc: "The meeting roster, and the machines that run it",
        href: "/employer/documents?feature=workspace&at=%2Fagents",
    },
    {
        // The palette also finds a row by its id, so "byok" finds this one.
        id: "byok",
        label: "Bring your own keys",
        Icon: IconKey,
        desc: "Your own API key or OpenRouter account for the workspace's AI",
        href: "/employer/documents?feature=workspace&at=%2Fbyok",
    },
] as const;

/**
 * Studio apps grouped by purpose. Every one of them opens as a tab of the
 * workspace — there is no such thing as a Studio app that is a page of its
 * own. A tool with screens of its own (Growth, Proposals, Vantage) keeps them
 * inside its tab; see `components/tool-app/README.md`.
 */
export interface StudioFeature {
    id: string;
    label: string;
    Icon: ComponentType<IconProps>;
    desc: string;
    /**
     * The link that opens this app's tab — "Open in a new browser tab" uses
     * it. Always `/employer/documents?feature=<id>` (or a deep link into the
     * tab); `registry.test.ts` fails on anything that would leave the page.
     */
    href?: string;
    /** When true, renders a "coming soon" pane instead of an interactive one. */
    comingSoon?: boolean;
    /**
     * Permission a person must hold to see this feature. Checked through
     * `usePermissions().can(...)`, which answers false until loaded — so a
     * gated tile never flashes for someone who may not open it.
     */
    requires?: Permission;
    /**
     * What to tell someone who follows a link to this app (a teammate's
     * link, a shortcut) without its permission. The app does not open for
     * them; this sentence says why instead of leaving them where they were.
     * Unset, nothing is said.
     */
    deniedNote?: string;
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
                // Where each file you add is on its way in: uploading,
                // waiting for a worker, reading the text, splitting,
                // indexing. Opens by itself when you add something.
                id: "processing",
                label: "Processing",
                Icon: IconProcessing,
                desc: "Watch files being read and indexed — what is running, what is waiting, and what needs a retry",
                href: "/employer/documents?feature=processing",
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
            {
                // Who is here and what they have been doing. It was a tab of
                // the sidebar; the sidebar is for making, filing and sharing
                // sources, so the team is a tab of its own like every app.
                id: "team",
                label: "Team",
                Icon: IconTeam,
                desc: "People and what you share with each, groups to share with in one step, and who added, shared or moved what",
                href: "/employer/documents?feature=team",
                requires: "members.view",
                deniedNote:
                    "Your role sees only what is shared with you, so there is no team list. New shares arrive in the bell at the top of the sidebar.",
            },
        ],
    },
    {
        id: "tools",
        label: "Tools",
        features: [
            {
                // The whole growth motion in one tab, with its screens in a
                // rail inside it: Brand (compose, schedule, calendar,
                // campaigns, accounts) and Prospects (segment, companies,
                // people, deals, runs, sources).
                id: "growth",
                label: "Growth",
                Icon: IconGrowth,
                desc: "Make the company known and find the companies that will buy — Brand schedules and publishes across networks, Prospects finds buyers with cited profiles and runs the deals",
                href: "/employer/documents?feature=growth",
            },
            {
                // A writing app: the proposal is the unit of work, and every
                // sentence in it points at a source — which is one tab away.
                id: "proposals",
                label: "Proposals",
                Icon: IconProposals,
                desc: "Write grant and funding proposals from what your sources prove: profile the organisation once, find the funders that fit, turn a call into a checklist, draft every answer with citations, review before you submit",
                href: "/employer/documents?feature=proposals",
            },
            {
                // Second only to Growth: being known, then being funded. The
                // search and the pitch starters are its two screens, and
                // "Draft in chat" is a move to the chat tab beside it.
                id: "investors",
                label: "Investor relations",
                Icon: IconInvestors,
                desc: "Find venture funds raising now from their SEC filings, and draft the one-pager, deck and intro emails from your sources",
                href: "/employer/documents?feature=investors",
            },
            {
                // The weekly loop: evidence in, a cited agenda out, decisions
                // that become commitments checked the week after. Screens of
                // its own inside its tab, like Growth.
                id: "vantage",
                label: "Vantage",
                Icon: IconVantage,
                desc: "Every week: the decisions that matter, an agenda where every claim cites its source, and follow-through on what was agreed — with a triage view for the program",
                href: "/employer/documents?feature=vantage",
            },
            {
                // A simulated social network: people built from the
                // workspace's records react to a situation over several
                // rounds. List, form and runs are screens inside its tab.
                id: "scenarios",
                label: "Scenarios",
                Icon: IconScenarios,
                desc: "Simulate how people built from your records react to a situation — the feed, who changed their mind and why, and a report. Something to think with, not a forecast",
                href: "/employer/documents?feature=scenarios",
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
        ],
    },
    {
        id: "management",
        label: "Management",
        features: [
            // Two kinds of settings, two tabs. Workspace is everything about
            // the workspace, with its screens across the top
            // (`WorkspaceTool`); Settings is yours alone (`SettingsHub`).
            // Every old `/employer/settings#…` link lands on the right one
            // (`~/lib/settings/surfaces`). Analytics is neither: it has its
            // own pane and its own permission.
            //
            // Both ungated: everyone has an account, a theme and shortcuts to
            // set, and may read the workspace's name and policy. Each
            // section carries its own gate (`SETTINGS_SECTION_ACCESS`).
            {
                id: "workspace",
                label: "Workspace",
                Icon: IconWorkspace,
                desc: "The workspace's name and details, its people and access, company profile, your own keys, models, agents, integrations, usage and archive",
                href: "/employer/documents?feature=workspace",
            },
            {
                id: "settings",
                label: "Settings",
                Icon: IconSettings,
                desc: "Your account, appearance, shortcuts and privacy",
            },
            {
                id: "analytics",
                label: "Analytics",
                Icon: IconChart,
                desc: "Documents, queries, and activity across the workspace",
                requires: "analytics.view",
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
 * the mindmap editor, and `workflows`, which keeps a pane, a palette row and
 * the `feature.workflows` shortcut but no picker tile. Each renders a real
 * pane; a tab needs a label and an icon, so `resolveStudioFeature` has to be
 * able to name them. (`?feature=metadata` from an old bookmark is a screen
 * of the Workspace tab now — `TOOL_ALIASES`.)
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

/**
 * Settings is a Studio app, so a link into it opens a tab rather than
 * leaving the workspace — Settings, or the Workspace tab for what moved
 * there (`settingsDestination` decides). Answers the hash a
 * `/employer/settings#…` link carries ("" when it names none), or undefined
 * for a link anywhere else.
 */
export function settingsSectionOf(href: string): string | undefined {
    const url = new URL(href, "http://workspace.invalid");
    if (url.pathname !== "/employer/settings") return undefined;
    return url.hash.replace(/^#/, "");
}

/** Add-source modal tabs, grouped Create / Upload / Connect. */
export interface AddSourceTab {
    id: string;
    label: string;
    Icon: ComponentType<IconProps>;
    desc: string;
}

export const ADD_TABS: { group: string; items: AddSourceTab[] }[] = [
    {
        // Authoring, not ingesting: these hand the user somewhere to write
        // rather than asking for a file. A mindmap becomes citable once it is
        // published back here; a Google Doc is citable from the moment it is
        // created and re-syncs as it is edited; pasted text is a note.
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
            {
                id: "paste",
                label: "Paste text",
                Icon: IconPaste,
                desc: "Drop in notes or excerpts",
            },
        ],
    },
    {
        group: "Upload",
        items: [
            { id: "files", label: "Files", Icon: IconFile, desc: "PDF, DOCX, XLSX, images" },
            { id: "folder", label: "Folder", Icon: IconFolder, desc: "Bulk — keeps structure" },
            {
                id: "audio",
                label: "Audio",
                Icon: IconAudio,
                desc: "MP3, M4A, WAV and more — transcribed",
            },
            { id: "video", label: "Video", Icon: IconVideo, desc: "MP4 — transcribed" },
            { id: "url", label: "URL", Icon: IconLink, desc: "Crawls the page" },
            { id: "youtube", label: "YouTube", Icon: IconYoutube, desc: "Pulls the transcript" },
            {
                // Was the Claude Artifacts tool. An artifact is a source now:
                // listed, searchable, citable, opened in a sandboxed preview.
                id: "artifact",
                label: "Claude artifact",
                Icon: IconArtifact,
                desc: "A page, diagram or component built in Claude",
            },
        ],
    },
    {
        group: "Connect",
        items: [
            { id: "gmail", label: "Gmail", Icon: IconGmail, desc: "Your mailbox, private to you" },
            { id: "notion", label: "Notion", Icon: IconNotion, desc: "Pick pages or databases" },
            {
                id: "obsidian",
                label: "Obsidian",
                Icon: IconObsidian,
                desc: "Import a vault — re-import to update",
            },
            {
                id: "slack",
                label: "Slack",
                Icon: IconSlack,
                desc: "Mirror agent meetings to a channel",
            },
            {
                id: "github",
                label: "GitHub",
                Icon: IconGithub,
                desc: "Private repos for the Repo Explainer",
            },
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

// ---------------------------------------------------------------------------
// The registries above in the reader's language
// ---------------------------------------------------------------------------
//
// The `label` / `desc` fields stay the English source of truth (tests and the
// palette's search read them); what a person reads goes through these, which
// look the same entries up in the catalogue. An id with no message falls
// back to its English field rather than to a key.
//
// Most words are the workspace's own (`workspace.studioApps`, …). The tools
// with screens of their own are named by `tools.registry`, so a tool reads
// the same here as inside its tab; source types are `sources.sourceTypes`,
// shared with the rail.

/** `t` for the `workspace` namespace. */
export type WorkspaceTranslator = ReturnType<typeof useTranslations<"workspace">>;

/** `t` for `tools.registry` — the tools' own names and descriptions. */
export type ToolRegistryTranslator = ReturnType<typeof useTranslations<"tools.registry">>;

/** `t` for `sources.sourceTypes`. */
export type SourceTypeTranslator = ReturnType<typeof useTranslations<"sources.sourceTypes">>;

/** What the Studio lookups below read from: `useStudioText()`. */
export interface StudioText {
    workspace: WorkspaceTranslator;
    tools: ToolRegistryTranslator;
}

/** The translators the Studio lookups take, for the reader's language. */
export function useStudioText(): StudioText {
    const workspace = useTranslations("workspace");
    const tools = useTranslations("tools.registry");
    return useMemo(() => ({ workspace, tools }), [workspace, tools]);
}

/** A source type's name, e.g. "File" / "文件" — `useTranslations("sources.sourceTypes")`. */
export function sourceTypeLabel(t: SourceTypeTranslator, type: SourceTypeId): string {
    return t(type);
}

const STUDIO_GROUP_MESSAGE_KEYS = {
    workspace: "workspace",
    tools: "tools",
    management: "management",
} as const;

/** A Studio group's heading ("Workspace", "Tools", "Management"). */
export function studioGroupLabel(
    text: StudioText,
    group: Pick<StudioGroup, "id" | "label">
): string {
    const key = lookup(STUDIO_GROUP_MESSAGE_KEYS, group.id);
    return key ? text.workspace(`studioGroups.${key}`) : group.label;
}

/** Tools named by `tools.registry` rather than by the workspace. */
const TOOL_REGISTRY_KEYS = {
    growth: "growth",
    proposals: "proposals",
    vantage: "vantage",
    scenarios: "scenarios",
} as const;

const STUDIO_APP_MESSAGE_KEYS = {
    chat: "chat",
    knowledge: "knowledge",
    processing: "processing",
    meetings: "meetings",
    agents: "agents",
    team: "team",
    investors: "investors",
    draft: "draft",
    rewrite: "rewrite",
    workspace: "workspace",
    settings: "settings",
    analytics: "analytics",
    mindmap: "mindmap",
    workflows: "workflows",
} as const;

const STUDIO_DENIED_NOTE_KEYS = { team: "team" } as const;

/** A Studio app's name — a tab's label, a picker tile, a launcher button. */
export function studioFeatureLabel(
    text: StudioText,
    feature: Pick<StudioFeature, "id" | "label">
): string {
    const tool = lookup(TOOL_REGISTRY_KEYS, feature.id);
    if (tool) return text.tools(`${tool}.name`);
    const key = lookup(STUDIO_APP_MESSAGE_KEYS, feature.id);
    return key ? text.workspace(`studioApps.${key}.label`) : feature.label;
}

/** What a Studio app is for — the picker's second line, a tab's tooltip. */
export function studioFeatureDescription(
    text: StudioText,
    feature: Pick<StudioFeature, "id" | "desc">
): string {
    const tool = lookup(TOOL_REGISTRY_KEYS, feature.id);
    if (tool) return text.tools(`${tool}.description`);
    const key = lookup(STUDIO_APP_MESSAGE_KEYS, feature.id);
    return key ? text.workspace(`studioApps.${key}.description`) : feature.desc;
}

/** Why an app did not open for someone without its permission; undefined when it says nothing. */
export function studioFeatureDeniedNote(
    text: StudioText,
    feature: Pick<StudioFeature, "id" | "deniedNote">
): string | undefined {
    if (!feature.deniedNote) return undefined;
    const key = lookup(STUDIO_DENIED_NOTE_KEYS, feature.id);
    return key ? text.workspace(`studioDeniedNotes.${key}`) : feature.deniedNote;
}

/** A Studio feature with its name, description and denied note in the reader's language. */
export function localizedStudioFeature<F extends StudioFeature>(text: StudioText, feature: F): F {
    return {
        ...feature,
        label: studioFeatureLabel(text, feature),
        desc: studioFeatureDescription(text, feature),
        deniedNote: studioFeatureDeniedNote(text, feature),
    };
}

const PALETTE_LINK_LABEL_KEYS = {
    knowledge: "knowledge",
    processing: "processing",
    meetings: "meetings",
    agents: "agents",
    team: "team",
    draft: "draft",
    rewrite: "rewrite",
    workflows: "workflows",
    mindmap: "mindmap",
    artifacts: "artifacts",
    "agent-sessions": "agentSessions",
    brand: "brand",
    prospects: "prospects",
    investors: "investors",
    audit: "audit",
    analytics: "analytics",
    workspace: "workspace",
    "workspace-general": "workspaceGeneral",
    settings: "settings",
    "people-access": "peopleAccess",
    profile: "profile",
    "agents-nodes": "agentsNodes",
    byok: "byok",
} as const;

/** Every palette row has a description of its own — the tools' rows included. */
const PALETTE_LINK_DESCRIPTION_KEYS = {
    ...PALETTE_LINK_LABEL_KEYS,
    growth: "growth",
    proposals: "proposals",
    vantage: "vantage",
    scenarios: "scenarios",
} as const;

/** A ⌘K quick link's name (`DEMOTED_FEATURES`); a tool's row says the tool's own name. */
export function demotedFeatureLabel(
    text: StudioText,
    feature: Pick<DemotedFeature, "id" | "label">
): string {
    const tool = lookup(TOOL_REGISTRY_KEYS, feature.id);
    if (tool) return text.tools(`${tool}.name`);
    const key = lookup(PALETTE_LINK_LABEL_KEYS, feature.id);
    return key ? text.workspace(`paletteLinks.${key}.label`) : feature.label;
}

/** A ⌘K quick link's second line. */
export function demotedFeatureDescription(
    text: StudioText,
    feature: Pick<DemotedFeature, "id" | "desc">
): string {
    const key = lookup(PALETTE_LINK_DESCRIPTION_KEYS, feature.id);
    return key ? text.workspace(`paletteLinks.${key}.description`) : feature.desc;
}

/** The message key an id maps to, or undefined for an id the map does not know. */
function lookup<M extends Record<string, string>>(map: M, id: string): M[keyof M] | undefined {
    return Object.prototype.hasOwnProperty.call(map, id) ? map[id as keyof M] : undefined;
}

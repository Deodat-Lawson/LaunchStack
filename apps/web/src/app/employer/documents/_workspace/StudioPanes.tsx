"use client";

import React, { type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import LoadingPage from "~/app/_components/loading";
import { Button } from "~/components/ui/button";
import type { ToolHost } from "~/components/tool-app/nav";
import { cn } from "~/lib/utils";
import type { KnowledgePaneProps } from "./KnowledgePane";
import type { ProcessingQueuePaneProps } from "./processing/ProcessingQueuePane";
import type { PersonalSectionId } from "./SettingsHub";
import { isStudioPaneId } from "./studioPaneIds";
import type { TeamToolProps } from "./team/TeamTool";
import {
    studioFeatureDescription,
    studioFeatureLabel,
    useStudioText,
    type StudioFeature,
} from "./types";
import { ChevronRight as IconChevronRight } from "lucide-react";

/**
 * Data the workspace shell owns but some panes need. Passed explicitly rather
 * than through context so a pane rendered from the drawer — which has no
 * workspace state — fails visibly instead of silently rendering empty.
 */
export interface StudioPaneContext {
    knowledge?: KnowledgePaneProps;
    /** Maps are created from the Add-source modal; the workspace owns it. */
    mindmap?: { onCreate: () => void };
    /**
     * Agents and Meetings hand off to each other and to the chat: "use in
     * chat" picks the agent in the composer, "put in a meeting" opens the
     * new-meeting dialog. Both are moves between tabs the shell owns.
     */
    agents?: {
        onUseInChat?: (agentKey: string) => void;
        onStartMeeting?: (agentKey: string) => void;
        onOpenAgents?: () => void;
        newMeetingRequest?: { workflowKey?: string | null; seats?: string[]; nonce: number } | null;
        /** A request to select one agent in the Agents app (from the palette). */
        openAgentRequest?: { key: string; nonce: number } | null;
    };
    /**
     * Investor relations drafts in the chat tab and saves a fund list as a
     * source — both moves the shell owns.
     */
    investors?: {
        onDraftInChat: (prompt: string) => void;
        onSaveAsSource: (markdown: string) => void;
    };
    /**
     * The Team tab opens what a row points at (a source tab, a folder in the
     * sidebar, a chat) and the Share dialog — both the shell's.
     */
    team?: Pick<TeamToolProps, "onOpenTarget" | "onShare">;
    /**
     * The Processing queue opens a finished file in its own tab, opens Add a
     * source, and tells the sidebar when a file settles — all the shell's.
     */
    processing?: Omit<ProcessingQueuePaneProps, "host">;
    /**
     * For tools with screens of their own: whether this tab is the focused
     * one, a location to show, where to remember the last one, and how to
     * reach other tabs. See `components/tool-app`.
     */
    tool?: ToolHost;
}

const DraftsTool = dynamic(
    () => import("~/app/employer/documents/components/DraftsTool").then(m => m.DraftsTool),
    { loading: () => <LoadingPage variant="pane" /> }
);

const RewriteTool = dynamic(
    () => import("~/app/employer/documents/components/RewriteTool").then(m => m.RewriteTool),
    { loading: () => <LoadingPage variant="pane" /> }
);

const InvestorsPane = dynamic(
    () => import("./investors/InvestorsPane").then(m => m.InvestorsPane),
    { loading: () => <LoadingPage variant="pane" /> }
);

const TeamTool = dynamic(() => import("./team/TeamTool").then(m => m.TeamTool), {
    loading: () => <LoadingPage variant="pane" />,
});

const ProcessingQueuePane = dynamic(
    () => import("./processing/ProcessingQueuePane").then(m => m.ProcessingQueuePane),
    { loading: () => <LoadingPage variant="pane" /> }
);
const FeedbackTool = dynamic(() => import("./feedback/FeedbackTool").then(m => m.FeedbackTool), {
    loading: () => <LoadingPage variant="pane" />,
});

// Tools with screens of their own. Each is a tab with a rail inside it and
// its own history; none of them is a page you navigate to any more.
const GrowthTool = dynamic(
    () => import("~/app/employer/tools/growth/GrowthTool").then(m => m.GrowthTool),
    { loading: () => <LoadingPage variant="pane" /> }
);

const ProposalsTool = dynamic(
    () => import("~/app/employer/tools/proposals/ProposalsTool").then(m => m.ProposalsTool),
    { loading: () => <LoadingPage variant="pane" /> }
);

const VantageTool = dynamic(
    () => import("~/app/employer/tools/vantage/VantageTool").then(m => m.VantageTool),
    { loading: () => <LoadingPage variant="pane" /> }
);

const ScenariosTool = dynamic(
    () => import("~/app/employer/tools/scenarios/ScenariosTool").then(m => m.ScenariosTool),
    { loading: () => <LoadingPage variant="pane" /> }
);

const SettingsHub = dynamic(() => import("./SettingsHub").then(m => m.SettingsHub), {
    loading: () => <LoadingPage variant="pane" />,
});

// The workspace's own settings, with its screens across the top.
const WorkspaceTool = dynamic(() => import("./WorkspaceTool").then(m => m.WorkspaceTool), {
    loading: () => <LoadingPage variant="pane" />,
});

const StatisticsView = dynamic(
    () => import("~/app/employer/statistics/StatisticsView").then(m => m.StatisticsView),
    { loading: () => <LoadingPage variant="pane" /> }
);

const AgentsPane = dynamic(() => import("./collab/AgentsPane").then(m => m.AgentsPane), {
    loading: () => <LoadingPage variant="pane" />,
});

const MeetingsPane = dynamic(() => import("./collab/MeetingsPane").then(m => m.MeetingsPane), {
    loading: () => <LoadingPage variant="pane" />,
});

const KnowledgePane = dynamic(() => import("./KnowledgePane").then(m => m.KnowledgePane), {
    loading: () => <LoadingPage variant="pane" />,
});

interface PaneProps {
    onClose: () => void;
}

function PaneShell({
    title,
    body,
    children,
    footer,
}: {
    title: string;
    body?: string;
    children: ReactNode;
    footer: ReactNode;
}) {
    return (
        <div className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto px-7 py-6">
                <h2 className="display text-ink m-0 mb-2.5 text-[28px] leading-[1.15] tracking-[-0.02em]">
                    {title}
                </h2>
                {body && (
                    <p className="text-ink-3 mb-[22px] mt-0 max-w-[68ch] text-[13px] leading-[1.6]">
                        {body}
                    </p>
                )}
                {children}
            </div>
            <div className="border-line bg-line-2 flex items-center gap-2 border-t px-6 py-3.5">
                {footer}
            </div>
        </div>
    );
}

function SecondaryLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
    return (
        <Button variant="ghost" size="sm" onClick={onClick} className="text-ink-2">
            {children}
        </Button>
    );
}

/** The accent-dotted list the explainer panes share. */
function BulletList({ items, className }: { items: string[]; className?: string }) {
    if (items.length === 0) return null;
    return (
        <ul className={cn("m-0 flex list-none flex-col gap-2.5 p-0", className)}>
            {items.map(item => (
                <li
                    key={item}
                    className="text-ink-2 flex items-start gap-2.5 text-[13px] leading-[1.55]"
                >
                    <span
                        aria-hidden
                        className="bg-brand mt-[7px] size-[5px] shrink-0 rounded-full"
                    />
                    {item}
                </li>
            ))}
        </ul>
    );
}

function InlineFeatureShell({
    title,
    subtitle,
    children,
}: {
    title: string;
    /** One line shown under title (Studio panes where copy helps orientation). */
    subtitle?: string;
    children: ReactNode;
}) {
    return (
        <div className="flex h-full flex-col">
            <div className="border-line bg-panel shrink-0 border-b px-6 pb-3 pt-3.5">
                <h2 className="display text-ink m-0 text-[22px] leading-[1.15] tracking-[-0.02em]">
                    {title}
                </h2>
                {subtitle ? (
                    <p className="text-ink-3 mb-0 mt-2 max-w-[min(560px,100%)] text-[12.5px] leading-normal">
                        {subtitle}
                    </p>
                ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
    );
}

export function ChatPane(_: PaneProps) {
    const t = useTranslations("workspace.studioPanes.chat");
    return (
        <InlineFeatureShell title={t("title")}>
            <div className="text-ink-2 px-6 py-5 text-[13px] leading-[1.6]">
                <p className="m-0">{t("body")}</p>
                <p className="text-ink-3 mb-0 mt-3 text-xs">
                    {t.rich("hint", { strong: chunks => <strong>{chunks}</strong> })}
                </p>
            </div>
        </InlineFeatureShell>
    );
}

/**
 * Templated Drafts in the shared tool frame: New document, My documents and
 * the Assistant are screens in its rail, and an open draft is a page under
 * My documents.
 */
export function DraftPane({ context }: PaneProps & { context?: StudioPaneContext }) {
    return <DraftsTool host={context?.tool} />;
}

interface ComingSoonPaneProps extends PaneProps {
    title: string;
    body: string;
    bullets: string[];
}

/** Reusable "coming soon" pane for Tools features that aren't shipped yet. */
export function ComingSoonPane({ onClose, title, body, bullets }: ComingSoonPaneProps) {
    const t = useTranslations("workspace.studioPanes");
    const tc = useTranslations("common");
    return (
        <PaneShell
            title={t("comingSoonTitle", { title })}
            body={body}
            footer={
                <>
                    <SecondaryLink onClick={onClose}>{tc("actions.close")}</SecondaryLink>
                    <div className="flex-1" />
                    <Button variant="secondary" disabled>
                        {t("comingSoon")}
                    </Button>
                </>
            }
        >
            <BulletList items={bullets} />
        </PaneShell>
    );
}

/** Rewrite in the shared tool frame: New rewrite and My rewrites in its rail. */
export function RewritePane({ context }: PaneProps & { context?: StudioPaneContext }) {
    return <RewriteTool host={context?.tool} />;
}

export function CompanySettingsPane({
    initialSection,
}: PaneProps & { initialSection?: PersonalSectionId }) {
    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <SettingsHub embedded initialSection={initialSection} />
        </div>
    );
}

/** Analytics reads, never configures, so it lives here beside the other views. */
export function AnalyticsPane(_: PaneProps) {
    return (
        <div style={{ height: "100%", overflowY: "auto" }}>
            <StatisticsView embedded />
        </div>
    );
}

export function MeetingsStudioPane({ context }: PaneProps & { context?: StudioPaneContext }) {
    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <MeetingsPane
                embedded
                onOpenAgents={context?.agents?.onOpenAgents}
                newMeetingRequest={context?.agents?.newMeetingRequest ?? null}
            />
        </div>
    );
}

export function AgentsStudioPane({ context }: PaneProps & { context?: StudioPaneContext }) {
    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <AgentsPane
                onUseInChat={context?.agents?.onUseInChat}
                onStartMeeting={context?.agents?.onStartMeeting}
                selectRequest={context?.agents?.openAgentRequest ?? null}
            />
        </div>
    );
}

/**
 * Knowledge needs the workspace's own source list, so the shell passes it
 * through `renderStudioPane`'s context. Opened from the drawer — where there
 * is no such context — it explains where to find the full surface rather than
 * rendering an empty corpus.
 */
export function KnowledgeStudioPane({
    context,
    onClose,
}: PaneProps & { context?: StudioPaneContext }) {
    const t = useTranslations("workspace.studioPanes.knowledge");
    if (!context?.knowledge) {
        return (
            <InlineFeatureShell title={t("title")}>
                <div className="text-ink-2 px-6 py-5 text-[13px] leading-[1.6]">
                    <p className="m-0">{t("body")}</p>
                    <Button size="sm" className="mt-3.5" onClick={onClose}>
                        {t("open")}
                    </Button>
                </div>
            </InlineFeatureShell>
        );
    }
    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <KnowledgePane {...context.knowledge} />
        </div>
    );
}

export function PredictiveGapsPane({ onClose }: PaneProps) {
    const router = useRouter();
    const t = useTranslations("workspace.studioPanes.predictive");
    return (
        <InlineFeatureShell title={t("title")}>
            <div className="flex flex-col gap-4 px-6 py-5">
                <p className="text-ink-3 m-0 text-[13px] leading-[1.55]">{t("body")}</p>
                <BulletList items={[t("crossReferences"), t("domainAware"), t("findingsLink")]} />
                <Button
                    className="self-start"
                    onClick={() => {
                        router.push("/employer/documents");
                        onClose();
                    }}
                >
                    {t("back")} <IconChevronRight />
                </Button>
            </div>
        </InlineFeatureShell>
    );
}

export function WorkflowsPane({ onClose }: PaneProps) {
    const t = useTranslations("workspace.studioPanes");
    const tc = useTranslations("common");
    return (
        <PaneShell
            title={t("workflows.title")}
            body={t("workflows.body")}
            footer={
                <>
                    <SecondaryLink onClick={onClose}>{tc("actions.close")}</SecondaryLink>
                    <div className="flex-1" />
                    <Button variant="secondary" disabled>
                        {t("comingSoon")}
                    </Button>
                </>
            }
        >
            <BulletList
                items={[t("workflows.scheduled"), t("workflows.composable"), t("workflows.dryRun")]}
            />
        </PaneShell>
    );
}

export function DefaultLinkPane({
    onClose,
    title,
    body,
    bullets,
    href,
    ctaLabel,
}: PaneProps & {
    title: string;
    body: string;
    bullets: string[];
    href: string;
    ctaLabel: string;
}) {
    const router = useRouter();
    const tc = useTranslations("common");
    return (
        <PaneShell
            title={title}
            body={body}
            footer={
                <>
                    <SecondaryLink onClick={onClose}>{tc("actions.cancel")}</SecondaryLink>
                    <div className="flex-1" />
                    <Button
                        onClick={() => {
                            router.push(href);
                            onClose();
                        }}
                    >
                        {ctaLabel} <IconChevronRight />
                    </Button>
                </>
            }
        >
            <BulletList items={bullets} className="mb-[22px]" />
        </PaneShell>
    );
}

/**
 * Mindmaps have no pane of their own: a map is a source, opened from the rail
 * like anything else. This pane exists so the Studio entry still does
 * something useful — start a new one.
 */
function MindmapStudioPane({ context, onClose }: PaneProps & { context?: StudioPaneContext }) {
    const t = useTranslations("workspace");
    if (!context?.mindmap) {
        return (
            <DefaultLinkPane
                onClose={onClose}
                title={t("studioPanes.mindmap.linkTitle")}
                body={t("studioPanes.mindmap.linkBody")}
                bullets={[]}
                href="/employer/documents?add=1&tab=mindmap"
                ctaLabel={t("common.newMindmap")}
            />
        );
    }
    const { onCreate } = context.mindmap;
    return (
        <InlineFeatureShell title={t("studioPanes.mindmap.title")}>
            <div className="text-ink-2 px-6 py-5 text-[13px] leading-[1.6]">
                <p className="m-0">{t("studioPanes.mindmap.body")}</p>
                <Button size="sm" className="mt-3.5" onClick={onCreate}>
                    {t("common.newMindmap")}
                </Button>
            </div>
        </InlineFeatureShell>
    );
}

/**
 * Single-entry pane renderer used by the Studio drawer *and* the main
 * workspace area when a non-chat feature is expanded. `onClose` is the pane's
 * exit path — the drawer passes its own close handler; the main area passes
 * return-to-chat after removing the chrome back control (Studio sidebar Chat handles that too).
 *
 * Every Studio app is drawn here, in its tab. The switch is exhaustive over
 * `STUDIO_PANE_IDS`, so adding an app without a pane fails to compile.
 */
export function renderStudioPane(
    feature: StudioFeature,
    onClose: () => void,
    context?: StudioPaneContext
): React.ReactNode {
    if (feature.comingSoon) return <FeatureComingSoonPane feature={feature} onClose={onClose} />;
    const id = feature.id;
    if (!isStudioPaneId(id)) return <UnknownPane feature={feature} />;
    switch (id) {
        case "chat":
            return <ChatPane onClose={onClose} />;
        case "knowledge":
            return <KnowledgeStudioPane onClose={onClose} context={context} />;
        case "mindmap":
            return <MindmapStudioPane onClose={onClose} context={context} />;
        case "meetings":
            return <MeetingsStudioPane onClose={onClose} context={context} />;
        case "agents":
            return <AgentsStudioPane onClose={onClose} context={context} />;
        case "team":
            return (
                <TeamTool
                    host={context?.tool}
                    onOpenTarget={context?.team?.onOpenTarget}
                    onShare={context?.team?.onShare}
                />
            );
        case "processing":
            return (
                <ProcessingQueuePane
                    host={context?.tool}
                    viewerId={context?.processing?.viewerId ?? null}
                    storageScope={context?.processing?.storageScope}
                    onOpenDocument={context?.processing?.onOpenDocument}
                    onAddSource={context?.processing?.onAddSource}
                    onSettled={context?.processing?.onSettled}
                />
            );
        case "feedback":
            return <FeedbackTool host={context?.tool} />;
        case "draft":
            return <DraftPane onClose={onClose} context={context} />;
        case "rewrite":
            return <RewritePane onClose={onClose} context={context} />;
        case "workflows":
            return <WorkflowsPane onClose={onClose} />;
        case "investors":
            return (
                <InvestorsPane
                    host={context?.tool}
                    onDraftInChat={context?.investors?.onDraftInChat}
                    onSaveAsSource={context?.investors?.onSaveAsSource}
                />
            );
        case "growth":
            return <GrowthTool host={context?.tool} />;
        case "proposals":
            return <ProposalsTool host={context?.tool} />;
        case "vantage":
            return <VantageTool host={context?.tool} />;
        case "scenarios":
            return <ScenariosTool host={context?.tool} />;
        case "analytics":
            return <AnalyticsPane onClose={onClose} />;
        // Yours alone: account, appearance, shortcuts, privacy.
        case "settings":
            return <CompanySettingsPane onClose={onClose} />;
        // Everything about the workspace. `?feature=metadata`, the company
        // profile's old pane, is a place inside it (`TOOL_ALIASES`).
        case "workspace":
            return <WorkspaceTool host={context?.tool} />;
        default: {
            const unhandled: never = id;
            return <UnknownPane feature={{ id: String(unhandled), label: String(unhandled) }} />;
        }
    }
}

/** An app that is listed but not shipped yet, named in the reader's language. */
function FeatureComingSoonPane({
    feature,
    onClose,
}: {
    feature: StudioFeature;
    onClose: () => void;
}) {
    const studio = useStudioText();
    return (
        <ComingSoonPane
            onClose={onClose}
            title={studioFeatureLabel(studio, feature)}
            body={studioFeatureDescription(studio, feature)}
            bullets={[]}
        />
    );
}

/** A tab whose app this build does not have — a layout saved by a newer version, say. */
function UnknownPane({ feature }: { feature: Pick<StudioFeature, "id" | "label"> }) {
    const t = useTranslations("workspace");
    const studio = useStudioText();
    return (
        <div className="text-ink-3 flex h-full items-center justify-center px-6 text-center text-[13px]">
            {t("studioPanes.unknown", { label: studioFeatureLabel(studio, feature) })}
        </div>
    );
}

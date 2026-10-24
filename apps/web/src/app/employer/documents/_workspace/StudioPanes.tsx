"use client";

import React, { type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import LoadingPage from "~/app/_components/loading";
import type { ToolHost } from "~/components/tool-app/nav";
import type { KnowledgePaneProps } from "./KnowledgePane";
import type { SettingsSectionId } from "./SettingsHub";
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
    eyebrow,
    title,
    body,
    children,
    footer,
}: {
    eyebrow: string;
    title: string;
    body?: string;
    children: ReactNode;
    footer: ReactNode;
}) {
    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
                <div
                    className="mono"
                    style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        color: "var(--ink-3)",
                        textTransform: "uppercase",
                        marginBottom: 6,
                    }}
                >
                    {eyebrow}
                </div>
                <h2
                    className="display"
                    style={{
                        fontSize: 28,
                        lineHeight: 1.15,
                        letterSpacing: "-0.02em",
                        color: "var(--ink)",
                        margin: "0 0 10px",
                    }}
                >
                    {title}
                </h2>
                {body && (
                    <div
                        style={{
                            fontSize: 13,
                            lineHeight: 1.6,
                            color: "var(--ink-3)",
                            marginBottom: 22,
                        }}
                    >
                        {body}
                    </div>
                )}
                {children}
            </div>
            <div
                style={{
                    padding: "14px 24px",
                    borderTop: "1px solid var(--line)",
                    background: "var(--line-2)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                }}
            >
                {footer}
            </div>
        </div>
    );
}

function PrimaryCTA({
    onClick,
    children,
    disabled,
}: {
    onClick: () => void;
    children: ReactNode;
    disabled?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 16px",
                borderRadius: 8,
                background: disabled ? "var(--line)" : "var(--accent)",
                color: disabled ? "var(--ink-3)" : "white",
                fontSize: 13,
                fontWeight: 600,
                cursor: disabled ? "not-allowed" : "pointer",
                boxShadow: disabled ? "none" : "0 2px 10px var(--accent-glow)",
            }}
        >
            {children}
        </button>
    );
}

function SecondaryLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
    return (
        <button
            onClick={onClick}
            style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--ink-2)",
            }}
            onMouseEnter={e => {
                e.currentTarget.style.color = "var(--accent)";
            }}
            onMouseLeave={e => {
                e.currentTarget.style.color = "var(--ink-2)";
            }}
        >
            {children}
        </button>
    );
}

function InlineFeatureShell({
    eyebrow,
    title,
    subtitle,
    children,
}: {
    eyebrow: string;
    title: string;
    /** One line shown under title (Studio panes where copy helps orientation). */
    subtitle?: string;
    children: ReactNode;
}) {
    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div
                style={{
                    padding: "14px 24px 12px",
                    borderBottom: "1px solid var(--line)",
                    background: "var(--panel)",
                    flexShrink: 0,
                }}
            >
                <div
                    className="mono"
                    style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        color: "var(--ink-3)",
                        textTransform: "uppercase",
                        marginBottom: 2,
                    }}
                >
                    {eyebrow}
                </div>
                <h2
                    className="display"
                    style={{
                        fontSize: 22,
                        lineHeight: 1.15,
                        letterSpacing: "-0.02em",
                        color: "var(--ink)",
                        margin: 0,
                    }}
                >
                    {title}
                </h2>
                {subtitle ? (
                    <p
                        style={{
                            margin: "8px 0 0",
                            fontSize: 12.5,
                            lineHeight: 1.5,
                            color: "var(--ink-3)",
                            maxWidth: "min(560px, 100%)",
                        }}
                    >
                        {subtitle}
                    </p>
                ) : null}
            </div>
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>{children}</div>
        </div>
    );
}

export function ChatPane(_: PaneProps) {
    const t = useTranslations("workspace.studioPanes.chat");
    return (
        <InlineFeatureShell eyebrow={t("eyebrow")} title={t("title")}>
            <div
                style={{
                    padding: "20px 24px",
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "var(--ink-2)",
                }}
            >
                <p style={{ margin: 0 }}>{t("body")}</p>
                <p style={{ marginTop: 12, color: "var(--ink-3)", fontSize: 12 }}>
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
    eyebrow: string;
    title: string;
    body: string;
    bullets: string[];
}

/** Reusable "coming soon" pane for Tools features that aren't shipped yet. */
export function ComingSoonPane({ onClose, eyebrow, title, body, bullets }: ComingSoonPaneProps) {
    const t = useTranslations("workspace.studioPanes");
    const tc = useTranslations("common");
    return (
        <PaneShell
            eyebrow={eyebrow}
            title={t("comingSoonTitle", { title })}
            body={body}
            footer={
                <>
                    <SecondaryLink onClick={onClose}>{tc("actions.close")}</SecondaryLink>
                    <div style={{ flex: 1 }} />
                    <button
                        disabled
                        style={{
                            fontSize: 13,
                            fontWeight: 600,
                            padding: "9px 16px",
                            borderRadius: 8,
                            background: "var(--line)",
                            color: "var(--ink-3)",
                            cursor: "not-allowed",
                        }}
                    >
                        {t("comingSoon")}
                    </button>
                </>
            }
        >
            <ul
                style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                }}
            >
                {bullets.map(b => (
                    <li
                        key={b}
                        style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "flex-start",
                            fontSize: 13,
                            color: "var(--ink-2)",
                            lineHeight: 1.55,
                        }}
                    >
                        <span
                            style={{
                                marginTop: 7,
                                width: 5,
                                height: 5,
                                borderRadius: "50%",
                                background: "var(--accent)",
                                flexShrink: 0,
                            }}
                        />
                        {b}
                    </li>
                ))}
            </ul>
        </PaneShell>
    );
}

/** Rewrite in the shared tool frame: New rewrite and My rewrites in its rail. */
export function RewritePane({ context }: PaneProps & { context?: StudioPaneContext }) {
    return <RewriteTool host={context?.tool} />;
}

export function CompanySettingsPane({
    initialSection,
}: PaneProps & { initialSection?: SettingsSectionId }) {
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
            <InlineFeatureShell eyebrow={t("eyebrow")} title={t("title")}>
                <div
                    style={{
                        padding: "20px 24px",
                        fontSize: 13,
                        lineHeight: 1.6,
                        color: "var(--ink-2)",
                    }}
                >
                    <p style={{ margin: 0 }}>{t("body")}</p>
                    <button
                        onClick={onClose}
                        style={{
                            marginTop: 14,
                            padding: "8px 14px",
                            borderRadius: 8,
                            background: "var(--accent)",
                            color: "white",
                            fontSize: 12.5,
                            fontWeight: 600,
                        }}
                    >
                        {t("open")}
                    </button>
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
        <InlineFeatureShell eyebrow={t("eyebrow")} title={t("title")}>
            <div
                style={{
                    padding: "20px 24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                }}
            >
                <div
                    style={{
                        fontSize: 13,
                        color: "var(--ink-3)",
                        lineHeight: 1.55,
                    }}
                >
                    {t("body")}
                </div>
                <ul
                    style={{
                        listStyle: "none",
                        margin: 0,
                        padding: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                    }}
                >
                    {[t("crossReferences"), t("domainAware"), t("findingsLink")].map(b => (
                        <li
                            key={b}
                            style={{
                                display: "flex",
                                gap: 10,
                                alignItems: "flex-start",
                                fontSize: 13,
                                color: "var(--ink-2)",
                                lineHeight: 1.55,
                            }}
                        >
                            <span
                                style={{
                                    marginTop: 7,
                                    width: 5,
                                    height: 5,
                                    borderRadius: "50%",
                                    background: "var(--accent)",
                                    flexShrink: 0,
                                }}
                            />
                            {b}
                        </li>
                    ))}
                </ul>
                <button
                    onClick={() => {
                        router.push("/employer/documents");
                        onClose();
                    }}
                    style={{
                        alignSelf: "flex-start",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "9px 16px",
                        borderRadius: 8,
                        background: "var(--accent)",
                        color: "white",
                        fontSize: 13,
                        fontWeight: 600,
                        boxShadow: "0 2px 10px var(--accent-glow)",
                    }}
                >
                    {t("back")} <IconChevronRight size={12} />
                </button>
            </div>
        </InlineFeatureShell>
    );
}

export function WorkflowsPane({ onClose }: PaneProps) {
    const t = useTranslations("workspace.studioPanes");
    const tc = useTranslations("common");
    return (
        <PaneShell
            eyebrow={t("workflows.eyebrow")}
            title={t("workflows.title")}
            body={t("workflows.body")}
            footer={
                <>
                    <SecondaryLink onClick={onClose}>{tc("actions.close")}</SecondaryLink>
                    <div style={{ flex: 1 }} />
                    <button
                        disabled
                        style={{
                            fontSize: 13,
                            fontWeight: 600,
                            padding: "9px 16px",
                            borderRadius: 8,
                            background: "var(--line)",
                            color: "var(--ink-3)",
                            cursor: "not-allowed",
                        }}
                    >
                        {t("comingSoon")}
                    </button>
                </>
            }
        >
            <ul
                style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                }}
            >
                {[t("workflows.scheduled"), t("workflows.composable"), t("workflows.dryRun")].map(
                    b => (
                        <li
                            key={b}
                            style={{
                                display: "flex",
                                gap: 10,
                                alignItems: "flex-start",
                                fontSize: 13,
                                color: "var(--ink-2)",
                                lineHeight: 1.55,
                            }}
                        >
                            <span
                                style={{
                                    marginTop: 7,
                                    width: 5,
                                    height: 5,
                                    borderRadius: "50%",
                                    background: "var(--accent)",
                                    flexShrink: 0,
                                }}
                            />
                            {b}
                        </li>
                    )
                )}
            </ul>
        </PaneShell>
    );
}

export function DefaultLinkPane({
    onClose,
    eyebrow,
    title,
    body,
    bullets,
    href,
    ctaLabel,
}: PaneProps & {
    eyebrow: string;
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
            eyebrow={eyebrow}
            title={title}
            body={body}
            footer={
                <>
                    <SecondaryLink onClick={onClose}>{tc("actions.cancel")}</SecondaryLink>
                    <div style={{ flex: 1 }} />
                    <PrimaryCTA
                        onClick={() => {
                            router.push(href);
                            onClose();
                        }}
                    >
                        {ctaLabel} <IconChevronRight size={12} />
                    </PrimaryCTA>
                </>
            }
        >
            <ul
                style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    marginBottom: 22,
                }}
            >
                {bullets.map(b => (
                    <li
                        key={b}
                        style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "flex-start",
                            fontSize: 13,
                            color: "var(--ink-2)",
                            lineHeight: 1.55,
                        }}
                    >
                        <span
                            style={{
                                marginTop: 7,
                                width: 5,
                                height: 5,
                                borderRadius: "50%",
                                background: "var(--accent)",
                                flexShrink: 0,
                            }}
                        />
                        {b}
                    </li>
                ))}
            </ul>
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
                eyebrow={t("studioPanes.studioEyebrow")}
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
        <InlineFeatureShell
            eyebrow={t("studioPanes.mindmap.eyebrow")}
            title={t("studioPanes.mindmap.title")}
        >
            <div
                style={{
                    padding: "20px 24px",
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "var(--ink-2)",
                }}
            >
                <p style={{ margin: 0 }}>{t("studioPanes.mindmap.body")}</p>
                <button
                    onClick={onCreate}
                    style={{
                        marginTop: 14,
                        padding: "8px 14px",
                        borderRadius: 8,
                        background: "var(--accent)",
                        color: "white",
                        fontSize: 12.5,
                        fontWeight: 600,
                    }}
                >
                    {t("common.newMindmap")}
                </button>
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
        // Company metadata is a section of Settings now. Its id survives so old
        // deep links open the right section rather than 404ing.
        case "metadata":
            return <CompanySettingsPane onClose={onClose} initialSection="company" />;
        case "analytics":
            return <AnalyticsPane onClose={onClose} />;
        case "settings":
            return <CompanySettingsPane onClose={onClose} />;
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
    const t = useTranslations("workspace");
    const studio = useStudioText();
    return (
        <ComingSoonPane
            onClose={onClose}
            eyebrow={t("studioPanes.studioEyebrow")}
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

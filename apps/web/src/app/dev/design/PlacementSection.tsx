"use client";

import {
    Bell,
    CalendarClock,
    ChevronLeft,
    ChevronRight,
    Command,
    MessageSquare,
    MoreHorizontal,
    Plus,
    Search,
    X,
} from "lucide-react";
import type { ReactNode } from "react";

import { ToolMark } from "~/components/tool-app/ToolFrame";
import { cn } from "~/lib/utils";

import { Code, DocSection, RefTable, SubSection } from "./parts";

/** A numbered pin on the map, matching the numbered list under it. */
function Pin({ n, className }: { n: number; className?: string }) {
    return (
        <span
            aria-hidden
            className={cn(
                "bg-brand text-brand-fg inline-flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold",
                className
            )}
        >
            {n}
        </span>
    );
}

function Bar({ className }: { className?: string }) {
    return <span aria-hidden className={cn("bg-line block h-2 rounded-full", className)} />;
}

/**
 * A drawing of the signed-in workspace — not the real shell, which needs a
 * session — so each surface can be pointed at and named.
 */
function WorkspaceMap() {
    return (
        <div
            role="img"
            aria-label="The workspace: sidebar on the left; on the right a pane with a tab strip, a tool's ToolFrame bar and its screen."
            className="border-line bg-surface @max-md:grid-cols-1 grid grid-cols-[210px_minmax(0,1fr)] overflow-hidden rounded-lg border text-[12px]"
        >
            {/* Sidebar */}
            <div className="border-line bg-surface-2 @max-md:hidden flex flex-col gap-2 border-r p-3">
                <div className="flex items-center gap-2">
                    <span className="bg-brand size-4 rounded-sm" />
                    <span className="text-ink font-semibold">Acme</span>
                    <span className="ml-auto flex items-center gap-1">
                        <Pin n={7} />
                        <Bell className="text-ink-3 size-3.5" />
                    </span>
                </div>
                <div className="border-line bg-panel text-ink-3 flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1">
                    <Search className="size-3 shrink-0" />{" "}
                    <span className="truncate">Jump to…</span>
                    <span className="ml-auto flex items-center gap-1">
                        <Command className="size-3" />K <Pin n={8} />
                    </span>
                </div>
                <div className="text-ink-2 flex items-center gap-1.5 px-1">
                    <Plus className="size-3" /> Add knowledge
                </div>
                <div className="flex items-center gap-1">
                    <span className="bg-brand-soft text-brand-ink rounded-sm px-1.5 py-0.5 font-medium">
                        Sources
                    </span>
                    <span className="text-ink-3 px-1.5">History</span>
                    <Pin n={1} className="ml-auto" />
                </div>
                <div className="flex flex-col gap-1.5 px-1 py-1">
                    <Bar className="w-3/4" />
                    <Bar className="ml-3 w-1/2" />
                    <Bar className="ml-3 w-2/3" />
                    <Bar className="w-1/2" />
                    <Bar className="ml-3 w-3/5" />
                </div>
                <div className="border-line mt-auto flex items-center gap-2 border-t pt-2">
                    <span className="bg-panel-2 border-line size-5 rounded-full border" />
                    <span className="text-ink-2">Account</span>
                    <Pin n={6} className="ml-auto" />
                </div>
            </div>

            {/* A pane holding a tool's tab */}
            <div className="flex min-w-0 flex-col">
                <div className="border-line bg-surface-2 flex items-end gap-1 border-b px-2 pt-1.5">
                    <span className="text-ink-3 flex items-center gap-1.5 rounded-t-md px-2.5 py-1">
                        <MessageSquare className="size-3" /> Chat
                    </span>
                    <span className="border-line bg-surface text-ink flex items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1 font-medium">
                        <CalendarClock className="size-3" /> Renewals{" "}
                        <X className="text-ink-4 size-3" />
                    </span>
                    <Pin n={2} className="mb-1 ml-auto" />
                </div>
                <div className="border-line bg-panel flex items-center gap-2 border-b px-3 py-2">
                    <ChevronLeft className="text-ink-3 size-3.5" />
                    <ChevronRight className="text-ink-4 size-3.5" />
                    <ToolMark icon={CalendarClock} className="size-4" />
                    <span className="text-ink font-semibold">Renewals</span>
                    <span className="bg-brand-soft text-brand-ink ml-2 rounded-sm px-1.5 py-0.5">
                        Overview
                    </span>
                    <span className="text-ink-3 px-1">Contracts</span>
                    <span className="text-ink-3 @max-lg:hidden px-1">New renewal</span>
                    <Pin n={3} />
                    <span className="ml-auto flex items-center gap-1">
                        <MoreHorizontal className="text-ink-3 size-3.5" />
                    </span>
                </div>
                <div className="relative flex flex-col gap-3 px-6 py-5">
                    <div className="flex items-start gap-2">
                        <div className="flex-1">
                            <div className="display text-ink text-[18px] leading-tight">
                                Renewals <em className="text-brand-ink not-italic">this quarter</em>
                            </div>
                            <Bar className="mt-2 w-48" />
                        </div>
                        <span className="bg-brand text-brand-fg rounded-md px-2 py-1 font-medium">
                            New renewal
                        </span>
                        <Pin n={4} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        {[0, 1, 2].map(i => (
                            <div
                                key={i}
                                className="border-line bg-panel rounded-md border px-2 py-2"
                            >
                                <Bar className="w-2/3" />
                                <Bar className="bg-ink-4/50 mt-2 h-3 w-1/3" />
                            </div>
                        ))}
                    </div>
                    <div className="border-line bg-panel rounded-md border">
                        {[0, 1, 2].map(i => (
                            <div
                                key={i}
                                className="border-line-2 flex items-center gap-2 border-t px-3 py-2 first:border-t-0"
                            >
                                <Bar className="w-1/3" />
                                <span className="ml-auto">
                                    <Bar className="bg-warn-soft w-12" />
                                </span>
                            </div>
                        ))}
                    </div>
                    {/* A sheet, scoped to this tab */}
                    <div className="border-line bg-panel shadow-3 @max-md:hidden absolute bottom-3 right-3 top-[72px] flex w-40 flex-col gap-2 rounded-md border p-2.5">
                        <div className="flex items-center gap-1.5">
                            <span className="text-ink font-medium">History</span>
                            <Pin n={5} className="ml-auto" />
                        </div>
                        <Bar className="w-5/6" />
                        <Bar className="w-2/3" />
                        <Bar className="w-3/4" />
                    </div>
                </div>
            </div>
        </div>
    );
}

const SURFACES: { n: number; name: string; for: ReactNode; notFor: ReactNode; file: string }[] = [
    {
        n: 1,
        name: "Sidebar (Sources, History)",
        for: "Making, filing and sharing sources: the file tree, Add knowledge, chat history, the shares bell.",
        notFor: "Anything else. Team, admin and tools are Studio tabs. It is the only sidebar on screen.",
        file: "_workspace/SourceRail.tsx, HistoryRail.tsx",
    },
    {
        n: 2,
        name: "Studio tab (a pane's strip)",
        for: "A new area of work: a tool, a workspace app (Team, Models & usage), an admin area (Workspace).",
        notFor: "A view of something that already has a tab — that is a screen of that tab.",
        file: "_workspace/types.ts STUDIO_GROUPS → StudioPanes.tsx",
    },
    {
        n: 3,
        name: "Screen of a tool (ToolFrame bar)",
        for: "Each view inside a tab: overview, a list, a record (a path under its list), a form, the tool's own settings.",
        notFor: "A second sidebar, a title bar, or tabs of your own above the screen.",
        file: "components/tool-app/ToolFrame.tsx (groups)",
    },
    {
        n: 4,
        name: "The screen's header",
        for: "The title (PageHeader), one line of context, the screen's primary action and at most two more.",
        notFor: "Status that belongs in the bar (a run in progress goes in ToolFrame's status).",
        file: "components/tools/PageHeader.tsx",
    },
    {
        n: 5,
        name: "Sheet (inside the tab)",
        for: "Reading or editing beside the screen without leaving it: details, history, a run's progress.",
        notFor: "A short task with an end — that is a Dialog.",
        file: "components/ui/sheet.tsx",
    },
    {
        n: 6,
        name: "Settings (account menu)",
        for: "A person's own preferences: account, appearance, shortcuts, privacy.",
        notFor: "Workspace policy (Workspace tab), models and keys (Models & usage), a tool's behaviour (its own Settings screen).",
        file: "_workspace/SettingsHub.tsx, lib/settings/surfaces.ts",
    },
    {
        n: 7,
        name: "Inbox bell",
        for: "Something someone else did for you to look at later: a share, a reply to your feedback.",
        notFor: "The result of what you just did — that is a toast.",
        file: "_workspace/team/InboxBell.tsx",
    },
    {
        n: 8,
        name: "⌘K palette and right-click",
        for: "Jumping anywhere and running verbs. Every app-level verb registered once shows in both.",
        notFor: "Being the only way to reach a verb: every menu item is also a visible control.",
        file: "_workspace/CommandPalette.tsx, components/context-menu",
    },
];

const TREE: { q: string; a: ReactNode }[] = [
    {
        q: "Is it about making, filing or sharing files, folders or chats?",
        a: <>The sidebar (1). Nothing else goes there.</>,
    },
    {
        q: "Is it a new area of work with screens of its own?",
        a: (
            <>
                A Studio tab on <Code>ToolFrame</Code> (2). Follow <Code>tool-app/README.md</Code> ›
                Adding a tool.
            </>
        ),
    },
    {
        q: "Is it another view of something a tab already holds?",
        a: (
            <>
                A screen of that tab (3): an item in its <Code>groups</Code>, or a path under a list
                for one record.
            </>
        ),
    },
    {
        q: "Is it a setting?",
        a: (
            <>
                Yours alone → Settings (6). The workspace&apos;s → the Workspace tab. Models, keys,
                spending → Models &amp; usage. Only about one tool → that tool&apos;s Settings
                screen.
            </>
        ),
    },
    {
        q: "Is it a short task with an end and up to three or four inputs?",
        a: (
            <>
                A <Code>Dialog</Code>. &ldquo;Are you sure?&rdquo; is a <Code>ConfirmDialog</Code>,
                never <Code>window.confirm</Code>.
            </>
        ),
    },
    {
        q: "Is it something to read or change beside the screen?",
        a: (
            <>
                A <Code>Sheet</Code> (5); inside ToolFrame it covers this tab only.
            </>
        ),
    },
    {
        q: "Is it a small choice or detail anchored to one control?",
        a: (
            <>
                <Code>Popover</Code> for a choice, <Code>HoverCard</Code> for a preview,{" "}
                <Code>Tooltip</Code> to name an icon.
            </>
        ),
    },
    {
        q: "Is it a verb on an object?",
        a: (
            <>
                Its menu: <Code>useContextTarget</Code> + a pure builder, opened by right-click and
                by its &ldquo;⋯&rdquo; (8).
            </>
        ),
    },
    {
        q: "Is it feedback?",
        a: (
            <>
                Just did it → <Code>toast</Code>. A lasting state → <Code>Alert</Code> on the
                screen. From someone else, for later → the bell (7).
            </>
        ),
    },
    {
        q: "Is it a page outside the workspace (sign-in, join, onboarding)?",
        a: (
            <>
                A full page on <Code>PageShell</Code>. Rare: ask before adding one.
            </>
        ),
    },
];

const REPO: ReactNode[][] = [
    [
        <>A primitive (button-level)</>,
        <>
            <Code>~/components/ui/&lt;name&gt;</Code> via <Code>npx shadcn@latest add</Code>, then
            re-themed to tokens
        </>,
    ],
    [
        <>A piece two or more features use</>,
        <>
            <Code>~/components/tools</Code>, <Code>~/components/layout</Code>,{" "}
            <Code>~/components/field.tsx</Code>
        </>,
    ],
    [
        <>Frame, tab history, tool links</>,
        <>
            <Code>~/components/tool-app</Code> — use it, never fork it
        </>,
    ],
    [
        <>A Studio tool</>,
        <>
            <Code>app/employer/tools/&lt;tool&gt;/</Code> with <Code>_screens/</Code>,{" "}
            <Code>_components/</Code>, <Code>_lib/</Code>, <Code>api.ts</Code>
        </>,
    ],
    [
        <>A workspace app or admin area</>,
        <>
            <Code>app/employer/documents/_workspace/&lt;app&gt;/</Code>
        </>,
    ],
    [
        <>A Settings section</>,
        <>
            <Code>_workspace/settings/&lt;Name&gt;Section.tsx</Code> + <Code>~/lib/settings</Code>
        </>,
    ],
    [
        <>Right-click items</>,
        <>
            A pure builder, <Code>&lt;thing&gt;ContextMenu.ts</Code>, beside the surface
        </>,
    ],
    [
        <>Words</>,
        <>
            <Code>src/i18n/messages/&#123;en,zh-CN&#125;/&lt;namespace&gt;.json</Code> + both{" "}
            <Code>index.ts</Code>
        </>,
    ],
    [
        <>Logic shared by server and client</>,
        <>
            <Code>~/lib/&lt;area&gt;</Code>
        </>,
    ],
    [
        <>A feature brick (no React)</>,
        <>
            <Code>packages/&lt;name&gt;</Code> (ADR-008; lint enforces the layers)
        </>,
    ],
    [
        <>Colour, type, radius tokens</>,
        <>
            <Code>packages/design-tokens/tokens.css</Code> + <Code>tailwind.config.ts</Code> —
            rarely
        </>,
    ],
    [
        <>A preview with no login</>,
        <>
            <Code>app/dev/&lt;name&gt;/</Code>, gated by <Code>devRoutesEnabled()</Code>
        </>,
    ],
];

export function PlacementSection() {
    return (
        <DocSection
            id="placement"
            title="Where it goes"
            guide="2. Where it goes"
            lead="Before drawing anything, decide which surface it lives on. Each has one job; putting something on the wrong one is the most common way a feature ends up feeling like a different app."
        >
            <SubSection id="placement-map" title="The workspace">
                <WorkspaceMap />
                <ol className="@max-md:grid-cols-1 m-0 grid list-none grid-cols-2 gap-x-6 gap-y-3 p-0">
                    {SURFACES.map(s => (
                        <li key={s.n} className="flex gap-2.5">
                            <Pin n={s.n} className="mt-0.5" />
                            <div className="min-w-0 text-[13px] leading-normal">
                                <div className="text-ink font-semibold">{s.name}</div>
                                <div className="text-ink-2">{s.for}</div>
                                <div className="text-ink-3">Not for: {s.notFor}</div>
                                <code className="text-ink-3 font-mono text-[12px]">{s.file}</code>
                            </div>
                        </li>
                    ))}
                </ol>
            </SubSection>

            <SubSection id="placement-tree" title="Choosing a surface">
                <p className="text-ink-2 max-w-[72ch] text-sm">Ask in order; take the first yes.</p>
                <ol className="border-line bg-panel m-0 list-none overflow-hidden rounded-lg border p-0">
                    {TREE.map((step, i) => (
                        <li
                            key={step.q}
                            className="border-line-2 @max-md:grid-cols-1 grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-6 gap-y-1 border-t px-4 py-2.5 text-[13px] first:border-t-0"
                        >
                            <span className="text-ink font-medium">
                                <span className="text-ink-3 mr-2 font-mono text-xs tabular-nums">
                                    {i + 1}
                                </span>
                                {step.q}
                            </span>
                            <span className="text-ink-2">{step.a}</span>
                        </li>
                    ))}
                </ol>
            </SubSection>

            <SubSection id="placement-repo" title="Where the files go">
                <p className="text-ink-2 max-w-[72ch] text-sm">
                    Take the first that exists: the kit, then a shared component, then your own
                    folder. Shared pieces never live in a route folder another feature imports from.
                </p>
                <RefTable head={["You are adding", "It goes in"]} rows={REPO} />
            </SubSection>
        </DocSection>
    );
}

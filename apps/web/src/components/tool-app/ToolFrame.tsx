"use client";

import {
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    Link2,
    MoreHorizontal,
    type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { SheetContainerProvider } from "~/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { useToolNav } from "./nav";
import { ToolLink } from "./ToolLink";

/** One screen in a tool's rail. */
export interface ToolNavItem {
    /** App-relative: "/prospects/companies". */
    to: string;
    label: string;
    icon?: LucideIcon;
    /** Shown right-aligned in mono; null or undefined shows nothing. */
    count?: number | null;
    /** Active only on this exact path, not below it. Home items want this. */
    exact?: boolean;
}

/** A labelled run of screens, with optional controls above and below them. */
export interface ToolNavGroup {
    id: string;
    label?: string;
    items: ToolNavItem[];
    /** Above the items: Growth's segment switcher. */
    header?: ReactNode;
    /** Below the items: a run in progress. */
    footer?: ReactNode;
}

export interface ToolFrameProps {
    /** The tool's name, as the tab names it. */
    title: string;
    /** The tool's mark, drawn on its tile (21px). */
    mark: ReactNode;
    /** The tool's screens. Leave out for a one-screen tool: the frame then has no rail. */
    groups?: ToolNavGroup[];
    /** A quiet note at the foot of the rail. */
    railFooter?: ReactNode;
    /**
     * Sheets the tool owns (a run in progress). Every kit sheet inside the
     * frame — these, and any a screen opens — covers this tab only, never
     * the column beside it.
     */
    overlay?: ReactNode;
    /** Classes for the padded content column, e.g. a max width. */
    contentClassName?: string;
    /**
     * The current screen lays itself out to the full height of the tab and
     * brings its own padding — an editor, a chat. The frame then adds none;
     * the screen gets a full-height box that still scrolls if it overflows.
     */
    fill?: boolean;
    children: ReactNode;
}

function isActive(item: ToolNavItem, path: string): boolean {
    if (item.exact) return path === item.to;
    return path === item.to || path.startsWith(`${item.to}/`);
}

/**
 * The one frame every Studio tool sits in, so a tool feels like a tab of the
 * workspace and not like a different app.
 *
 * - A rail of the tool's screens inside the tab, the way Settings has one.
 *   It sizes by the tab, not the window: below 720px of its own width it
 *   folds into a bar with a screen menu, so a tool in a third of the screen
 *   is as usable as one in all of it.
 * - Back and forward walk the tab's own history; the page never navigates.
 * - Each screen keeps its scroll position when you come back to it.
 * - Sheets open over this tab only.
 *
 * Tools supply their screens as data (`groups`) and render the current
 * screen as `children`. See README.md beside this file.
 */
export function ToolFrame({
    title,
    mark,
    groups,
    railFooter,
    overlay,
    contentClassName,
    fill = false,
    children,
}: ToolFrameProps) {
    const nav = useToolNav();
    const [root, setRoot] = useState<HTMLDivElement | null>(null);
    const scroller = useRef<HTMLDivElement | null>(null);
    const positions = useRef(new Map<number, number>());
    const entryKey = useRef(nav.entryKey);

    // Every visit has its own key; remember where each one was scrolled to,
    // and put it back when that visit comes back through Back or Forward.
    const onScroll = useCallback(() => {
        const el = scroller.current;
        if (el) positions.current.set(entryKey.current, el.scrollTop);
    }, []);
    useLayoutEffect(() => {
        entryKey.current = nav.entryKey;
        const el = scroller.current;
        if (!el) return;
        const saved = positions.current.get(nav.entryKey) ?? 0;
        el.scrollTop = saved;
        if (saved === 0 || el.scrollTop >= saved - 1) return;
        // The screen is still loading its rows, so there is not yet room to
        // scroll that far. Follow the content as it grows and put the position
        // back once it fits — unless the person scrolls first, or it never
        // arrives (a list that came back shorter).
        const content = el.firstElementChild;
        let observer: ResizeObserver | null = null;
        let timer = 0;
        const stop = () => {
            observer?.disconnect();
            observer = null;
            el.removeEventListener("wheel", stop);
            el.removeEventListener("touchstart", stop);
            el.removeEventListener("keydown", stop);
            window.clearTimeout(timer);
        };
        if (typeof ResizeObserver !== "undefined" && content) {
            observer = new ResizeObserver(() => {
                if (entryKey.current !== nav.entryKey) return stop();
                el.scrollTop = saved;
                if (el.scrollTop >= saved - 1) stop();
            });
            observer.observe(content);
        }
        el.addEventListener("wheel", stop, { passive: true });
        el.addEventListener("touchstart", stop, { passive: true });
        el.addEventListener("keydown", stop);
        timer = window.setTimeout(stop, 4000);
        return stop;
    }, [nav.entryKey]);

    const hasRail = Boolean(groups?.length);
    const activeGroup = groups?.find(group => group.items.some(item => isActive(item, nav.path)));
    const activeItem = activeGroup?.items.find(item => isActive(item, nav.path));

    return (
        <SheetContainerProvider container={root}>
            <div
                ref={setRoot}
                data-tool-frame={nav.toolId}
                // `contain: layout` makes this element the containing block for
                // the fixed-position sheets mounted inside it — that is what
                // keeps them inside the tab.
                className="bg-surface text-ink relative flex h-full min-h-0 w-full [contain:layout] [container-type:inline-size]"
            >
                {hasRail && (
                    // The element that hides by width carries no display class of
                    // its own: `@uploadthing/react/styles.css` loads after the
                    // app's CSS and redefines `.flex`, `.block` and `.hidden`, so
                    // `flex …:hidden` on one element would never hide. The layout
                    // lives on the inner div.
                    <aside
                        aria-label={`${title} screens`}
                        className="border-line bg-panel w-[220px] shrink-0 overflow-y-auto border-r [@container(max-width:719px)]:hidden"
                    >
                        <div className="flex min-h-full flex-col gap-4 px-2.5 pb-6 pt-3">
                            <div className="flex items-center gap-1 pl-1.5">
                                <span className="flex min-w-0 flex-1 items-center gap-2">
                                    {mark}
                                    {/* Wraps rather than truncates: "Investor relations"
                                        beside the history buttons is wider than the rail. */}
                                    <span className="text-ink min-w-0 text-balance text-[13.5px] font-semibold leading-tight tracking-[-0.02em]">
                                        {title}
                                    </span>
                                </span>
                                <HistoryButtons />
                                <FrameMenu title={title} />
                            </div>
                            {groups!.map(group => (
                                <RailGroup key={group.id} group={group} path={nav.path} />
                            ))}
                            {railFooter && (
                                <div className="text-ink-3 mt-auto px-2 text-[11.5px] leading-relaxed">
                                    {railFooter}
                                </div>
                            )}
                        </div>
                    </aside>
                )}

                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {hasRail && (
                        <div className="border-line bg-panel shrink-0 border-b [@container(min-width:720px)]:hidden">
                            <div className="flex flex-col gap-2 px-3 py-2">
                                <div className="flex items-center gap-1">
                                    <HistoryButtons />
                                    <ScreenMenu
                                        title={title}
                                        mark={mark}
                                        groups={groups!}
                                        activeGroup={activeGroup}
                                        activeItem={activeItem}
                                        path={nav.path}
                                    />
                                    <FrameMenu title={title} />
                                </div>
                                {(activeGroup?.header ?? activeGroup?.footer) && (
                                    // `empty:hidden`: a footer that renders nothing
                                    // (no run in progress) must not leave a gap.
                                    <div className="flex flex-col gap-2 empty:hidden">
                                        {activeGroup.header}
                                        {activeGroup.footer}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    <div
                        ref={scroller}
                        onScroll={onScroll}
                        data-tool-scroller
                        className="min-h-0 flex-1 overflow-y-auto [container-type:inline-size]"
                    >
                        <div
                            className={cn(
                                fill
                                    ? "h-full w-full"
                                    : "@max-md:px-4 @max-md:pt-4 w-full px-8 pb-12 pt-6",
                                contentClassName
                            )}
                        >
                            {children}
                        </div>
                    </div>
                </div>

                {overlay}
            </div>
        </SheetContainerProvider>
    );
}

function RailGroup({ group, path }: { group: ToolNavGroup; path: string }) {
    return (
        <nav aria-label={group.label ?? "Screens"} className="flex flex-col gap-2">
            {group.label && (
                <div className="text-ink-3 px-2 text-[11.5px] font-medium">{group.label}</div>
            )}
            {group.header}
            <ul className="flex flex-col gap-0.5">
                {group.items.map(item => (
                    <RailItem key={item.to} item={item} active={isActive(item, path)} />
                ))}
            </ul>
            {group.footer}
        </nav>
    );
}

function RailItem({ item, active }: { item: ToolNavItem; active: boolean }) {
    const Icon = item.icon;
    return (
        <li>
            <ToolLink
                href={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                    "focus-visible:ring-brand/50 flex h-8 items-center gap-2 rounded-md px-2 text-[13px] outline-none transition-colors focus-visible:ring-[3px]",
                    active
                        ? "bg-brand-soft text-brand-ink font-medium"
                        : "text-ink-2 hover:bg-line-2 hover:text-ink"
                )}
            >
                {Icon && <Icon className="size-[15px] shrink-0 opacity-85" aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.count !== undefined && item.count !== null && (
                    <span
                        className={cn(
                            "font-mono text-[11px] tabular-nums",
                            active ? "text-brand-ink/80" : "text-ink-3"
                        )}
                    >
                        {item.count}
                    </span>
                )}
            </ToolLink>
        </li>
    );
}

function HistoryButtons() {
    const { back, forward, canBack, canForward } = useToolNav();
    return (
        <span className="flex shrink-0 items-center">
            <HistoryButton label="Back" onClick={back} disabled={!canBack}>
                <ChevronLeft className="size-4" />
            </HistoryButton>
            <HistoryButton label="Forward" onClick={forward} disabled={!canForward}>
                <ChevronRight className="size-4" />
            </HistoryButton>
        </span>
    );
}

function HistoryButton({
    label,
    onClick,
    disabled,
    children,
}: {
    label: string;
    onClick: () => void;
    disabled: boolean;
    children: ReactNode;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                {/* A disabled button gets no pointer events, so the tooltip
                    lives on a wrapper that always does. */}
                <span className="inline-flex">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={label}
                        onClick={onClick}
                        disabled={disabled}
                        className="text-ink-3 hover:bg-line-2 hover:text-ink size-7 rounded-md"
                    >
                        {children}
                    </Button>
                </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
    );
}

/** The tab's own "⋯": a link to this screen, or this screen in a browser tab. */
function FrameMenu({ title }: { title: string }) {
    const { linkFor, path, search } = useToolNav();
    const here = `${path}${search}`;
    const copy = async () => {
        const url = new URL(linkFor(here), window.location.origin).toString();
        try {
            await navigator.clipboard.writeText(url);
            toast.success("Link copied");
        } catch {
            toast.error("Could not copy the link");
        }
    };
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${title} options`}
                    className="text-ink-3 hover:bg-line-2 hover:text-ink data-[state=open]:bg-line-2 size-7 shrink-0 rounded-md"
                >
                    <MoreHorizontal className="size-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => void copy()}>
                    <Link2 />
                    Copy link to this screen
                </DropdownMenuItem>
                <DropdownMenuItem
                    onSelect={() => window.open(linkFor(here), "_blank", "noopener,noreferrer")}
                >
                    <ExternalLink />
                    Open in a new browser tab
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** The rail, folded: the tool's name and the current screen, opening every screen. */
function ScreenMenu({
    title,
    mark,
    groups,
    activeGroup,
    activeItem,
    path,
}: {
    title: string;
    mark: ReactNode;
    groups: ToolNavGroup[];
    activeGroup: ToolNavGroup | undefined;
    activeItem: ToolNavItem | undefined;
    path: string;
}) {
    const { navigate } = useToolNav();
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    aria-label={`${title} screens`}
                    className="hover:bg-line-2 hover:text-ink data-[state=open]:bg-line-2 h-8 min-w-0 flex-1 justify-start gap-2 px-1.5 text-left font-normal"
                >
                    {mark}
                    <span className="text-ink shrink-0 text-[13.5px] font-semibold tracking-[-0.02em]">
                        {title}
                    </span>
                    {activeItem && (
                        <>
                            <span className="text-ink-4 shrink-0" aria-hidden>
                                /
                            </span>
                            <span className="text-ink-2 min-w-0 truncate text-[13px]">
                                {activeGroup?.label && groups.length > 1
                                    ? `${activeGroup.label} · ${activeItem.label}`
                                    : activeItem.label}
                            </span>
                        </>
                    )}
                    <ChevronDown className="text-ink-3 ml-auto size-3.5 shrink-0" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-[70vh] w-64 overflow-y-auto">
                {groups.map((group, index) => (
                    <DropdownMenuGroup key={group.id}>
                        {index > 0 && <DropdownMenuSeparator />}
                        {group.label && <DropdownMenuLabel>{group.label}</DropdownMenuLabel>}
                        {group.items.map(item => {
                            const Icon = item.icon;
                            const active = isActive(item, path);
                            return (
                                <DropdownMenuItem
                                    key={item.to}
                                    onSelect={() => navigate(item.to)}
                                    aria-current={active ? "page" : undefined}
                                >
                                    {Icon ? <Icon /> : null}
                                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                    {item.count !== undefined && item.count !== null && (
                                        <span className="text-ink-3 font-mono text-[11px] tabular-nums">
                                            {item.count}
                                        </span>
                                    )}
                                    {active && <Check className="text-brand-ink" />}
                                </DropdownMenuItem>
                            );
                        })}
                    </DropdownMenuGroup>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/**
 * A tool's mark on its tile, for tools whose mark is a lucide glyph. Same
 * size and shape as the drawn marks (Growth's, Vantage's) so every rail
 * starts the same way.
 */
export function ToolMark({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
    return (
        <span
            className={cn(
                "bg-brand text-brand-fg inline-flex size-[21px] shrink-0 items-center justify-center rounded-[27%]",
                className
            )}
            aria-hidden
        >
            <Icon className="size-3" strokeWidth={2.25} />
        </span>
    );
}

/** What a tool shows for a path it has no screen for — an old or mistyped link. */
export function ToolNotFound({ home, homeLabel }: { home: string; homeLabel: string }) {
    const { navigate, forgetCurrent } = useToolNav();
    // A dead link is not a place to come back to: the tab keeps remembering
    // the last screen that existed.
    useEffect(() => forgetCurrent(), [forgetCurrent]);
    return (
        <div className="border-line bg-panel flex max-w-xl flex-col items-start gap-2 rounded-lg border px-5 py-5">
            <div className="text-ink text-sm font-medium">This screen does not exist</div>
            <p className="text-ink-2 text-sm">
                The link may be from an older version of the app, or the thing it pointed at was
                removed.
            </p>
            <Button size="sm" variant="outline" className="mt-1" onClick={() => navigate(home)}>
                Go to {homeLabel}
            </Button>
        </div>
    );
}

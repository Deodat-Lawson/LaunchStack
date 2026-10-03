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
import {
    Fragment,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
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
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { useToolNav } from "./nav";
import { ToolLink } from "./ToolLink";

/** One screen of a tool: a tab in its bar. */
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

/**
 * A labelled run of screens. A tool with many screens in labelled groups
 * (Growth: Brand and Prospects) gets a switch between its groups and the
 * active group's screens as tabs; otherwise every screen is a tab in one row,
 * groups divided by a hairline.
 */
export interface ToolNavGroup {
    id: string;
    label?: string;
    items: ToolNavItem[];
    /** Compact controls shown in the bar while this group is active: Growth's segment switcher. (A run is the frame's `status`.) */
    toolbar?: ReactNode;
    /** On a phone the bar folds into a screen menu; this sits under it, full width. */
    header?: ReactNode;
}

export interface ToolFrameProps {
    /** The tool's name, as the tab names it. */
    title: string;
    /** The tool's mark, drawn on its tile (21px). */
    mark: ReactNode;
    /** The tool's screens. Leave out for a one-screen tool: the frame then has no bar. */
    groups?: ToolNavGroup[];
    /** One or two sentences on what the tool is for, at the top of its ⋯ menu. */
    about?: ReactNode;
    /**
     * Tool-wide status in the bar on every screen and at every width — a run
     * in progress, which you need a way back to from anywhere in the tool.
     */
    status?: ReactNode;
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

/** Focus the browser would ring: from the keyboard, not a click. */
function focusVisible(el: Element): boolean {
    try {
        return el.matches(":focus-visible");
    } catch {
        // A browser without the selector: treat focus as from the keyboard.
        return true;
    }
}

/**
 * The one frame every Studio tool sits in, so a tool feels like a tab of the
 * workspace and not like a different app.
 *
 * - A bar across the top of the tab: back and forward, the tool's name, its
 *   screens as tabs, its controls and a ⋯ menu. The workspace sidebar
 *   (Sources, History) stays the only sidebar — a tool used to bring a rail
 *   of its own, which put two sidebars side by side.
 * - The bar sizes by the tab, not the window: a tool's screens scroll
 *   sideways when they do not fit (fading at the edge that has more), and
 *   under 520px — a phone — the bar folds into a screen menu. A tool with
 *   many screens in groups (Growth) puts them on a second row.
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
    about,
    status,
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

    const hasBar = Boolean(groups?.length);
    const activeGroup = groups?.find(group => group.items.some(item => isActive(item, nav.path)));
    const activeItem = activeGroup?.items.find(item => isActive(item, nav.path));
    // Many screens in labelled groups (Growth's 12) do not fit one row: switch
    // groups, and show the active group's screens.
    const totalItems = groups?.reduce((n, g) => n + g.items.length, 0) ?? 0;
    const twoLevel = Boolean(
        groups && groups.length > 1 && totalItems > 8 && groups.every(g => g.label)
    );
    const tabGroups = twoLevel ? (activeGroup ? [activeGroup] : groups!.slice(0, 1)) : groups;
    const tabs = (
        <ScreenTabs title={title} groups={tabGroups ?? []} path={nav.path} ownRow={twoLevel} />
    );

    return (
        <SheetContainerProvider container={root}>
            <div
                ref={setRoot}
                data-tool-frame={nav.toolId}
                // `contain: layout` makes this element the containing block for
                // the fixed-position sheets mounted inside it — that is what
                // keeps them inside the tab.
                className="bg-surface text-ink relative flex h-full min-h-0 w-full flex-col [contain:layout] [container-type:inline-size]"
            >
                {hasBar && (
                    <header className="border-line bg-panel shrink-0 border-b">
                        {/* Each wrapper that hides by width carries no display
                            class of its own: `@uploadthing/react/styles.css`
                            loads after the app's CSS and redefines `.flex` and
                            `.hidden`, so `flex …:hidden` on one element would
                            never hide. The layout lives on the inner div. */}
                        <div className="[@container(max-width:519px)]:hidden">
                            <div className="flex flex-wrap items-center gap-x-2 px-3">
                                <div className="flex h-11 min-w-0 shrink-0 items-center gap-1">
                                    <HistoryButtons />
                                    <span className="ml-1 flex min-w-0 items-center gap-2">
                                        {mark}
                                        {/* The tab strip names the tool too; in a tab under
                                            600px the mark is enough and the room goes to
                                            the screens. */}
                                        <span className="text-ink truncate text-[13.5px] font-semibold tracking-[-0.02em] [@container(max-width:599px)]:hidden">
                                            {title}
                                        </span>
                                    </span>
                                    {twoLevel && (
                                        <GroupSwitch
                                            groups={groups!}
                                            activeGroup={activeGroup}
                                            path={nav.path}
                                        />
                                    )}
                                </div>
                                {/* In the DOM where it is seen, so Tab moves through
                                    the bar in reading order: a two-level bar's tabs
                                    are always the second row, after the controls. */}
                                {!twoLevel && tabs}
                                <div className="ml-auto flex h-11 shrink-0 items-center gap-2">
                                    {status}
                                    {activeGroup?.toolbar}
                                    <FrameMenu title={title} about={about} />
                                </div>
                                {twoLevel && tabs}
                            </div>
                        </div>
                        {/* A phone: the screens fold into a menu. */}
                        <div className="[@container(min-width:520px)]:hidden">
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
                                    {status}
                                    <FrameMenu title={title} about={about} />
                                </div>
                                {activeGroup?.header && (
                                    <div className="flex flex-col gap-2">{activeGroup.header}</div>
                                )}
                            </div>
                        </div>
                    </header>
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

                {overlay}
            </div>
        </SheetContainerProvider>
    );
}

/**
 * The tool's screens as tabs: in the row with the title, or on a row of
 * their own for a two-level tool; scrolling sideways rather than wrapping.
 */
function ScreenTabs({
    title,
    groups,
    path,
    ownRow,
}: {
    title: string;
    groups: ToolNavGroup[];
    path: string;
    ownRow: boolean;
}) {
    const row = useRef<HTMLElement | null>(null);
    const [edges, setEdges] = useState({ left: false, right: false });

    // Keep the current screen's tab in view — when the screen changes, and
    // when the row changes width under it (counts arriving widen the tabs
    // before it; a split narrows the tab). Only moves when the tab is cut
    // off, so a row the person scrolled by hand stays where they put it.
    useLayoutEffect(() => {
        const el = row.current;
        if (!el) return;
        const update = () => {
            const current = el.querySelector<HTMLElement>('[aria-current="page"]');
            if (current) {
                // Measured against the row itself (a tab's offsetLeft counts
                // from the frame), keeping the tab clear of the edge fade.
                const rowBox = el.getBoundingClientRect();
                const tabBox = current.getBoundingClientRect();
                const margin = 32;
                if (tabBox.left < rowBox.left + margin) {
                    el.scrollLeft -= rowBox.left + margin - tabBox.left;
                } else if (tabBox.right > rowBox.right - margin) {
                    el.scrollLeft += tabBox.right - (rowBox.right - margin);
                }
            }
            setEdges({
                left: el.scrollLeft > 1,
                right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
            });
        };
        update();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(update);
        observer.observe(el);
        if (el.firstElementChild) observer.observe(el.firstElementChild);
        return () => observer.disconnect();
    }, [path]);

    const onScroll = () => {
        const el = row.current;
        if (!el) return;
        setEdges({
            left: el.scrollLeft > 1,
            right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
        });
    };

    // A tab reached with the keyboard comes clear of the edge fade (the
    // browser only scrolls when less of it than the fade covers is showing).
    // Keyboard focus only: a click focuses the tab on mouse-down, and
    // scrolling then would slide another tab under the pointer before the
    // mouse-up, so the click would open nothing.
    const onFocus = (event: React.FocusEvent<HTMLElement>) => {
        const el = row.current;
        const tab = event.target as HTMLElement;
        if (!el?.contains(tab) || !focusVisible(tab)) return;
        const rowBox = el.getBoundingClientRect();
        const tabBox = tab.getBoundingClientRect();
        const margin = 32;
        if (tabBox.left < rowBox.left + margin) el.scrollLeft -= rowBox.left + margin - tabBox.left;
        else if (tabBox.right > rowBox.right - margin) {
            el.scrollLeft += tabBox.right - (rowBox.right - margin);
        }
    };

    // A mouse wheel scrolls up and down; this row only scrolls sideways.
    const onWheel = (event: React.WheelEvent<HTMLElement>) => {
        const el = row.current;
        if (!el || event.deltaX !== 0 || el.scrollWidth <= el.clientWidth) return;
        el.scrollLeft += event.deltaY;
    };

    return (
        <nav
            ref={row}
            aria-label={`${title} screens`}
            onScroll={onScroll}
            onWheel={onWheel}
            onFocus={onFocus}
            className={cn(
                "-mb-px min-w-0 self-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                // A one-row tool keeps its tabs in the row at every desktop
                // width (scrolling, with fades), so the DOM order is the
                // order you see and the bar never grows a row it doesn't need.
                ownRow ? "order-last basis-full" : "flex-1",
                // Tabs past the edge fade out, so a row that scrolls says so.
                edges.left && edges.right
                    ? "[mask-image:linear-gradient(to_right,transparent,black_28px,black_calc(100%-28px),transparent)]"
                    : edges.left
                      ? "[mask-image:linear-gradient(to_right,transparent,black_28px)]"
                      : edges.right
                        ? "[mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)]"
                        : undefined
            )}
        >
            {/* Sized to its tabs, not the row: the observer above sees it
                grow when counts arrive and widen the tabs. */}
            <ul className="flex h-full w-max min-w-full items-stretch gap-0.5">
                {groups.map((group, index) => (
                    <Fragment key={group.id}>
                        {index > 0 && (
                            <li aria-hidden className="bg-line mx-1.5 my-3 w-px shrink-0" />
                        )}
                        {group.items.map(item => (
                            <ScreenTab key={item.to} item={item} active={isActive(item, path)} />
                        ))}
                    </Fragment>
                ))}
            </ul>
        </nav>
    );
}

function ScreenTab({ item, active }: { item: ToolNavItem; active: boolean }) {
    const Icon = item.icon;
    return (
        <li className="flex shrink-0">
            <ToolLink
                href={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                    // The underline sits on the bar's bottom border, so the
                    // current screen reads as part of the page below.
                    // The ring is inset: the row scrolls, and an outer ring
                    // would be clipped at its edges.
                    "focus-visible:ring-brand/50 relative inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] outline-none transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full focus-visible:ring-2 focus-visible:ring-inset",
                    active
                        ? "text-ink after:bg-brand font-medium"
                        : "text-ink-3 hover:text-ink after:bg-transparent"
                )}
            >
                {Icon && <Icon className="size-[14px] shrink-0 opacity-85" aria-hidden />}
                {item.label}
                {item.count !== undefined && item.count !== null && (
                    <span className="text-ink-3 font-mono text-[11px] tabular-nums">
                        {item.count}
                    </span>
                )}
            </ToolLink>
        </li>
    );
}

/**
 * Between the halves of a two-level tool (Growth: Brand | Prospects). Each
 * half remembers the screen it was last on, so switching back returns there.
 */
function GroupSwitch({
    groups,
    activeGroup,
    path,
}: {
    groups: ToolNavGroup[];
    activeGroup: ToolNavGroup | undefined;
    path: string;
}) {
    const { navigate, search } = useToolNav();
    const lastIn = useRef(new Map<string, string>());
    useEffect(() => {
        if (activeGroup) lastIn.current.set(activeGroup.id, `${path}${search}`);
    }, [activeGroup, path, search]);
    return (
        <ToggleGroup
            type="single"
            value={activeGroup?.id ?? ""}
            onValueChange={id => {
                const group = groups.find(g => g.id === id);
                if (!group || group === activeGroup) return;
                navigate(lastIn.current.get(group.id) ?? group.items[0]!.to);
            }}
            aria-label="Area"
            className="border-line bg-surface ml-2 shrink-0 gap-0.5 rounded-md border p-0.5"
        >
            {groups.map(group => (
                <ToggleGroupItem
                    key={group.id}
                    value={group.id}
                    // The app's "this one" idiom (tabs, Settings): a raised
                    // panel on the surface reads as nothing — ~1.05:1.
                    className="data-[state=on]:bg-brand-soft data-[state=on]:text-brand-ink h-7 shrink-0 rounded-[5px] px-2.5 text-[12.5px] data-[state=on]:font-medium"
                >
                    {group.label}
                </ToggleGroupItem>
            ))}
        </ToggleGroup>
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

/** The tab's own "⋯": what the tool is for, a link to this screen, or this screen in a browser tab. */
function FrameMenu({ title, about }: { title: string; about?: ReactNode }) {
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
            <DropdownMenuContent align="end" className="w-64">
                {about && (
                    <>
                        <DropdownMenuLabel className="text-ink-3 text-[12px] font-normal leading-relaxed">
                            {about}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                    </>
                )}
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

/** The bar, folded for a phone: the tool's name and the current screen, opening every screen. */
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
 * size and shape as the drawn marks (Growth's, Vantage's) so every bar
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
export function ToolNotFound({
    home,
    homeLabel,
    title = "This screen does not exist",
    body = "The link may be from an older version of the app, or the thing it pointed at was removed.",
}: {
    home: string;
    homeLabel: string;
    /** For a record that has gone: "This company is no longer here". */
    title?: string;
    body?: string;
}) {
    const { navigate, forgetCurrent } = useToolNav();
    // A dead link is not a place to come back to: the tab keeps remembering
    // the last screen that existed.
    useEffect(() => forgetCurrent(), [forgetCurrent]);
    return (
        <div className="border-line bg-panel flex max-w-xl flex-col items-start gap-2 rounded-lg border px-5 py-5">
            <div className="text-ink text-sm font-medium">{title}</div>
            <p className="text-ink-2 text-sm">{body}</p>
            <Button size="sm" variant="outline" className="mt-1" onClick={() => navigate(home)}>
                Go to {homeLabel}
            </Button>
        </div>
    );
}

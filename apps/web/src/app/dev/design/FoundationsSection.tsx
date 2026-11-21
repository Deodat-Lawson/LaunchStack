"use client";

import { CalendarClock, Check, FileText, Plus, Search, Settings2, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { ToolMark } from "~/components/tool-app/ToolFrame";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { Code, DoDont, DocSection, RefTable, Rule, Rules, Specimen, SubSection } from "./parts";

/* ── Colour ─────────────────────────────────────────────────────────── */

/** A CSS colour as sRGB, read back through a 1×1 canvas so oklch() works. */
function toRgb(color: string): [number, number, number] | null {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    // Reset first: an unparseable colour leaves the previous fill in place.
    ctx.fillStyle = "black";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r!, g!, b!];
}

function luminance([r, g, b]: [number, number, number]): number {
    const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg: string, bg: string): number | null {
    const a = toRgb(fg);
    const b = toRgb(bg);
    if (!a || !b) return null;
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
}

/** The token's value right now, in this theme. */
function useTokenValue(token: string): string {
    const { resolvedTheme } = useTheme();
    const [value, setValue] = useState("");
    useLayoutEffect(() => {
        setValue(getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim());
    }, [token, resolvedTheme]);
    return value;
}

interface Swatch {
    cls: string;
    token: string;
    use: string;
    /** Text tokens: measure against this surface token. */
    on?: string;
    /** Minimum ratio the token promises. */
    min?: number;
}

function SwatchRow({ swatch }: { swatch: Swatch }) {
    const value = useTokenValue(swatch.token);
    const surface = useTokenValue(swatch.on ?? "panel");
    const ratio = swatch.on && value && surface ? contrast(value, surface) : null;
    const pass = ratio !== null && swatch.min !== undefined ? ratio >= swatch.min : null;
    return (
        <li className="border-line-2 @max-md:grid-cols-[40px_minmax(0,1fr)] grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 border-t px-3 py-2 first:border-t-0">
            <span
                aria-hidden
                className="border-line size-10 rounded-md border"
                style={{ background: `var(--${swatch.token})` }}
            />
            <span className="min-w-0">
                <span className="text-ink block font-mono text-[12px]">{swatch.cls}</span>
                <span className="text-ink-3 block text-xs">{swatch.use}</span>
            </span>
            {ratio !== null && (
                <span
                    className={cn(
                        "@max-md:col-start-2 justify-self-start text-xs tabular-nums",
                        pass === false ? "text-danger-ink" : "text-ink-2"
                    )}
                    title={`Measured now against --${swatch.on}`}
                >
                    {ratio.toFixed(1)}:1 on {swatch.on}
                    {swatch.min !== undefined && (
                        <span className="text-ink-3"> · needs {swatch.min}:1</span>
                    )}
                </span>
            )}
        </li>
    );
}

const COLOUR_GROUPS: { title: string; note: string; swatches: Swatch[] }[] = [
    {
        title: "Surfaces",
        note: "The tab is surface; anything grouped sits on panel with a line border. panel-2 is hover, captions and quiet fills.",
        swatches: [
            { cls: "bg-surface", token: "bg", use: "The tab's background (ToolFrame paints it)" },
            { cls: "bg-surface-2", token: "bg-2", use: "Sidebar, tab strips" },
            {
                cls: "bg-panel",
                token: "panel",
                use: "Lists, tables, stat tiles, the ToolFrame bar",
            },
            { cls: "bg-panel-2", token: "panel-2", use: "Row hover, captions, secondary fill" },
        ],
    },
    {
        title: "Ink",
        note: "A contrast contract, measured live below in the current theme. ink-3 is the smallest tier for words; ink-4 is never text.",
        swatches: [
            {
                cls: "text-ink",
                token: "ink",
                use: "Titles, values, row names",
                on: "panel",
                min: 4.5,
            },
            {
                cls: "text-ink-2",
                token: "ink-2",
                use: "Body copy, secondary values",
                on: "panel",
                min: 4.5,
            },
            {
                cls: "text-ink-3",
                token: "ink-3",
                use: "Meta, hints, descriptions, headers",
                on: "panel",
                min: 4.5,
            },
            {
                cls: "text-ink-4",
                token: "ink-4",
                use: "Disabled glyphs, decoration only",
                on: "panel",
                min: 3,
            },
        ],
    },
    {
        title: "Lines",
        note: "line borders a panel; line-2 divides rows inside one.",
        swatches: [
            { cls: "border-line", token: "line", use: "Panel and control borders" },
            { cls: "border-line-2", token: "line-2", use: "Hairlines between rows" },
        ],
    },
    {
        title: "Brand",
        note: "Purple is for the one thing to do (filled button), the current place (active tab: brand-soft + brand-ink) and links. Not for decoration.",
        swatches: [
            { cls: "bg-brand", token: "accent", use: "Primary button, ToolMark tile" },
            {
                cls: "text-brand-fg",
                token: "accent-fg",
                use: "Text on bg-brand",
                on: "accent",
                min: 4.5,
            },
            {
                cls: "bg-brand-soft",
                token: "accent-soft",
                use: "Selected tab, hover on ghost buttons",
            },
            {
                cls: "text-brand-ink",
                token: "accent-ink",
                use: "Links, accent words, selected text",
                on: "panel",
                min: 4.5,
            },
        ],
    },
    {
        title: "Status",
        note: "Each status has a base (dots, icons, borders), a soft fill and an ink for words. Words in a status colour always use -ink.",
        swatches: [
            {
                cls: "text-success-ink on bg-success-soft",
                token: "success-ink",
                use: "Done, connected, saved",
                on: "success-soft",
                min: 4.5,
            },
            {
                cls: "text-warn-ink on bg-warn-soft",
                token: "warn-ink",
                use: "Needs attention, due soon",
                on: "warn-soft",
                min: 4.5,
            },
            {
                cls: "text-info-ink on bg-info-soft",
                token: "info-ink",
                use: "In progress, neutral news",
                on: "info-soft",
                min: 4.5,
            },
            {
                cls: "text-danger-ink on bg-danger-soft",
                token: "danger-ink",
                use: "Failed, destructive, overdue",
                on: "danger-soft",
                min: 4.5,
            },
        ],
    },
];

/* ── Type ───────────────────────────────────────────────────────────── */

/**
 * Shows the computed size and weight of the text it wraps, live: the first
 * heading, paragraph or code inside (a PageHeader's own wrapper carries the
 * inherited 16px, not the title's size).
 */
function Measured({ children }: { children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    const [spec, setSpec] = useState("");
    const { resolvedTheme } = useTheme();
    useEffect(() => {
        const el = ref.current?.querySelector("h1, h2, h3, p, code");
        if (!el) return;
        const cs = getComputedStyle(el);
        setSpec(`${parseFloat(cs.fontSize)}px / ${cs.fontWeight}`);
    }, [resolvedTheme]);
    return (
        <div className="@max-md:grid-cols-1 grid grid-cols-[minmax(0,1fr)_96px] items-center gap-3">
            <div ref={ref} className="min-w-0">
                {children}
            </div>
            <span className="text-ink-3 font-mono text-[12px] tabular-nums">{spec}</span>
        </div>
    );
}

const TYPE_ROLES: ReactNode[][] = [
    [
        <>Screen title</>,
        <>
            <Code>PageHeader</Code> (lg)
        </>,
        <>30px / 600, 28px under 640px</>,
        <>A tool&apos;s home and its lists</>,
    ],
    [
        <>Record title</>,
        <>
            <Code>PageHeader size=&quot;md&quot;</Code>
        </>,
        <>26px / 600, 24px under 640px</>,
        <>One record, a form, a tool&apos;s settings</>,
    ],
    [
        <>Section heading</>,
        <>
            <Code>SectionHeading</Code>
        </>,
        <>13px / 600, ink</>,
        <>Every group on a screen</>,
    ],
    [
        <>Body, controls, row names</>,
        <>
            <Code>text-sm</Code>
        </>,
        <>14px / 400–500</>,
        <>Default text; row names at 500</>,
    ],
    [
        <>Secondary</>,
        <>
            <Code>text-[13px]</Code>
        </>,
        <>13px, ink-2 / ink-3</>,
        <>Sub lines, descriptions, notices</>,
    ],
    [
        <>Meta</>,
        <>
            <Code>text-xs</Code>
        </>,
        <>12px, ink-3</>,
        <>Captions, table headers, badges, hints. The floor.</>,
    ],
    [
        <>Figure</>,
        <>
            <Code>text-xl font-medium tabular-nums</Code>
        </>,
        <>20px / 500</>,
        <>A number in a stat tile</>,
    ],
    [
        <>Code, IDs, keys</>,
        <>
            <Code>font-mono text-[12px]</Code>
        </>,
        <>12px JetBrains Mono</>,
        <>Identifiers, shortcuts, file paths</>,
    ],
];

/* ── Section ────────────────────────────────────────────────────────── */

export function FoundationsSection() {
    return (
        <DocSection
            id="foundations"
            title="Foundations"
            guide="3. Foundations"
            lead={
                <>
                    Colour, type, space and shape all come from{" "}
                    <Code>packages/design-tokens/tokens.css</Code> through the semantic Tailwind
                    names in <Code>tailwind.config.ts</Code>. Use the names; never a hex value,
                    never the raw Tailwind palette, never an inline <Code>style</Code> colour. Then
                    dark mode costs nothing.
                </>
            }
        >
            <SubSection id="colour" title="Colour">
                <div className="@max-lg:grid-cols-1 grid grid-cols-2 gap-4">
                    {COLOUR_GROUPS.map(group => (
                        <div key={group.title} className="flex flex-col gap-2">
                            <div>
                                <div className="text-ink text-[13px] font-semibold">
                                    {group.title}
                                </div>
                                <p className="text-ink-3 text-xs leading-normal">{group.note}</p>
                            </div>
                            <ul className="border-line bg-panel m-0 list-none overflow-hidden rounded-lg border p-0">
                                {group.swatches.map(s => (
                                    <SwatchRow key={s.cls} swatch={s} />
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
                <DoDont
                    good={
                        <div className="flex items-center gap-2">
                            <Badge variant="warn">Needs a decision</Badge>
                            <span className="text-warn-ink text-sm">Notice due in 9 days</span>
                        </div>
                    }
                    goodNote="Status words in the status ink, on the soft fill or the panel. The word carries the meaning; colour backs it up."
                    bad={
                        <div className="flex items-center gap-2">
                            <span className="bg-warn size-2.5 rounded-full" />
                            <span className="text-warn text-sm">Notice due in 9 days</span>
                        </div>
                    }
                    badNote="The base status colour as text (text-warn) measures about 2.4:1. Base colours are for dots, icons and borders."
                />
            </SubSection>

            <SubSection id="type" title="Type">
                <p className="text-ink-2 max-w-[72ch] text-sm">
                    Inter for every word of UI, JetBrains Mono for code. Eight roles, five text
                    sizes; nothing under 12px. Weights 400, 500 and 600. The sizes on the right are
                    measured from the rendered element.
                </p>
                <Specimen source="~/components/tools/PageHeader — PageHeader, SectionHeading">
                    <div className="flex flex-col gap-5 [container-type:inline-size]">
                        <Measured>
                            <PageHeader title="Renewals" accent="this quarter" />
                        </Measured>
                        <Measured>
                            <PageHeader size="md" title="Northwind Analytics" />
                        </Measured>
                        <Measured>
                            <SectionHeading title="Needs a decision" className="mb-0" />
                        </Measured>
                        <Measured>
                            <p className="text-ink text-sm">
                                Body and controls. A row&apos;s name sits at weight 500.
                            </p>
                        </Measured>
                        <Measured>
                            <p className="text-ink-3 text-[13px]">
                                Secondary: the line under a title, a description.
                            </p>
                        </Measured>
                        <Measured>
                            <p className="text-ink-3 text-xs">
                                Meta: captions, table headers, hints.
                            </p>
                        </Measured>
                        <Measured>
                            <p className="text-ink text-xl font-medium tabular-nums">$184,200</p>
                        </Measured>
                        <Measured>
                            <code className="text-ink-2 font-mono text-[12px]">
                                tool.location.v1
                            </code>
                        </Measured>
                    </div>
                </Specimen>
                <RefTable head={["Role", "Use", "Size / weight", "Where"]} rows={TYPE_ROLES} />
                <Rules>
                    <Rule why="A tool's home may set one phrase in brand ink, as Growth, Proposals and Vantage do; a list, a record or a form never.">
                        Accent words only on a home screen.
                    </Rule>
                    <Rule why="They read as a template, and 10–11px uppercase measured below the contrast floor.">
                        No uppercase tracked eyebrow labels above titles or sections.
                    </Rule>
                    <Rule why="12.5, 11.5 and 13.5px are legacy sizes from before the scale; they make nine sizes on one screen.">
                        No fractional sizes in new code.
                    </Rule>
                    <Rule why="So columns of digits line up.">
                        <Code>tabular-nums</Code> on every number in a list, table or tile.
                    </Rule>
                </Rules>
            </SubSection>

            <SubSection id="space" title="Space and layout">
                <RefTable
                    head={["What", "Value", "Where it comes from"]}
                    rows={[
                        [
                            <>Screen padding</>,
                            <>32px sides, 24px top, 48px bottom; 16px under 640px</>,
                            <>
                                <Code>ToolFrame</Code> — never add your own
                            </>,
                        ],
                        [
                            <>Content column</>,
                            <>max 1080px, centred, sections 28px apart</>,
                            <>
                                <Code>mx-auto flex max-w-[1080px] flex-col gap-7</Code>
                            </>,
                        ],
                        [
                            <>Form column</>,
                            <>max 640px, on the left edge</>,
                            <>
                                <Code>max-w-[640px]</Code>
                            </>,
                        ],
                        [
                            <>Reading width</>,
                            <>about 70 characters</>,
                            <>
                                <Code>max-w-[70ch]</Code>
                            </>,
                        ],
                        [
                            <>Inside a group</>,
                            <>8 / 12 / 16px</>,
                            <>
                                <Code>gap-2</Code>, <Code>gap-3</Code>, <Code>gap-4</Code>; row
                                padding <Code>px-4 py-2.5</Code>
                            </>,
                        ],
                        [
                            <>Two columns</>,
                            <>main + 280px side, 28px gap; stack under 880px</>,
                            <>
                                <Code>grid-cols-[minmax(0,1fr)_280px] @max-lg:grid-cols-1</Code>
                            </>,
                        ],
                    ]}
                />
                <RefTable
                    head={["Variant", "Tab narrower than", "Typical change"]}
                    rows={[
                        [<Code key="a">@max-xl</Code>, <>1120px</>, <>Drop a third column</>],
                        [
                            <Code key="a">@max-lg</Code>,
                            <>880px</>,
                            <>Side column stacks under the main one</>,
                        ],
                        [
                            <Code key="a">@max-md</Code>,
                            <>640px</>,
                            <>Titles step down; low-value table columns hide; padding 16px</>,
                        ],
                        [
                            <Code key="a">@max-sm</Code>,
                            <>520px</>,
                            <>ToolFrame folds its screens into a menu; label/control rows stack</>,
                        ],
                        [<Code key="a">@max-xs</Code>, <>380px</>, <>Icon-only toolbar buttons</>],
                    ]}
                />
                <Rules>
                    <Rule why="A tool in a third of a wide monitor is narrow; md: would give it the widest layout. The variants read the tab's width.">
                        Inside a tab, fold with container variants (<Code>@max-lg:</Code>), never
                        viewport ones (<Code>lg:</Code>).
                    </Rule>
                    <Rule why="Intrinsic layouts fold themselves.">
                        Reach for <Code>flex-wrap</Code> and{" "}
                        <Code>grid-cols-[repeat(auto-fill,minmax(…))]</Code> before a variant.
                    </Rule>
                    <Rule why="The Settings audit found titles at x=420 and content at x=446 on one screen.">
                        Everything on a screen starts on the same left edge.
                    </Rule>
                </Rules>
            </SubSection>

            <SubSection id="shape" title="Radius and elevation">
                <div className="@max-md:grid-cols-2 grid grid-cols-4 gap-3">
                    {[
                        { cls: "rounded-sm", px: "6px", use: "Inline chips, focus rings on text" },
                        {
                            cls: "rounded-md",
                            px: "8px",
                            use: "Controls: buttons, inputs, badges, menus",
                        },
                        {
                            cls: "rounded-lg",
                            px: "10px",
                            use: "Panels, lists, tiles, dialogs, popovers",
                        },
                        { cls: "rounded-full", px: "∞", use: "Avatars, dots, the pin" },
                    ].map(r => (
                        <div key={r.cls} className="flex flex-col gap-2">
                            <div
                                className={cn("bg-brand-soft border-brand/30 h-16 border", r.cls)}
                            />
                            <div>
                                <div className="text-ink font-mono text-[12px]">
                                    {r.cls} <span className="text-ink-3">{r.px}</span>
                                </div>
                                <div className="text-ink-3 text-xs">{r.use}</div>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="@max-md:grid-cols-1 grid grid-cols-3 gap-3">
                    {[
                        { cls: "border border-line", label: "In the page: a border, no shadow" },
                        { cls: "shadow-2", label: "What kit popovers and hover cards use" },
                        {
                            cls: "shadow-3",
                            label: "Highest token. Dialogs, sheets and menus bring their own",
                        },
                    ].map(e => (
                        <div key={e.cls} className={cn("bg-panel rounded-lg px-4 py-5", e.cls)}>
                            <div className="text-ink font-mono text-[12px]">{e.cls}</div>
                            <div className="text-ink-3 text-xs">{e.label}</div>
                        </div>
                    ))}
                </div>
                <Rules>
                    <Rule why="rounded-xl, rounded-2xl and rounded-[14px] are 85 + 16 + 10 legacy uses; five radii on one screen read as five designers.">
                        Three radii and full. Nothing else.
                    </Rule>
                    <Rule why="The kit already lifts what floats; a shadow on a panel in the flow makes it look draggable.">
                        Elevation belongs to overlays. Panels in the page get a border.
                    </Rule>
                    <Rule why="Stacking is a contract: z-sticky, z-dropdown, z-modal, z-toast, z-tooltip.">
                        Use the z tokens, never a number.
                    </Rule>
                </Rules>
            </SubSection>

            <SubSection id="icons" title="Icons and motion">
                <Specimen source='import { … } from "lucide-react" · brand marks from ~/components/icons/brand'>
                    <div className="flex flex-wrap items-center gap-6">
                        <Button size="sm">
                            <Plus />
                            New renewal
                        </Button>
                        <Button size="sm" variant="outline">
                            <Settings2 />
                            Manage
                        </Button>
                        <span className="text-ink-2 flex items-center gap-1.5 text-xs">
                            <FileText className="size-3.5" /> size-3.5 in dense rows
                        </span>
                        <span className="text-ink-2 flex items-center gap-1.5 text-sm">
                            <Search className="size-4" /> size-4 beside text
                        </span>
                        <span className="flex items-center gap-2">
                            <ToolMark icon={CalendarClock} />
                            <span className="text-ink-3 text-xs">
                                ToolMark — a tool&apos;s tile
                            </span>
                        </span>
                        <Button size="icon" variant="ghost" aria-label="Delete">
                            <Trash2 />
                        </Button>
                        <span className="text-success-ink flex items-center gap-1 text-xs">
                            <Check className="size-3.5" /> Saved
                        </span>
                    </div>
                </Specimen>
                <Rules>
                    <Rule why="Kit buttons size their icons to 16px; don't pass a size inside a Button.">
                        Lucide only, at its default stroke. 16px beside 14px text, 14px in 12–13px
                        rows.
                    </Rule>
                    <Rule why="A screen reader has nothing else to say.">
                        An icon-only button has an <Code>aria-label</Code> and a{" "}
                        <Code>Tooltip</Code>.
                    </Rule>
                    <Rule why="Loading states wait 150ms then fade in (animate-loader-in), so a fast load shows nothing.">
                        Motion is short (150–200ms) and functional; the app honours reduced motion
                        globally.
                    </Rule>
                </Rules>
            </SubSection>
        </DocSection>
    );
}

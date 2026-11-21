"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { LaunchstackMark } from "~/app/_components/LaunchstackLogo";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Toaster } from "~/components/ui/sonner";
import { TooltipProvider } from "~/components/ui/tooltip";
import { useChangeLocale } from "~/i18n/client";
import type { Locale } from "~/i18n/locales";

import { ChecklistSection } from "./ChecklistSection";
import { ComponentsSection } from "./ComponentsSection";
import { FoundationsSection } from "./FoundationsSection";
import { PlacementSection } from "./PlacementSection";
import { TemplatesSection } from "./TemplatesSection";

const TOC: { id: string; label: string; children?: { id: string; label: string }[] }[] = [
    { id: "principles", label: "Principles" },
    {
        id: "placement",
        label: "Where it goes",
        children: [
            { id: "placement-map", label: "The workspace" },
            { id: "placement-tree", label: "Choosing a surface" },
            { id: "placement-repo", label: "Where the files go" },
        ],
    },
    {
        id: "foundations",
        label: "Foundations",
        children: [
            { id: "colour", label: "Colour" },
            { id: "type", label: "Type" },
            { id: "space", label: "Space and layout" },
            { id: "shape", label: "Radius and elevation" },
            { id: "icons", label: "Icons and motion" },
        ],
    },
    {
        id: "components",
        label: "Components",
        children: [
            { id: "c-actions", label: "Actions" },
            { id: "c-status", label: "Status and notices" },
            { id: "c-inputs", label: "Inputs" },
            { id: "c-display", label: "Display" },
            { id: "c-overlays", label: "Overlays and menus" },
            { id: "c-tool", label: "Tool pieces" },
        ],
    },
    {
        id: "templates",
        label: "Template tool",
        children: [{ id: "states", label: "States" }],
    },
    { id: "checklist", label: "Review checklist" },
];

/**
 * The design library page: a contents column and one long, sectioned page.
 * It is documentation, not a product surface, so it may have a contents
 * sidebar; the template tool inside it follows every product rule.
 */
export function DesignLibrary() {
    const [mounted, setMounted] = useState(false);
    const { resolvedTheme, setTheme } = useTheme();
    const { locale, changeLocale } = useChangeLocale();
    useEffect(() => {
        const theme = new URLSearchParams(window.location.search).get("theme");
        if (theme === "light" || theme === "dark") setTheme(theme);
        setMounted(true);
    }, [setTheme]);
    // Client-only, like the other harnesses: the kit generates ids, and a
    // server pass with no theme would hydrate every specimen mismatched.
    if (!mounted) return null;

    return (
        <TooltipProvider delayDuration={300}>
            <div data-preview="design-library" className="bg-surface text-ink min-h-dvh">
                <header className="border-line bg-panel/90 z-sticky sticky top-0 border-b backdrop-blur">
                    <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-5">
                        <LaunchstackMark size={22} />
                        <div className="min-w-0 flex-1">
                            <div className="text-ink truncate text-sm font-semibold tracking-[-0.01em]">
                                LaunchStack design library
                            </div>
                            <div className="text-ink-3 truncate text-xs">
                                Live from <code className="font-mono">~/components</code>. The
                                written rules are{" "}
                                <code className="font-mono">apps/web/DESIGN.md</code>.
                            </div>
                        </div>
                        <ToggleGroup
                            type="single"
                            size="sm"
                            variant="outline"
                            value={locale}
                            onValueChange={value => value && changeLocale(value as Locale)}
                            aria-label="Language of the template tool"
                        >
                            <ToggleGroupItem value="en" className="shrink-0 px-2.5 text-xs">
                                EN
                            </ToggleGroupItem>
                            <ToggleGroupItem value="zh-CN" className="shrink-0 px-2.5 text-xs">
                                中文
                            </ToggleGroupItem>
                        </ToggleGroup>
                        <ToggleGroup
                            type="single"
                            size="sm"
                            variant="outline"
                            value={resolvedTheme === "dark" ? "dark" : "light"}
                            onValueChange={value => value && setTheme(value)}
                            aria-label="Theme"
                        >
                            <ToggleGroupItem value="light" aria-label="Light" className="shrink-0">
                                <Sun />
                            </ToggleGroupItem>
                            <ToggleGroupItem value="dark" aria-label="Dark" className="shrink-0">
                                <Moon />
                            </ToggleGroupItem>
                        </ToggleGroup>
                    </div>
                </header>

                <div className="mx-auto grid max-w-[1440px] grid-cols-[200px_minmax(0,1fr)] gap-10 px-5 max-lg:grid-cols-1">
                    <nav
                        aria-label="Contents"
                        className="sticky top-14 h-[calc(100dvh-3.5rem)] overflow-y-auto py-8 max-lg:hidden"
                    >
                        <ol className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
                            {TOC.map(entry => (
                                <li key={entry.id}>
                                    <a
                                        href={`#${entry.id}`}
                                        className="text-ink hover:text-brand-ink block rounded-sm py-1 font-medium no-underline"
                                    >
                                        {entry.label}
                                    </a>
                                    {entry.children && (
                                        <ol className="border-line m-0 mb-1 ml-1 flex list-none flex-col border-l p-0 pl-3">
                                            {entry.children.map(child => (
                                                <li key={child.id}>
                                                    <a
                                                        href={`#${child.id}`}
                                                        className="text-ink-3 hover:text-brand-ink block py-0.5 no-underline"
                                                    >
                                                        {child.label}
                                                    </a>
                                                </li>
                                            ))}
                                        </ol>
                                    )}
                                </li>
                            ))}
                        </ol>
                    </nav>

                    <main className="flex min-w-0 max-w-[1120px] flex-col gap-12 py-8 pb-24 [container-type:inline-size]">
                        <PrinciplesSection />
                        <PlacementSection />
                        <FoundationsSection />
                        <ComponentsSection />
                        <TemplatesSection />
                        <ChecklistSection />
                    </main>
                </div>
                <Toaster richColors position="top-right" />
            </div>
        </TooltipProvider>
    );
}

const PRINCIPLES: { title: string; body: string }[] = [
    {
        title: "A tab of the workspace, not an app of its own",
        body: "Every tool opens as a tab in ToolFrame: its screens across the top, the workspace sidebar the only sidebar, no route tree, no title bar of its own.",
    },
    {
        title: "One type scale, one left edge",
        body: "Titles at 30 or 26px from PageHeader, section headings at 13px, text at 14/13/12px. Everything on a screen starts on the frame's content edge.",
    },
    {
        title: "Lead with the work",
        body: "The first thing on a screen is the thing people came for. No eyebrow labels, no marketing lines on working screens, no chrome that restates the tab.",
    },
    {
        title: "Quiet surfaces, one primary action",
        body: "One bordered panel per group, hairlines between rows, emphasis by weight and colour rather than by more boxes. One filled button per screen, next to what it acts on.",
    },
    {
        title: "Say it once",
        body: "A status, a count or a failure appears in one place. Every state (loading, empty, failed, not allowed) is designed, not left to fall through.",
    },
    {
        title: "Fit the tab, both themes, both languages",
        body: "Lay out for a full-width tab and fold with container variants (@max-lg, @max-md…), never viewport ones. Tokens only, so dark mode is free; every word from the catalogue.",
    },
];

function PrinciplesSection() {
    return (
        <section id="principles" className="flex scroll-mt-20 flex-col gap-6">
            <header className="flex flex-col gap-2">
                <h1 className="display text-ink @max-md:text-[28px] text-[34px] leading-[1.1] tracking-[-0.02em]">
                    Designing UI in LaunchStack
                </h1>
                <p className="text-ink-2 max-w-[72ch] text-sm leading-relaxed">
                    Six principles, then where a new piece of UI goes, the foundations, every kit
                    component, and a complete template tool to copy. Each specimen on this page is
                    the real component, so what you see is what ships. Switch the theme and language
                    at the top right.
                </p>
            </header>
            <ol className="@max-md:grid-cols-1 m-0 grid list-none grid-cols-2 gap-3 p-0">
                {PRINCIPLES.map((p, i) => (
                    <li
                        key={p.title}
                        className="border-line bg-panel flex gap-3 rounded-lg border px-4 py-3.5"
                    >
                        <span className="text-brand-ink font-mono text-xs tabular-nums">
                            {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="min-w-0">
                            <span className="text-ink block text-sm font-semibold">{p.title}</span>
                            <span className="text-ink-2 mt-0.5 block text-[13px] leading-normal">
                                {p.body}
                            </span>
                        </span>
                    </li>
                ))}
            </ol>
        </section>
    );
}

"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { ToolHost } from "~/components/tool-app/nav";
import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";

import { Code, DocSection, RefTable, SELECTED, SubSection } from "./parts";
import { PreviewStateContext, type PreviewState } from "./template/data";
import { RenewalsTool } from "./template/RenewalsTool";

const SCREENS = [
    { at: "/", label: "Overview", kind: "Home" },
    { at: "/contracts", label: "Contracts", kind: "List (Table)" },
    { at: "/contracts/northwind", label: "Contract", kind: "Record" },
    { at: "/new", label: "New", kind: "Form" },
    { at: "/settings", label: "Settings", kind: "Tool settings" },
    { at: "/contracts/gone", label: "Not found", kind: "Dead link" },
] as const;

const WIDTHS = [
    { id: "full", px: 1120, label: "Full (1120)" },
    { id: "half", px: 760, label: "Half (760)" },
    { id: "narrow", px: 560, label: "Narrow (560)" },
    { id: "phone", px: 390, label: "Phone (390)" },
] as const;

const STATES: { id: PreviewState; label: string }[] = [
    { id: "ready", label: "Ready" },
    { id: "loading", label: "Loading" },
    { id: "empty", label: "Empty" },
    { id: "error", label: "Failed" },
];

/**
 * The template tool, live, in a box the size of a workspace pane. The box is
 * a size container like a real pane host, so the tool folds by its width
 * exactly as it would in a split.
 */
export function TemplatesSection() {
    const [width, setWidth] = useState<(typeof WIDTHS)[number]["id"]>("full");
    const [state, setState] = useState<PreviewState>("ready");
    const [request, setRequest] = useState<{ at: string; nonce: number }>({ at: "/", nonce: 1 });
    const nonce = useRef(1);
    const host = useMemo<ToolHost>(
        () => ({
            active: true,
            request,
            openHref: href => toast(`In the app this opens ${decodeURIComponent(href)}`),
            openTool: (toolId, at) => toast(`In the app this opens ${toolId} at ${at}`),
        }),
        [request]
    );
    const go = (at: string) => {
        nonce.current += 1;
        setRequest({ at, nonce: nonce.current });
    };
    const px = WIDTHS.find(w => w.id === width)!.px;

    return (
        <DocSection
            id="templates"
            title="Template tool"
            guide="5. Patterns and the template tool"
            lead={
                <>
                    A complete tool on <Code>ToolFrame</Code> with the five screens most tools need,
                    built only from the kit and the shared tool pieces, translated into English and
                    Chinese. Copy <Code>apps/web/src/app/dev/design/template/</Code> to start a new
                    one; its <Code>RenewalsTool.tsx</Code> header says how. Use the switches to see
                    each screen at each tab width and in each state; the language and theme switches
                    are at the top of the page.
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <Control label="Screen">
                        <div className="flex flex-wrap gap-1">
                            {SCREENS.map(s => (
                                <Button
                                    key={s.at}
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2.5 text-xs"
                                    onClick={() => go(s.at)}
                                >
                                    {s.label}
                                </Button>
                            ))}
                        </div>
                    </Control>
                    <Control label="Width">
                        <ToggleGroup
                            type="single"
                            size="sm"
                            variant="outline"
                            value={width}
                            onValueChange={value => value && setWidth(value as typeof width)}
                            aria-label="Tab width"
                        >
                            {WIDTHS.map(w => (
                                <ToggleGroupItem
                                    key={w.id}
                                    value={w.id}
                                    className={`${SELECTED} shrink-0 px-2.5 text-xs`}
                                >
                                    {w.label}
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                    </Control>
                    <Control label="State">
                        <ToggleGroup
                            type="single"
                            size="sm"
                            variant="outline"
                            value={state}
                            onValueChange={value => value && setState(value as PreviewState)}
                            aria-label="Data state"
                        >
                            {STATES.map(s => (
                                <ToggleGroupItem
                                    key={s.id}
                                    value={s.id}
                                    className={`${SELECTED} shrink-0 px-2.5 text-xs`}
                                >
                                    {s.label}
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                    </Control>
                </div>
                <div className="bg-surface-2 border-line overflow-x-auto rounded-lg border p-3">
                    <div
                        data-template-pane
                        className="border-line mx-auto h-[780px] overflow-hidden rounded-md border transition-[width] duration-200 [container-type:inline-size]"
                        style={{ width: px, maxWidth: "100%" }}
                    >
                        <PreviewStateContext.Provider value={state}>
                            <RenewalsTool host={host} />
                        </PreviewStateContext.Provider>
                    </div>
                </div>
            </div>

            <SubSection title="What each screen shows">
                <RefTable
                    head={["Screen", "Pattern", "File", "Look for"]}
                    rows={[
                        [
                            <>Overview</>,
                            <>Home</>,
                            <Code key="f">OverviewScreen.tsx</Code>,
                            <>
                                PageHeader with accent and primary action; stat tiles; row lists;
                                two columns that stack at @max-lg
                            </>,
                        ],
                        [
                            <>Contracts</>,
                            <>List</>,
                            <Code key="f">ContractsScreen.tsx</Code>,
                            <>
                                Filter row; kit Table in a panel; right-click and ⋯ on each row;
                                columns that hide as the tab narrows; filtered-empty vs empty
                            </>,
                        ],
                        [
                            <>Contract</>,
                            <>Record</>,
                            <Code key="f">ContractScreen.tsx</Code>,
                            <>
                                PageHeader md; one filled button; cited passage that opens the
                                document; side facts; Dialog and pane-scoped Sheet
                            </>,
                        ],
                        [
                            <>New</>,
                            <>Form</>,
                            <Code key="f">NewScreen.tsx</Code>,
                            <>
                                Field column at 640px; errors on submit with focus; buttons at the
                                end of the form
                            </>,
                        ],
                        [
                            <>Settings</>,
                            <>Tool settings</>,
                            <Code key="f">SettingsScreen.tsx</Code>,
                            <>
                                Label-left rows that apply at once; Alert for a consequence;
                                destructive last, with ConfirmDialog
                            </>,
                        ],
                        [
                            <>Not found</>,
                            <>Dead link</>,
                            <Code key="f">RenewalsTool.tsx</Code>,
                            <>ToolNotFound with a way home; the tab forgets the dead link</>,
                        ],
                    ]}
                />
            </SubSection>

            <SubSection id="states" title="States">
                <RefTable
                    head={["State", "Show", "Component"]}
                    rows={[
                        [
                            <>Loading</>,
                            <>
                                The screen&apos;s own shape at its real size; the title stays, its
                                sub line is a skeleton
                            </>,
                            <>
                                <Code>SkeletonRows</Code>, <Code>SkeletonBlock</Code>,{" "}
                                <Code>Skeleton</Code>
                            </>,
                        ],
                        [
                            <>Empty, first run</>,
                            <>
                                What the tool does and the one control that starts it; no zeros, no
                                empty sections
                            </>,
                            <Code key="c">EmptyState</Code>,
                        ],
                        [
                            <>Empty, filtered</>,
                            <>That nothing matches, and Clear filters</>,
                            <Code key="c">EmptyState</Code>,
                        ],
                        [
                            <>Failed to load</>,
                            <>What failed, and Retry</>,
                            <Code key="c">InlineError</Code>,
                        ],
                        [
                            <>Working (a run)</>,
                            <>
                                Progress where it happens, plus the frame&apos;s status so you can
                                get back to it
                            </>,
                            <>
                                <Code>ToolFrame status</Code>, <Code>Progress</Code>,{" "}
                                <Code>Alert info</Code>
                            </>,
                        ],
                        [
                            <>Not allowed</>,
                            <>
                                One line saying why and who can change it; controls disabled with
                                the reason, not hidden
                            </>,
                            <>
                                <Code>Alert</Code>, disabled controls
                            </>,
                        ],
                        [
                            <>Not found</>,
                            <>That it is gone, and a way to the tool&apos;s home</>,
                            <Code key="c">ToolNotFound</Code>,
                        ],
                        [
                            <>Done</>,
                            <>A toast in the past tense; the screen shows the new state</>,
                            <Code key="c">toast.success</Code>,
                        ],
                    ]}
                />
            </SubSection>
        </DocSection>
    );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-ink-3 text-xs">{label}</span>
            {children}
        </div>
    );
}

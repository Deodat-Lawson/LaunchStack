"use client";

import {
    AlertTriangle,
    Bold,
    ChevronsUpDown,
    Download,
    Info,
    Italic,
    LayoutGrid,
    List,
    MoreHorizontal,
    Plus,
    Trash2,
    Underline,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import LoadingPage from "~/app/_components/loading";
import { useActionMenu, useContextTarget } from "~/components/context-menu";
import { Field } from "~/components/field";
import { Cite, type CiteEvidence } from "~/components/tools/Cite";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonBlock, SkeletonRows } from "~/components/tools/SkeletonRows";
import type { ActionMenuItem } from "~/components/ui/action-menu";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "~/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "~/components/ui/hover-card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Progress } from "~/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { Slider } from "~/components/ui/slider";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import { Toggle } from "~/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

import { Code, DoDont, DocSection, RefTable, Rule, Rules, Specimen, SubSection } from "./parts";

function Row({ children }: { children: React.ReactNode }) {
    return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

const EVIDENCE: CiteEvidence[] = [
    {
        n: 1,
        title: "Northwind MSA 2024.pdf",
        page: 4,
        quote: "This Agreement renews automatically for successive twelve-month terms unless either party gives written notice at least thirty (30) days before the end of the then-current term.",
        href: null,
    },
];

/** A box that is a right-click target, the way a row declares itself. */
function MenuTargetDemo() {
    const menu = useActionMenu();
    const items = (): ActionMenuItem[] => [
        { type: "label", id: "t", label: "Northwind Analytics" },
        { type: "item", id: "open", label: "Open", icon: "open", onSelect: () => toast("Open") },
        {
            type: "item",
            id: "ask",
            label: "Ask about this contract",
            icon: "ask",
            onSelect: () => toast("Ask"),
        },
        {
            type: "item",
            id: "copy",
            label: "Copy link",
            icon: "link",
            shortcut: "⌘L",
            onSelect: () => toast("Copied"),
        },
        { type: "separator", id: "s" },
        {
            type: "item",
            id: "del",
            label: "Delete renewal…",
            icon: "delete",
            danger: true,
            onSelect: () => toast("Delete"),
        },
    ];
    const target = useContextTarget({
        kind: "design-demo",
        id: "northwind",
        label: "Northwind Analytics",
        items,
    });
    return (
        <div
            {...target}
            className="border-line bg-panel flex items-center gap-3 rounded-lg border px-4 py-3"
        >
            <span className="min-w-0 flex-1">
                <span className="text-ink block text-sm font-medium">Northwind Analytics</span>
                <span className="text-ink-3 block text-xs">Right-click this row, or use its ⋯</span>
            </span>
            <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label="Actions for Northwind Analytics"
                onClick={event => {
                    const box = event.currentTarget.getBoundingClientRect();
                    menu.open({
                        x: box.left,
                        y: box.bottom + 4,
                        items: items(),
                        via: "button",
                        kind: "design-demo",
                    });
                }}
            >
                <MoreHorizontal />
            </Button>
        </div>
    );
}

export function ComponentsSection() {
    const [confirm, setConfirm] = useState(false);
    const [view, setView] = useState("list");
    const [sort, setSort] = useState("renews");
    const [open, setOpen] = useState(false);

    return (
        <DocSection
            id="components"
            title="Components"
            guide="4. Components"
            lead={
                <>
                    Take the first that exists: the kit (<Code>~/components/ui/&lt;name&gt;</Code>,
                    shadcn re-themed on the tokens), then the shared tool pieces (
                    <Code>~/components/tools</Code>, <Code>~/components/tool-app</Code>,{" "}
                    <Code>~/components/field</Code>). A primitive that is missing is added with{" "}
                    <Code>npx shadcn@latest add</Code> — never hand-rolled.
                </>
            }
        >
            {/* ── Actions ─────────────────────────────────────────────── */}
            <SubSection id="c-actions" title="Actions">
                <Specimen source="~/components/ui/button — Button (variant, size)">
                    <div className="flex flex-col gap-4">
                        <Row>
                            <Button>Create renewal</Button>
                            <Button variant="outline">Export</Button>
                            <Button variant="ghost">Cancel</Button>
                            <Button variant="secondary">Secondary</Button>
                            <Button variant="link">Open the contract</Button>
                            <Button variant="destructive">Delete</Button>
                        </Row>
                        <Row>
                            <Button size="sm">
                                <Plus />
                                New renewal
                            </Button>
                            <Button size="sm" variant="outline">
                                <Download />
                                Export
                            </Button>
                            <Button size="sm" disabled>
                                <Spinner />
                                Saving…
                            </Button>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button size="icon" variant="ghost" aria-label="Delete renewal">
                                        <Trash2 />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete renewal</TooltipContent>
                            </Tooltip>
                            <Button size="lg">Large (onboarding only)</Button>
                        </Row>
                    </div>
                </Specimen>
                <RefTable
                    head={["Variant", "Use"]}
                    rows={[
                        [
                            <Code key="v">default</Code>,
                            <>The one primary action of a screen, dialog or form. One per view.</>,
                        ],
                        [
                            <Code key="v">outline</Code>,
                            <>Secondary actions beside it: Export, History, Manage.</>,
                        ],
                        [
                            <Code key="v">ghost</Code>,
                            <>Cancel, icon buttons, actions inside rows and toolbars.</>,
                        ],
                        [
                            <Code key="v">link</Code>,
                            <>An action that reads as a link inside text.</>,
                        ],
                        [
                            <Code key="v">destructive</Code>,
                            <>
                                Only as the confirm button of a ConfirmDialog. Elsewhere a delete is
                                an outline or a menu item.
                            </>,
                        ],
                        [
                            <Code key="v">secondary</Code>,
                            <>Rarely; a filled neutral. Prefer outline.</>,
                        ],
                    ]}
                />
                <Rules>
                    <Rule why="Screen headers, toolbars and rows use sm (32px); default (36px) in forms and dialogs; lg only on full pages.">
                        Size by place, not by importance.
                    </Rule>
                    <Rule why="Create renewal, Save decision, Delete all — never OK, Submit or Yes.">
                        Label a button with its verb and object.
                    </Rule>
                    <Rule why="A raw <button> skips the focus ring, disabled state and sizing (366 still exist; don't add more).">
                        Always <Code>Button</Code>, with <Code>asChild</Code> around a{" "}
                        <Code>ToolLink</Code> when it navigates.
                    </Rule>
                </Rules>
                <Specimen
                    source="~/components/ui/toggle-group, ~/components/ui/toggle"
                    note="A choice of view or mode that changes this screen in place. Not for navigation between screens — those are ToolFrame tabs."
                >
                    <Row>
                        <ToggleGroup
                            type="single"
                            size="sm"
                            variant="outline"
                            value={view}
                            onValueChange={v => v && setView(v)}
                            aria-label="View"
                        >
                            <ToggleGroupItem value="list" aria-label="List" className="shrink-0">
                                <List />
                            </ToggleGroupItem>
                            <ToggleGroupItem value="grid" aria-label="Grid" className="shrink-0">
                                <LayoutGrid />
                            </ToggleGroupItem>
                        </ToggleGroup>
                        <ToggleGroup type="multiple" size="sm" aria-label="Format">
                            <ToggleGroupItem value="b" aria-label="Bold" className="shrink-0">
                                <Bold />
                            </ToggleGroupItem>
                            <ToggleGroupItem value="i" aria-label="Italic" className="shrink-0">
                                <Italic />
                            </ToggleGroupItem>
                            <ToggleGroupItem value="u" aria-label="Underline" className="shrink-0">
                                <Underline />
                            </ToggleGroupItem>
                        </ToggleGroup>
                        <Toggle size="sm" variant="outline" aria-label="Only mine">
                            Only mine
                        </Toggle>
                    </Row>
                </Specimen>
            </SubSection>

            {/* ── Status and notices ─────────────────────────────────── */}
            <SubSection id="c-status" title="Status and notices">
                <Specimen
                    source="~/components/ui/badge — Badge"
                    note="One mapping per tool from state to tone: attention warn, good outcome success, in progress info, inactive secondary. The word is always there; colour only backs it up."
                >
                    <Row>
                        <Badge>Default</Badge>
                        <Badge variant="secondary">Renews on its own</Badge>
                        <Badge variant="outline">Ending</Badge>
                        <Badge variant="success">Connected</Badge>
                        <Badge variant="info">Renewing</Badge>
                        <Badge variant="warn">Needs a decision</Badge>
                        <Badge variant="danger">Failed</Badge>
                    </Row>
                </Specimen>
                <Specimen
                    source="~/components/ui/alert — Alert, AlertTitle, AlertDescription (new)"
                    note="A lasting state on the screen, in one or two sentences. Use instead of the hand-built notes (StatusNote, ErrorNote, Notice…) in new code."
                >
                    <div className="flex flex-col gap-3">
                        <Alert>
                            <Info />
                            <AlertDescription>
                                Reminders follow each owner&apos;s time zone.
                            </AlertDescription>
                        </Alert>
                        <Alert variant="info">
                            <Info />
                            <AlertTitle>Reading 3 of 10 documents</AlertTitle>
                            <AlertDescription>
                                Renewals found so far are listed below.
                            </AlertDescription>
                        </Alert>
                        <Alert variant="warn">
                            <AlertTriangle />
                            <AlertDescription>
                                Reminders are off. Owners won&apos;t hear about notice dates.
                            </AlertDescription>
                        </Alert>
                        <Alert variant="danger">
                            <AlertTriangle />
                            <AlertDescription>
                                Harbor Cloud&apos;s notice date passed on 1 December.
                            </AlertDescription>
                        </Alert>
                    </div>
                </Specimen>
                <div className="@max-lg:grid-cols-1 grid grid-cols-2 gap-3">
                    <Specimen
                        source="sonner — toast(), toast.success(), toast.error()"
                        note="The result of something the person just did. Short, past tense, no 'successfully'."
                    >
                        <Row>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => toast.success("Renewal created.")}
                            >
                                Success
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => toast.error("Couldn't save the decision.")}
                            >
                                Error
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                    toast("Renewal deleted.", {
                                        action: { label: "Undo", onClick: () => undefined },
                                    })
                                }
                            >
                                With undo
                            </Button>
                        </Row>
                    </Specimen>
                    <Specimen
                        source="Progress, Spinner, Skeleton"
                        note="Progress when you know how far; Spinner beside a word when you don't; Skeleton at the real size of what is coming."
                    >
                        <div className="flex flex-col gap-3">
                            <Progress value={30} aria-label="3 of 10 read" />
                            <span className="text-ink-3 flex items-center gap-2 text-[13px]">
                                <Spinner className="text-brand" /> Reading Northwind MSA 2024.pdf…
                            </span>
                            <Skeleton className="h-3 w-2/3" />
                        </div>
                    </Specimen>
                </div>
            </SubSection>

            {/* ── Inputs ─────────────────────────────────────────────── */}
            <SubSection id="c-inputs" title="Inputs">
                <div className="@max-lg:grid-cols-1 grid grid-cols-2 gap-3">
                    <Specimen source="~/components/field — Field around kit Input / Textarea / Select">
                        <div className="flex flex-col">
                            <Field label="Vendor" htmlFor="demo-vendor">
                                <Input id="demo-vendor" defaultValue="Northwind Analytics" />
                            </Field>
                            <Field
                                label="Annual value"
                                htmlFor="demo-value"
                                hint="In US dollars. Leave it empty if you don't know."
                            >
                                <Input id="demo-value" inputMode="decimal" />
                            </Field>
                            <Field
                                label="Renews on"
                                htmlFor="demo-date"
                                error="Pick the date it renews."
                            >
                                <Input id="demo-date" type="date" aria-invalid />
                            </Field>
                            <Field label="Owner" htmlFor="demo-owner">
                                <Select defaultValue="ada">
                                    <SelectTrigger id="demo-owner" className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ada">Ada Okafor</SelectItem>
                                        <SelectItem value="lin">Lin Wei</SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="Notes" htmlFor="demo-notes">
                                <Textarea
                                    id="demo-notes"
                                    rows={2}
                                    placeholder="Anything the owner should know"
                                />
                            </Field>
                        </div>
                    </Specimen>
                    <Specimen source="Checkbox, RadioGroup, Switch, Slider, Label">
                        <div className="flex flex-col gap-5">
                            <div className="flex items-center gap-2.5">
                                <Checkbox id="demo-check" defaultChecked />
                                <Label htmlFor="demo-check" className="text-sm font-normal">
                                    Include ended contracts
                                </Label>
                            </div>
                            <RadioGroup defaultValue="renew" aria-label="Decision">
                                {[
                                    ["renew", "Renew as it stands"],
                                    ["renegotiate", "Renegotiate before it renews"],
                                    ["end", "Let it end"],
                                ].map(([value, label]) => (
                                    <div key={value} className="flex items-center gap-2.5">
                                        <RadioGroupItem value={value!} id={`demo-r-${value}`} />
                                        <Label
                                            htmlFor={`demo-r-${value}`}
                                            className="text-sm font-normal"
                                        >
                                            {label}
                                        </Label>
                                    </div>
                                ))}
                            </RadioGroup>
                            <label
                                htmlFor="demo-switch"
                                className="text-ink flex items-center gap-3 text-sm"
                            >
                                <Switch id="demo-switch" defaultChecked />
                                Remind the owner 30 days before
                            </label>
                            <div className="flex flex-col gap-2">
                                <Label className="text-ink-2 text-xs font-semibold">
                                    Remind this far ahead
                                </Label>
                                <Slider
                                    defaultValue={[30]}
                                    min={7}
                                    max={90}
                                    step={1}
                                    aria-label="Days ahead"
                                />
                            </div>
                        </div>
                    </Specimen>
                </div>
                <Rules>
                    <Rule why="Field puts the label above, the hint under, the error in place of the hint.">
                        A label on every control, above it. Placeholder is an example, never the
                        label.
                    </Rule>
                    <Rule why="A switch applies at once; a checkbox is part of a form you submit.">
                        Switch for a setting that takes effect now; Checkbox inside a form;
                        RadioGroup for 2–5 visible choices, Select for more.
                    </Rule>
                    <Rule why="Say how to fix it: 'Name the vendor.', not 'Invalid input'.">
                        Errors under the field, on submit, and focus moves to the first one.
                    </Rule>
                </Rules>
            </SubSection>

            {/* ── Display ────────────────────────────────────────────── */}
            <SubSection id="c-display" title="Display">
                <div className="@max-lg:grid-cols-1 grid grid-cols-2 gap-3">
                    <Specimen
                        source="Row list — bordered panel, hairline rows (recipe)"
                        note="Things you scan by name. The house list: Proposals, Extract and Team use it."
                    >
                        <ul className="border-line bg-panel m-0 list-none overflow-hidden rounded-lg border p-0">
                            {[
                                [
                                    "Northwind Analytics",
                                    "Notice due in 25 days",
                                    "warn",
                                    "Needs a decision",
                                ],
                                ["Brightdesk", "Ada Okafor", "secondary", "Renews on its own"],
                                ["Fernway Recruiting", "Sam Rivera", "info", "Renewing"],
                            ].map(([name, meta, tone, status]) => (
                                <li
                                    key={name}
                                    className="border-line-2 hover:bg-panel-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t px-4 py-2.5 first:border-t-0"
                                >
                                    <span className="min-w-0">
                                        <span className="text-ink block truncate text-sm font-medium">
                                            {name}
                                        </span>
                                        <span className="text-ink-3 block truncate text-xs">
                                            {meta}
                                        </span>
                                    </span>
                                    <Badge variant={tone as "warn"}>{status}</Badge>
                                </li>
                            ))}
                        </ul>
                    </Specimen>
                    <Specimen
                        source="~/components/ui/table — Table in a bordered panel"
                        note="Things you compare across columns. Headers text-ink-3 text-xs; numbers right-aligned, tabular."
                    >
                        <div className="border-line overflow-hidden rounded-lg border">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="text-ink-3 pl-4 text-xs">
                                            Vendor
                                        </TableHead>
                                        <TableHead className="text-ink-3 text-xs">Renews</TableHead>
                                        <TableHead className="text-ink-3 text-right text-xs">
                                            Annual value
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {[
                                        ["Harbor Cloud", "31 Dec", "$72,500"],
                                        ["Northwind Analytics", "14 Jan", "$48,000"],
                                        ["Atlas Legal", "1 Feb", "$18,000"],
                                    ].map(([v, d, n]) => (
                                        <TableRow key={v}>
                                            <TableCell className="text-ink pl-4 font-medium">
                                                {v}
                                            </TableCell>
                                            <TableCell className="text-ink-2 tabular-nums">
                                                {d}
                                            </TableCell>
                                            <TableCell className="text-ink-2 text-right tabular-nums">
                                                {n}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </Specimen>
                    <Specimen
                        source="~/components/ui/tabs — Tabs"
                        note="Switching content inside one panel or dialog. A tool's screens are ToolFrame groups, never kit Tabs across the top of a screen."
                    >
                        <Tabs defaultValue="terms">
                            <TabsList>
                                <TabsTrigger value="terms">Terms</TabsTrigger>
                                <TabsTrigger value="parties">Parties</TabsTrigger>
                            </TabsList>
                            <TabsContent value="terms" className="text-ink-2 pt-2 text-sm">
                                Renews for twelve months at a time.
                            </TabsContent>
                            <TabsContent value="parties" className="text-ink-2 pt-2 text-sm">
                                Acme Inc. and Northwind Analytics Ltd.
                            </TabsContent>
                        </Tabs>
                    </Specimen>
                    <Specimen source="Avatar, Separator, Collapsible, ScrollArea">
                        <div className="flex flex-col gap-3">
                            <Row>
                                {["AO", "LW", "PN"].map(i => (
                                    <Avatar key={i} className="size-7">
                                        <AvatarFallback className="text-[11px]">{i}</AvatarFallback>
                                    </Avatar>
                                ))}
                                <span className="text-ink-3 text-xs">Owners</span>
                            </Row>
                            <Separator />
                            <Collapsible>
                                <CollapsibleTrigger asChild>
                                    <Button size="sm" variant="ghost" className="-ml-2">
                                        <ChevronsUpDown />
                                        Ended contracts (2)
                                    </Button>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="text-ink-2 pl-1 pt-1 text-[13px]">
                                    Mosaic Print, Orbit Travel
                                </CollapsibleContent>
                            </Collapsible>
                            <ScrollArea className="border-line h-20 rounded-md border">
                                <div className="text-ink-2 p-3 text-[13px] leading-relaxed">
                                    Use ScrollArea only for a bounded box inside a screen. The
                                    screen itself scrolls in ToolFrame; never give a whole screen
                                    its own scroller. This box holds more text than it shows, so it
                                    scrolls on its own.
                                </div>
                            </ScrollArea>
                        </div>
                    </Specimen>
                </div>
                <DoDont
                    good={
                        <div className="border-line bg-panel rounded-lg border px-4 py-3">
                            <SectionHeading title="Details" className="mb-1" />
                            <p className="text-ink-2 text-sm">
                                One panel per group; rows inside it.
                            </p>
                        </div>
                    }
                    goodNote="One bordered panel per group (border-line bg-panel rounded-lg border). The kit Card is for the rare header/content/footer composition."
                    bad={
                        <div className="rounded-2xl border p-3 shadow-lg">
                            <div className="rounded-xl border p-3">
                                <div className="rounded-lg border p-3 text-sm">
                                    Card in a card in a card
                                </div>
                            </div>
                        </div>
                    }
                    badNote="Card soup: boxes in boxes, three radii, shadows in the page flow. The Settings audit counted 48 bordered boxes on one screen."
                />
            </SubSection>

            {/* ── Overlays and menus ─────────────────────────────────── */}
            <SubSection id="c-overlays" title="Overlays and menus">
                <Specimen source="Dialog, ConfirmDialog, Sheet, Popover, HoverCard, DropdownMenu, Tooltip">
                    <Row>
                        <Dialog open={open} onOpenChange={setOpen}>
                            <DialogTrigger asChild>
                                <Button size="sm">Dialog</Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-md">
                                <DialogHeader>
                                    <DialogTitle>Record a decision</DialogTitle>
                                    <DialogDescription>
                                        Northwind Analytics renews on 14 January 2027.
                                    </DialogDescription>
                                </DialogHeader>
                                <Field label="Note for the owner" htmlFor="demo-dialog-note">
                                    <Textarea id="demo-dialog-note" rows={3} />
                                </Field>
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setOpen(false)}>
                                        Cancel
                                    </Button>
                                    <Button onClick={() => setOpen(false)}>Save decision</Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                        <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>
                            ConfirmDialog
                        </Button>
                        <ConfirmDialog
                            open={confirm}
                            onOpenChange={setConfirm}
                            title="Delete this renewal?"
                            description="Northwind Analytics stops being tracked and nobody is reminded. The contract document stays where it is."
                            confirmLabel="Delete"
                            onConfirm={() => setConfirm(false)}
                        />
                        <Sheet>
                            <SheetTrigger asChild>
                                <Button size="sm" variant="outline">
                                    Sheet
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="right" className="w-[360px] max-w-full">
                                <SheetHeader>
                                    <SheetTitle>History</SheetTitle>
                                    <SheetDescription>
                                        Here it covers the page; inside a ToolFrame it covers only
                                        that tab.
                                    </SheetDescription>
                                </SheetHeader>
                            </SheetContent>
                        </Sheet>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button size="sm" variant="outline">
                                    Popover
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 text-[13px]">
                                <div className="text-ink font-medium">Remind this far ahead</div>
                                <p className="text-ink-3 mt-1">
                                    A small choice anchored to the control that opened it.
                                </p>
                            </PopoverContent>
                        </Popover>
                        <HoverCard>
                            <HoverCardTrigger asChild>
                                <Button size="sm" variant="link" className="px-0">
                                    HoverCard
                                </Button>
                            </HoverCardTrigger>
                            <HoverCardContent className="w-72 text-[13px]">
                                A preview on hover, never the only way to see something: it has no
                                touch equivalent.
                            </HoverCardContent>
                        </HoverCard>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline">
                                    Sort: {sort === "renews" ? "Renews" : "Value"}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
                                    <DropdownMenuRadioItem value="renews">
                                        Renews
                                    </DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="value">
                                        Annual value
                                    </DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </Row>
                </Specimen>
                <Specimen
                    source="~/components/context-menu — useContextTarget + useActionMenu (the ActionMenu primitive)"
                    note="An object's verbs: one pure builder, opened by right-click (and Shift+F10, long-press) and by its ⋯ button. Destructive last, after a separator."
                >
                    <MenuTargetDemo />
                </Specimen>
                <RefTable
                    head={["Need", "Use", "Not"]}
                    rows={[
                        [
                            <>A short task with an end, ≤3–4 inputs</>,
                            <Code key="u">Dialog</Code>,
                            <>A screen (too small) or a Sheet</>,
                        ],
                        [
                            <>&ldquo;Are you sure?&rdquo;</>,
                            <Code key="u">ConfirmDialog</Code>,
                            <>
                                <Code>window.confirm</Code> — embedded views silently refuse it
                            </>,
                        ],
                        [
                            <>Read or edit beside the screen</>,
                            <Code key="u">Sheet</Code>,
                            <>A new screen that loses the place</>,
                        ],
                        [
                            <>A small choice on one control</>,
                            <Code key="u">Popover</Code>,
                            <>A Dialog</>,
                        ],
                        [
                            <>A list of choices from a button</>,
                            <Code key="u">DropdownMenu</Code>,
                            <>A Select (that is a form value)</>,
                        ],
                        [
                            <>An object&apos;s verbs</>,
                            <>
                                <Code>useContextTarget</Code> + builder
                            </>,
                            <>A hand-rolled menu or a DropdownMenu per row</>,
                        ],
                        [
                            <>Name an icon button</>,
                            <Code key="u">Tooltip</Code>,
                            <>The only label (also set aria-label)</>,
                        ],
                    ]}
                />
            </SubSection>

            {/* ── Tool pieces ────────────────────────────────────────── */}
            <SubSection id="c-tool" title="Tool pieces">
                <Specimen
                    source="~/components/tools/PageHeader — PageHeader (title, accent, sub, actions, size)"
                    className="[container-type:inline-size]"
                >
                    <PageHeader
                        title="Contracts"
                        sub="8 contracts from 8 documents"
                        actions={
                            <Button size="sm">
                                <Plus />
                                New renewal
                            </Button>
                        }
                    />
                </Specimen>
                <div className="@max-lg:grid-cols-1 grid grid-cols-2 gap-3">
                    <Specimen
                        source="EmptyState (first run)"
                        note="Names what to do next and carries the control that does it."
                    >
                        <EmptyState
                            title="No renewals yet"
                            body="Add a contract and the date it renews."
                            action={<Button size="sm">New renewal</Button>}
                        />
                    </Specimen>
                    <Specimen
                        source="EmptyState (filtered to nothing)"
                        note="Not the same as empty: say so and offer the way back."
                    >
                        <EmptyState
                            title="No contracts match"
                            body={'Nothing matches "harbr" with that status.'}
                            action={
                                <Button size="sm" variant="outline">
                                    Clear filters
                                </Button>
                            }
                        />
                    </Specimen>
                    <Specimen
                        source="SkeletonRows, SkeletonBlock"
                        note="At the real row height, so nothing jumps when data arrives."
                    >
                        <div className="flex flex-col gap-3">
                            <SkeletonRows rows={2} height={52} />
                            <SkeletonBlock lines={2} />
                        </div>
                    </Specimen>
                    <Specimen
                        source='InlineError, LoadingPage variant="pane"'
                        note="A failed load says what failed and offers Retry. A tab still loading its code shows the pane loader."
                    >
                        <div className="flex flex-col gap-3">
                            <InlineError
                                message="Couldn't load contracts."
                                onRetry={() => toast("Retry")}
                            />
                            <div className="border-line h-24 rounded-md border">
                                <LoadingPage variant="pane" className="min-h-0" />
                            </div>
                        </div>
                    </Specimen>
                    <Specimen
                        source="Cite — a numbered citation with its passage"
                        note="Anything grounded in a document says which one and where, and opens it."
                    >
                        <p className="text-ink text-sm leading-relaxed">
                            It renews for twelve months at a time unless notice is given 30 days
                            before the end of the term <Cite n={1} evidence={EVIDENCE} />.
                        </p>
                    </Specimen>
                </div>
            </SubSection>
        </DocSection>
    );
}

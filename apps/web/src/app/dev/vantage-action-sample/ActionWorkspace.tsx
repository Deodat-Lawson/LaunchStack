"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import {
    Check,
    CheckCircle2,
    ChevronRight,
    Circle,
    CircleHelp,
    FileText,
    Moon,
    RotateCcw,
    Search,
    ShieldCheck,
    Sparkles,
    Star,
    Sun,
} from "lucide-react";
import { roleDirectoryV0 } from "@launchstack/pipelines/vantage/role-context-v0";
import type {
    DemoSource,
    DemoSourceRef,
    DemoHumanDecision,
} from "~/app/employer/tools/vantage/demo-contract";
import { ToolFrame, type ToolNavGroup } from "~/components/tool-app/ToolFrame";
import { ToolNavProvider, useToolNav } from "~/components/tool-app/nav";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "~/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { cn } from "~/lib/utils";
import { CompactTopicRow } from "~/app/employer/tools/vantage/_components/CompactTopicRow";
import { topicPresentation } from "~/app/employer/tools/vantage/_lib/topic-presentation";
import { createItems, sourceKey, refLabel, type SampleData, type SampleItem } from "./sample-model";
import s from "./sample.module.css";

const directory = roleDirectoryV0();
const groups: ToolNavGroup[] = [
    {
        id: "sample",
        items: [
            { to: "/", label: "Your week", exact: true },
            { to: "/review", label: "Weekly review" },
            { to: "/context", label: "Your context" },
        ],
    },
];
const typeLabels = {
    proposal: "AI proposal",
    question: "Historical question",
    commitment: "Committed action",
};
const decisionLabels = { go: "Go", "no-go": "No-go", "needs-more-evidence": "Needs more evidence" };
type PreviewReview = {
    status?: "kept" | "dismissed" | "addressed";
    decision?: { value: DemoHumanDecision["value"]; text: string };
    events: { label: string; detail: string; at: string }[];
};

function dateLabel(value: string, options?: Intl.DateTimeFormatOptions) {
    const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
    return Number.isNaN(parsed.getTime())
        ? value
        : new Intl.DateTimeFormat("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
              ...options,
          }).format(parsed);
}

function sourceTitle(source: DemoSource | undefined, ref: DemoSourceRef) {
    const aliases: Record<string, string> = {
        "workspace-document/14": "Pilot-access constraints",
        "workspace-document/15": "Privacy review record",
        "workspace-document/16": "QA deletion check",
        "workspace-document/18": "Operations deletion audit",
        "workspace-document/19": "Deletion reliability blocker",
    };
    return aliases[ref.id] ?? source?.title ?? refLabel(ref);
}

function reviewLabel(item: SampleItem, review?: PreviewReview) {
    if (review?.decision && review.status === "kept") return "Decision recorded · preview";
    if (review?.status)
        return `${review.status === "kept" ? "Kept for discussion" : review.status === "addressed" ? "Addressed" : "Dismissed"} · preview`;
    if (item.type === "question") return "Current status unverified";
    if (item.type === "commitment") return item.status;
    return item.status === "suggested"
        ? "Needs review"
        : item.status === "kept"
          ? "Kept for discussion"
          : "Dismissed";
}

function ItemIcon({ type }: { type: SampleItem["type"] }) {
    const Icon = type === "proposal" ? Sparkles : type === "question" ? CircleHelp : CheckCircle2;
    return <Icon size={20} className={s.itemIcon} aria-hidden="true" />;
}

/** Isolated client preview: all mutations below are local React state, never product writes. */
export function ActionWorkspace({ data }: { data: SampleData }) {
    const [resetKey, setResetKey] = useState(0);
    return <Workspace key={resetKey} data={data} onReset={() => setResetKey(key => key + 1)} />;
}

function Workspace({ data, onReset }: { data: SampleData; onReset: () => void }) {
    return (
        <div className={s.sample}>
            <div className={s.disclosure}>
                <span>
                    Local synthetic sample{" "}
                    <span className={s.disclosureFull}>· changes stay in this preview</span> · reset
                    on reload
                </span>
                <Button size="sm" variant="ghost" className={s.reset} onClick={onReset}>
                    <RotateCcw size={12} aria-hidden="true" />
                    Reset
                </Button>
            </div>
            <div className={s.frameHost}>
                <ToolNavProvider
                    toolId="vantage"
                    roots={["review", "context"]}
                    host={{
                        active: true,
                        hrefForToolPath: at =>
                            `/dev/vantage-action-sample?at=${encodeURIComponent(at)}`,
                    }}
                >
                    <WorkspaceFrame data={data} />
                </ToolNavProvider>
            </div>
        </div>
    );
}

function WorkspaceFrame({ data }: { data: SampleData }) {
    const nav = useToolNav();
    const linkApplied = useRef(false);
    useEffect(() => {
        if (linkApplied.current) return;
        linkApplied.current = true;
        const at = new URLSearchParams(window.location.search).get("at");
        if (at && ["/", "/review", "/context"].includes(at)) nav.navigate(at);
    }, [nav]);
    const items = useMemo(() => createItems(data), [data]);
    const sources = useMemo(
        () => new Map(data.sources.map(source => [sourceKey(source.source), source])),
        [data.sources]
    );
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [inspectRef, setInspectRef] = useState<DemoSourceRef | null>(null);
    const [reviews, setReviews] = useState<Record<string, PreviewReview>>({});
    const [notice, setNotice] = useState("");
    const origin = useRef<HTMLElement | null>(null);
    const [roleIds, setRoleIds] = useState<string[]>(() => [...data.personal.roles.roleIds]);
    const [primaryRole, setPrimaryRole] = useState(data.personal.roles.primaryRoleId ?? "none");
    const [rolesConfirmed, setRolesConfirmed] = useState(data.personal.roles.userConfirmed);
    const [starKeys, setStarKeys] = useState<Set<string>>(
        () =>
            new Set(
                data.personal.state.stars.map(star => sourceKey(star.lastKnownRef as DemoSourceRef))
            )
    );
    const selected = items.find(item => item.id === selectedId);
    const report = data.state.report;
    const counts = {
        all: items.length,
        proposal: items.filter(item => item.type === "proposal").length,
        question: items.filter(item => item.type === "question").length,
        commitment: items.filter(item => item.type === "commitment").length,
    };
    const filtered = items.filter(
        item =>
            (filter === "all" || item.type === filter) &&
            `${item.title} ${item.originalTitle} ${item.description} ${reviewLabel(item, reviews[item.id])}`
                .toLowerCase()
                .includes(query.toLowerCase().trim())
    );
    const next = items.find(
        item =>
            !reviews[item.id]?.status && (item.type === "question" || item.status === "suggested")
    );
    const remaining = items.filter(
        item =>
            !reviews[item.id]?.status && (item.type === "question" || item.status === "suggested")
    ).length;

    function openItem(item: SampleItem, trigger: HTMLElement) {
        origin.current = trigger;
        setInspectRef(null);
        setSelectedId(item.id);
        setDrawerOpen(true);
    }
    function inspect(ref: DemoSourceRef, trigger: HTMLElement) {
        origin.current = trigger;
        setSelectedId(null);
        setInspectRef(ref);
        setDrawerOpen(true);
    }
    function review(
        item: SampleItem,
        status: NonNullable<PreviewReview["status"]>,
        detail?: string
    ) {
        const label =
            status === "kept"
                ? "Kept for discussion"
                : status === "addressed"
                  ? "Confirmed addressed"
                  : "Dismissed";
        setReviews(previous =>
            previous[item.id]?.status === status
                ? previous
                : {
                      ...previous,
                      [item.id]: {
                          ...previous[item.id],
                          status,
                          events: [
                              ...(previous[item.id]?.events ?? []),
                              {
                                  label: `${label} · local preview`,
                                  detail:
                                      detail ??
                                      "A preview review choice. No action, completion proof, or approval was created.",
                                  at: new Date().toISOString(),
                              },
                          ],
                      },
                  }
        );
        setNotice(`${label} in this preview. No action or approval created.`);
    }
    function recordDecision(item: SampleItem, value: DemoHumanDecision["value"], text: string) {
        setReviews(previous => ({
            ...previous,
            [item.id]: {
                ...previous[item.id],
                status: "kept",
                decision: { value, text },
                events: [
                    ...(previous[item.id]?.events ?? []),
                    {
                        label: "Decision note · local preview",
                        detail: `${decisionLabels[value]}${text ? `: ${text}` : ""}. Review completed in this preview; no approval or action was created.`,
                        at: new Date().toISOString(),
                    },
                ],
            },
        }));
        setNotice("Decision note recorded in this preview. No action or approval created.");
    }
    const contextProps = { data, sources, roleIds, primaryRole, rolesConfirmed, starKeys };
    const isContext = nav.path === "/context";
    const isReview = nav.path === "/review";
    return (
        <ToolFrame
            title="Vantage"
            mark={
                <Sparkles size={20} strokeWidth={1.7} className={s.itemIcon} aria-hidden="true" />
            }
            groups={groups}
            about="An interactive local sample of your weekly review queue. All changes reset on reload."
            status={<ThemeButton />}
            contentClassName={s.frameContent}
            overlay={
                <Sheet
                    open={drawerOpen}
                    onOpenChange={open => {
                        setDrawerOpen(open);
                    }}
                >
                    <SheetContent
                        id="sample-item-detail"
                        className={s.drawer}
                        onCloseAutoFocus={event => {
                            event.preventDefault();
                            const opener = origin.current;
                            window.requestAnimationFrame(() => {
                                if (opener?.isConnected) opener.focus({ preventScroll: true });
                            });
                        }}
                    >
                        {selected ? (
                            <ItemDetail
                                key={selected.id}
                                item={selected}
                                review={reviews[selected.id]}
                                data={data}
                                sources={sources}
                                onReview={review}
                                onDecision={recordDecision}
                                onContext={() => {
                                    setDrawerOpen(false);
                                    nav.navigate("/context");
                                }}
                            />
                        ) : inspectRef ? (
                            <SourceInspector
                                refValue={inspectRef}
                                source={sources.get(sourceKey(inspectRef))}
                            />
                        ) : (
                            <SheetTitle className="sr-only">Review details</SheetTitle>
                        )}
                    </SheetContent>
                </Sheet>
            }
        >
            <main className={s.content}>
                <header className={s.pageHeading}>
                    <div>
                        <p className={s.overline}>
                            Week of {dateLabel(report?.weekStart ?? data.state.selectedWeek)}
                        </p>
                        <h1>
                            {isContext ? "Your context" : isReview ? "Weekly review" : "Your week"}
                        </h1>
                        <p className={s.subtitle}>
                            {isContext
                                ? "Guide the review with your responsibilities and trusted source documents."
                                : isReview
                                  ? "The saved report, grounded in your sources. Choose what deserves a decision."
                                  : `${remaining === 0 ? "Your preview reviews are up to date" : `${remaining} ${remaining === 1 ? "item" : "items"} to review`}. Turn evidence into a clear next step.`}
                        </p>
                    </div>
                    {!isContext && !isReview && (
                        <Button
                            className={s.primaryAction}
                            aria-disabled={!next}
                            onClick={event => {
                                if (next) openItem(next, event.currentTarget);
                            }}
                        >
                            Review next
                            <ChevronRight size={16} aria-hidden="true" />
                        </Button>
                    )}
                </header>
                <div className={s.contextStatus}>
                    <ShieldCheck size={20} aria-hidden="true" />
                    <div>
                        <p>Company Architecture needs review</p>
                        <p className={s.muted}>
                            New generation is blocked. Your saved report is still available.
                        </p>
                    </div>
                    {!isContext && (
                        <Button
                            variant="secondary"
                            className={s.contextButton}
                            onClick={() => nav.navigate("/context")}
                        >
                            Review context
                        </Button>
                    )}
                </div>
                <p role="status" aria-live="polite" className={cn(s.notice, !notice && s.srOnly)}>
                    {notice}
                </p>
                {isContext ? (
                    <ContextView
                        {...contextProps}
                        onToggleRole={id => {
                            setRolesConfirmed(false);
                            setRoleIds(previous =>
                                previous.includes(id)
                                    ? previous.filter(role => role !== id)
                                    : [...previous, id]
                            );
                            if (primaryRole === id) setPrimaryRole("none");
                        }}
                        onPrimary={value => {
                            setPrimaryRole(value);
                            setRolesConfirmed(false);
                        }}
                        onConfirm={() => {
                            setRolesConfirmed(true);
                            setNotice(
                                "Roles confirmed for this local preview. Required context remains unreviewed; the saved report is unchanged."
                            );
                        }}
                        onStar={ref => {
                            const key = sourceKey(ref);
                            setStarKeys(previous => {
                                const result = new Set(previous);
                                if (result.has(key)) result.delete(key);
                                else result.add(key);
                                return result;
                            });
                            setNotice(
                                "Star selection updated in this preview. The saved report keeps its original context."
                            );
                        }}
                        onInspect={inspect}
                    />
                ) : isReview ? (
                    <WeeklyView
                        data={data}
                        items={items}
                        reviews={reviews}
                        onOpen={openItem}
                        selectedId={drawerOpen ? selectedId : null}
                    />
                ) : (
                    <>
                        <div className={s.filters} role="group" aria-label="Filter review items">
                            {(
                                [
                                    ["all", "All"],
                                    ["proposal", "Proposals"],
                                    ["question", "Questions"],
                                    ["commitment", "Actions"],
                                ] as const
                            ).map(([value, label]) => (
                                <Button
                                    key={value}
                                    variant="ghost"
                                    aria-pressed={filter === value}
                                    className={cn(s.filter, filter === value && s.filterActive)}
                                    onClick={() => setFilter(value)}
                                >
                                    {label}
                                    <span className={s.count}>{counts[value]}</span>
                                </Button>
                            ))}
                        </div>
                        <div className={s.search}>
                            <Search size={18} aria-hidden="true" />
                            <Input
                                aria-label="Search your review queue"
                                placeholder="Search your review queue"
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                            />
                            {query && (
                                <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
                                    Clear
                                </Button>
                            )}
                        </div>
                        <div className={s.queue} aria-label="Review queue">
                            {filtered.map(item =>
                                item.topic ? (
                                    <CompactTopicRow
                                        key={item.id}
                                        topic={item.topic}
                                        reviewLabel={reviewLabel(item, reviews[item.id])}
                                        selected={drawerOpen && selectedId === item.id}
                                        onOpen={trigger => openItem(item, trigger)}
                                    />
                                ) : (
                                    <Button
                                        key={item.id}
                                        variant="ghost"
                                        className={cn(
                                            s.row,
                                            drawerOpen && selectedId === item.id && s.selectedRow
                                        )}
                                        onClick={event => openItem(item, event.currentTarget)}
                                        aria-haspopup="dialog"
                                        aria-controls="sample-item-detail"
                                    >
                                        <ItemIcon type={item.type} />
                                        <span className={s.rowCopy}>
                                            <span className={s.rowTitle}>{item.title}</span>
                                            <span className={s.rowSummary}>{item.description}</span>
                                        </span>
                                        <span className={s.rowMeta}>
                                            <span>
                                                {typeLabels[item.type]}
                                                {item.refs.length > 0
                                                    ? ` · ${item.refs.length} exact sources`
                                                    : ""}
                                            </span>
                                            <span>{reviewLabel(item, reviews[item.id])}</span>
                                            {item.refs.some(ref => ref.kind === "company") ? (
                                                <span>Company context unreviewed</span>
                                            ) : null}
                                            {item.owner ? ` · ${item.owner}` : ""}
                                            {item.due ? ` · Due ${dateLabel(item.due)}` : ""}
                                        </span>
                                        <ChevronRight
                                            size={16}
                                            className={s.rowArrow}
                                            aria-hidden="true"
                                        />
                                    </Button>
                                )
                            )}
                            {filtered.length === 0 && (
                                <div className={s.empty}>
                                    <Search size={20} aria-hidden="true" />
                                    <div>
                                        <h2>
                                            {filter === "commitment" && !query
                                                ? "No accepted actions yet"
                                                : "No matching items"}
                                        </h2>
                                        <p>
                                            {filter === "commitment" && !query
                                                ? "Reviewing a proposal does not assign an owner or create a commitment."
                                                : "Try another search or return to all items."}
                                        </p>
                                        <Button
                                            variant="link"
                                            onClick={() => {
                                                setFilter("all");
                                                setQuery("");
                                            }}
                                        >
                                            Show all items
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                        {counts.commitment === 0 && filter !== "commitment" && (
                            <div className={s.actionEmpty}>
                                <Circle size={20} aria-hidden="true" />
                                <div>
                                    <p>No accepted actions yet</p>
                                    <p className={s.muted}>
                                        Reviewing a proposal does not assign an owner or create a
                                        commitment.
                                    </p>
                                </div>
                            </div>
                        )}
                    </>
                )}
                <Provenance data={data} />
            </main>
        </ToolFrame>
    );
}

function ThemeButton() {
    const { resolvedTheme, setTheme } = useTheme();
    return (
        <Button
            size="icon"
            variant="ghost"
            aria-label="Toggle light and dark theme"
            title="Toggle theme"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
            <Moon size={20} className="dark:hidden" aria-hidden="true" />
            <Sun size={20} className="hidden dark:block" aria-hidden="true" />
        </Button>
    );
}

function Provenance({ data }: { data: SampleData }) {
    const report = data.state.report;
    return (
        <footer className={s.provenance}>
            <p>Saved replay · no fresh model call</p>
            <p className={s.code}>
                {report
                    ? `Report v${report.version} · saved ${dateLabel(report.generatedAt)} · ${report.topics.length} proposals`
                    : "No saved report"}{" "}
                · {(data.pending?.questions ?? []).length} historical question
                {data.pending?.questions.length === 1 ? "" : "s"}
            </p>
        </footer>
    );
}

function WeeklyView({
    data,
    items,
    reviews,
    onOpen,
    selectedId,
}: {
    data: SampleData;
    items: SampleItem[];
    reviews: Record<string, PreviewReview>;
    onOpen: (item: SampleItem, trigger: HTMLElement) => void;
    selectedId: string | null;
}) {
    const report = data.state.report;
    const presentationBrief = report?.topics.some(
        topic => topic.title === "Reconcile run-17 samples before a privacy go/no-go"
    )
        ? "QA and Operations report different deletion results; their account samples may differ. No named privacy reviewer's approval is recorded in the supplied evidence."
        : report?.summary;
    return (
        <>
            <section className={s.summary}>
                <div className={s.sectionTop}>
                    <h2>The week at a glance</h2>
                    <span className={s.small}>Presentation brief · saved report</span>
                </div>
                <p>{presentationBrief ?? "No report was present in the captured sample."}</p>
                {report && (
                    <details className={s.details}>
                        <summary>Read full saved summary</summary>
                        <p className={cn(s.body, s.fullSummary)}>{report.summary}</p>
                    </details>
                )}
            </section>
            <section className={s.section}>
                <div className={s.sectionTop}>
                    <h2>Discussion topics</h2>
                    <span className={s.small}>{report?.topics.length ?? 0} proposals</span>
                </div>
                <div className={s.weeklyList}>
                    {items
                        .filter(item => item.type === "proposal")
                        .map(item => (
                            <CompactTopicRow
                                key={item.id}
                                topic={item.topic!}
                                reviewLabel={reviewLabel(item, reviews[item.id])}
                                selected={selectedId === item.id}
                                onOpen={trigger => onOpen(item, trigger)}
                            />
                        ))}
                </div>
            </section>
            {items.some(item => item.type === "question") && (
                <section className={s.section}>
                    <div className={s.sectionTop}>
                        <h2>Carried forward</h2>
                        <span className={s.small}>
                            {items.filter(item => item.type === "question").length} historical
                            question
                        </span>
                    </div>
                    {items
                        .filter(item => item.type === "question")
                        .map(item => (
                            <Button
                                key={item.id}
                                variant="ghost"
                                className={s.row}
                                onClick={event => onOpen(item, event.currentTarget)}
                                aria-haspopup="dialog"
                            >
                                <ItemIcon type="question" />
                                <span className={s.rowCopy}>
                                    <span className={s.rowTitle}>{item.title}</span>
                                    <span className={s.rowDescription}>
                                        Historical question · From{" "}
                                        {dateLabel(item.question!.originWeekStart)} ·{" "}
                                        {reviewLabel(item, reviews[item.id])}
                                    </span>
                                </span>
                                <ChevronRight size={16} className={s.rowArrow} aria-hidden="true" />
                            </Button>
                        ))}
                </section>
            )}
            <details className={s.details}>
                <summary>Saved report provenance</summary>
                <div className={s.detailStack}>
                    <p>
                        This report is the captured earlier TL/Sophia replay. It was not generated
                        from your current Joseph choices.
                    </p>
                    <dl className={s.metadata}>
                        <dt>Report ID</dt>
                        <dd className={s.code}>{report?.id ?? "Unavailable"}</dd>
                        <dt>Generated</dt>
                        <dd>{report?.generatedAt ?? "Unavailable"}</dd>
                        <dt>Context fingerprint</dt>
                        <dd className={s.code}>
                            {report?.diagnostics.contextFingerprint ?? "Unavailable"}
                        </dd>
                    </dl>
                </div>
            </details>
        </>
    );
}

function ContextView({
    data,
    sources,
    roleIds,
    primaryRole,
    rolesConfirmed,
    starKeys,
    onToggleRole,
    onPrimary,
    onConfirm,
    onStar,
    onInspect,
}: {
    data: SampleData;
    sources: Map<string, DemoSource>;
    roleIds: string[];
    primaryRole: string;
    rolesConfirmed: boolean;
    starKeys: Set<string>;
    onToggleRole: (id: string) => void;
    onPrimary: (id: string) => void;
    onConfirm: () => void;
    onStar: (ref: DemoSourceRef) => void;
    onInspect: (ref: DemoSourceRef, trigger: HTMLElement) => void;
}) {
    const [allDocuments, setAllDocuments] = useState(false);
    const [allRoles, setAllRoles] = useState(false);
    const sourceOrder = new Map(
        (data.state.report?.topics[0]?.facts.flatMap(fact => fact.refs) ?? []).map((ref, index) => [
            ref.id,
            index,
        ])
    );
    const docs = data.personal.documents
        .map(document => ({
            ...document,
            ref: { kind: "doc" as const, id: document.id, version: document.version },
        }))
        .sort(
            (a, b) =>
                (sourceOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
                (sourceOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER)
        );
    const displayedDocs = allDocuments ? docs : docs.slice(0, 3);
    const architecture = data.state.companyArchitecture;
    const visibleRoles = allRoles
        ? directory.roles
        : directory.roles.filter(role => roleIds.includes(role.id));
    return (
        <div className={s.contextGrid}>
            <section className={s.contextCard}>
                <h2>Your responsibilities</h2>
                <p className={s.small}>
                    {rolesConfirmed
                        ? "Confirmed for this preview. The saved report is unchanged."
                        : "Suggested roles · confirm your selection for this preview."}
                </p>
                <div className={s.roles}>
                    {visibleRoles.map(role => (
                        <label
                            key={role.id}
                            className={cn(s.role, roleIds.includes(role.id) && s.roleSelected)}
                        >
                            <Checkbox
                                checked={roleIds.includes(role.id)}
                                onCheckedChange={() => onToggleRole(role.id)}
                            />
                            <span>{role.label}</span>
                        </label>
                    ))}
                </div>
                <Button
                    variant="link"
                    className={s.textButton}
                    onClick={() => setAllRoles(value => !value)}
                >
                    {allRoles ? "Show selected roles" : "Edit responsibilities"}
                </Button>
                <div className={s.primaryRole}>
                    <label htmlFor="sample-primary-role">Primary role</label>
                    <Select value={primaryRole} onValueChange={onPrimary}>
                        <SelectTrigger id="sample-primary-role" className={s.primarySelect}>
                            <SelectValue placeholder="No primary selected" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">No primary selected</SelectItem>
                            {directory.roles
                                .filter(role => roleIds.includes(role.id))
                                .map(role => (
                                    <SelectItem key={role.id} value={role.id}>
                                        {role.label}
                                    </SelectItem>
                                ))}
                        </SelectContent>
                    </Select>
                </div>
                <p className={s.small}>Roles guide perspective. They do not change access.</p>
                <Button className={s.fitButton} onClick={onConfirm}>
                    {rolesConfirmed ? <Check size={16} aria-hidden="true" /> : null}
                    {rolesConfirmed ? "Roles confirmed · preview" : "Confirm roles"}
                </Button>
                <div className={s.documentHeading}>
                    <h2>Starred documents</h2>
                    <p className={s.small}>
                        {starKeys.size} starred · Pin an exact document version for later context.
                    </p>
                </div>
                <div>
                    {displayedDocs.map(document => {
                        const source = sources.get(sourceKey(document.ref));
                        const title = sourceTitle(source, document.ref);
                        const starred = starKeys.has(sourceKey(document.ref));
                        return (
                            <div className={s.documentRow} key={document.id}>
                                <FileText size={20} className={s.muted} aria-hidden="true" />
                                <div className={s.documentCopy}>
                                    <button
                                        type="button"
                                        className={s.sourceTitle}
                                        disabled={!source}
                                        onClick={event =>
                                            onInspect(document.ref, event.currentTarget)
                                        }
                                    >
                                        {title}
                                    </button>
                                    <span className={s.code}>
                                        v{document.version}
                                        {!source ? " · body unavailable in this snapshot" : ""}
                                    </span>
                                </div>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label={`${starred ? "Unstar" : "Star"} ${title} version ${document.version}`}
                                    aria-pressed={starred}
                                    className={cn(s.star, starred && s.starred)}
                                    onClick={() => onStar(document.ref)}
                                >
                                    <Star size={20} aria-hidden="true" />
                                </Button>
                            </div>
                        );
                    })}
                </div>
                {docs.length > 3 && (
                    <Button
                        variant="link"
                        className={s.textButton}
                        onClick={() => setAllDocuments(value => !value)}
                    >
                        {allDocuments
                            ? "Show fewer documents"
                            : `${docs.length - 3} more documents available`}
                    </Button>
                )}
            </section>
            <aside className={s.contextCard}>
                <ShieldCheck size={20} className={s.itemIcon} aria-hidden="true" />
                <h2>Required context</h2>
                <p>Company Architecture</p>
                <p className={s.small}>
                    {architecture?.reviewState ?? "Unreviewed"} · Not included
                </p>
                <p className={s.body}>
                    Readable source, incomplete generation bundle. New generation stays blocked.
                </p>
                {architecture && (
                    <Button
                        variant="outline"
                        className={s.fitButton}
                        onClick={event => onInspect(architecture.source, event.currentTarget)}
                    >
                        Inspect source
                    </Button>
                )}
                <p className={s.small}>
                    Current choices apply to future context preparation. The saved report keeps its
                    original manifest.
                </p>
                <details className={s.contextDetails}>
                    <summary>Captured readiness details</summary>
                    <p>{data.personal.blocker ?? "Required context is not ready."}</p>
                    {data.personal.diagnostics.sources.map((entry, index) => (
                        <p key={index}>{entry.reason ?? entry.status}</p>
                    ))}
                </details>
            </aside>
            <p className={s.contextFootnote}>
                Local preview · Role and star changes reset on reload. Saved report context stays
                unchanged.
            </p>
        </div>
    );
}

function ItemDetail({
    item,
    review,
    data,
    sources,
    onReview,
    onDecision,
    onContext,
}: {
    item: SampleItem;
    review?: PreviewReview;
    data: SampleData;
    sources: Map<string, DemoSource>;
    onReview: (
        item: SampleItem,
        status: NonNullable<PreviewReview["status"]>,
        detail?: string
    ) => void;
    onDecision: (item: SampleItem, value: DemoHumanDecision["value"], text: string) => void;
    onContext: () => void;
}) {
    const [tab, setTab] = useState("overview");
    const [showDecision, setShowDecision] = useState(false);
    const [decisionValue, setDecisionValue] =
        useState<DemoHumanDecision["value"]>("needs-more-evidence");
    const [decisionText, setDecisionText] = useState("");
    const [showAddressed, setShowAddressed] = useState(false);
    const [addressedNote, setAddressedNote] = useState("");
    const primaryReviewControl = useRef<HTMLButtonElement | null>(null);
    const decisionControl = useRef<HTMLButtonElement | null>(null);
    const topic = item.topic;
    const presentation = topic ? topicPresentation(topic) : null;
    return (
        <>
            <div className={s.drawerHeader}>
                <p className={s.drawerOverline}>{typeLabels[item.type]}</p>
                <SheetTitle className={s.drawerTitle}>{item.title}</SheetTitle>
                <SheetDescription className={s.drawerDescription}>
                    {reviewLabel(item, review)} ·{" "}
                    {item.owner ? `Owner: ${item.owner}` : "No owner assigned"}
                    {item.due ? ` · Due ${dateLabel(item.due)}` : " · No due date assigned"}
                </SheetDescription>
            </div>
            <Tabs value={tab} onValueChange={setTab} className={s.drawerTabs}>
                <TabsList className={s.detailTabs}>
                    {["Overview", "Evidence", "History", "Context"].map(label => (
                        <TabsTrigger
                            key={label}
                            value={label.toLowerCase()}
                            className={s.detailTab}
                        >
                            {label}
                        </TabsTrigger>
                    ))}
                </TabsList>
                <TabsContent value="overview" className={s.tabContent}>
                    <DetailSection
                        title={
                            topic
                                ? "Issue"
                                : item.type === "question"
                                  ? "Historical question"
                                  : "Completion test"
                        }
                    >
                        <p className={s.body}>{presentation?.issue ?? item.description}</p>
                    </DetailSection>
                    {presentation?.reason && (
                        <DetailSection title="Why this matters">
                            <p className={s.interpretationLabel}>AI interpretation</p>
                            <p className={s.body}>{presentation.reason}</p>
                        </DetailSection>
                    )}
                    {presentation && presentation.approach.length > 0 && (
                        <details className={s.details}>
                            <summary>Suggested approach</summary>
                            <ul className={s.approachList}>
                                {presentation.approach.map(step => (
                                    <li key={step}>{step}</li>
                                ))}
                            </ul>
                        </details>
                    )}
                    {presentation?.decision && (
                        <details className={s.details}>
                            <summary>Decision to make</summary>
                            <p className={s.disclosureBody}>{presentation.decision}</p>
                        </details>
                    )}
                    <Button
                        variant="ghost"
                        className={s.evidenceOverview}
                        onClick={() => setTab("evidence")}
                    >
                        <FileText size={20} aria-hidden="true" />
                        <span>
                            {item.refs.length
                                ? `${item.refs.length} exact sources · View evidence`
                                : item.legacyRefs?.length
                                  ? `${item.legacyRefs.length} historical reference · View evidence`
                                  : "No exact source version on file"}
                        </span>
                        <ChevronRight size={16} aria-hidden="true" />
                    </Button>
                    {topic?.unknowns.length ? (
                        <details className={s.details}>
                            <summary>Unknowns and limitations ({topic.unknowns.length})</summary>
                            <ul className={s.plainList}>
                                {topic.unknowns.map(unknown => (
                                    <li key={unknown}>{unknown}</li>
                                ))}
                            </ul>
                        </details>
                    ) : null}
                    {item.question && (
                        <DetailSection title="Historical record">
                            <p className={s.small}>
                                Origin week {dateLabel(item.question.originWeekStart)}. This
                                question remains separate from current report proposals. Current
                                status is unverified until a human reviews its evidence.
                            </p>
                        </DetailSection>
                    )}
                    {topic ? (
                        <details className={s.details}>
                            <summary>Original report wording</summary>
                            <div className={s.originalWording}>
                                <h3>Original title</h3>
                                <p>{item.originalTitle}</p>
                                <h3>Why it merits discussion</h3>
                                <p>{topic.whyItMatters}</p>
                                <h3>Decision question</h3>
                                <p>{topic.decisionQuestion}</p>
                                <h3>Original suggested next step</h3>
                                <p>{topic.proposedNextStep}</p>
                                <h3>Rationale</h3>
                                <p>{topic.rationale}</p>
                            </div>
                        </details>
                    ) : (
                        <DetailSection title="Original title" quiet>
                            <p className={s.small}>{item.originalTitle}</p>
                        </DetailSection>
                    )}
                    {review?.decision && (
                        <div className={s.savedDecision}>
                            <CheckCircle2 size={18} aria-hidden="true" />
                            <div>
                                <p>Preview decision: {decisionLabels[review.decision.value]}</p>
                                <p className={s.small}>
                                    {review.decision.text || "No note entered."}
                                </p>
                                <p className={s.small}>
                                    No approval or committed action was created.
                                </p>
                            </div>
                        </div>
                    )}
                    {topic && (
                        <>
                            <div className={s.reviewActions}>
                                <Button
                                    ref={primaryReviewControl}
                                    onClick={() => onReview(item, "kept")}
                                    aria-disabled={review?.status === "kept"}
                                >
                                    {review?.status === "kept"
                                        ? "Kept for discussion"
                                        : "Keep for discussion"}
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => onReview(item, "dismissed")}
                                    aria-disabled={review?.status === "dismissed"}
                                >
                                    Dismiss
                                </Button>
                            </div>
                            <Button
                                ref={decisionControl}
                                variant="link"
                                className={s.textButton}
                                onClick={() => setShowDecision(value => !value)}
                            >
                                {showDecision
                                    ? "Cancel decision note"
                                    : review?.decision
                                      ? "Update decision note"
                                      : "Record a decision"}
                            </Button>
                            {showDecision && (
                                <form
                                    className={s.form}
                                    onSubmit={event => {
                                        event.preventDefault();
                                        onDecision(item, decisionValue, decisionText.trim());
                                        setShowDecision(false);
                                        decisionControl.current?.focus();
                                    }}
                                >
                                    <label htmlFor="sample-decision">
                                        Decision for this preview
                                    </label>
                                    <Select
                                        value={decisionValue}
                                        onValueChange={value =>
                                            setDecisionValue(value as DemoHumanDecision["value"])
                                        }
                                    >
                                        <SelectTrigger id="sample-decision">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {Object.entries(decisionLabels).map(
                                                ([value, label]) => (
                                                    <SelectItem key={value} value={value}>
                                                        {label}
                                                    </SelectItem>
                                                )
                                            )}
                                        </SelectContent>
                                    </Select>
                                    <label htmlFor="sample-decision-note">Decision note</label>
                                    <Textarea
                                        id="sample-decision-note"
                                        value={decisionText}
                                        onChange={event => setDecisionText(event.target.value)}
                                        placeholder="What did you decide, and why?"
                                    />
                                    <p className={s.small}>
                                        A preview decision note grants no access approval and
                                        creates no action.
                                    </p>
                                    <Button type="submit">Save preview decision</Button>
                                </form>
                            )}
                        </>
                    )}
                    {item.question && (
                        <>
                            <div className={s.reviewActions}>
                                <Button
                                    ref={primaryReviewControl}
                                    onClick={() => {
                                        if (review?.status !== "addressed")
                                            setShowAddressed(value => !value);
                                    }}
                                    aria-disabled={review?.status === "addressed"}
                                >
                                    {review?.status === "addressed"
                                        ? "Addressed · preview"
                                        : "Confirm addressed"}
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => onReview(item, "dismissed")}
                                    aria-disabled={review?.status === "dismissed"}
                                >
                                    Dismiss
                                </Button>
                            </div>
                            {showAddressed && (
                                <form
                                    className={s.form}
                                    onSubmit={event => {
                                        event.preventDefault();
                                        if (!addressedNote.trim()) return;
                                        onReview(
                                            item,
                                            "addressed",
                                            `Human preview note: ${addressedNote.trim()}. This is not independently verified completion or approval.`
                                        );
                                        setShowAddressed(false);
                                        primaryReviewControl.current?.focus();
                                    }}
                                >
                                    <label htmlFor="sample-addressed-note">
                                        What evidence addresses this question?
                                    </label>
                                    <Textarea
                                        id="sample-addressed-note"
                                        required
                                        value={addressedNote}
                                        onChange={event => setAddressedNote(event.target.value)}
                                        placeholder="Name the evidence you reviewed. A related AI proposal does not establish completion."
                                    />
                                    <Button type="submit" disabled={!addressedNote.trim()}>
                                        Save preview confirmation
                                    </Button>
                                </form>
                            )}
                        </>
                    )}
                    <p className={s.previewNote}>
                        Preview only · No action or approval is created.
                    </p>
                </TabsContent>
                <TabsContent value="evidence" className={s.tabContent}>
                    <p className={s.small}>
                        Select a source to inspect its captured excerpt, exact version and
                        provenance. This sample does not revalidate current access.
                    </p>
                    {topic && (
                        <details className={s.details}>
                            <summary>Reported statements and conflicts</summary>
                            <div className={s.originalWording}>
                                {topic && (
                                    <DetailSection title="What the sources report">
                                        <ul className={s.factList}>
                                            {topic.facts.map((fact, index) => (
                                                <li key={index}>
                                                    <p>{fact.text}</p>
                                                    <div className={s.refChips}>
                                                        {fact.refs.map(ref => (
                                                            <span key={sourceKey(ref)}>
                                                                {sourceTitle(
                                                                    sources.get(sourceKey(ref)),
                                                                    ref
                                                                )}{" "}
                                                                · v
                                                                {ref.version.length < 20
                                                                    ? ref.version
                                                                    : "exact version"}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </DetailSection>
                                )}
                                {topic?.conflicts.length ? (
                                    <DetailSection title="Conflicting evidence">
                                        <ul className={s.factList}>
                                            {topic.conflicts.map((conflict, index) => (
                                                <li key={index}>
                                                    <p>{conflict.text}</p>
                                                </li>
                                            ))}
                                        </ul>
                                    </DetailSection>
                                ) : null}
                            </div>
                        </details>
                    )}
                    <DetailSection title="Exact sources">
                        {item.refs.length === 0 && (
                            <p className={s.small}>
                                No exact source version is attached to this historical record.
                            </p>
                        )}
                        {item.refs.map(ref => (
                            <details key={sourceKey(ref)} className={s.sourceDisclosure}>
                                <summary>
                                    <FileText size={18} aria-hidden="true" />
                                    <span>{sourceTitle(sources.get(sourceKey(ref)), ref)}</span>
                                    <ChevronRight size={16} aria-hidden="true" />
                                </summary>
                                <SourceBody source={sources.get(sourceKey(ref))} refValue={ref} />
                            </details>
                        ))}
                    </DetailSection>
                    {item.legacyRefs?.length ? (
                        <DetailSection title="Historical references">
                            {item.legacyRefs.map(ref => (
                                <div key={ref.ref} className={s.legacyRef}>
                                    <p>
                                        {ref.label}
                                        {ref.date ? ` · ${ref.date}` : ""}
                                    </p>
                                    <p className={s.code}>{ref.ref}</p>
                                    <p className={s.small}>
                                        No exact version or source body was captured for this
                                        historical reference.
                                    </p>
                                </div>
                            ))}
                        </DetailSection>
                    ) : null}
                </TabsContent>
                <TabsContent value="history" className={s.tabContent}>
                    <DetailSection title="Record history">
                        <ol className={s.timeline}>
                            {[...item.history, ...(review?.events ?? [])].map((event, index) => (
                                <li key={`${event.label}:${index}`}>
                                    <span className={s.timelineDot} />
                                    <div>
                                        <h3>{event.label}</h3>
                                        {event.at && (
                                            <time className={s.small} dateTime={event.at}>
                                                {dateLabel(event.at, {
                                                    hour: "numeric",
                                                    minute: "2-digit",
                                                })}
                                            </time>
                                        )}
                                        <p>{event.detail}</p>
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </DetailSection>
                </TabsContent>
                <TabsContent value="context" className={s.tabContent}>
                    <SavedContext data={data} />
                    <Button variant="outline" onClick={onContext}>
                        Manage your current context
                        <ChevronRight size={16} aria-hidden="true" />
                    </Button>
                </TabsContent>
            </Tabs>
        </>
    );
}

function DetailSection({
    title,
    quiet,
    children,
}: {
    title: string;
    quiet?: boolean;
    children: ReactNode;
}) {
    return (
        <section className={s.detailSection}>
            <h3 className={quiet ? s.quietHeading : undefined}>{title}</h3>
            {children}
        </section>
    );
}

function SavedContext({ data }: { data: SampleData }) {
    const manifest = data.state.report?.diagnostics.context;
    return (
        <div className={s.detailStack}>
            <h3>Context of the saved report</h3>
            <p className={s.body}>
                This is the earlier TL/Sophia replay. Your current Joseph role and star choices do
                not change its saved context.
            </p>
            <dl className={s.metadata}>
                <dt>Manifest</dt>
                <dd>{manifest?.manifestStatus ?? "Not recorded"}</dd>
                <dt>Roles at capture</dt>
                <dd>{manifest?.roleIds.length ? manifest.roleIds.join(", ") : "Not recorded"}</dd>
                <dt>Stars at capture</dt>
                <dd>{manifest?.personalStarCount ?? "Not recorded"}</dd>
                <dt>Sources selected</dt>
                <dd>{manifest?.selectedCount ?? "Not recorded"}</dd>
                <dt>Sources omitted</dt>
                <dd>{manifest?.omittedCount ?? "Not recorded"}</dd>
                <dt>Research</dt>
                <dd>{manifest?.researchStatus ?? "Not recorded"}</dd>
            </dl>
            <div className={s.contextStatus}>
                <ShieldCheck size={20} aria-hidden="true" />
                <div>
                    <p>Current generation remains blocked</p>
                    <p className={s.small}>
                        Company Architecture is unreviewed. This preview cannot mark it approved.
                    </p>
                </div>
            </div>
        </div>
    );
}

function SourceInspector({ source, refValue }: { source?: DemoSource; refValue: DemoSourceRef }) {
    return (
        <>
            <div className={s.drawerHeader}>
                <p className={s.drawerOverline}>Exact source</p>
                <SheetTitle className={s.drawerTitle}>{sourceTitle(source, refValue)}</SheetTitle>
                <SheetDescription>Captured source · read-only</SheetDescription>
            </div>
            <SourceBody source={source} refValue={refValue} />
        </>
    );
}

function SourceBody({ source, refValue }: { source?: DemoSource; refValue: DemoSourceRef }) {
    return (
        <div className={s.sourceBody}>
            <p className={s.small}>
                Captured synthetic source · current access is not rechecked in this preview.
            </p>
            <dl className={s.metadata}>
                <dt>Original title</dt>
                <dd>{source?.title ?? "Unavailable"}</dd>
                <dt>Source ID</dt>
                <dd className={s.code}>{refValue.id}</dd>
                <dt>Exact version</dt>
                <dd className={s.code}>{refValue.version}</dd>
                {source?.sourceDate && (
                    <>
                        <dt>Source date</dt>
                        <dd>{dateLabel(source.sourceDate)}</dd>
                    </>
                )}
                {source?.reviewState && (
                    <>
                        <dt>Review state</dt>
                        <dd>{source.reviewState}</dd>
                    </>
                )}
            </dl>
            {source ? (
                <>
                    <p className={s.small}>Authority recorded at capture: {source.authority}</p>
                    <div className={s.sourceText}>{source.body}</div>
                    <details className={s.details}>
                        <summary>Content hash</summary>
                        <p className={s.code}>{source.contentHash}</p>
                    </details>
                </>
            ) : (
                <p className={s.small}>
                    The exact source body was not available in this captured sample. No content is
                    reconstructed.
                </p>
            )}
        </div>
    );
}

"use client";

import {
    ArrowDown,
    ArrowUp,
    Check,
    Copy,
    ExternalLink,
    MessageSquare,
    MoreHorizontal,
    Plus,
    Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import { useToolRouter } from "~/components/tool-app/nav";
import { ToolNotFound } from "~/components/tool-app/ToolFrame";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { cn } from "~/lib/utils";

import { EvidenceRows } from "~/components/tools/Cite";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { SkeletonBlock } from "~/components/tools/SkeletonRows";
import { useToolFormat } from "~/lib/tools/format";
import { useResource } from "~/lib/tools/useResource";
import {
    ApplicationStatusMenu,
    ReadinessMeter,
    SectionStatusPill,
    SeverityWord,
    StatusWord,
} from "../_components/Pills";
import { runIsLive, useProposals } from "../_lib/context";
import { SECTION_TONE, amountWords, deadlineTone, deadlineWords } from "../_lib/words";
import {
    ProposalsApiError,
    proposalsApi,
    type ApplicationDetail,
    type ApplicationStatus,
    type RequirementDto,
    type RewritePreset,
    type RunDto,
    type SectionDto,
} from "../api";

/** Checklist groups in this order; labels are `proposals.requirementKind.<kind>`. */
const KIND_ORDER: RequirementDto["kind"][] = [
    "eligibility",
    "deadline",
    "budget",
    "section",
    "attachment",
    "format",
];
const PRESETS: RewritePreset[] = ["tighten", "specific", "plainer", "stronger", "custom"];

/** What a run that could not start was for: `proposals.application.startFailed.<what>`. */
type RunWhat = "rewrite" | "drafting" | "review" | "extract";

/**
 * A question for the Studio chat about this section, with the sources in
 * view. It is a prompt for the model, so it stays in English.
 */
function askPrompt(section: SectionDto, app: ApplicationDetail): string {
    return `I am writing the "${section.question}" section of our proposal to ${app.funder ?? "a funder"} ("${app.title}"). Which of our sources say something about this? Quote the passages, name the documents, and tell me what is missing.`;
}

function askHref(section: SectionDto, app: ApplicationDetail): string {
    return `/employer/documents?ask=${encodeURIComponent(askPrompt(section, app))}`;
}

// ─── Outline ─────────────────────────────────────────────────────────────────

const DOT: Record<SectionDto["status"], string> = {
    empty: "border-line border",
    drafted: "bg-brand",
    edited: "bg-info",
    approved: "bg-success",
};

function Outline({
    sections,
    selectedId,
    onSelect,
    readiness,
    children,
}: {
    sections: SectionDto[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    readiness: number;
    children?: React.ReactNode;
}) {
    const t = useTranslations("proposals.application.outline");
    return (
        <aside className="@max-xl:row-span-2 @max-lg:static @max-lg:row-auto @max-lg:self-auto sticky top-6 flex flex-col gap-3 self-start">
            <div className="flex items-center justify-between px-1">
                <span className="text-ink-3 text-xs">
                    {t("written", {
                        written: sections.filter(s => s.status !== "empty").length,
                        total: sections.length,
                    })}
                </span>
                <ReadinessMeter value={readiness} />
            </div>
            <ol className="border-line bg-panel overflow-hidden rounded-lg border">
                {sections.map((s, i) => {
                    const selected = s.id === selectedId;
                    const over = s.wordLimit !== null && s.words > s.wordLimit;
                    return (
                        <li key={s.id} className="border-line-2 border-t first:border-t-0">
                            <button
                                type="button"
                                onClick={() => onSelect(s.id)}
                                aria-current={selected ? "true" : undefined}
                                className={cn(
                                    "focus-visible:ring-brand/50 grid w-full grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-inset",
                                    selected ? "bg-brand-soft" : "hover:bg-panel-2"
                                )}
                            >
                                <span
                                    className={cn("size-[7px] rounded-full", DOT[s.status])}
                                    aria-hidden
                                />
                                <span
                                    className={cn(
                                        "truncate text-[13px]",
                                        selected ? "text-ink font-medium" : "text-ink-2"
                                    )}
                                >
                                    {i + 1}. {s.question}
                                </span>
                                <span
                                    className={cn(
                                        "font-mono text-[10.5px] tabular-nums",
                                        over ? "text-warn" : "text-ink-3"
                                    )}
                                >
                                    {s.words}
                                    {s.wordLimit ? `/${s.wordLimit}` : ""}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ol>
            {children}
        </aside>
    );
}

function AddSectionForm({
    applicationId,
    onAdded,
}: {
    applicationId: string;
    onAdded: (section: SectionDto) => void;
}) {
    const t = useTranslations("proposals.application.addSection");
    const tp = useTranslations("proposals.common");
    const tc = useTranslations("common");
    const [open, setOpen] = useState(false);
    const [question, setQuestion] = useState("");
    const [limit, setLimit] = useState("");
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        setBusy(true);
        try {
            const { section } = await proposalsApi.addSection(applicationId, {
                question: question.trim(),
                wordLimit: limit ? Number(limit) : null,
            });
            onAdded(section);
            setQuestion("");
            setLimit("");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("failed"));
        } finally {
            setBusy(false);
        }
    };
    if (!open)
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="text-ink-2 hover:text-ink focus-visible:ring-brand/50 inline-flex items-center gap-2 rounded-md px-1 py-1 text-[13px] outline-none focus-visible:ring-2"
            >
                <Plus className="size-3.5" />
                {t("open")}
            </button>
        );
    return (
        <form
            className="border-line bg-panel grid gap-2 rounded-lg border px-3 py-3"
            onSubmit={e => {
                e.preventDefault();
                if (question.trim() && !busy) void submit();
            }}
        >
            <div className="grid gap-1">
                <Label htmlFor="new-section" className="text-xs">
                    {tp("question")}
                </Label>
                <Input
                    id="new-section"
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    autoFocus
                />
            </div>
            <div className="grid gap-1">
                <Label htmlFor="new-section-limit" className="text-xs">
                    {t("wordLimit")}
                </Label>
                <Input
                    id="new-section-limit"
                    inputMode="numeric"
                    value={limit}
                    onChange={e => setLimit(e.target.value.replace(/[^0-9]/g, ""))}
                />
            </div>
            <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={!question.trim() || busy}>
                    {tc("actions.add")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                    {tc("actions.cancel")}
                </Button>
            </div>
        </form>
    );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function WordMeter({ words, limit }: { words: number; limit: number | null }) {
    const t = useTranslations("proposals.application.editor");
    if (!limit) return null;
    const share = Math.min(100, (words / limit) * 100);
    const over = words > limit;
    return (
        <span
            className="bg-line relative block h-1 w-24 overflow-hidden rounded-full"
            title={t("wordMeter", { words, limit })}
            aria-hidden
        >
            <span
                className={cn(
                    "absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 motion-reduce:transition-none",
                    over ? "bg-warn" : share > 85 ? "bg-ink-2" : "bg-ink-3"
                )}
                style={{ width: `${share}%` }}
            />
        </span>
    );
}

function RewriteDialog({
    open,
    onOpenChange,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (instruction: string) => void;
}) {
    const t = useTranslations("proposals.application.rewriteDialog");
    const tc = useTranslations("common");
    const [text, setText] = useState("");
    useEffect(() => {
        if (open) setText("");
    }, [open]);
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>{t("description")}</DialogDescription>
                </DialogHeader>
                <form
                    className="grid gap-3"
                    onSubmit={e => {
                        e.preventDefault();
                        if (text.trim()) onSubmit(text.trim());
                    }}
                >
                    <Textarea
                        value={text}
                        onChange={e => setText(e.target.value)}
                        rows={4}
                        placeholder={t("placeholder")}
                        aria-label={t("aria")}
                        autoFocus
                        maxLength={600}
                    />
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                            {tc("actions.cancel")}
                        </Button>
                        <Button type="submit" disabled={!text.trim()}>
                            {t("submit")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function SectionEditor({
    app,
    section,
    busy,
    onChange,
    onRun,
    onRemove,
    index,
    total,
    onStep,
}: {
    app: ApplicationDetail;
    section: SectionDto;
    busy: boolean;
    onChange: (section: SectionDto) => void;
    onRun: (start: () => Promise<{ run: RunDto }>, what: RunWhat) => Promise<void>;
    onRemove: () => void;
    index: number;
    total: number;
    onStep: (delta: 1 | -1) => void;
}) {
    const t = useTranslations("proposals.application.editor");
    const tp = useTranslations("proposals.common");
    const tPreset = useTranslations("proposals.rewritePreset");
    const format = useToolFormat();
    const [draft, setDraft] = useState(section.draft ?? "");
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [customOpen, setCustomOpen] = useState(false);
    const timer = useRef<number | null>(null);
    useEffect(() => {
        if (!dirty) setDraft(section.draft ?? "");
    }, [section.id, section.draft, dirty]);
    useEffect(() => {
        setDirty(false);
        setDraft(section.draft ?? "");
    }, [section.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;
    const over = section.wordLimit !== null && words > section.wordLimit;

    const save = async (patch: Parameters<typeof proposalsApi.patchSection>[2], done?: string) => {
        setSaving(true);
        try {
            const { section: next } = await proposalsApi.patchSection(app.id, section.id, patch);
            onChange(next);
            setDirty(false);
            if (done) toast.success(done);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("saveFailed"));
        } finally {
            setSaving(false);
        }
    };
    const onType = (value: string) => {
        setDraft(value);
        setDirty(true);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void save({ draft: value }), 800);
    };
    const rewrite = (preset: RewritePreset, instruction?: string) =>
        void onRun(
            () => proposalsApi.rewriteSection(app.id, section.id, { preset, instruction }),
            "rewrite"
        );
    const saveToLibrary = async () => {
        try {
            await proposalsApi.saveToLibrary(app.id, section.id);
            toast.success(t("savedToLibrary"));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("saveToLibraryFailed"));
        }
    };
    const hasDraft = draft.trim().length > 0;

    return (
        <section
            id={`section-${section.key}`}
            className="border-line bg-panel flex min-w-0 flex-col gap-3 rounded-lg border px-5 py-4"
        >
            <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-ink-3 text-xs">
                        {t("position", { n: index + 1, total })}
                        {!section.required && ` · ${t("optional")}`}
                    </div>
                    <h2 className="text-ink mt-0.5 text-[16px] font-semibold leading-snug">
                        {section.question}
                    </h2>
                    {section.guidance && (
                        <p className="text-ink-3 mt-1 max-w-[70ch] text-xs leading-relaxed">
                            {section.guidance}
                        </p>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={index === 0}
                        onClick={() => onStep(-1)}
                        aria-label={t("previous")}
                    >
                        <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={index >= total - 1}
                        onClick={() => onStep(1)}
                        aria-label={t("next")}
                    >
                        <ArrowDown className="size-3.5" />
                    </Button>
                </div>
            </header>

            {!hasDraft && section.status === "empty" ? (
                <div className="border-line-2 flex flex-col items-start gap-2 rounded-md border border-dashed px-4 py-5">
                    <p className="text-ink-2 text-[13px]">{t("empty")}</p>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                                void onRun(
                                    () => proposalsApi.draftSection(app.id, section.id),
                                    "drafting"
                                )
                            }
                        >
                            <Sparkles className="size-3.5" />
                            {t("draft")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onType(" ")}>
                            {t("byHand")}
                        </Button>
                    </div>
                </div>
            ) : (
                <Textarea
                    value={draft}
                    onChange={e => onType(e.target.value)}
                    rows={Math.min(26, Math.max(10, Math.ceil(draft.length / 80)))}
                    className="text-[14px] leading-[1.6]"
                    aria-label={t("answerAria", { question: section.question })}
                />
            )}

            <div className="text-ink-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <WordMeter words={words} limit={section.wordLimit} />
                <span className={cn("tabular-nums", over && "text-warn")}>
                    {section.wordLimit
                        ? t("wordsOfLimit", { words, limit: section.wordLimit })
                        : t("words", { words })}
                    {over ? ` · ${t("overLimit")}` : ""}
                </span>
                <SectionStatusPill status={section.status} />
                {section.draftedAt && (
                    <span>{t("drafted", { time: format.relativeTime(section.draftedAt) })}</span>
                )}
                {saving ? <span>{t("saving")}</span> : dirty ? <span>{t("unsaved")}</span> : null}
            </div>

            <div className="border-line-2 flex flex-wrap items-center gap-2 border-t pt-3">
                <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                        void onRun(() => proposalsApi.draftSection(app.id, section.id), "drafting")
                    }
                >
                    <Sparkles className="size-3.5" />
                    {hasDraft ? t("redraft") : t("draft")}
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild disabled={busy || !hasDraft}>
                        <Button size="sm" variant="outline">
                            {t("rewrite")}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64">
                        <DropdownMenuLabel className="text-ink-3 text-xs font-normal">
                            {t("rewriteKeeps")}
                        </DropdownMenuLabel>
                        {PRESETS.map(preset => (
                            <DropdownMenuItem
                                key={preset}
                                disabled={preset === "tighten" && !section.wordLimit && !over}
                                onSelect={() =>
                                    preset === "custom" ? setCustomOpen(true) : rewrite(preset)
                                }
                            >
                                {tPreset(preset)}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
                <span className="ml-auto flex items-center gap-1.5">
                    {section.status === "approved" ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void save({ status: "edited" }, t("approvalRemoved"))}
                        >
                            {t("unapprove")}
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            disabled={!hasDraft || saving}
                            onClick={() => void save({ draft, status: "approved" }, t("approved"))}
                        >
                            <Check className="size-3.5" />
                            {t("approve")}
                        </Button>
                    )}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label={t("actions")}
                            >
                                <MoreHorizontal className="size-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem
                                onSelect={() => void saveToLibrary()}
                                disabled={!hasDraft}
                            >
                                {t("saveToLibrary")}
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                                <ToolLink href={askHref(section, app)}>{tp("askInChat")}</ToolLink>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={onRemove}>{t("remove")}</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </span>
            </div>
            <RewriteDialog
                open={customOpen}
                onOpenChange={setCustomOpen}
                onSubmit={instruction => {
                    setCustomOpen(false);
                    rewrite("custom", instruction);
                }}
            />
        </section>
    );
}

// ─── Evidence rail ───────────────────────────────────────────────────────────

function EvidenceRail({
    section,
    app,
    libraryHref,
}: {
    section: SectionDto;
    app: ApplicationDetail;
    libraryHref: string;
}) {
    const t = useTranslations("proposals.application.evidence");
    const tp = useTranslations("proposals.common");
    const cited = section.evidence.filter(e => section.cites.includes(e.n));
    const other = section.evidence.filter(e => !section.cites.includes(e.n));
    const [showOther, setShowOther] = useState(false);
    return (
        <aside className="@max-xl:static @max-xl:self-auto sticky top-6 flex flex-col gap-4 self-start">
            <section>
                <h3 className="text-ink mb-1.5 text-[13px] font-semibold">
                    {t("heading")}
                    <span className="text-ink-3 ml-1.5 text-xs font-normal">
                        {cited.length === 0 ? t("noneCited") : t("cited", { count: cited.length })}
                    </span>
                </h3>
                {cited.length === 0 ? (
                    <p className="text-ink-3 text-xs leading-relaxed">
                        {section.status === "empty" ? t("emptyDrafted") : t("noCites")}
                    </p>
                ) : (
                    <EvidenceRows evidence={cited} />
                )}
                {other.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setShowOther(v => !v)}
                        className="text-ink-3 hover:text-ink mt-1.5 text-xs"
                    >
                        {showOther
                            ? t("hideOther", { count: other.length })
                            : t("showOther", { count: other.length })}
                    </button>
                )}
                {showOther && other.length > 0 && (
                    <div className="mt-2">
                        <EvidenceRows evidence={other} />
                    </div>
                )}
            </section>
            {section.gaps.length > 0 && (
                <section className="bg-warn-soft rounded-md px-3 py-2.5">
                    <h3 className="text-warn mb-1 text-xs font-semibold">{t("gaps")}</h3>
                    <ul className="text-warn list-disc pl-4 text-xs leading-relaxed">
                        {section.gaps.map(g => (
                            <li key={g}>{g}</li>
                        ))}
                    </ul>
                </section>
            )}
            <section>
                <h3 className="text-ink mb-1.5 text-[13px] font-semibold">{t("reused")}</h3>
                <p className="text-ink-3 text-xs leading-relaxed">
                    {section.libraryItemIds.length === 0
                        ? t("noReuse")
                        : t("reuse", { count: section.libraryItemIds.length })}{" "}
                    <ToolLink href={libraryHref} className="text-brand-ink hover:underline">
                        {tp("library")}
                    </ToolLink>
                </p>
            </section>
            <section>
                <ToolLink
                    href={askHref(section, app)}
                    className="border-line bg-panel hover:bg-panel-2 text-ink flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs"
                >
                    <MessageSquare className="text-brand-ink mt-0.5 size-3.5 shrink-0" />
                    <span>
                        <span className="font-medium">{tp("askInChat")}</span>
                        <span className="text-ink-3 mt-0.5 block leading-relaxed">
                            {t("askBody")}
                        </span>
                    </span>
                </ToolLink>
            </section>
        </aside>
    );
}

// ─── Details dialog ──────────────────────────────────────────────────────────

function DetailsDialog({
    open,
    onOpenChange,
    app,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    app: ApplicationDetail;
    onSaved: (app: ApplicationDetail) => void;
}) {
    const t = useTranslations("proposals.application");
    const tp = useTranslations("proposals.common");
    const tc = useTranslations("common");
    const [title, setTitle] = useState(app.title);
    const [funder, setFunder] = useState(app.funder ?? "");
    const [deadline, setDeadline] = useState(app.deadline ?? "");
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!open) return;
        setTitle(app.title);
        setFunder(app.funder ?? "");
        setDeadline(app.deadline ?? "");
    }, [open, app]);
    const submit = async () => {
        setBusy(true);
        try {
            const { application } = await proposalsApi.patchApplication(app.id, {
                title: title.trim() || app.title,
                funder: funder.trim() || null,
                deadline: deadline || null,
            });
            onSaved(application);
            onOpenChange(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("saveFailed"));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("details.title")}</DialogTitle>
                    <DialogDescription>{t("details.description")}</DialogDescription>
                </DialogHeader>
                <form
                    className="grid gap-3"
                    onSubmit={e => {
                        e.preventDefault();
                        if (!busy) void submit();
                    }}
                >
                    <div className="grid gap-1.5">
                        <Label htmlFor="d-title" className="text-xs">
                            {tp("title")}
                        </Label>
                        <Input
                            id="d-title"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="d-funder" className="text-xs">
                            {tp("funder")}
                        </Label>
                        <Input
                            id="d-funder"
                            value={funder}
                            onChange={e => setFunder(e.target.value)}
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="d-deadline" className="text-xs">
                            {tp("deadline")}
                        </Label>
                        <Input
                            id="d-deadline"
                            type="date"
                            value={deadline}
                            onChange={e => setDeadline(e.target.value)}
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            disabled={busy}
                        >
                            {tc("actions.cancel")}
                        </Button>
                        <Button type="submit" disabled={busy}>
                            {tc("actions.save")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// ─── Preview ─────────────────────────────────────────────────────────────────

function PreviewTab({
    id,
    version,
    onExport,
}: {
    id: string;
    version: string;
    onExport: () => void;
}) {
    const t = useTranslations("proposals.application.preview");
    const tp = useTranslations("proposals.common");
    const tc = useTranslations("common");
    const res = useResource(`proposals:markdown:${id}:${version}`, () => proposalsApi.markdown(id));
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        if (!res.data) return;
        try {
            await navigator.clipboard.writeText(res.data.markdown);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error(t("copyFailed"));
        }
    };
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void copy()}
                    disabled={!res.data}
                >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? tc("actions.copied") : t("copyMarkdown")}
                </Button>
                <Button size="sm" variant="outline" onClick={onExport}>
                    {tp("exportToSources")}
                </Button>
                <span className="text-ink-3 text-xs">{t("hint")}</span>
            </div>
            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
            {res.loading || !res.data ? (
                <SkeletonBlock lines={8} />
            ) : (
                <article className="border-line bg-panel text-ink max-w-[75ch] rounded-lg border px-6 py-6 text-[14px] leading-[1.6]">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            h1: p => (
                                <h1
                                    className="mb-3 text-[22px] font-semibold tracking-[-0.02em]"
                                    {...p}
                                />
                            ),
                            h2: p => <h2 className="mb-2 mt-6 text-[15px] font-semibold" {...p} />,
                            p: p => <p className="mb-3" {...p} />,
                            ul: p => <ul className="mb-3 list-disc pl-5" {...p} />,
                            li: p => <li className="mb-1" {...p} />,
                            blockquote: p => (
                                <blockquote
                                    className="border-line text-ink-2 mb-3 border-l-2 pl-3"
                                    {...p}
                                />
                            ),
                            hr: () => <hr className="border-line my-5" />,
                            em: p => <em className="text-ink-3 not-italic" {...p} />,
                            a: p => <a className="text-brand-ink hover:underline" {...p} />,
                        }}
                    >
                        {res.data.markdown}
                    </ReactMarkdown>
                </article>
            )}
        </div>
    );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

/**
 * One proposal: an outline of sections, an editor for the one in hand, and
 * the evidence beside it; the checklist the funder set; the review; the
 * request it all came from; a preview of the whole. Drafts come from the
 * workspace's sources with citations; the person edits, rewrites, approves,
 * and exports when it reads right.
 */
export function ApplicationScreen({ id }: { id: string }) {
    const t = useTranslations("proposals.application");
    const tp = useTranslations("proposals.common");
    const tWords = useTranslations("proposals.words");
    const tKind = useTranslations("proposals.requirementKind");
    const tName = useTranslations("tools.registry.proposals");
    const tc = useTranslations("common");
    const format = useToolFormat();
    const { href, trackRun, activeRun, finishedTick } = useProposals();
    const router = useToolRouter();
    const res = useResource(`proposals:application:${id}`, () => proposalsApi.application(id));
    const reload = res.reload;
    useEffect(() => {
        if (finishedTick > 0) void reload();
    }, [finishedTick, reload]);
    const app = res.data?.application ?? null;
    const busy = runIsLive(activeRun) && activeRun?.applicationId === id;
    const [tab, setTab] = useState("write");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [details, setDetails] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [removing, setRemoving] = useState<SectionDto | null>(null);
    const [requestText, setRequestText] = useState("");
    const [requestUrl, setRequestUrl] = useState("");
    useEffect(() => {
        if (!app) return;
        setRequestText(app.requestText ?? "");
        setRequestUrl(app.requestUrl ?? "");
    }, [app]);

    const sections = useMemo(() => app?.sectionList ?? [], [app]);
    const selected =
        sections.find(s => s.id === selectedId) ??
        sections.find(s => s.status === "empty") ??
        sections[0] ??
        null;
    const selectedIndex = selected ? sections.findIndex(s => s.id === selected.id) : -1;

    const setApp = (next: ApplicationDetail) => res.mutate(() => ({ application: next }));
    const setSection = (next: SectionDto) => {
        res.mutate(current => ({
            application: {
                ...current.application,
                sectionList: current.application.sectionList.map(s =>
                    s.id === next.id ? next : s
                ),
            },
        }));
        void reload();
    };

    const run = async (start: () => Promise<{ run: RunDto }>, what: RunWhat) => {
        try {
            const { run: started } = await start();
            trackRun(started);
        } catch (e) {
            const message =
                e instanceof ProposalsApiError && e.status === 402
                    ? t("noCredits")
                    : e instanceof Error
                      ? e.message
                      : t(`startFailed.${what}`);
            toast.error(message);
        }
    };
    const patch = async (
        input: Parameters<typeof proposalsApi.patchApplication>[1],
        done?: string
    ) => {
        try {
            const { application } = await proposalsApi.patchApplication(id, input);
            setApp(application);
            if (done) toast.success(done);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("saveFailed"));
        }
    };
    const exportToSources = async () => {
        try {
            const { application } = await proposalsApi.exportApplication(id);
            setApp(application);
            toast.success(t("exported"));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("exportFailed"));
        }
    };
    const remove = async () => {
        try {
            await proposalsApi.deleteApplication(id);
            toast(t("deleted"));
            // Replace, not push: the tab's Back would otherwise return to a
            // proposal that no longer exists.
            router.replace(href("/write"));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("deleteFailed"));
        } finally {
            setDeleting(false);
        }
    };
    const removeSection = async () => {
        if (!removing) return;
        try {
            await proposalsApi.deleteSection(id, removing.id);
            res.mutate(current => ({
                application: {
                    ...current.application,
                    sectionList: current.application.sectionList.filter(s => s.id !== removing.id),
                },
            }));
            toast(t("sectionRemoved"));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("removeFailed"));
        } finally {
            setRemoving(null);
        }
    };

    const grouped = useMemo(() => {
        const map = new Map<RequirementDto["kind"], RequirementDto[]>();
        for (const r of app?.requirements ?? []) map.set(r.kind, [...(map.get(r.kind) ?? []), r]);
        return KIND_ORDER.filter(k => map.has(k)).map(k => [k, map.get(k)!] as const);
    }, [app?.requirements]);
    const emptyCount = sections.filter(s => s.status === "empty").length;
    const tone = deadlineTone(app?.daysLeft ?? null);
    const goToSection = (key: string | null) => {
        const target = sections.find(s => s.key === key);
        if (target) setSelectedId(target.id);
        setTab("write");
    };

    // Gone (deleted, or a link from another workspace): say so, and do not
    // remember it as the tab's last screen.
    if (res.errorStatus === 404) {
        return (
            <ToolNotFound
                home={href("/write")}
                homeLabel={t("notFoundHome")}
                title={t("notFoundTitle")}
                body={t("notFoundBody")}
            />
        );
    }

    if (res.error) {
        return (
            <div className="mx-auto max-w-[1200px]">
                <InlineError message={res.error} onRetry={() => void res.reload()} />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-[1200px]">
            <div className="text-ink-3 mb-3 flex items-center gap-3 text-xs">
                <ToolLink href={href("/write")} className="hover:text-ink">
                    {tName("name")}
                </ToolLink>
                <span aria-hidden>/</span>
                <span className="text-ink truncate font-medium">
                    {app?.title ?? <Skeleton className="inline-block h-3 w-40 align-middle" />}
                </span>
            </div>

            <header className="border-line @max-md:grid-cols-1 mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b pb-5">
                <div className="min-w-0">
                    <h1 className="text-ink text-[22px] font-semibold tracking-[-0.02em]">
                        {app ? app.title : <Skeleton className="h-6 w-72" />}
                    </h1>
                    {app && (
                        <div className="text-ink-3 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                            <span>{app.funder ?? tp("funderNotSet")}</span>
                            <span
                                className={cn(
                                    tone === "warn" && "text-warn",
                                    tone === "lost" && "text-danger"
                                )}
                            >
                                {app.deadline
                                    ? t("deadlineWithDate", {
                                          words: deadlineWords(tWords, app.deadline, app.daysLeft),
                                          date: app.deadline,
                                      })
                                    : deadlineWords(tWords, app.deadline, app.daysLeft)}
                            </span>
                            {amountWords(tWords, app.amountMin, app.amountMax) && (
                                <span>{amountWords(tWords, app.amountMin, app.amountMax)}</span>
                            )}
                            <button
                                type="button"
                                onClick={() => setDetails(true)}
                                className="text-brand-ink hover:underline"
                            >
                                {tp("editDetails")}
                            </button>
                        </div>
                    )}
                    {app && (
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                            <ReadinessMeter value={app.readiness} label={tp("ready")} />
                            <ApplicationStatusMenu
                                status={app.status}
                                onChange={(status: ApplicationStatus) =>
                                    void patch({ status }, t("statusUpdated"))
                                }
                            />
                            {app.blockers > 0 && (
                                <span className="text-danger text-xs">
                                    {t("blockers", { count: app.blockers })}
                                </span>
                            )}
                            {app.exportedHref && (
                                <ToolLink
                                    href={app.exportedHref}
                                    className="text-brand-ink inline-flex items-center gap-1 text-xs hover:underline"
                                >
                                    {t("inSources")}
                                    <ExternalLink className="size-3" />
                                </ToolLink>
                            )}
                        </div>
                    )}
                </div>
                {app && (
                    <div className="@max-md:justify-start flex flex-wrap items-center justify-end gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void run(() => proposalsApi.review(id), "review")}
                        >
                            {t("review")}
                        </Button>
                        <Button
                            size="sm"
                            disabled={busy || emptyCount === 0}
                            onClick={() => void run(() => proposalsApi.draftAll(id), "drafting")}
                        >
                            <Sparkles className="size-3.5" />
                            {emptyCount === 0
                                ? t("allDrafted")
                                : emptyCount === sections.length
                                  ? t("draftEvery")
                                  : t("draftSome", { count: emptyCount })}
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8"
                                    aria-label={tc("actions.more")}
                                >
                                    <MoreHorizontal className="size-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => void exportToSources()}>
                                    {tp("exportToSources")}
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setDetails(true)}>
                                    {tp("editDetails")}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => setDeleting(true)}>
                                    {t("deleteProposal")}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
            </header>

            {!app ? (
                <SkeletonBlock lines={6} />
            ) : (
                <Tabs value={tab} onValueChange={setTab} className="gap-5">
                    {/* Five tabs outgrow a narrow tab: the list scrolls sideways
                        instead of pushing the page wider. */}
                    <TabsList className="max-w-full justify-start overflow-x-auto [scrollbar-width:none]">
                        <TabsTrigger value="write">
                            {t("tabs.write", { count: sections.length })}
                        </TabsTrigger>
                        <TabsTrigger value="checklist">
                            {t("tabs.checklist", {
                                done: app.requirements.filter(r => r.done).length,
                                total: app.requirements.length,
                            })}
                        </TabsTrigger>
                        <TabsTrigger value="review">
                            {app.review
                                ? t("tabs.reviewCount", { count: app.review.findings.length })
                                : t("tabs.review")}
                        </TabsTrigger>
                        <TabsTrigger value="request">{t("tabs.request")}</TabsTrigger>
                        <TabsTrigger value="preview">{t("tabs.preview")}</TabsTrigger>
                    </TabsList>

                    <TabsContent value="write">
                        {sections.length === 0 ? (
                            <EmptyState
                                title={t("noSections")}
                                body={
                                    app.requestText || app.requestUrl
                                        ? busy
                                            ? t("noSectionsReading")
                                            : t("noSectionsUnread")
                                        : t("noSectionsNoRequest")
                                }
                                action={
                                    app.requestText || app.requestUrl ? (
                                        <Button
                                            size="sm"
                                            disabled={busy}
                                            onClick={() =>
                                                void run(() => proposalsApi.extract(id), "extract")
                                            }
                                        >
                                            {t("readRequest")}
                                        </Button>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => setTab("request")}
                                        >
                                            {t("addRequest")}
                                        </Button>
                                    )
                                }
                            />
                        ) : (
                            <div className="@max-xl:grid-cols-[220px_minmax(0,1fr)] @max-lg:grid-cols-1 grid grid-cols-[240px_minmax(0,1fr)_260px] gap-5">
                                <Outline
                                    sections={sections}
                                    selectedId={selected?.id ?? null}
                                    onSelect={setSelectedId}
                                    readiness={app.readiness}
                                >
                                    <AddSectionForm
                                        applicationId={id}
                                        onAdded={section => {
                                            res.mutate(current => ({
                                                application: {
                                                    ...current.application,
                                                    sectionList: [
                                                        ...current.application.sectionList,
                                                        section,
                                                    ],
                                                },
                                            }));
                                            setSelectedId(section.id);
                                        }}
                                    />
                                </Outline>
                                {selected && (
                                    <SectionEditor
                                        key={selected.id}
                                        app={app}
                                        section={selected}
                                        busy={busy}
                                        onChange={setSection}
                                        onRun={run}
                                        onRemove={() => setRemoving(selected)}
                                        index={selectedIndex}
                                        total={sections.length}
                                        onStep={delta => {
                                            const next = sections[selectedIndex + delta];
                                            if (next) setSelectedId(next.id);
                                        }}
                                    />
                                )}
                                {selected && (
                                    <EvidenceRail
                                        section={selected}
                                        app={app}
                                        libraryHref={href("/library")}
                                    />
                                )}
                            </div>
                        )}
                        {sections.length === 0 && (
                            <div className="mt-4">
                                <AddSectionForm
                                    applicationId={id}
                                    onAdded={section =>
                                        res.mutate(current => ({
                                            application: {
                                                ...current.application,
                                                sectionList: [
                                                    ...current.application.sectionList,
                                                    section,
                                                ],
                                            },
                                        }))
                                    }
                                />
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="checklist" className="flex flex-col gap-5">
                        {app.requirements.length === 0 ? (
                            <EmptyState title={t("noChecklist")} body={t("noChecklistBody")} />
                        ) : (
                            grouped.map(([kind, rows]) => (
                                <section key={kind}>
                                    <h2 className="text-ink mb-2 text-[13px] font-semibold">
                                        {tKind(kind)}
                                        <span className="text-ink-3 ml-2 text-xs font-normal">
                                            {t("doneOf", {
                                                done: rows.filter(r => r.done).length,
                                                total: rows.length,
                                            })}
                                        </span>
                                    </h2>
                                    <div className="border-line bg-panel overflow-hidden rounded-lg border">
                                        {rows.map(r => {
                                            const isSection = r.kind === "section";
                                            const section = isSection
                                                ? sections.find(s => s.key === r.sectionKey)
                                                : null;
                                            return (
                                                <label
                                                    key={r.id}
                                                    className={cn(
                                                        "border-line-2 flex items-center gap-3 border-t px-4 py-2.5 text-[13px] first:border-t-0",
                                                        isSection
                                                            ? "cursor-default"
                                                            : "hover:bg-panel-2 cursor-pointer"
                                                    )}
                                                >
                                                    <Checkbox
                                                        checked={r.done}
                                                        disabled={isSection}
                                                        onCheckedChange={v =>
                                                            void patch({
                                                                requirement: {
                                                                    id: r.id,
                                                                    done: v === true,
                                                                },
                                                            })
                                                        }
                                                        aria-label={r.text}
                                                    />
                                                    <span
                                                        className={cn(
                                                            "min-w-0 flex-1",
                                                            r.done && "text-ink-3"
                                                        )}
                                                    >
                                                        {r.text}
                                                    </span>
                                                    {section && (
                                                        <button
                                                            type="button"
                                                            onClick={() => goToSection(section.key)}
                                                            className="text-ink-3 hover:text-ink text-xs"
                                                        >
                                                            <StatusWord
                                                                tone={SECTION_TONE[section.status]}
                                                            >
                                                                {t("openSection")}
                                                            </StatusWord>
                                                        </button>
                                                    )}
                                                </label>
                                            );
                                        })}
                                    </div>
                                    {kind === "section" && (
                                        <p className="text-ink-3 mt-1.5 text-xs">
                                            {t("sectionTicks")}
                                        </p>
                                    )}
                                </section>
                            ))
                        )}
                    </TabsContent>

                    <TabsContent value="review" className="flex flex-col gap-4">
                        {!app.review ? (
                            <EmptyState
                                title={t("notReviewed")}
                                body={t("notReviewedBody")}
                                action={
                                    <Button
                                        size="sm"
                                        disabled={busy}
                                        onClick={() =>
                                            void run(() => proposalsApi.review(id), "review")
                                        }
                                    >
                                        {t("reviewNow")}
                                    </Button>
                                }
                            />
                        ) : (
                            <>
                                <div className="border-line bg-panel rounded-lg border px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <ReadinessMeter
                                            value={app.review.readiness}
                                            label={tp("ready")}
                                        />
                                        <span className="text-ink-3 text-xs">
                                            {t("reviewed", {
                                                time: format.relativeTime(app.review.reviewedAt),
                                            })}
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={busy}
                                            className="ml-auto"
                                            onClick={() =>
                                                void run(() => proposalsApi.review(id), "review")
                                            }
                                        >
                                            {t("reviewAgain")}
                                        </Button>
                                    </div>
                                    <p className="text-ink mt-2 max-w-[70ch] text-[13.5px] leading-relaxed">
                                        {app.review.summary}
                                    </p>
                                </div>
                                {app.review.findings.length === 0 ? (
                                    <p className="text-ink-3 text-[13px]">{t("nothingToFix")}</p>
                                ) : (
                                    <div className="border-line bg-panel overflow-hidden rounded-lg border">
                                        {app.review.findings.map(f => (
                                            <div
                                                key={f.id}
                                                className="border-line-2 @max-md:grid-cols-1 @max-md:gap-y-1 grid grid-cols-[96px_minmax(0,1fr)_auto] gap-x-4 gap-y-4 border-t px-4 py-3 first:border-t-0"
                                            >
                                                <SeverityWord severity={f.severity} />
                                                <div className="min-w-0">
                                                    <div className="text-ink text-[13.5px]">
                                                        {f.message}
                                                    </div>
                                                    {f.suggestion && (
                                                        <div className="text-ink-3 mt-0.5 text-xs leading-relaxed">
                                                            {f.suggestion}
                                                        </div>
                                                    )}
                                                </div>
                                                {f.sectionKey && (
                                                    <button
                                                        type="button"
                                                        onClick={() => goToSection(f.sectionKey)}
                                                        className="text-brand-ink self-start text-xs hover:underline"
                                                    >
                                                        {t("goToSection")}
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </TabsContent>

                    <TabsContent value="request" className="flex flex-col gap-4">
                        {app.requestSummary && (
                            <p className="text-ink max-w-[70ch] text-[13.5px] leading-relaxed">
                                {app.requestSummary}
                            </p>
                        )}
                        <div className="grid gap-1.5">
                            <Label htmlFor="req-url" className="text-ink-3 text-xs font-normal">
                                {t("requestLink")}
                            </Label>
                            <div className="flex gap-2">
                                <Input
                                    id="req-url"
                                    value={requestUrl}
                                    onChange={e => setRequestUrl(e.target.value)}
                                    placeholder="https://"
                                    inputMode="url"
                                />
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={requestUrl === (app.requestUrl ?? "")}
                                    onClick={() =>
                                        void patch(
                                            { requestUrl: requestUrl.trim() || null },
                                            t("linkSaved")
                                        )
                                    }
                                >
                                    {tc("actions.save")}
                                </Button>
                            </div>
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="req-text" className="text-ink-3 text-xs font-normal">
                                {t("requestText")}
                            </Label>
                            <Textarea
                                id="req-text"
                                value={requestText}
                                onChange={e => setRequestText(e.target.value)}
                                rows={14}
                                placeholder={t("requestPlaceholder")}
                                className="font-mono text-[12.5px] leading-[1.5]"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={requestText === (app.requestText ?? "")}
                                    onClick={() =>
                                        void patch(
                                            { requestText: requestText.trim() || null },
                                            t("requestSaved")
                                        )
                                    }
                                >
                                    {t("saveText")}
                                </Button>
                                <Button
                                    size="sm"
                                    disabled={busy || (!requestText.trim() && !requestUrl.trim())}
                                    onClick={async () => {
                                        if (
                                            requestText !== (app.requestText ?? "") ||
                                            requestUrl !== (app.requestUrl ?? "")
                                        )
                                            await patch({
                                                requestText: requestText.trim() || null,
                                                requestUrl: requestUrl.trim() || null,
                                            });
                                        await run(() => proposalsApi.extract(id), "extract");
                                    }}
                                >
                                    {sections.length > 0 ? t("readAgain") : t("readRequest")}
                                </Button>
                                <span className="text-ink-3 text-xs">{t("rereadHint")}</span>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="preview">
                        <PreviewTab
                            id={id}
                            version={`${app.updatedAt}:${sections.map(s => `${s.id}:${s.words}:${s.status}`).join(",")}`}
                            onExport={() => void exportToSources()}
                        />
                    </TabsContent>
                </Tabs>
            )}

            {app && (
                <DetailsDialog
                    open={details}
                    onOpenChange={setDetails}
                    app={app}
                    onSaved={setApp}
                />
            )}
            <ConfirmDialog
                open={deleting}
                onOpenChange={setDeleting}
                title={t("deleteTitle")}
                description={t("deleteBody")}
                confirmLabel={tc("actions.delete")}
                onConfirm={() => void remove()}
            />
            <ConfirmDialog
                open={removing !== null}
                onOpenChange={open => !open && setRemoving(null)}
                title={t("removeTitle")}
                description={t("removeBody")}
                confirmLabel={tc("actions.remove")}
                onConfirm={() => void removeSection()}
            />
        </div>
    );
}

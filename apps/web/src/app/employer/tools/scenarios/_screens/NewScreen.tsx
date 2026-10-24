"use client";

import {
    Building2,
    ChevronDown,
    ClipboardPaste,
    MessagesSquare,
    Play,
    Search,
    Users,
    type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useToolRouter } from "~/components/tool-app/nav";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { Slider } from "~/components/ui/slider";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { SCENARIO_CAVEAT, SCENARIO_LIMITS, type ScenarioEstimate } from "~/lib/scenarios/types";
import { joinNatural, plural } from "~/lib/tools/format";
import { useResource } from "~/lib/tools/useResource";
import { cn } from "~/lib/utils";

import { ScenariosApiError, scenariosApi } from "../api";
import { FilePickerDialog } from "../_components/FilePickerDialog";
import { SituationComposer, type PickedFile } from "../_components/SituationComposer";
import { useScenarios } from "../_lib/context";
import { SIZE_PRESETS, UPLOAD_ACCEPT, presetFor } from "../_lib/files";
import { runPath } from "../_lib/screens";
import { useUploads } from "../_lib/useUploads";

const L = SCENARIO_LIMITS;

/** How often the file list is asked again while a picked file is being read. */
const READING_POLL_MS = 3000;

/** The estimate for a size, asked for once the sliders settle. */
function useEstimate(agents: number, rounds: number) {
    const [state, setState] = useState<{
        data: ScenarioEstimate | null;
        loading: boolean;
        error: string | null;
    }>({ data: null, loading: true, error: null });
    useEffect(() => {
        let cancelled = false;
        setState(s => ({ ...s, loading: true }));
        const timer = window.setTimeout(() => {
            scenariosApi
                .estimate({ agents, rounds })
                .then(data => {
                    if (!cancelled) setState({ data, loading: false, error: null });
                })
                .catch((e: unknown) => {
                    if (!cancelled)
                        setState(s => ({
                            data: s.data,
                            loading: false,
                            error: e instanceof Error ? e.message : "Could not estimate the cost",
                        }));
                });
        }, 350);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [agents, rounds]);
    return state;
}

function Counter({ value, max }: { value: number; max: number }) {
    return (
        <span
            className={cn(
                "shrink-0 font-mono text-[11px] tabular-nums",
                value > max ? "text-danger" : "text-ink-3"
            )}
        >
            {value.toLocaleString()}/{max.toLocaleString()}
        </span>
    );
}

interface SourceSwitch {
    id: string;
    icon: LucideIcon;
    label: string;
    /** How the summary names it. */
    short: string;
    hint: string;
    checked: boolean;
    set: (v: boolean) => void;
    disabled?: boolean;
}

/**
 * The form: what happens and the files it is about, what else the people are
 * built from, and how many people and rounds. Files can be uploaded or picked
 * from the workspace; a picked file still being read holds the run until it
 * can be. The summary on the right follows every choice, and its one primary
 * action starts the run and opens it.
 */
export function NewScreen() {
    const router = useToolRouter();
    const { expectLive } = useScenarios();
    const [pollMs, setPollMs] = useState<number | null>(null);
    const options = useResource("scenarios:sources", () => scenariosApi.sources(), { pollMs });

    const [title, setTitle] = useState("");
    const [subject, setSubject] = useState("");
    const [docs, setDocs] = useState<number[]>([]);
    /** Names of files uploaded here, for the moment before the file list includes them. */
    const [arriving, setArriving] = useState<Record<number, string>>({});
    const [pickerOpen, setPickerOpen] = useState(false);
    const [searchFiles, setSearchFiles] = useState(true);
    const [prospects, setProspects] = useState(false);
    const [brandComments, setBrandComments] = useState(false);
    const [companyProfile, setCompanyProfile] = useState(true);
    const [notes, setNotes] = useState("");
    const [notesOpen, setNotesOpen] = useState(false);
    const [agents, setAgents] = useState<number>(L.agents.default);
    const [rounds, setRounds] = useState<number>(L.rounds.default);
    const [submitting, setSubmitting] = useState(false);
    const [problem, setProblem] = useState<{ message: string; credits: boolean } | null>(null);
    const estimate = useEstimate(agents, rounds);
    const fileInput = useRef<HTMLInputElement>(null);

    const offered = options.data;
    const reloadOptions = options.reload;
    const canUpload = offered?.canUpload ?? false;
    // The profile switch means nothing when there is no profile to read.
    const profileOn = companyProfile && (offered?.companyProfile ?? true);
    const documents = useMemo(() => offered?.documents ?? [], [offered]);

    const picked = useMemo<PickedFile[]>(() => {
        const byId = new Map(documents.map(d => [d.id, d]));
        return docs.flatMap((id): PickedFile[] => {
            const file = byId.get(id);
            if (file) return [{ id, file }];
            const name = arriving[id];
            return name ? [{ id, file: null, name }] : [];
        });
    }, [docs, documents, arriving]);
    const reading = picked.filter(p => !p.file || p.file.status === "processing").length;
    const unreadable = picked.filter(p => p.file?.status === "failed").length;

    // Ask again while a picked file is being read; stop the moment none is.
    useEffect(() => setPollMs(reading > 0 ? READING_POLL_MS : null), [reading]);

    const uploader = useUploads({
        room: L.documentsMax - docs.length,
        onAdded: (id, name) => {
            void reloadOptions();
            if (id === null) {
                toast.success(`${name} was added to your files. Choose it from your files.`);
                return;
            }
            setArriving(a => ({ ...a, [id]: name }));
            setDocs(list => [...new Set([...list, id])].slice(0, L.documentsMax));
        },
    });

    const toggleDoc = (id: number, on: boolean) => {
        setDocs(list =>
            on ? [...new Set([...list, id])].slice(0, L.documentsMax) : list.filter(d => d !== id)
        );
    };

    const switches: SourceSwitch[] = [
        {
            id: "profile",
            icon: Building2,
            label: "Company profile",
            short: "company profile",
            hint:
                offered && !offered.companyProfile
                    ? "This workspace has no company profile yet."
                    : "What you sell, to whom, and at what price.",
            checked: profileOn,
            set: setCompanyProfile,
            disabled: offered ? !offered.companyProfile : true,
        },
        {
            id: "search",
            icon: Search,
            label: "Search my files",
            short: "file search",
            hint: "Finds passages about the situation in every file you can see.",
            checked: searchFiles,
            set: setSearchFiles,
        },
        {
            id: "prospects",
            icon: Users,
            label: "Prospects",
            short: "prospects",
            hint: offered
                ? offered.prospects > 0
                    ? `${plural(offered.prospects, "company", "companies")} from Growth › Prospects become buyers in the network.`
                    : "No prospects yet. Growth › Prospects finds them."
                : "Companies from Growth › Prospects.",
            checked: prospects && (offered?.prospects ?? 0) > 0,
            set: setProspects,
            disabled: offered ? offered.prospects === 0 : true,
        },
        {
            id: "comments",
            icon: MessagesSquare,
            label: "Comments on your posts",
            short: "post comments",
            hint: offered
                ? offered.brandComments > 0
                    ? `${plural(offered.brandComments, "comment")} people left on the workspace's social posts.`
                    : "No comments on your posts yet."
                : "What people said under the workspace's social posts.",
            checked: brandComments && (offered?.brandComments ?? 0) > 0,
            set: setBrandComments,
            disabled: offered ? offered.brandComments === 0 : true,
        },
    ];

    const hasNotes = notes.trim().length > 0;
    const builtFrom = [
        ...switches.filter(s => s.checked).map(s => s.short),
        ...(hasNotes ? ["pasted material"] : []),
    ];
    const anySource = picked.length > 0 || builtFrom.length > 0;

    const current =
        estimate.data && estimate.data.agents === agents && estimate.data.rounds === rounds
            ? estimate.data
            : null;
    const blocked = current !== null && !current.enough;
    const tooLong = subject.length > L.subjectMax || notes.length > L.notesMax;
    const holdReason = !subject.trim()
        ? "Describe the situation first."
        : uploader.busy
          ? "Waiting for uploads to finish."
          : reading > 0
            ? `Waiting for ${reading === 1 ? "a file" : `${reading} files`} to be read, so the people can use ${reading === 1 ? "it" : "them"}. Remove ${reading === 1 ? "it" : "them"} to run without.`
            : unreadable > 0
              ? `Remove the ${unreadable === 1 ? "file" : "files"} that could not be read.`
              : tooLong
                ? "The situation or the pasted material is too long."
                : null;
    const canRun = holdReason === null && !blocked && !submitting;

    const submit = async () => {
        setSubmitting(true);
        setProblem(null);
        try {
            const { run } = await scenariosApi.create({
                title: title.trim() || undefined,
                subject: subject.trim(),
                sources: {
                    documentIds: docs,
                    searchFiles,
                    prospects: prospects && (offered?.prospects ?? 0) > 0,
                    brandComments: brandComments && (offered?.brandComments ?? 0) > 0,
                    companyProfile: profileOn,
                    notes: notes.trim(),
                },
                agents,
                rounds,
            });
            expectLive();
            router.push(runPath(run.id));
        } catch (e) {
            const credits =
                e instanceof ScenariosApiError &&
                (e.status === 402 || e.code === "insufficient_credits");
            setProblem({
                message: e instanceof Error ? e.message : "Could not start the scenario",
                credits,
            });
            setSubmitting(false);
        }
    };

    const preset = presetFor(agents, rounds);

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
            <PageHeader
                size="md"
                title="New"
                accent="scenario"
                sub="Describe a situation and attach what it is about. People built from your records react to it over several rounds."
            />
            <input
                ref={fileInput}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-label="Upload files about the situation"
                accept={UPLOAD_ACCEPT}
                onChange={e => {
                    uploader.add(Array.from(e.target.files ?? []));
                    e.target.value = "";
                }}
            />
            <div className="@max-lg:grid-cols-1 grid grid-cols-[minmax(0,1fr)_320px] items-start gap-8">
                <div className="flex min-w-0 flex-col gap-8">
                    <section className="flex flex-col gap-4" aria-label="The situation">
                        <SituationComposer
                            value={subject}
                            onChange={setSubject}
                            max={L.subjectMax}
                            picked={picked}
                            uploads={uploader.uploads}
                            filesMax={L.documentsMax}
                            canUpload={canUpload}
                            onFiles={uploader.add}
                            onUpload={() => fileInput.current?.click()}
                            onChoose={() => setPickerOpen(true)}
                            onRemove={id => toggleDoc(id, false)}
                            onDismissUpload={uploader.dismiss}
                        />
                        <div className="@max-sm:flex-col @max-sm:items-stretch @max-sm:gap-1.5 flex items-center gap-3">
                            <Label
                                htmlFor="scenario-title"
                                className="text-ink-3 w-[110px] shrink-0 text-xs font-normal"
                            >
                                Title (optional)
                            </Label>
                            <Input
                                id="scenario-title"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                maxLength={120}
                                placeholder="Taken from the situation when left empty"
                                className="h-8 md:text-[13px]"
                            />
                        </div>
                    </section>

                    <section className="flex flex-col gap-3">
                        <SectionHeading
                            title="What else the people are built from"
                            aside="Only material you can see is used"
                            className="mb-0"
                        />
                        <div className="@max-md:grid-cols-1 grid grid-cols-2 gap-2">
                            {switches.map(s => (
                                <SourceCard key={s.id} source={s} />
                            ))}
                        </div>
                        <Collapsible
                            open={notesOpen || hasNotes}
                            onOpenChange={setNotesOpen}
                            className="border-line bg-panel rounded-lg border"
                        >
                            <CollapsibleTrigger
                                disabled={hasNotes}
                                className="hover:bg-panel-2 focus-visible:ring-brand/50 flex w-full items-center gap-3 rounded-lg p-3 text-left outline-none focus-visible:ring-2 disabled:cursor-default disabled:hover:bg-transparent"
                            >
                                <SourceIcon icon={ClipboardPaste} on={hasNotes} />
                                <span className="min-w-0 flex-1">
                                    <span className="text-ink block text-[13px] font-medium">
                                        Paste material
                                    </span>
                                    <span className="text-ink-3 block text-xs">
                                        A news story, a policy draft, an announcement, a
                                        competitor&rsquo;s pricing page…
                                    </span>
                                </span>
                                {!hasNotes && (
                                    <ChevronDown
                                        aria-hidden
                                        className={cn(
                                            "text-ink-3 size-4 shrink-0 transition-transform",
                                            notesOpen && "rotate-180"
                                        )}
                                    />
                                )}
                            </CollapsibleTrigger>
                            <CollapsibleContent className="px-3 pb-3">
                                <Textarea
                                    id="scenario-notes"
                                    aria-label="Pasted material"
                                    value={notes}
                                    onChange={e => setNotes(e.target.value)}
                                    rows={5}
                                    placeholder="Paste the text here."
                                    className="bg-surface md:text-[13px]"
                                    aria-invalid={notes.length > L.notesMax || undefined}
                                />
                                <div className="mt-1 flex justify-end">
                                    <Counter value={notes.length} max={L.notesMax} />
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    </section>

                    <section className="flex flex-col gap-4">
                        <SectionHeading
                            title="Size"
                            aside={`${plural(agents, "person", "people")} · ${plural(rounds, "round")}`}
                            className="mb-0"
                        />
                        <ToggleGroup
                            type="single"
                            variant="outline"
                            value={preset?.id ?? ""}
                            onValueChange={id => {
                                const p = SIZE_PRESETS.find(s => s.id === id);
                                if (!p) return;
                                setAgents(p.agents);
                                setRounds(p.rounds);
                            }}
                            aria-label="Size presets"
                            className="@max-sm:grid-cols-1 grid grid-cols-3 gap-2"
                        >
                            {SIZE_PRESETS.map(p => (
                                <ToggleGroupItem
                                    key={p.id}
                                    value={p.id}
                                    className="data-[state=on]:border-brand data-[state=on]:bg-brand-soft h-auto flex-col items-start gap-0.5 px-3 py-2 text-left"
                                >
                                    <span className="text-ink text-[13px] font-medium">
                                        {p.label}
                                    </span>
                                    <span className="text-ink-3 text-xs font-normal tabular-nums">
                                        {p.agents} people · {p.rounds} rounds
                                    </span>
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                        <div className="@max-md:grid-cols-1 grid grid-cols-2 gap-x-8 gap-y-5">
                            <SizeSlider
                                id="people"
                                label="People"
                                value={agents}
                                min={L.agents.min}
                                max={L.agents.max}
                                onChange={setAgents}
                                hint="More people bring more points of view, and cost more."
                            />
                            <SizeSlider
                                id="rounds"
                                label="Rounds"
                                value={rounds}
                                min={L.rounds.min}
                                max={L.rounds.max}
                                onChange={setRounds}
                                hint="Each round, people read their feed and post, reply, share or change their minds."
                            />
                        </div>
                    </section>
                </div>

                <aside className="@max-lg:static sticky top-0 flex flex-col gap-3">
                    <div className="border-line bg-panel overflow-hidden rounded-xl border">
                        <div className="px-4 pb-3 pt-4">
                            <span className="text-ink-3 text-xs">Your scenario</span>
                            <p
                                className={cn(
                                    "mt-1 line-clamp-4 text-[13px] leading-relaxed",
                                    subject.trim() ? "text-ink" : "text-ink-3"
                                )}
                            >
                                {subject.trim()
                                    ? asQuestion(subject.trim())
                                    : "What happens if… Describe the situation to start."}
                            </p>
                        </div>
                        <dl className="border-line-2 grid gap-2 border-t px-4 py-3 text-xs">
                            <SummaryRow
                                term="Files"
                                value={
                                    picked.length === 0 && !uploader.busy
                                        ? "None attached"
                                        : [
                                              plural(picked.length, "file"),
                                              uploader.busy ? "uploading more" : null,
                                              reading > 0 ? `${reading} being read` : null,
                                          ]
                                              .filter(Boolean)
                                              .join(" · ")
                                }
                                muted={picked.length === 0 && !uploader.busy}
                            />
                            <SummaryRow
                                term="Also from"
                                value={
                                    builtFrom.length > 0
                                        ? capitalize(joinNatural(builtFrom))
                                        : "Nothing else"
                                }
                                muted={builtFrom.length === 0}
                            />
                            <SummaryRow
                                term="Size"
                                value={`${plural(agents, "person", "people")} · ${plural(rounds, "round")}`}
                            />
                        </dl>
                        <EstimateBox
                            estimate={current ?? estimate.data}
                            settling={estimate.loading || current === null}
                            error={estimate.error}
                            blocked={blocked}
                        />
                        <div className="border-line-2 flex flex-col gap-2 border-t p-4">
                            {!anySource && (
                                <p className="border-warn/40 bg-warn-soft text-warn rounded-md border px-3 py-2 text-xs leading-relaxed">
                                    Nothing to build people from, so every person will be invented.
                                    Attach a file, switch on a source or paste some material.
                                </p>
                            )}
                            <Button
                                size="lg"
                                disabled={!canRun}
                                onClick={() => void submit()}
                                className="w-full"
                            >
                                <Play />
                                {submitting ? "Starting…" : "Run scenario"}
                            </Button>
                            {holdReason && !problem && (
                                <p
                                    className="text-ink-3 text-xs leading-relaxed"
                                    aria-live="polite"
                                >
                                    {holdReason}
                                </p>
                            )}
                            {problem && (
                                <p role="alert" className="text-danger text-xs leading-relaxed">
                                    {problem.message}
                                    {problem.credits &&
                                        " Use fewer people or rounds, or ask an admin to add credits."}
                                </p>
                            )}
                        </div>
                    </div>
                    <p className="text-ink-3 px-1 text-xs leading-relaxed">{SCENARIO_CAVEAT}</p>
                </aside>
            </div>

            <FilePickerDialog
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                files={documents}
                loading={options.loading}
                error={options.error}
                onRetry={() => void reloadOptions()}
                picked={docs}
                max={L.documentsMax}
                onToggle={toggleDoc}
                onUpload={
                    canUpload
                        ? () => {
                              fileInput.current?.click();
                              setPickerOpen(false);
                          }
                        : null
                }
            />
        </div>
    );
}

/** The situation read on from "What happens if", unless it already asks. */
function asQuestion(text: string): string {
    if (/^what\b/i.test(text)) return text;
    // "We raise prices…" reads on lower-case; a name ("Acme raises…") keeps its case.
    const rest = /^(We|Our|The|A|An|All|Every|Some|They|Their)\b/.test(text)
        ? text[0]!.toLowerCase() + text.slice(1)
        : text;
    return `What happens if ${rest}`;
}

function capitalize(text: string): string {
    return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

function SummaryRow({ term, value, muted }: { term: string; value: string; muted?: boolean }) {
    return (
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
            <dt className="text-ink-3">{term}</dt>
            <dd className={cn("min-w-0", muted ? "text-ink-3" : "text-ink-2")}>{value}</dd>
        </div>
    );
}

function SourceIcon({ icon: Icon, on }: { icon: LucideIcon; on: boolean }) {
    return (
        <span
            aria-hidden
            className={cn(
                "inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
                on ? "bg-brand text-brand-fg" : "bg-panel-2 text-ink-2"
            )}
        >
            <Icon className="size-4" />
        </span>
    );
}

/** One source the people can be built from, as a card the whole of which flips its switch. */
function SourceCard({ source: s }: { source: SourceSwitch }) {
    const id = `scenario-${s.id}`;
    return (
        <label
            htmlFor={id}
            className={cn(
                "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                s.disabled
                    ? "border-line bg-panel cursor-not-allowed opacity-60"
                    : s.checked
                      ? "border-brand/50 bg-brand-soft/50 cursor-pointer"
                      : "border-line bg-panel hover:bg-panel-2 cursor-pointer"
            )}
        >
            <SourceIcon icon={s.icon} on={s.checked} />
            <span className="min-w-0 flex-1">
                <span className="text-ink block text-[13px] font-medium">{s.label}</span>
                <span className="text-ink-3 mt-0.5 block text-xs leading-snug">{s.hint}</span>
            </span>
            <Switch
                id={id}
                checked={s.checked}
                disabled={s.disabled}
                onCheckedChange={s.set}
                className="mt-0.5"
            />
        </label>
    );
}

function SizeSlider({
    id,
    label,
    value,
    min,
    max,
    onChange,
    hint,
}: {
    id: string;
    label: string;
    value: number;
    min: number;
    max: number;
    onChange: (v: number) => void;
    hint: string;
}) {
    return (
        <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={`scenario-${id}`} className="text-ink-2 text-[13px] font-normal">
                    {label}
                </Label>
                <span className="text-ink font-mono text-sm tabular-nums">{value}</span>
            </div>
            <Slider
                id={`scenario-${id}`}
                min={min}
                max={max}
                step={1}
                value={[value]}
                onValueChange={([v]) => onChange(v ?? min)}
                thumbLabel={label}
            />
            <div className="text-ink-3 flex justify-between gap-3 text-xs">
                <span>{hint}</span>
                <span className="shrink-0 font-mono tabular-nums">
                    {min}–{max}
                </span>
            </div>
        </div>
    );
}

function EstimateBox({
    estimate,
    settling,
    error,
    blocked,
}: {
    estimate: ScenarioEstimate | null;
    settling: boolean;
    error: string | null;
    blocked: boolean;
}) {
    return (
        <div
            className={cn(
                "border-line-2 flex flex-col gap-1 border-t px-4 py-3",
                blocked && "bg-danger-soft"
            )}
            aria-live="polite"
        >
            <span className="text-ink-3 text-xs">Estimate</span>
            {estimate ? (
                <div className={cn("transition-opacity", settling && "opacity-60")}>
                    <div className="text-ink text-lg font-semibold tabular-nums leading-tight">
                        ≈ {estimate.credits.toLocaleString()}{" "}
                        <span className="text-ink-2 text-xs font-normal">credits</span>
                    </div>
                    <div className="text-ink-3 mt-0.5 text-xs tabular-nums">
                        About {estimate.calls.toLocaleString()} model calls
                    </div>
                </div>
            ) : error ? null : (
                <Skeleton className="h-6 w-3/5" />
            )}
            {estimate && (
                <span className="text-ink-3 text-xs tabular-nums">
                    {estimate.balance === null
                        ? "Usage is not metered on this workspace."
                        : `Balance: ${estimate.balance.toLocaleString()} credits`}
                </span>
            )}
            {error && <span className="text-danger text-xs">{error}</span>}
            {blocked && estimate && (
                <p className="text-danger mt-1 text-xs leading-relaxed">
                    Not enough credits for this size: it needs about{" "}
                    {estimate.credits.toLocaleString()} and the workspace has{" "}
                    {(estimate.balance ?? 0).toLocaleString()}. Use fewer people or rounds.
                </p>
            )}
        </div>
    );
}

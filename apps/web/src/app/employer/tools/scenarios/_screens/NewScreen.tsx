"use client";

import { Search } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { useToolRouter } from "~/components/tool-app/nav";
import { InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { Slider } from "~/components/ui/slider";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { SCENARIO_LIMITS, type ScenarioEstimate } from "~/lib/scenarios/types";
import { useResource } from "~/lib/tools/useResource";
import { cn } from "~/lib/utils";

import { ScenariosApiError, scenariosApi } from "../api";
import { useScenarios } from "../_lib/context";
import { runPath } from "../_lib/screens";

const L = SCENARIO_LIMITS;

/** The estimate for a size, asked for once the sliders settle. */
function useEstimate(agents: number, rounds: number, fallbackError: string) {
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
                            error: e instanceof Error ? e.message : fallbackError,
                        }));
                });
        }, 350);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [agents, rounds, fallbackError]);
    return state;
}

function Counter({ value, max }: { value: number; max: number }) {
    const format = useFormatter();
    return (
        <span
            className={cn(
                "shrink-0 font-mono text-[11px] tabular-nums",
                value > max ? "text-danger" : "text-ink-3"
            )}
        >
            {format.number(value)}/{format.number(max)}
        </span>
    );
}

/**
 * The form: what happens, what the people are built from, how many people
 * and rounds. The estimate follows the sliders; the one primary action starts
 * the run and opens it.
 */
export function NewScreen() {
    const t = useTranslations("scenarios.new");
    const tw = useTranslations("scenarios.words");
    const router = useToolRouter();
    const { expectLive } = useScenarios();
    const options = useResource("scenarios:sources", () => scenariosApi.sources());

    const [title, setTitle] = useState("");
    const [subject, setSubject] = useState("");
    const [docs, setDocs] = useState<number[]>([]);
    const [query, setQuery] = useState("");
    const [searchFiles, setSearchFiles] = useState(true);
    const [prospects, setProspects] = useState(false);
    const [brandComments, setBrandComments] = useState(false);
    const [companyProfile, setCompanyProfile] = useState(true);
    const [notes, setNotes] = useState("");
    const [agents, setAgents] = useState<number>(L.agents.default);
    const [rounds, setRounds] = useState<number>(L.rounds.default);
    const [submitting, setSubmitting] = useState(false);
    const [problem, setProblem] = useState<{ message: string; credits: boolean } | null>(null);
    const estimate = useEstimate(agents, rounds, t("estimateError"));

    const offered = options.data;
    // The profile switch means nothing when there is no profile to read.
    const profileOn = companyProfile && (offered?.companyProfile ?? true);
    const documents = useMemo(() => offered?.documents ?? [], [offered]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return documents;
        return documents.filter(
            d => d.title.toLowerCase().includes(q) || (d.folder ?? "").toLowerCase().includes(q)
        );
    }, [documents, query]);

    const anySource =
        docs.length > 0 ||
        searchFiles ||
        (prospects && (offered?.prospects ?? 0) > 0) ||
        (brandComments && (offered?.brandComments ?? 0) > 0) ||
        profileOn ||
        notes.trim().length > 0;

    const current =
        estimate.data && estimate.data.agents === agents && estimate.data.rounds === rounds
            ? estimate.data
            : null;
    const blocked = current !== null && !current.enough;
    const tooLong = subject.length > L.subjectMax || notes.length > L.notesMax;
    const canRun = subject.trim().length > 0 && !blocked && !tooLong && !submitting;

    const toggleDoc = (id: number, on: boolean) => {
        setDocs(list =>
            on ? [...new Set([...list, id])].slice(0, L.documentsMax) : list.filter(d => d !== id)
        );
    };

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
                message: e instanceof Error ? e.message : t("startError"),
                credits,
            });
            setSubmitting(false);
        }
    };

    const switches: Array<{
        id: string;
        label: string;
        hint: string;
        checked: boolean;
        set: (v: boolean) => void;
        disabled?: boolean;
    }> = [
        {
            id: "search",
            label: t("switches.search"),
            hint: t("switches.searchHint"),
            checked: searchFiles,
            set: setSearchFiles,
        },
        {
            id: "prospects",
            label: t("switches.prospects"),
            hint: offered
                ? offered.prospects > 0
                    ? t("switches.prospectsHint", { count: offered.prospects })
                    : t("switches.prospectsNone")
                : t("switches.prospectsLoading"),
            checked: prospects && (offered?.prospects ?? 0) > 0,
            set: setProspects,
            disabled: offered ? offered.prospects === 0 : true,
        },
        {
            id: "comments",
            label: t("switches.comments"),
            hint: offered
                ? offered.brandComments > 0
                    ? t("switches.commentsHint", { count: offered.brandComments })
                    : t("switches.commentsNone")
                : t("switches.commentsLoading"),
            checked: brandComments && (offered?.brandComments ?? 0) > 0,
            set: setBrandComments,
            disabled: offered ? offered.brandComments === 0 : true,
        },
        {
            id: "profile",
            label: t("switches.profile"),
            hint:
                offered && !offered.companyProfile
                    ? t("switches.profileNone")
                    : t("switches.profileHint"),
            checked: profileOn,
            set: setCompanyProfile,
            disabled: offered ? !offered.companyProfile : true,
        },
    ];

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
            <PageHeader size="md" title={t("title")} accent={t("accent")} sub={t("sub")} />
            <div className="@max-lg:grid-cols-1 grid grid-cols-[minmax(0,1fr)_320px] items-start gap-8">
                <div className="flex min-w-0 flex-col gap-7">
                    <section className="flex flex-col gap-4">
                        <div>
                            <Label htmlFor="scenario-subject" className="text-ink text-sm">
                                {t("subjectLabel")}
                            </Label>
                            <Textarea
                                id="scenario-subject"
                                value={subject}
                                onChange={e => setSubject(e.target.value)}
                                rows={3}
                                placeholder={t("subjectPlaceholder")}
                                className="mt-1.5 text-[14px] leading-[1.5]"
                                aria-invalid={subject.length > L.subjectMax || undefined}
                            />
                            <div className="text-ink-3 mt-1 flex justify-between gap-3 text-xs">
                                <span>{t("subjectHint")}</span>
                                <Counter value={subject.length} max={L.subjectMax} />
                            </div>
                        </div>
                        <div>
                            <Label
                                htmlFor="scenario-title"
                                className="text-ink-3 text-xs font-normal"
                            >
                                {t("titleLabel")}
                            </Label>
                            <Input
                                id="scenario-title"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                maxLength={120}
                                placeholder={t("titlePlaceholder")}
                                className="mt-1.5"
                            />
                        </div>
                    </section>

                    <section className="flex flex-col gap-4">
                        <SectionHeading title={t("builtFromTitle")} aside={t("builtFromAside")} />
                        <div>
                            <div className="mb-1.5 flex items-baseline justify-between gap-3">
                                <span className="text-ink-2 text-[13px]">{t("files")}</span>
                                <span className="text-ink-3 text-xs tabular-nums">
                                    {t("picked", { count: docs.length, max: L.documentsMax })}
                                </span>
                            </div>
                            <div className="border-line bg-panel overflow-hidden rounded-lg border">
                                <div className="border-line-2 flex items-center gap-2 border-b px-3">
                                    <Search className="text-ink-3 size-3.5 shrink-0" aria-hidden />
                                    <Input
                                        value={query}
                                        onChange={e => setQuery(e.target.value)}
                                        placeholder={t("findFile")}
                                        aria-label={t("findFile")}
                                        className="h-9 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0 dark:bg-transparent"
                                    />
                                </div>
                                {options.loading ? (
                                    <SkeletonRows
                                        rows={3}
                                        height={36}
                                        className="rounded-none border-0"
                                    />
                                ) : options.error ? (
                                    <InlineError
                                        className="px-3 py-3"
                                        message={options.error}
                                        onRetry={() => void options.reload()}
                                    />
                                ) : shown.length === 0 ? (
                                    <p className="text-ink-3 px-3 py-3 text-[13px]">
                                        {documents.length === 0 ? t("noFiles") : t("noMatch")}
                                    </p>
                                ) : (
                                    <ul
                                        className="max-h-[232px] overflow-y-auto"
                                        aria-label={t("files")}
                                    >
                                        {shown.map(doc => {
                                            const id = `scenario-doc-${doc.id}`;
                                            const on = docs.includes(doc.id);
                                            const full = !on && docs.length >= L.documentsMax;
                                            return (
                                                <li
                                                    key={doc.id}
                                                    className="border-line-2 hover:bg-panel-2 flex items-center gap-3 border-t px-3 py-2 first:border-t-0"
                                                >
                                                    <Checkbox
                                                        id={id}
                                                        checked={on}
                                                        disabled={full}
                                                        onCheckedChange={v =>
                                                            toggleDoc(doc.id, v === true)
                                                        }
                                                    />
                                                    <Label
                                                        htmlFor={id}
                                                        className={cn(
                                                            "min-w-0 flex-1 cursor-pointer text-[13px] font-normal",
                                                            full ? "text-ink-3" : "text-ink"
                                                        )}
                                                    >
                                                        <span className="truncate">
                                                            {doc.title}
                                                        </span>
                                                    </Label>
                                                    {doc.folder && (
                                                        <span className="text-ink-3 @max-sm:hidden shrink-0 text-xs">
                                                            {doc.folder}
                                                        </span>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        </div>

                        <div className="border-line bg-panel rounded-lg border">
                            {switches.map(s => (
                                <div
                                    key={s.id}
                                    className="border-line-2 flex items-start gap-3 border-t px-3 py-2.5 first:border-t-0"
                                >
                                    <Switch
                                        id={`scenario-${s.id}`}
                                        checked={s.checked}
                                        disabled={s.disabled}
                                        onCheckedChange={s.set}
                                        className="mt-0.5"
                                    />
                                    <div className="min-w-0">
                                        <Label
                                            htmlFor={`scenario-${s.id}`}
                                            className={cn(
                                                "text-[13px] font-normal",
                                                s.disabled ? "text-ink-3" : "text-ink"
                                            )}
                                        >
                                            {s.label}
                                        </Label>
                                        <p className="text-ink-3 mt-0.5 text-xs">{s.hint}</p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div>
                            <Label
                                htmlFor="scenario-notes"
                                className="text-ink-2 text-[13px] font-normal"
                            >
                                {t("notesLabel")}
                            </Label>
                            <Textarea
                                id="scenario-notes"
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                rows={4}
                                placeholder={t("notesPlaceholder")}
                                className="mt-1.5 text-[13px]"
                                aria-invalid={notes.length > L.notesMax || undefined}
                            />
                            <div className="mt-1 flex justify-end">
                                <Counter value={notes.length} max={L.notesMax} />
                            </div>
                        </div>
                    </section>

                    <section className="flex flex-col gap-5">
                        <SectionHeading title={t("size")} />
                        <SizeSlider
                            id="people"
                            label={t("people")}
                            value={agents}
                            min={L.agents.min}
                            max={L.agents.max}
                            onChange={setAgents}
                            hint={t("peopleHint")}
                        />
                        <SizeSlider
                            id="rounds"
                            label={t("rounds")}
                            value={rounds}
                            min={L.rounds.min}
                            max={L.rounds.max}
                            onChange={setRounds}
                            hint={t("roundsHint")}
                        />
                    </section>
                </div>

                <aside className="@max-lg:static sticky top-0 flex flex-col gap-3">
                    <EstimateBox
                        estimate={current ?? estimate.data}
                        settling={estimate.loading || current === null}
                        error={estimate.error}
                        blocked={blocked}
                    />
                    {!anySource && (
                        <p className="border-warn/40 bg-warn-soft text-warn rounded-lg border px-3 py-2 text-xs leading-relaxed">
                            {t("noSources")}
                        </p>
                    )}
                    <p className="text-ink-3 text-xs leading-relaxed">{tw("caveat")}</p>
                    <Button disabled={!canRun} onClick={() => void submit()} className="w-full">
                        {submitting ? t("starting") : t("run")}
                    </Button>
                    {!subject.trim() && !problem && (
                        <p className="text-ink-3 text-xs">{t("describeFirst")}</p>
                    )}
                    {problem && (
                        <p role="alert" className="text-danger text-xs leading-relaxed">
                            {problem.message}
                            {problem.credits && ` ${t("creditsHint")}`}
                        </p>
                    )}
                </aside>
            </div>
        </div>
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
    const t = useTranslations("scenarios.new");
    return (
        <div
            className={cn(
                "bg-panel flex flex-col gap-1.5 rounded-lg border p-4",
                blocked ? "border-danger/60" : "border-line"
            )}
            aria-live="polite"
        >
            <span className="text-ink-3 text-xs">{t("estimate")}</span>
            {estimate ? (
                <div
                    className={cn(
                        "text-ink text-sm font-medium tabular-nums transition-opacity",
                        settling && "opacity-60"
                    )}
                >
                    {t("estimateValue", { calls: estimate.calls, credits: estimate.credits })}
                </div>
            ) : error ? null : (
                <Skeleton className="h-4 w-4/5" />
            )}
            {estimate && (
                <span className="text-ink-3 text-xs tabular-nums">
                    {estimate.balance === null
                        ? t("unmetered")
                        : t("balance", { balance: estimate.balance })}
                </span>
            )}
            {error && <span className="text-danger text-xs">{error}</span>}
            {blocked && estimate && (
                <p className="text-danger mt-1 text-xs leading-relaxed">
                    {t("notEnough", {
                        credits: estimate.credits,
                        balance: estimate.balance ?? 0,
                    })}
                </p>
            )}
        </div>
    );
}

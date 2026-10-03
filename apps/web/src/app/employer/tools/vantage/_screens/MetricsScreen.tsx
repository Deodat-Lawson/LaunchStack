"use client";

import { MoreHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { useResource } from "~/lib/tools/useResource";
import { Button } from "~/components/ui/button";
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
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

import { vantageApi, type MetricDefinitionDto, type MetricObservationDto } from "../api";
import { Field, FormError } from "../_components/Primitives";
import { addDaysIso, fmtChange, fmtDate, fmtNumber, plural, todayIso } from "../_lib/format";

const UNITS = ["count", "percent", "usd", "eur", "minutes", "days"];

function lastMonday(today = todayIso()): string {
    const d = new Date(today);
    const day = d.getDay();
    const back = day === 0 ? 6 : day - 1;
    return addDaysIso(today, -back - 7);
}

/**
 * Metric definitions and the numbers against them. The definition is the
 * point: signups, activated, active and paying are four different things,
 * and a number without its period and source cannot be cited.
 */
export function MetricsScreen() {
    const metrics = useResource("vantage:metrics", () => vantageApi.metrics());
    const [defining, setDefining] = useState<MetricDefinitionDto | null | "new">(null);
    const [recording, setRecording] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);

    const definitions = useMemo(() => metrics.data?.definitions ?? [], [metrics.data]);
    const observations = useMemo(() => metrics.data?.observations ?? [], [metrics.data]);

    /** Latest and previous per metric, for the definitions table. */
    const latestByMetric = useMemo(() => {
        const m = new Map<
            string,
            { latest: MetricObservationDto; previous: MetricObservationDto | null }
        >();
        for (const def of definitions) {
            const rows = observations
                .filter(o => o.metricId === def.id)
                .sort((a, b) =>
                    a.periodEnd < b.periodEnd ? 1 : a.periodEnd > b.periodEnd ? -1 : 0
                );
            const latest = rows[0];
            if (!latest) continue;
            const previous = rows.slice(1).find(r => r.periodEnd < latest.periodStart) ?? null;
            m.set(def.id, { latest, previous });
        }
        return m;
    }, [definitions, observations]);

    const removeDefinition = async (d: MetricDefinitionDto) => {
        if (!window.confirm(`Remove "${d.name}" and every number recorded against it?`)) return;
        try {
            await vantageApi.deleteMetric(d.id);
            toast("Metric removed");
            void metrics.reload();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not remove it");
        }
    };

    const removeObservation = async (o: MetricObservationDto) => {
        try {
            await vantageApi.deleteObservation(o.id);
            metrics.mutate(c => ({
                ...c,
                observations: c.observations.filter(x => x.id !== o.id),
            }));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not remove it");
        }
    };

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
            <PageHeader
                title="Numbers that say"
                accent="what they count"
                sub={
                    metrics.data
                        ? `${plural(definitions.length, "metric")} · ${plural(observations.length, "number")} recorded`
                        : undefined
                }
                actions={
                    <>
                        <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
                            Import CSV
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => setRecording(definitions[0]?.id ?? null)}
                            disabled={definitions.length === 0}
                        >
                            Record a number
                        </Button>
                    </>
                }
            />

            {metrics.error && (
                <InlineError message={metrics.error} onRetry={() => void metrics.reload()} />
            )}

            <section>
                <SectionHeading
                    title="Definitions"
                    aside={
                        <button
                            type="button"
                            onClick={() => setDefining("new")}
                            className="hover:text-ink"
                        >
                            Define a metric
                        </button>
                    }
                />
                {metrics.loading ? (
                    <SkeletonRows rows={4} height={52} />
                ) : (
                    <div className="border-line bg-panel rounded-lg border">
                        {definitions.map(d => {
                            const l = latestByMetric.get(d.id);
                            const pct =
                                l?.previous && l.previous.value !== 0
                                    ? (l.latest.value - l.previous.value) / l.previous.value
                                    : null;
                            const delta = l?.previous ? l.latest.value - l.previous.value : null;
                            return (
                                <div
                                    key={d.id}
                                    className="border-line-2 flex min-h-[52px] items-center gap-3 border-t px-4 py-2 first:border-t-0"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-ink text-[13px] font-medium">
                                                {d.name}
                                            </span>
                                            <span className="text-ink-3 font-mono text-[11px]">
                                                {d.key}
                                            </span>
                                        </div>
                                        <div
                                            className={cn(
                                                "max-w-[70ch] text-[12px]",
                                                d.definition ? "text-ink-2" : "text-warn"
                                            )}
                                        >
                                            {d.definition ||
                                                "No definition yet — say what counts and what does not."}
                                        </div>
                                    </div>
                                    {l ? (
                                        <div className="@max-sm:hidden text-right">
                                            <div className="text-ink font-mono text-[13px] tabular-nums">
                                                {fmtNumber(l.latest.value, d.unit)}
                                            </div>
                                            <div className="text-ink-3 text-[11px]">
                                                {fmtDate(l.latest.periodStart)}–
                                                {fmtDate(l.latest.periodEnd)}
                                                {delta !== null && (
                                                    <span className="ml-1.5 font-mono tabular-nums">
                                                        {fmtChange(pct, delta, d.unit)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <span className="text-ink-3 @max-sm:hidden text-[12px]">
                                            no numbers yet
                                        </span>
                                    )}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setRecording(d.id)}
                                    >
                                        Record
                                    </Button>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="size-7"
                                                aria-label={`Actions for ${d.name}`}
                                            >
                                                <MoreHorizontal className="size-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onSelect={() => setDefining(d)}>
                                                Edit definition
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                className="text-danger"
                                                onSelect={() => void removeDefinition(d)}
                                            >
                                                Remove metric
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            <section>
                <SectionHeading title="Recorded numbers" aside="newest period first" />
                {metrics.loading ? (
                    <SkeletonRows rows={5} height={40} />
                ) : observations.length === 0 ? (
                    <EmptyState
                        title="No numbers yet"
                        body="Record this week's signups, activations, actives and paying customers — one number, one period, one source. Or paste a CSV from your spreadsheet."
                        action={
                            <>
                                <Button
                                    size="sm"
                                    onClick={() => setRecording(definitions[0]?.id ?? null)}
                                    disabled={definitions.length === 0}
                                >
                                    Record a number
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setImporting(true)}
                                >
                                    Import CSV
                                </Button>
                            </>
                        }
                    />
                ) : (
                    <div className="border-line bg-panel overflow-x-auto rounded-lg border">
                        <table className="w-full text-[13px]">
                            <thead>
                                <tr className="text-ink-3 text-left text-[12px]">
                                    <th className="px-4 py-2 font-medium">Metric</th>
                                    <th className="px-4 py-2 text-right font-medium">Value</th>
                                    <th className="px-4 py-2 font-medium">Period</th>
                                    <th className="px-4 py-2 font-medium">Source</th>
                                    <th className="px-4 py-2 font-medium">Note</th>
                                    <th className="px-2 py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {observations.map(o => {
                                    const unit =
                                        definitions.find(d => d.id === o.metricId)?.unit ?? "count";
                                    return (
                                        <tr key={o.id} className="border-line-2 h-10 border-t">
                                            <td className="text-ink px-4 font-medium">
                                                {o.metricName}
                                            </td>
                                            <td className="text-ink px-4 text-right font-mono tabular-nums">
                                                {fmtNumber(o.value, unit)}
                                            </td>
                                            <td className="text-ink-2 px-4 font-mono text-[12px] tabular-nums">
                                                {o.periodStart === o.periodEnd
                                                    ? o.periodStart
                                                    : `${o.periodStart} → ${o.periodEnd}`}
                                            </td>
                                            <td className="text-ink-2 max-w-[200px] truncate px-4">
                                                {o.source ?? (
                                                    <span className="text-warn">no source</span>
                                                )}
                                            </td>
                                            <td className="text-ink-3 max-w-[260px] truncate px-4 text-[12px]">
                                                {o.note ?? ""}
                                            </td>
                                            <td className="px-2 text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 px-2 text-[12px]"
                                                    onClick={() => void removeObservation(o)}
                                                >
                                                    Remove
                                                </Button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <DefineMetricDialog
                open={defining !== null}
                onOpenChange={o => !o && setDefining(null)}
                initial={defining === "new" ? null : defining}
                onSaved={() => void metrics.reload()}
            />
            <RecordDialog
                open={recording !== null}
                onOpenChange={o => !o && setRecording(null)}
                definitions={definitions}
                initialMetricId={recording}
                onSaved={() => void metrics.reload()}
            />
            <ImportDialog
                open={importing}
                onOpenChange={setImporting}
                onDone={() => void metrics.reload()}
            />
        </div>
    );
}

function DefineMetricDialog({
    open,
    onOpenChange,
    initial,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    initial: MetricDefinitionDto | null;
    onSaved: () => void;
}) {
    const [name, setName] = useState("");
    const [definition, setDefinition] = useState("");
    const [unit, setUnit] = useState("count");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!open) return;
        setName(initial?.name ?? "");
        setDefinition(initial?.definition ?? "");
        setUnit(initial?.unit ?? "count");
        setError(null);
    }, [open, initial]);
    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            if (initial) await vantageApi.patchMetric(initial.id, { name, definition, unit });
            else await vantageApi.defineMetric({ name, definition, unit });
            toast(initial ? "Definition saved" : "Metric defined");
            onSaved();
            onOpenChange(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "That did not save");
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle>{initial ? "Edit definition" : "Define a metric"}</DialogTitle>
                    <DialogDescription>
                        Write down what counts. A deck and a dashboard disagree about definitions
                        more often than about arithmetic.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3.5">
                    <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_140px]">
                        <Field label="Name" htmlFor="m-name">
                            <Input
                                id="m-name"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Activated users"
                                autoFocus
                            />
                        </Field>
                        <Field label="Unit">
                            <Select value={unit} onValueChange={setUnit}>
                                <SelectTrigger aria-label="Unit">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {UNITS.map(u => (
                                        <SelectItem key={u} value={u}>
                                            {u}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>
                    </div>
                    <Field
                        label="Definition"
                        htmlFor="m-def"
                        hint="What is in, what is out, and over what period a number is measured"
                    >
                        <Textarea
                            id="m-def"
                            value={definition}
                            onChange={e => setDefinition(e.target.value)}
                            rows={3}
                            placeholder="Signups that completed the first-value action within 7 days."
                        />
                    </Field>
                    <FormError message={error} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void save()}
                        disabled={busy || !name.trim() || !definition.trim()}
                    >
                        {initial ? "Save" : "Define"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function RecordDialog({
    open,
    onOpenChange,
    definitions,
    initialMetricId,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    definitions: MetricDefinitionDto[];
    initialMetricId: string | null;
    onSaved: () => void;
}) {
    const [metricId, setMetricId] = useState("");
    const [value, setValue] = useState("");
    const [periodStart, setPeriodStart] = useState(lastMonday());
    const [periodEnd, setPeriodEnd] = useState(addDaysIso(lastMonday(), 6));
    const [source, setSource] = useState("");
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!open) return;
        setMetricId(initialMetricId ?? definitions[0]?.id ?? "");
        setValue("");
        setError(null);
    }, [open, initialMetricId, definitions]);
    const def = definitions.find(d => d.id === metricId);
    const save = async () => {
        const n = Number(value.replace(/[^\d.\-eE]/g, ""));
        if (!Number.isFinite(n)) {
            setError("Enter a number.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await vantageApi.addObservation({
                metricId,
                value: n,
                periodStart,
                periodEnd,
                source: source || null,
                note: note || null,
            });
            toast("Number recorded");
            onSaved();
            onOpenChange(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "That did not save");
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle>Record a number</DialogTitle>
                    <DialogDescription>
                        {def
                            ? def.definition || "This metric has no definition yet."
                            : "Pick a metric."}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3.5">
                    <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_140px]">
                        <Field label="Metric">
                            <Select value={metricId} onValueChange={setMetricId}>
                                <SelectTrigger aria-label="Metric">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {definitions.map(d => (
                                        <SelectItem key={d.id} value={d.id}>
                                            {d.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field label={`Value${def ? ` (${def.unit})` : ""}`} htmlFor="o-value">
                            <Input
                                id="o-value"
                                inputMode="decimal"
                                value={value}
                                onChange={e => setValue(e.target.value)}
                                placeholder="40"
                                autoFocus
                                className="font-mono tabular-nums"
                            />
                        </Field>
                    </div>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <Field label="Period start" htmlFor="o-start">
                            <Input
                                id="o-start"
                                type="date"
                                value={periodStart}
                                onChange={e => setPeriodStart(e.target.value)}
                            />
                        </Field>
                        <Field label="Period end" htmlFor="o-end">
                            <Input
                                id="o-end"
                                type="date"
                                value={periodEnd}
                                onChange={e => setPeriodEnd(e.target.value)}
                            />
                        </Field>
                    </div>
                    <Field
                        label="Source"
                        htmlFor="o-source"
                        hint="Where the number comes from: a tool, an export, a person"
                    >
                        <Input
                            id="o-source"
                            value={source}
                            onChange={e => setSource(e.target.value)}
                            placeholder="Mixpanel · Stripe · Seed deck v3"
                        />
                    </Field>
                    <Field label="Note" htmlFor="o-note">
                        <Input
                            id="o-note"
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            placeholder="Optional"
                        />
                    </Field>
                    <FormError message={error} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void save()}
                        disabled={busy || !metricId || !value.trim()}
                    >
                        Record
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

const CSV_EXAMPLE = `metric,value,period_start,period_end,source
signups,40,2026-09-21,2026-09-27,Mixpanel
activated,6,2026-09-21,2026-09-27,Mixpanel`;

function ImportDialog({
    open,
    onOpenChange,
    onDone,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    onDone: () => void;
}) {
    const [csv, setCsv] = useState("");
    const [source, setSource] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{
        imported: number;
        problems: { line: number; message: string }[];
        createdMetrics: string[];
    } | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (open) {
            setResult(null);
            setError(null);
        }
    }, [open]);
    const run = async () => {
        setBusy(true);
        setError(null);
        try {
            const r = await vantageApi.importMetrics(csv, source || null);
            setResult(r);
            if (r.imported > 0) {
                toast(`${plural(r.imported, "number")} imported`);
                onDone();
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "The import failed");
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>Import numbers from a spreadsheet</DialogTitle>
                    <DialogDescription>
                        Columns: metric, value, period_start, period_end (or one period column),
                        source. A metric that is not defined yet is created and needs its definition
                        afterwards.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3.5">
                    <Field label="CSV" htmlFor="imp-csv">
                        <Textarea
                            id="imp-csv"
                            value={csv}
                            onChange={e => setCsv(e.target.value)}
                            rows={8}
                            placeholder={CSV_EXAMPLE}
                            className="font-mono text-[12px]"
                        />
                        <div className="flex items-center gap-2">
                            <input
                                ref={fileRef}
                                type="file"
                                accept=".csv,.tsv,text/csv,text/plain"
                                className="hidden"
                                onChange={e => {
                                    const f = e.target.files?.[0];
                                    if (f) void f.text().then(setCsv);
                                    e.target.value = "";
                                }}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => fileRef.current?.click()}
                            >
                                Choose a file
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setCsv(CSV_EXAMPLE)}
                            >
                                Use the example
                            </Button>
                        </div>
                    </Field>
                    <Field
                        label="Default source"
                        htmlFor="imp-source"
                        hint="Used for rows without a source column"
                    >
                        <Input
                            id="imp-source"
                            value={source}
                            onChange={e => setSource(e.target.value)}
                            placeholder="Mixpanel export"
                        />
                    </Field>
                    <FormError message={error} />
                    {result && (
                        <div className="border-line bg-panel-2 rounded-lg border px-3 py-2 text-[12.5px]">
                            <div className="text-ink">
                                {plural(result.imported, "number")} imported.
                            </div>
                            {result.createdMetrics.length > 0 && (
                                <div className="text-warn mt-1">
                                    New metrics without a definition:{" "}
                                    {result.createdMetrics.join(", ")}. Define them so their numbers
                                    can be cited.
                                </div>
                            )}
                            {result.problems.length > 0 && (
                                <ul className="text-danger mt-1 list-disc pl-4">
                                    {result.problems.slice(0, 8).map(p => (
                                        <li key={p.line}>
                                            Line {p.line}: {p.message}
                                        </li>
                                    ))}
                                    {result.problems.length > 8 && (
                                        <li>…and {result.problems.length - 8} more</li>
                                    )}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        {result ? "Done" : "Cancel"}
                    </Button>
                    <Button onClick={() => void run()} disabled={busy || !csv.trim()}>
                        Import
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

"use client";

import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { useResource } from "~/lib/tools/useResource";
import { Button } from "~/components/ui/button";
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
import { MetricSuggestions } from "../_components/MetricSuggestions";
import { Field, FormError } from "../_components/Primitives";
import { useOneClick } from "../_lib/actions";
import { useHiddenSuggestions } from "../_lib/hidden";
import { addDaysIso, todayIso, useVantageFormat } from "../_lib/format";

const UNITS = ["count", "percent", "usd", "eur", "minutes", "days"] as const;
type Unit = (typeof UNITS)[number];
const isUnit = (u: string): u is Unit => (UNITS as readonly string[]).includes(u);

function lastMonday(today = todayIso()): string {
    const d = new Date(today);
    const day = d.getDay();
    const back = day === 0 ? 6 : day - 1;
    return addDaysIso(today, -back - 7);
}

/**
 * Metric definitions and the numbers against them. The definition is the
 * point: signups, activated, active and paying are four different things,
 * and a number without its period and source cannot be cited. Vantage's
 * suggestions sit on top: two sources disagreeing about one period (keep
 * one, one click) and metrics with no number this week.
 */
export function MetricsScreen() {
    const t = useTranslations("vantage.metrics");
    const tc = useTranslations("common");
    const fmt = useVantageFormat();
    const metrics = useResource("vantage:metrics", () => vantageApi.metrics());
    const overview = useResource("vantage:overview", () => vantageApi.overview());
    const hidden = useHiddenSuggestions();
    const reloadMetrics = metrics.reload;
    const reloadOverview = overview.reload;
    const refresh = useCallback(
        () => Promise.all([reloadMetrics(), reloadOverview()]),
        [reloadMetrics, reloadOverview]
    );
    const { act, gone } = useOneClick(refresh);
    const [defining, setDefining] = useState<MetricDefinitionDto | null | "new">(null);
    const [recording, setRecording] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);
    /** The metric a Remove has been asked for, pending the confirm dialog. */
    const [removing, setRemoving] = useState<MetricDefinitionDto | null>(null);

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
        try {
            await vantageApi.deleteMetric(d.id);
            toast(t("removed"));
            void refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("removeError"));
        }
    };

    const removeObservation = async (o: MetricObservationDto) => {
        try {
            await vantageApi.deleteObservation(o.id);
            metrics.mutate(c => ({
                ...c,
                observations: c.observations.filter(x => x.id !== o.id),
            }));
            void reloadOverview();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("removeError"));
        }
    };

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
            <PageHeader
                title={t("title")}
                accent={t("accent")}
                sub={
                    metrics.data
                        ? t("sub", {
                              metrics: definitions.length,
                              numbers: observations.length,
                          })
                        : undefined
                }
                actions={
                    <>
                        <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
                            {t("importCsv")}
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => setRecording(definitions[0]?.id ?? null)}
                            disabled={definitions.length === 0}
                        >
                            {t("recordNumber")}
                        </Button>
                    </>
                }
            />

            {metrics.error && (
                <InlineError message={metrics.error} onRetry={() => void metrics.reload()} />
            )}

            {overview.data && (
                <MetricSuggestions
                    signals={overview.data.signals}
                    week={overview.data.agendaWeek}
                    observations={observations}
                    act={act}
                    gone={gone}
                    hidden={hidden}
                    onRecord={setRecording}
                />
            )}

            <section>
                <SectionHeading
                    title={t("definitions")}
                    aside={
                        <button
                            type="button"
                            onClick={() => setDefining("new")}
                            className="hover:text-ink"
                        >
                            {t("defineMetric")}
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
                                            {d.definition || t("noDefinition")}
                                        </div>
                                    </div>
                                    {l ? (
                                        <div className="@max-sm:hidden text-right">
                                            <div className="text-ink font-mono text-[13px] tabular-nums">
                                                {fmt.number(l.latest.value, d.unit)}
                                            </div>
                                            <div className="text-ink-3 text-[11px]">
                                                {t("period", {
                                                    start: fmt.date(l.latest.periodStart),
                                                    end: fmt.date(l.latest.periodEnd),
                                                })}
                                                {delta !== null && (
                                                    <span className="ml-1.5 font-mono tabular-nums">
                                                        {fmt.change(pct, delta, d.unit)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <span className="text-ink-3 @max-sm:hidden text-[12px]">
                                            {t("noNumbersYet")}
                                        </span>
                                    )}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setRecording(d.id)}
                                    >
                                        {t("record")}
                                    </Button>
                                    {/* Not modal: its items open dialogs, and a modal menu that hands off to a
                                        dialog leaves the page unclickable once the dialog closes. */}
                                    <DropdownMenu modal={false}>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="size-7"
                                                aria-label={t("actionsFor", { name: d.name })}
                                            >
                                                <MoreHorizontal className="size-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onSelect={() => setDefining(d)}>
                                                {t("editDefinition")}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                className="text-danger"
                                                onSelect={() => setRemoving(d)}
                                            >
                                                {t("removeMetricAsk")}
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
                <SectionHeading title={t("recorded")} aside={t("recordedAside")} />
                {metrics.loading ? (
                    <SkeletonRows rows={5} height={40} />
                ) : observations.length === 0 ? (
                    <EmptyState
                        title={t("emptyTitle")}
                        body={t("emptyBody")}
                        action={
                            <>
                                <Button
                                    size="sm"
                                    onClick={() => setRecording(definitions[0]?.id ?? null)}
                                    disabled={definitions.length === 0}
                                >
                                    {t("recordNumber")}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setImporting(true)}
                                >
                                    {t("importCsv")}
                                </Button>
                            </>
                        }
                    />
                ) : (
                    <div className="border-line bg-panel overflow-x-auto rounded-lg border">
                        <table className="w-full text-[13px]">
                            <thead>
                                <tr className="text-ink-3 text-left text-[12px]">
                                    <th className="px-4 py-2 font-medium">{t("table.metric")}</th>
                                    <th className="px-4 py-2 text-right font-medium">
                                        {t("table.value")}
                                    </th>
                                    <th className="px-4 py-2 font-medium">{t("table.period")}</th>
                                    <th className="px-4 py-2 font-medium">{t("table.source")}</th>
                                    <th className="px-4 py-2 font-medium">{t("table.note")}</th>
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
                                                {fmt.number(o.value, unit)}
                                            </td>
                                            <td className="text-ink-2 px-4 font-mono text-[12px] tabular-nums">
                                                {o.periodStart === o.periodEnd
                                                    ? o.periodStart
                                                    : `${o.periodStart} → ${o.periodEnd}`}
                                            </td>
                                            <td className="text-ink-2 max-w-[200px] truncate px-4">
                                                {o.source ?? (
                                                    <span className="text-warn">
                                                        {t("noSource")}
                                                    </span>
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
                                                    {tc("actions.remove")}
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
                onSaved={() => void refresh()}
            />
            <RecordDialog
                open={recording !== null}
                onOpenChange={o => !o && setRecording(null)}
                definitions={definitions}
                initialMetricId={recording}
                onSaved={() => void refresh()}
            />
            <ImportDialog
                open={importing}
                onOpenChange={setImporting}
                onDone={() => void refresh()}
            />
            <ConfirmDialog
                open={removing !== null}
                onOpenChange={next => {
                    if (!next) setRemoving(null);
                }}
                title={t("removeTitle", { name: removing?.name ?? "" })}
                description={t("removeBody")}
                confirmLabel={t("removeMetric")}
                onConfirm={() => {
                    const target = removing;
                    setRemoving(null);
                    if (target) void removeDefinition(target);
                }}
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
    const t = useTranslations("vantage.metrics");
    const tc = useTranslations("common");
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
            toast(initial ? t("definitionSaved") : t("defined"));
            onSaved();
            onOpenChange(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : t("saveError"));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle>{initial ? t("editDefinition") : t("defineMetric")}</DialogTitle>
                    <DialogDescription>{t("defineDescription")}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3.5">
                    <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_140px]">
                        <Field label={tc("fields.name")} htmlFor="m-name">
                            <Input
                                id="m-name"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder={t("namePlaceholder")}
                                autoFocus
                            />
                        </Field>
                        <Field label={t("unit")}>
                            <Select value={unit} onValueChange={setUnit}>
                                <SelectTrigger aria-label={t("unit")}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {UNITS.map(u => (
                                        <SelectItem key={u} value={u}>
                                            {t(`units.${u}`)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>
                    </div>
                    <Field label={t("definition")} htmlFor="m-def" hint={t("definitionHint")}>
                        <Textarea
                            id="m-def"
                            value={definition}
                            onChange={e => setDefinition(e.target.value)}
                            rows={3}
                            placeholder={t("definitionPlaceholder")}
                        />
                    </Field>
                    <FormError message={error} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        {tc("actions.cancel")}
                    </Button>
                    <Button
                        onClick={() => void save()}
                        disabled={busy || !name.trim() || !definition.trim()}
                    >
                        {initial ? tc("actions.save") : t("define")}
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
    const t = useTranslations("vantage.metrics");
    const tc = useTranslations("common");
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
            setError(t("enterNumber"));
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
            toast(t("numberRecorded"));
            onSaved();
            onOpenChange(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : t("saveError"));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle>{t("recordNumber")}</DialogTitle>
                    <DialogDescription>
                        {def ? def.definition || t("noDefinitionShort") : t("pickMetric")}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3.5">
                    <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_140px]">
                        <Field label={t("table.metric")}>
                            <Select value={metricId} onValueChange={setMetricId}>
                                <SelectTrigger aria-label={t("table.metric")}>
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
                        <Field
                            label={
                                def
                                    ? t("valueWithUnit", {
                                          unit: isUnit(def.unit)
                                              ? t(`units.${def.unit}`)
                                              : def.unit,
                                      })
                                    : t("table.value")
                            }
                            htmlFor="o-value"
                        >
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
                        <Field label={t("periodStart")} htmlFor="o-start">
                            <Input
                                id="o-start"
                                type="date"
                                value={periodStart}
                                onChange={e => setPeriodStart(e.target.value)}
                            />
                        </Field>
                        <Field label={t("periodEnd")} htmlFor="o-end">
                            <Input
                                id="o-end"
                                type="date"
                                value={periodEnd}
                                onChange={e => setPeriodEnd(e.target.value)}
                            />
                        </Field>
                    </div>
                    <Field label={t("table.source")} htmlFor="o-source" hint={t("sourceHint")}>
                        <Input
                            id="o-source"
                            value={source}
                            onChange={e => setSource(e.target.value)}
                            placeholder={t("sourcePlaceholder")}
                        />
                    </Field>
                    <Field label={t("table.note")} htmlFor="o-note">
                        <Input
                            id="o-note"
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            placeholder={tc("status.optional")}
                        />
                    </Field>
                    <FormError message={error} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        {tc("actions.cancel")}
                    </Button>
                    <Button
                        onClick={() => void save()}
                        disabled={busy || !metricId || !value.trim()}
                    >
                        {t("record")}
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
    const t = useTranslations("vantage.metrics");
    const tc = useTranslations("common");
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
                toast(t("imported", { count: r.imported }));
                onDone();
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : t("importFailed"));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>{t("importTitle")}</DialogTitle>
                    <DialogDescription>{t("importDescription")}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3.5">
                    <Field label={t("csv")} htmlFor="imp-csv">
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
                                {t("chooseFile")}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setCsv(CSV_EXAMPLE)}
                            >
                                {t("useExample")}
                            </Button>
                        </div>
                    </Field>
                    <Field
                        label={t("defaultSource")}
                        htmlFor="imp-source"
                        hint={t("defaultSourceHint")}
                    >
                        <Input
                            id="imp-source"
                            value={source}
                            onChange={e => setSource(e.target.value)}
                            placeholder={t("defaultSourcePlaceholder")}
                        />
                    </Field>
                    <FormError message={error} />
                    {result && (
                        <div className="border-line bg-panel-2 rounded-lg border px-3 py-2 text-[12.5px]">
                            <div className="text-ink">
                                {t("importedSentence", { count: result.imported })}
                            </div>
                            {result.createdMetrics.length > 0 && (
                                <div className="text-warn mt-1">
                                    {t("createdMetrics", {
                                        names: result.createdMetrics.join(t("listSeparator")),
                                    })}
                                </div>
                            )}
                            {result.problems.length > 0 && (
                                <ul className="text-danger mt-1 list-disc pl-4">
                                    {result.problems.slice(0, 8).map(p => (
                                        <li key={p.line}>
                                            {t("problemLine", { line: p.line, message: p.message })}
                                        </li>
                                    ))}
                                    {result.problems.length > 8 && (
                                        <li>
                                            {t("moreProblems", {
                                                count: result.problems.length - 8,
                                            })}
                                        </li>
                                    )}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        {result ? tc("actions.done") : tc("actions.cancel")}
                    </Button>
                    <Button onClick={() => void run()} disabled={busy || !csv.trim()}>
                        {tc("actions.import")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

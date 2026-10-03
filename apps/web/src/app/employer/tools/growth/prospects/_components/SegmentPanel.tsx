"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

import { prospectsApi, type SegmentField, type SourceKind, type SourceRow } from "../api";
import { useProspects } from "../_lib/context";
import { plural, relativeTime, shortDate } from "../../_lib/format";
import { useResource } from "../../_lib/useResource";
import { InlineError } from "../../_components/EmptyState";
import { Panel } from "../../_components/Panel";
import { SkeletonRows } from "../../_components/SkeletonRows";
import { NewSegmentDialog } from "./NewSegmentDialog";

function FieldRow({
    field,
    onSave,
}: {
    field: SegmentField;
    onSave: (value: string | string[]) => Promise<void>;
}) {
    const [editing, setEditing] = useState(false);
    const isList = Array.isArray(field.value);
    const [draft, setDraft] = useState(
        isList ? (field.value as string[]).join(", ") : String(field.value)
    );
    const [busy, setBusy] = useState(false);

    const save = async () => {
        setBusy(true);
        try {
            await onSave(
                isList
                    ? draft
                          .split(",")
                          .map(s => s.trim())
                          .filter(Boolean)
                    : draft.trim()
            );
            setEditing(false);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="border-line-2 grid grid-cols-1 gap-2 border-t py-3 first:border-t-0 md:grid-cols-[120px_1fr_auto] md:gap-x-4">
            <div className="text-ink-2 pt-0.5 text-[13px]">{field.label}</div>
            <div className="min-w-0">
                {editing ? (
                    <div className="flex flex-col gap-2">
                        {isList || String(field.value).length < 60 ? (
                            <Input
                                autoFocus
                                value={draft}
                                onChange={e => setDraft(e.target.value)}
                                className="h-8 text-[13px]"
                                aria-label={field.label}
                            />
                        ) : (
                            <Textarea
                                autoFocus
                                rows={2}
                                value={draft}
                                onChange={e => setDraft(e.target.value)}
                                className="text-[13px]"
                                aria-label={field.label}
                            />
                        )}
                        {isList && (
                            <span className="text-ink-3 text-xs">Separate items with commas.</span>
                        )}
                        <div className="flex gap-1.5">
                            <Button size="sm" onClick={() => void save()} disabled={busy}>
                                Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                ) : isList ? (
                    <div className="flex flex-wrap gap-1.5">
                        {(field.value as string[]).map(v => (
                            <span
                                key={v}
                                className="border-line bg-panel rounded-md border px-2 py-0.5 text-[12.5px]"
                            >
                                {v}
                            </span>
                        ))}
                        {(field.value as string[]).length === 0 && (
                            <span className="text-ink-3 text-[13px]">None</span>
                        )}
                    </div>
                ) : (
                    <div className="text-ink text-sm">{field.value}</div>
                )}
                {field.sources.length > 0 && !editing && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {field.sources.map(s => (
                            <span
                                key={s}
                                className="bg-panel-2 text-ink-3 rounded px-1.5 py-px text-[11px]"
                            >
                                {s}
                            </span>
                        ))}
                    </div>
                )}
            </div>
            <div className="md:pt-0.5">
                {field.editable && !editing && (
                    <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="text-ink-3 hover:text-ink focus-visible:ring-brand/50 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs outline-none focus-visible:ring-[3px]"
                        aria-label={`Edit ${field.label}`}
                    >
                        <Pencil className="size-3" /> Edit
                    </button>
                )}
            </div>
        </div>
    );
}

const KIND_LABEL: Record<SourceKind, string> = {
    api: "Directory or API",
    recipe: "Search-index listing",
    signal: "Signal",
};

function SourceLine({ s, onToggle }: { s: SourceRow; onToggle: (enabled: boolean) => void }) {
    return (
        <div className="border-line-2 grid grid-cols-[1fr_auto] items-center gap-3 border-t py-3 first:border-t-0">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <span
                        className={cn(
                            "text-ink text-[13px] font-medium",
                            !s.available && "text-ink-2"
                        )}
                    >
                        {s.label}
                    </span>
                    <span
                        className={cn(
                            "border-line text-ink-3 rounded-full border px-[7px] text-[11px] leading-[17px]",
                            s.kind === "signal" && "border-dashed"
                        )}
                    >
                        {KIND_LABEL[s.kind]}
                    </span>
                </div>
                <div className="text-ink-3 mt-0.5 text-xs">{s.description}</div>
                {!s.available && s.requires && (
                    <div className="text-warn mt-1 text-xs">
                        Needs <span className="font-mono">{s.requires}</span> on the server.
                    </div>
                )}
                <div className="text-ink-3 mt-1 text-xs tabular-nums">
                    {s.lastYield ? (
                        <>
                            <span className="text-ink-2">{s.lastYield.found} found</span> ·{" "}
                            {s.lastYield.cost} · {relativeTime(s.lastYield.at)}
                        </>
                    ) : (
                        <>Not run yet · {s.cost}</>
                    )}
                </div>
            </div>
            <span
                title={
                    s.locked
                        ? "Per-segment settings arrive with the source registry; keys on the server decide for now"
                        : undefined
                }
            >
                <Switch
                    checked={s.enabled && s.available}
                    disabled={!s.available || s.locked}
                    onCheckedChange={v => onToggle(v)}
                    aria-label={`${s.label} ${s.enabled ? "on" : "off"}`}
                />
            </span>
        </div>
    );
}

/**
 * The segment as a side panel: who you sell to, field by field, and the
 * sources the next run will search. Editing makes it a draft again until
 * it is confirmed.
 */
export function SegmentPanel({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
}) {
    const { segmentId, reloadSegments } = useProspects();
    const res = useResource(open && segmentId ? `segment:${segmentId}` : null, () =>
        prospectsApi.segment(segmentId!)
    );
    const sources = useResource(open && segmentId ? `sources:${segmentId}` : null, () =>
        prospectsApi.sources(segmentId!)
    );
    const s = res.data?.segment ?? null;
    const [busy, setBusy] = useState<"confirm" | "derive" | null>(null);
    const [creating, setCreating] = useState(false);

    const confirm = async () => {
        if (!s) return;
        setBusy("confirm");
        try {
            const { segment } = await prospectsApi.confirmSegment(s.id);
            res.mutate(() => ({ segment }));
            await reloadSegments();
            toast.success("Segment confirmed. Runs will use this version.");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not confirm");
        } finally {
            setBusy(null);
        }
    };
    const derive = async () => {
        if (!s) return;
        setBusy("derive");
        try {
            const { segment } = await prospectsApi.deriveSegment(s.id);
            res.mutate(() => ({ segment }));
            toast.success(
                `Re-derived from your company profile and ${plural(segment.basis.documents, "document")}.`
            );
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not re-derive");
        } finally {
            setBusy(null);
        }
    };
    const saveField = async (key: string, value: string | string[]) => {
        if (!s) return;
        try {
            const { segment } = await prospectsApi.patchSegment(s.id, { [key]: value });
            res.mutate(() => ({ segment }));
            await reloadSegments();
            toast.success("Saved.");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not save");
            throw e;
        }
    };
    const toggleSource = async (source: SourceRow, enabled: boolean) => {
        sources.mutate(current => ({
            sources: current.sources.map(x => (x.id === source.id ? { ...x, enabled } : x)),
        }));
        try {
            await prospectsApi.setSourceEnabled(source.id, enabled, segmentId!);
            await reloadSegments();
        } catch (e) {
            await sources.reload();
            toast.error(e instanceof Error ? e.message : "Could not update the source");
        }
    };

    const on = (sources.data?.sources ?? []).filter(x => x.enabled && x.available).length;

    return (
        <Panel
            open={open}
            onOpenChange={onOpenChange}
            size="md"
            title={s ? s.name : "Segment"}
            description={
                s
                    ? s.status === "confirmed" && s.confirmedAt
                        ? `Confirmed ${shortDate(s.confirmedAt)}. ${s.headline}.`
                        : `Drafted ${shortDate(s.derivedAt)}. Confirm it, or fix anything first.`
                    : undefined
            }
            footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
                        New segment
                    </Button>
                    <span className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void derive()}
                            disabled={!s || busy !== null}
                        >
                            Re-derive
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => void confirm()}
                            disabled={!s || busy !== null || s.status === "confirmed"}
                        >
                            {s?.status === "confirmed" ? "Confirmed" : "Confirm segment"}
                        </Button>
                    </span>
                </div>
            }
        >
            <section className="mb-6">
                <h2 className="text-ink mb-2 text-[13px] font-semibold">Who you sell to</h2>
                {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
                {res.loading || !s ? (
                    <SkeletonRows rows={6} height={48} />
                ) : (
                    <div className="border-line bg-panel rounded-lg border px-4 py-1">
                        {s.fields.map(f => (
                            <FieldRow
                                key={f.key}
                                field={f}
                                onSave={value => saveField(f.key, value)}
                            />
                        ))}
                    </div>
                )}
                {s && !s.basis.hasProfile && (
                    <p className="text-ink-2 mt-2 text-[13px]">
                        There is no company profile yet, so this draft leans on documents alone. Add
                        one under Settings to sharpen it.
                    </p>
                )}
            </section>

            <section>
                <h2 className="text-ink mb-2 text-[13px] font-semibold">
                    Sources
                    {sources.data && (
                        <span className="text-ink-3 ml-2 text-xs font-normal">
                            {on} of {sources.data.sources.length} on for the next run
                        </span>
                    )}
                </h2>
                {sources.error && (
                    <InlineError message={sources.error} onRetry={() => void sources.reload()} />
                )}
                {sources.loading ? (
                    <SkeletonRows rows={5} height={56} />
                ) : (
                    <div className="border-line bg-panel rounded-lg border px-4 py-1">
                        {(sources.data?.sources ?? []).map(x => (
                            <SourceLine key={x.id} s={x} onToggle={v => void toggleSource(x, v)} />
                        ))}
                    </div>
                )}
            </section>
            <NewSegmentDialog open={creating} onOpenChange={setCreating} />
        </Panel>
    );
}

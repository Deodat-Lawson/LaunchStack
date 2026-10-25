"use client";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

import { prospectsApi, type SegmentField } from "../api";
import { useCopyText } from "~/lib/tools/copyText";
import { useGrowthFormat } from "../../_lib/format";
import { useErrorText } from "~/lib/tools/errorText";
import { useProspects } from "../_lib/context";
import { useResource } from "~/lib/tools/useResource";
import { InlineError } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";

function FieldRow({
    field,
    onSave,
}: {
    field: SegmentField;
    onSave: (value: string | string[]) => Promise<void>;
}) {
    const t = useTranslations("growth.prospects.segment");
    const tc = useTranslations("common");
    const word = useCopyText();
    const label = word(field.labelCopy, field.label);
    const [editing, setEditing] = useState(false);
    const isList = Array.isArray(field.value);
    // A worded value, for display only: editable fields carry their own words.
    const listCopies = Array.isArray(field.valueCopy) ? field.valueCopy : null;
    const valueCopy = field.valueCopy && !Array.isArray(field.valueCopy) ? field.valueCopy : null;
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
                          .split(/[,，、]/)
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
        <div className="border-line-2 @max-md:grid-cols-1 grid grid-cols-[150px_1fr_auto] gap-x-5 gap-y-2 border-t py-3.5 first:border-t-0">
            <div className="text-ink-2 pt-0.5 text-[13px]">{label}</div>
            <div className="min-w-0">
                {editing ? (
                    <div className="flex flex-col gap-2">
                        {isList || String(field.value).length < 60 ? (
                            <Input
                                autoFocus
                                value={draft}
                                onChange={e => setDraft(e.target.value)}
                                className="h-8 text-[13px]"
                                aria-label={label}
                            />
                        ) : (
                            <Textarea
                                autoFocus
                                rows={2}
                                value={draft}
                                onChange={e => setDraft(e.target.value)}
                                className="text-[13px]"
                                aria-label={label}
                            />
                        )}
                        {isList && <span className="text-ink-3 text-xs">{t("separateItems")}</span>}
                        <div className="flex gap-1.5">
                            <Button size="sm" onClick={() => void save()} disabled={busy}>
                                {tc("actions.save")}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                                {tc("actions.cancel")}
                            </Button>
                        </div>
                    </div>
                ) : isList ? (
                    <div className="flex flex-wrap gap-1.5">
                        {(field.value as string[]).map((v, i) => (
                            <span
                                key={v}
                                className={cn(
                                    "border-line bg-panel rounded-md border px-2 py-0.5 text-[12.5px]",
                                    field.key === "seedDomains" && "font-mono text-[12px]"
                                )}
                            >
                                {word(listCopies?.[i], v)}
                            </span>
                        ))}
                        {(field.value as string[]).length === 0 && (
                            <span className="text-ink-3 text-[13px]">{tc("status.none")}</span>
                        )}
                    </div>
                ) : (
                    <div className="text-ink text-sm">{word(valueCopy, String(field.value))}</div>
                )}
                {field.sources.length > 0 && !editing && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {field.sources.map((s, i) => (
                            <span
                                key={s}
                                className="bg-panel-2 text-ink-3 rounded px-1.5 py-px text-[11px]"
                            >
                                {word(field.sourcesCopy?.[i], s)}
                            </span>
                        ))}
                    </div>
                )}
            </div>
            <div className="@max-md:pt-0 pt-0.5">
                {field.editable && !editing && (
                    <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="text-ink-3 hover:text-ink focus-visible:ring-brand/50 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs outline-none focus-visible:ring-[3px]"
                        aria-label={t("editAria", { label })}
                    >
                        <Pencil className="size-3" /> {tc("actions.edit")}
                    </button>
                )}
            </div>
        </div>
    );
}

export function SegmentScreen() {
    const t = useTranslations("growth.prospects.segment");
    const { shortDate } = useGrowthFormat();
    const errorText = useErrorText();
    const { segmentId, reloadSegments } = useProspects();
    const res = useResource(segmentId ? `segment:${segmentId}` : null, () =>
        prospectsApi.segment(segmentId!)
    );
    const s = res.data?.segment ?? null;
    const [busy, setBusy] = useState<"confirm" | "derive" | null>(null);

    const confirm = async () => {
        if (!s) return;
        setBusy("confirm");
        try {
            const { segment } = await prospectsApi.confirmSegment(s.id);
            res.mutate(() => ({ segment }));
            await reloadSegments();
            toast.success(t("confirmed"));
        } catch (e) {
            toast.error(errorText(e, t("confirmFailed")));
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
            toast.success(t("rederived", { count: segment.basis.documents }));
        } catch (e) {
            toast.error(errorText(e, t("rederiveFailed")));
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
            toast.success(t("saved"));
        } catch (e) {
            toast.error(errorText(e, t("saveFailed")));
            throw e;
        }
    };

    return (
        <div className="mx-auto flex max-w-[900px] flex-col gap-5">
            <PageHeader
                title={t("title")}
                accent={t("accent")}
                sub={
                    s
                        ? s.status === "confirmed" && s.confirmedAt
                            ? t("subConfirmed", {
                                  confirmed: shortDate(s.confirmedAt),
                                  count: s.basis.documents,
                                  derived: shortDate(s.derivedAt),
                              })
                            : t("subDraft", {
                                  count: s.basis.documents,
                                  derived: shortDate(s.derivedAt),
                              })
                        : undefined
                }
                actions={
                    s && (
                        <>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void derive()}
                                disabled={busy !== null}
                            >
                                {t("rederive")}
                            </Button>
                            <Button
                                size="sm"
                                onClick={() => void confirm()}
                                disabled={busy !== null || s.status === "confirmed"}
                            >
                                {s.status === "confirmed" ? t("confirmedButton") : t("confirm")}
                            </Button>
                        </>
                    )
                }
            />
            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
            {res.loading || !s ? (
                <SkeletonRows rows={7} height={56} />
            ) : (
                <div className="border-line bg-panel rounded-lg border px-5 py-1">
                    {s.fields.map(f => (
                        <FieldRow key={f.key} field={f} onSave={value => saveField(f.key, value)} />
                    ))}
                </div>
            )}
            {s && !s.basis.hasProfile && <p className="text-ink-2 text-[13px]">{t("noProfile")}</p>}
        </div>
    );
}

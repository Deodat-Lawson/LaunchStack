"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";

import { EVIDENCE_KINDS, vantageApi, type EvidenceDto, type VantageEvidenceKind } from "../api";
import { todayIso } from "../_lib/format";
import { Field, FormError } from "./Primitives";

/**
 * Add or edit one piece of evidence. Capture is meant to be quick: kind,
 * a title, what happened, and the date it is about. Source and link are
 * there but not required — a rough note now beats a perfect one never.
 * A text or Markdown file can be dropped in; its contents become the body.
 */
export function EvidenceDialog({
    open,
    onOpenChange,
    initial,
    defaultKind = "note",
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initial?: EvidenceDto | null;
    defaultKind?: VantageEvidenceKind;
    onSaved: (saved: EvidenceDto) => void;
}) {
    const t = useTranslations("vantage.evidenceDialog");
    const tk = useTranslations("vantage.evidenceKind");
    const tc = useTranslations("common");
    const [kind, setKind] = useState<VantageEvidenceKind>(defaultKind);
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [source, setSource] = useState("");
    const [sourceUrl, setSourceUrl] = useState("");
    const [observedAt, setObservedAt] = useState(todayIso());
    const [shared, setShared] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        setKind(initial?.kind ?? defaultKind);
        setTitle(initial?.title ?? "");
        setBody(initial?.body ?? "");
        setSource(initial?.source ?? "");
        setSourceUrl(initial?.sourceUrl ?? "");
        setObservedAt(initial?.observedAt ?? todayIso());
        setShared(initial?.visibility === "shared");
        setError(null);
    }, [open, initial, defaultKind]);

    const readFile = async (file: File) => {
        if (file.size > 2_000_000) {
            setError(t("tooBig"));
            return;
        }
        const text = await file.text();
        setBody(current => (current.trim() ? `${current.trim()}\n\n${text}` : text));
        if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
        if (!source.trim()) setSource(file.name);
        if (kind === "note") setKind("document");
    };

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            const input = {
                kind,
                title,
                body,
                source: source || null,
                sourceUrl: sourceUrl || null,
                observedAt,
                visibility: shared ? ("shared" as const) : ("private" as const),
            };
            const { evidence } = initial
                ? await vantageApi.patchEvidence(initial.id, input)
                : await vantageApi.addEvidence(input);
            toast(initial ? t("updated") : t("added"));
            onSaved(evidence);
            onOpenChange(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : t("saveError"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>{initial ? t("editTitle") : t("addTitle")}</DialogTitle>
                    <DialogDescription>{t("description")}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3.5">
                    <div className="grid gap-3.5 sm:grid-cols-[160px_minmax(0,1fr)]">
                        <Field label={t("kind")} hint={tk(`hint.${kind}`)}>
                            <Select
                                value={kind}
                                onValueChange={v => setKind(v as VantageEvidenceKind)}
                            >
                                <SelectTrigger aria-label={t("kind")}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {EVIDENCE_KINDS.map(k => (
                                        <SelectItem key={k} value={k}>
                                            {tk(`label.${k}`)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field label={tc("fields.title")} htmlFor="ev-title">
                            <Input
                                id="ev-title"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                placeholder={
                                    kind === "interview"
                                        ? t("titlePlaceholder.interview")
                                        : kind === "claim"
                                          ? t("titlePlaceholder.claim")
                                          : t("titlePlaceholder.other")
                                }
                                autoFocus
                            />
                        </Field>
                    </div>
                    <Field label={t("body")} htmlFor="ev-body">
                        <Textarea
                            id="ev-body"
                            value={body}
                            onChange={e => setBody(e.target.value)}
                            rows={6}
                            placeholder={
                                kind === "interview"
                                    ? t("bodyPlaceholder.interview")
                                    : t("bodyPlaceholder.other")
                            }
                        />
                        <div className="flex items-center gap-2">
                            <input
                                ref={fileRef}
                                type="file"
                                accept=".txt,.md,.markdown,.csv,text/plain,text/markdown"
                                className="hidden"
                                onChange={e => {
                                    const f = e.target.files?.[0];
                                    if (f) void readFile(f);
                                    e.target.value = "";
                                }}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => fileRef.current?.click()}
                            >
                                {t("addFile")}
                            </Button>
                            <span className="text-ink-3 text-[11.5px]">{t("addFileHint")}</span>
                        </div>
                    </Field>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <Field label={t("source")} htmlFor="ev-source" hint={t("sourceHint")}>
                            <Input
                                id="ev-source"
                                value={source}
                                onChange={e => setSource(e.target.value)}
                                placeholder={t("sourcePlaceholder")}
                            />
                        </Field>
                        <Field label={t("date")} htmlFor="ev-date">
                            <Input
                                id="ev-date"
                                type="date"
                                value={observedAt}
                                onChange={e => setObservedAt(e.target.value)}
                            />
                        </Field>
                    </div>
                    <Field label={t("link")} htmlFor="ev-url" hint={tc("status.optional")}>
                        <Input
                            id="ev-url"
                            type="url"
                            value={sourceUrl}
                            onChange={e => setSourceUrl(e.target.value)}
                            placeholder="https://"
                        />
                    </Field>
                    <div className="border-line-2 flex items-center justify-between gap-3 border-t pt-3">
                        <div>
                            <div className="text-ink text-[13px] font-medium">{t("visible")}</div>
                            <div className="text-ink-3 text-[11.5px]">{t("visibleHint")}</div>
                        </div>
                        <Switch
                            checked={shared}
                            onCheckedChange={setShared}
                            aria-label={t("sharedAria")}
                        />
                    </div>
                    <FormError message={error} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        {tc("actions.cancel")}
                    </Button>
                    <Button
                        onClick={() => void save()}
                        disabled={busy || !title.trim() || !body.trim()}
                    >
                        {initial ? tc("actions.saveChanges") : t("addTitle")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

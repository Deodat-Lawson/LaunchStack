"use client";

/**
 * The reporter: one dialog, two kinds.
 *
 * - **Bug** — one line is enough to send. Details, how much it is in the
 *   way, and up to three screenshots are optional. The page, browser, window
 *   and the last few errors go with it unless the reporter switches that off;
 *   the panel at the bottom lists exactly what will be sent.
 * - **Feature request** — a title is enough. While it is typed, requests
 *   already on the board that match are offered, with a vote button: a +1
 *   on an existing request counts for more than a near-duplicate.
 *
 * Sending shows the report's number and a way to it in the Feedback tab,
 * where replies from the team arrive.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
    Bug,
    Camera,
    Check,
    ChevronDown,
    ChevronUp,
    ImagePlus,
    Lightbulb,
    Loader2,
    PenLine,
    X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
    createFeedback,
    FeedbackApiError,
    listFeedback,
    voteForFeedback,
} from "~/lib/feedback/api";
import { collectFeedbackContext } from "~/lib/feedback/context";
import {
    BUG_SEVERITIES,
    FEEDBACK_LIMITS,
    feedbackReportHref,
    type BugSeverity,
    type FeedbackContext,
    type FeedbackDetail,
    type FeedbackKind,
    type FeedbackListItem,
} from "~/lib/feedback/contract";
import { capturePage } from "~/lib/feedback/screenshot";
import { cn } from "~/lib/utils";

import { feedbackKeys } from "./keys";
import { emptyDraft, isOriginKey, type FeedbackDraft, type FeedbackImage } from "./draft";
import { StatusBadge } from "./labels";
import { ScreenshotEditor } from "./ScreenshotEditor";

let imageSeq = 0;
function toImage(blob: Blob): FeedbackImage {
    imageSeq += 1;
    return { id: `img-${imageSeq}`, blob, url: URL.createObjectURL(blob) };
}

const ACCEPTED = FEEDBACK_LIMITS.attachmentTypes as readonly string[];

export function FeedbackDialog({
    open,
    onOpenChange,
    draft,
    onDraftChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    draft: FeedbackDraft;
    onDraftChange: React.Dispatch<React.SetStateAction<FeedbackDraft>>;
}) {
    const t = useTranslations("feedback.dialog");
    const router = useRouter();
    const [sent, setSent] = useState<FeedbackDetail | null>(null);
    const [busy, setBusy] = useState(false);
    const [capturing, setCapturing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    // What the page looked like when the dialog opened — not when it is
    // sent, by which time the dialog itself has changed what's on screen.
    const [snapshot, setSnapshot] = useState<FeedbackContext>({});
    const fileInput = useRef<HTMLInputElement>(null);
    const titleInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        setSnapshot(collectFeedbackContext({ technical: true, origin: draft.origin }));
        setError(null);
        setNotice(null);
        // Opening again after a send starts on the form, not the thank-you.
        setSent(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open
    }, [open]);

    const patch = useCallback(
        (next: Partial<FeedbackDraft>) => onDraftChange(current => ({ ...current, ...next })),
        [onDraftChange]
    );

    const addImages = useCallback(
        (blobs: Blob[]) => {
            setNotice(null);
            const room = FEEDBACK_LIMITS.attachmentsMax - draft.images.length;
            const usable = blobs.filter(b => ACCEPTED.includes(b.type));
            const small = usable.filter(b => b.size <= FEEDBACK_LIMITS.attachmentBytesMax);
            if (usable.length < blobs.length) setNotice(t("images.wrongType"));
            else if (small.length < usable.length)
                setNotice(t("images.tooBig", { mb: FEEDBACK_LIMITS.attachmentBytesMax >> 20 }));
            else if (small.length > room)
                setNotice(t("images.tooMany", { max: FEEDBACK_LIMITS.attachmentsMax }));
            const taken = small.slice(0, Math.max(0, room)).map(toImage);
            if (taken.length > 0)
                onDraftChange(current => ({ ...current, images: [...current.images, ...taken] }));
        },
        [draft.images.length, onDraftChange, t]
    );

    const removeImage = (id: string) =>
        onDraftChange(current => {
            const gone = current.images.find(i => i.id === id);
            if (gone) URL.revokeObjectURL(gone.url);
            return { ...current, images: current.images.filter(i => i.id !== id) };
        });

    const replaceImage = (id: string, blob: Blob) =>
        onDraftChange(current => ({
            ...current,
            images: current.images.map(image => {
                if (image.id !== id) return image;
                URL.revokeObjectURL(image.url);
                return { ...image, blob, url: URL.createObjectURL(blob) };
            }),
        }));

    const capture = async () => {
        setCapturing(true);
        setNotice(null);
        try {
            // Let the button's spinner paint before the main thread is busy.
            await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
            addImages([await capturePage()]);
        } catch {
            setNotice(t("images.captureFailed"));
        } finally {
            setCapturing(false);
        }
    };

    const onPaste = (event: React.ClipboardEvent) => {
        const files = Array.from(event.clipboardData.files).filter(f =>
            f.type.startsWith("image/")
        );
        if (files.length === 0) return;
        event.preventDefault();
        addImages(files);
    };

    const canSend = draft.title.trim().length > 0 && !busy;

    const send = async () => {
        if (!canSend) return;
        setBusy(true);
        setError(null);
        try {
            const context = draft.technical
                ? { ...snapshot, origin: draft.origin }
                : collectFeedbackContext({ technical: false, origin: draft.origin });
            const report = await createFeedback(
                {
                    kind: draft.kind,
                    title: draft.title.trim(),
                    body: draft.body.trim(),
                    severity: draft.kind === "bug" ? (draft.severity ?? undefined) : undefined,
                    context,
                },
                draft.images.map(i => i.blob)
            );
            draft.images.forEach(i => URL.revokeObjectURL(i.url));
            onDraftChange(emptyDraft(draft.kind));
            setSent(report);
        } catch (err) {
            setError(
                err instanceof FeedbackApiError && err.status === 429
                    ? t("errors.rateLimited")
                    : err instanceof FeedbackApiError && err.message
                      ? err.message
                      : t("errors.generic")
            );
        } finally {
            setBusy(false);
        }
    };

    const editingImage = editing ? draft.images.find(i => i.id === editing) : undefined;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                data-feedback-capture="skip"
                data-testid="feedback-dialog"
                className={cn(
                    "max-h-[calc(100dvh-2rem)] overflow-y-auto",
                    editingImage ? "sm:max-w-[min(960px,calc(100%-2rem))]" : "sm:max-w-[560px]"
                )}
                onPaste={sent || editingImage ? undefined : onPaste}
                onEscapeKeyDown={event => {
                    // Escape in the editor goes back to the form, not out of it.
                    if (editingImage) {
                        event.preventDefault();
                        setEditing(null);
                    }
                }}
                onKeyDown={event => {
                    if (
                        !sent &&
                        !editingImage &&
                        event.key === "Enter" &&
                        (event.metaKey || event.ctrlKey)
                    ) {
                        event.preventDefault();
                        void send();
                    }
                }}
                onOpenAutoFocus={event => {
                    event.preventDefault();
                    titleInput.current?.focus();
                }}
            >
                {sent ? (
                    <SentView
                        report={sent}
                        onView={() => {
                            onOpenChange(false);
                            router.push(feedbackReportHref(sent.id, "mine"));
                        }}
                        onAnother={() => setSent(null)}
                        onDone={() => onOpenChange(false)}
                    />
                ) : editingImage ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>{t("editor.title")}</DialogTitle>
                            <DialogDescription>{t("editor.description")}</DialogDescription>
                        </DialogHeader>
                        <ScreenshotEditor
                            src={editingImage.url}
                            onCancel={() => setEditing(null)}
                            onDone={blob => {
                                replaceImage(editingImage.id, blob);
                                setEditing(null);
                            }}
                        />
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle>{t("title")}</DialogTitle>
                            <DialogDescription>{t("description")}</DialogDescription>
                        </DialogHeader>

                        <ToggleGroup
                            type="single"
                            variant="outline"
                            value={draft.kind}
                            onValueChange={value => {
                                if (!value || value === draft.kind) return;
                                patch({ kind: value as FeedbackKind, technical: value === "bug" });
                            }}
                            className="w-full"
                            aria-label={t("kindLabel")}
                        >
                            <ToggleGroupItem
                                value="bug"
                                className="flex-1 gap-2"
                                data-testid="feedback-kind-bug"
                            >
                                <Bug aria-hidden />
                                {t("kinds.bug")}
                            </ToggleGroupItem>
                            <ToggleGroupItem
                                value="idea"
                                className="flex-1 gap-2"
                                data-testid="feedback-kind-idea"
                            >
                                <Lightbulb aria-hidden />
                                {t("kinds.idea")}
                            </ToggleGroupItem>
                        </ToggleGroup>

                        <form
                            className="flex min-w-0 flex-col gap-4"
                            onSubmit={event => {
                                event.preventDefault();
                                void send();
                            }}
                        >
                            <TitleField
                                ref={titleInput}
                                kind={draft.kind}
                                value={draft.title}
                                onChange={title => patch({ title })}
                            />
                            {draft.kind === "idea" && (
                                <SimilarIdeas
                                    query={draft.title}
                                    onOpen={id => {
                                        onOpenChange(false);
                                        router.push(feedbackReportHref(id, "ideas"));
                                    }}
                                />
                            )}
                            <BodyField
                                kind={draft.kind}
                                value={draft.body}
                                onChange={body => patch({ body })}
                            />
                            {draft.kind === "bug" && (
                                <SeverityField
                                    value={draft.severity}
                                    onChange={severity => patch({ severity })}
                                />
                            )}
                            <ImagesField
                                images={draft.images}
                                capturing={capturing}
                                notice={notice}
                                onCapture={() => void capture()}
                                onAttach={() => fileInput.current?.click()}
                                onEdit={setEditing}
                                onRemove={removeImage}
                            />
                            <input
                                ref={fileInput}
                                type="file"
                                accept={ACCEPTED.join(",")}
                                multiple
                                hidden
                                data-testid="feedback-file-input"
                                onChange={event => {
                                    addImages(Array.from(event.target.files ?? []));
                                    event.target.value = "";
                                }}
                            />
                            <ContextPanel
                                kind={draft.kind}
                                technical={draft.technical}
                                onTechnicalChange={technical => patch({ technical })}
                                snapshot={snapshot}
                                origin={draft.origin}
                            />
                            {error && (
                                <p
                                    role="alert"
                                    className="text-danger m-0 text-sm"
                                    data-testid="feedback-error"
                                >
                                    {error}
                                </p>
                            )}
                            <DialogFooter className="items-center gap-2">
                                <span className="text-ink-3 mr-auto hidden text-xs sm:inline">
                                    {t("sendHint", { send: feedbackKeys().send })}
                                </span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => onOpenChange(false)}
                                >
                                    {t("cancel")}
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={!canSend}
                                    data-testid="feedback-send"
                                >
                                    {busy && <Loader2 className="animate-spin" aria-hidden />}
                                    {draft.kind === "bug" ? t("sendBug") : t("sendIdea")}
                                </Button>
                            </DialogFooter>
                        </form>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

const TitleField = React.forwardRef<
    HTMLInputElement,
    { kind: FeedbackKind; value: string; onChange: (value: string) => void }
>(function TitleField({ kind, value, onChange }, ref) {
    const t = useTranslations("feedback.dialog");
    const id = useId();
    const left = FEEDBACK_LIMITS.titleMax - value.length;
    return (
        <div className="flex flex-col gap-1.5">
            <Label htmlFor={id}>{kind === "bug" ? t("bugTitle") : t("ideaTitle")}</Label>
            <Input
                ref={ref}
                id={id}
                value={value}
                maxLength={FEEDBACK_LIMITS.titleMax}
                onChange={event => onChange(event.target.value)}
                placeholder={kind === "bug" ? t("bugTitlePlaceholder") : t("ideaTitlePlaceholder")}
                data-testid="feedback-title"
                autoComplete="off"
            />
            {left < 20 && (
                <span className="text-ink-3 text-[11px]">{t("charsLeft", { count: left })}</span>
            )}
        </div>
    );
});

function BodyField({
    kind,
    value,
    onChange,
}: {
    kind: FeedbackKind;
    value: string;
    onChange: (value: string) => void;
}) {
    const t = useTranslations("feedback.dialog");
    const id = useId();
    return (
        <div className="flex flex-col gap-1.5">
            <Label htmlFor={id}>
                {kind === "bug" ? t("bugBody") : t("ideaBody")}
                <span className="text-ink-3 font-normal">{t("optional")}</span>
            </Label>
            <Textarea
                id={id}
                value={value}
                rows={4}
                maxLength={FEEDBACK_LIMITS.bodyMax}
                onChange={event => onChange(event.target.value)}
                placeholder={kind === "bug" ? t("bugBodyPlaceholder") : t("ideaBodyPlaceholder")}
                data-testid="feedback-body"
            />
        </div>
    );
}

function SeverityField({
    value,
    onChange,
}: {
    value: BugSeverity | null;
    onChange: (value: BugSeverity | null) => void;
}) {
    const t = useTranslations("feedback.dialog");
    const ts = useTranslations("feedback.severity");
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-ink text-sm font-medium leading-none">
                {t("severity")}
                <span className="text-ink-3 font-normal">{t("optional")}</span>
            </span>
            <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={value ?? ""}
                onValueChange={next => onChange(next ? (next as BugSeverity) : null)}
                className="w-full"
                aria-label={t("severity")}
            >
                {BUG_SEVERITIES.map(severity => (
                    <ToggleGroupItem
                        key={severity}
                        value={severity}
                        className="flex-1 px-2 text-xs"
                        data-testid={`feedback-severity-${severity}`}
                    >
                        {ts(severity)}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </div>
    );
}

function ImagesField({
    images,
    capturing,
    notice,
    onCapture,
    onAttach,
    onEdit,
    onRemove,
}: {
    images: FeedbackImage[];
    capturing: boolean;
    notice: string | null;
    onCapture: () => void;
    onAttach: () => void;
    onEdit: (id: string) => void;
    onRemove: (id: string) => void;
}) {
    const t = useTranslations("feedback.dialog.images");
    const full = images.length >= FEEDBACK_LIMITS.attachmentsMax;
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-ink text-sm font-medium leading-none">
                    {t("label")}
                    <span className="text-ink-3 font-normal">{t("optional")}</span>
                </span>
                <div className="ml-auto flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onCapture}
                        disabled={capturing || full}
                        data-testid="feedback-capture"
                    >
                        {capturing ? (
                            <Loader2 className="animate-spin" aria-hidden />
                        ) : (
                            <Camera aria-hidden />
                        )}
                        {capturing ? t("capturing") : t("capture")}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onAttach}
                        disabled={full}
                    >
                        <ImagePlus aria-hidden />
                        {t("attach")}
                    </Button>
                </div>
            </div>
            {images.length > 0 ? (
                <ul
                    className="m-0 flex list-none flex-wrap gap-2 p-0"
                    data-testid="feedback-images"
                >
                    {images.map((image, i) => (
                        <li
                            key={image.id}
                            className="border-line bg-panel-2 group relative h-[84px] w-[132px] overflow-hidden rounded-md border"
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element -- an object URL */}
                            <img
                                src={image.url}
                                alt={t("thumbAlt", { n: i + 1 })}
                                className="size-full object-cover object-top"
                            />
                            <div className="bg-surface/90 absolute inset-x-0 bottom-0 flex justify-between gap-1 p-1">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-1.5 text-[11px]"
                                    onClick={() => onEdit(image.id)}
                                    data-testid="feedback-image-markup"
                                >
                                    <PenLine className="size-3" aria-hidden />
                                    {t("markup")}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-1.5"
                                    onClick={() => onRemove(image.id)}
                                    aria-label={t("remove", { n: i + 1 })}
                                >
                                    <X className="size-3" aria-hidden />
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-ink-3 m-0 text-xs">
                    {t("pasteHint", { paste: feedbackKeys().paste })}
                </p>
            )}
            {notice && (
                <p className="text-warn-ink m-0 text-xs" role="status">
                    {notice}
                </p>
            )}
        </div>
    );
}

/**
 * Exactly what goes with the report, so nobody has to wonder. Technical
 * details can be switched off; the page's path is always sent, because a
 * report that can't say where it happened can rarely be acted on.
 */
function ContextPanel({
    kind,
    technical,
    onTechnicalChange,
    snapshot,
    origin,
}: {
    kind: FeedbackKind;
    technical: boolean;
    onTechnicalChange: (value: boolean) => void;
    snapshot: FeedbackContext;
    origin?: Record<string, string>;
}) {
    const t = useTranslations("feedback.dialog.context");
    const [expanded, setExpanded] = useState(false);
    const switchId = useId();
    const errors = snapshot.recentErrors ?? [];
    const rows: { label: string; value: string }[] = useMemo(() => {
        const out: { label: string; value: string }[] = [];
        if (snapshot.path) out.push({ label: t("page"), value: snapshot.path });
        if (!technical) return out;
        if (snapshot.browser) out.push({ label: t("browser"), value: snapshot.browser });
        if (snapshot.viewport)
            out.push({
                label: t("window"),
                value: `${snapshot.viewport.width} × ${snapshot.viewport.height}`,
            });
        if (snapshot.screen)
            out.push({
                label: t("screen"),
                value: `${snapshot.screen.width} × ${snapshot.screen.height} @${snapshot.screen.pixelRatio}x`,
            });
        if (snapshot.theme) out.push({ label: t("theme"), value: t(`themes.${snapshot.theme}`) });
        if (snapshot.locale) out.push({ label: t("language"), value: snapshot.locale });
        if (snapshot.timeZone) out.push({ label: t("timeZone"), value: snapshot.timeZone });
        return out;
    }, [snapshot, technical, t]);
    return (
        <Collapsible
            open={expanded}
            onOpenChange={setExpanded}
            className="border-line bg-panel rounded-md border"
        >
            <div className="flex items-center gap-3 px-3 py-2.5">
                <Switch
                    id={switchId}
                    checked={technical}
                    onCheckedChange={onTechnicalChange}
                    data-testid="feedback-technical"
                />
                <Label
                    htmlFor={switchId}
                    className="min-w-0 flex-1 cursor-pointer text-[13px] font-normal"
                >
                    {t("include")}
                    {technical && errors.length > 0 && kind === "bug" && (
                        <span className="text-ink-3">
                            {" "}
                            · {t("errorsCount", { count: errors.length })}
                        </span>
                    )}
                </Label>
                <CollapsibleTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        data-testid="feedback-context-toggle"
                    >
                        {expanded ? t("hide") : t("show")}
                        {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
                    </Button>
                </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
                <div className="border-line border-t px-3 py-2.5" data-testid="feedback-context">
                    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
                        {rows.map(row => (
                            <React.Fragment key={row.label}>
                                <dt className="text-ink-3">{row.label}</dt>
                                <dd className="text-ink-2 m-0 truncate" title={row.value}>
                                    {row.value}
                                </dd>
                            </React.Fragment>
                        ))}
                        {origin &&
                            Object.entries(origin).map(([key, value]) => (
                                <React.Fragment key={key}>
                                    <dt className="text-ink-3">
                                        {isOriginKey(key) ? t(`origin.${key}`) : key}
                                    </dt>
                                    <dd
                                        className="text-ink-2 mono m-0 truncate text-[11px]"
                                        title={value}
                                    >
                                        {value}
                                    </dd>
                                </React.Fragment>
                            ))}
                    </dl>
                    {technical && errors.length > 0 && (
                        <div className="mt-2.5">
                            <div className="text-ink-3 mb-1 text-xs">{t("recentErrors")}</div>
                            <ol className="bg-panel-2 m-0 flex max-h-28 list-none flex-col gap-1 overflow-y-auto rounded p-2">
                                {errors.map((e, i) => (
                                    <li
                                        key={i}
                                        className="mono text-ink-2 break-words text-[11px] leading-snug"
                                    >
                                        {e.message}
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}
                    <p className="text-ink-3 m-0 mt-2.5 text-[11px] leading-normal">
                        {t("alsoSent")}
                    </p>
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

/**
 * Requests already on the board that look like this one. Searched once the
 * title has a few letters, after a pause in typing; nothing shows when there
 * is no match, so it never stands between someone and sending.
 */
function SimilarIdeas({ query, onOpen }: { query: string; onOpen: (id: number) => void }) {
    const t = useTranslations("feedback.dialog.similar");
    const [items, setItems] = useState<FeedbackListItem[]>([]);
    const q = query.trim();

    useEffect(() => {
        if (q.length < 4) {
            setItems([]);
            return;
        }
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            listFeedback({ scope: "ideas", q, sort: "votes", limit: 3 }, controller.signal)
                .then(setItems)
                .catch(() => undefined);
        }, 350);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [q]);

    if (items.length === 0) return null;

    const vote = async (item: FeedbackListItem) => {
        const next = !item.voted;
        setItems(current =>
            current.map(i =>
                i.id === item.id ? { ...i, voted: next, votes: i.votes + (next ? 1 : -1) } : i
            )
        );
        try {
            const result = await voteForFeedback(item.id, next);
            setItems(current => current.map(i => (i.id === item.id ? { ...i, ...result } : i)));
        } catch {
            setItems(current => current.map(i => (i.id === item.id ? item : i)));
        }
    };

    return (
        <div
            className="border-line bg-panel rounded-md border px-3 py-2.5"
            data-testid="feedback-similar"
        >
            <div className="text-ink-2 mb-1.5 text-xs font-medium">{t("title")}</div>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {items.map(item => (
                    <li key={item.id} className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant={item.voted ? "default" : "outline"}
                            size="sm"
                            className="h-7 shrink-0 gap-1 px-2 text-xs"
                            onClick={() => void vote(item)}
                            aria-pressed={item.voted}
                            aria-label={item.voted ? t("unvote") : t("vote")}
                            data-testid="feedback-similar-vote"
                        >
                            {item.voted ? <Check aria-hidden /> : <ChevronUp aria-hidden />}
                            {item.votes}
                        </Button>
                        <button
                            type="button"
                            onClick={() => onOpen(item.id)}
                            className="text-ink hover:text-brand-ink min-w-0 flex-1 truncate text-left text-[13px] outline-none focus-visible:underline"
                        >
                            {item.title}
                        </button>
                        <StatusBadge status={item.status} />
                    </li>
                ))}
            </ul>
            <p className="text-ink-3 m-0 mt-1.5 text-[11px]">{t("hint")}</p>
        </div>
    );
}

function SentView({
    report,
    onView,
    onAnother,
    onDone,
}: {
    report: FeedbackDetail;
    onView: () => void;
    onAnother: () => void;
    onDone: () => void;
}) {
    const t = useTranslations("feedback.dialog.sent");
    return (
        <div className="flex flex-col items-start gap-3" data-testid="feedback-sent">
            <div className="bg-success-soft text-success-ink flex size-9 items-center justify-center rounded-full">
                <Check className="size-5" aria-hidden />
            </div>
            <DialogHeader>
                <DialogTitle>
                    {report.kind === "bug"
                        ? t("titleBug", { id: report.id })
                        : t("titleIdea", { id: report.id })}
                </DialogTitle>
                <DialogDescription>{t("body")}</DialogDescription>
            </DialogHeader>
            <DialogFooter className="w-full gap-2 pt-1">
                <Button variant="ghost" onClick={onAnother}>
                    {t("another")}
                </Button>
                <Button variant="outline" onClick={onView} data-testid="feedback-sent-view">
                    {t("view")}
                </Button>
                <Button onClick={onDone}>{t("done")}</Button>
            </DialogFooter>
        </div>
    );
}

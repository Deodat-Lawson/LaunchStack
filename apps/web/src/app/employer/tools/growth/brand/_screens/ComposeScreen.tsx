"use client";

import { FlaskConical, ImagePlus, RotateCw, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { useToolRouter } from "~/components/tool-app/nav";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { SCENARIO_LIMITS, normalizeDraft } from "~/lib/scenarios/types";
import { formatPercent, isLive, progressLabel } from "~/lib/scenarios/words";
import { useResource } from "~/lib/tools/useResource";
import { cn } from "~/lib/utils";

import { useGrowthFormat } from "../../_lib/format";
import { useGrowthPaths } from "../../_lib/paths";
import { ChannelAvatar } from "../_components/ChannelAvatar";
import { NETWORK_LABEL, NetworkMark } from "../_components/NetworkMark";
import { PostTestSheet } from "../_components/PostTestSheet";
import {
    byKindThenName,
    composeChannels,
    defaultChannelSelection,
    groupByNetwork,
    isPostable,
    unavailableReason,
} from "../_lib/channels";
import {
    MEDIA_ACCEPT,
    MEDIA_MAX_COUNT,
    channelMediaNote,
    fileSize,
    mediaRejection,
    overLimit,
    postLength,
    previewText,
} from "../_lib/compose";
import { dayAndMonth, nextSlot, timeOfDay, toLocalInput } from "../_lib/time";
import {
    BrandApiError,
    COMPOSE_HANDOFF_KEY,
    brandApi,
    type BrandChannel,
    type BrandMedia,
    type BrandPostSource,
    type ComposeHandoff,
    type PostTestResult,
} from "../api";

type When = "now" | "later" | "draft";

/** An attached image: shown from the local file at once, sent as soon as it is picked. */
interface Attachment {
    key: number;
    file: File;
    localUrl: string;
    status: "uploading" | "ready" | "error";
    media: BrandMedia | null;
    error: string | null;
    alt: string;
}

/** The first value with something in it, for a Reddit title that falls back to the first line. */
function firstNonEmpty(...values: Array<string | undefined>): string | null {
    for (const value of values) {
        const trimmed = value?.trim();
        if (trimmed) return trimmed;
    }
    return null;
}

function readHandoff(): ComposeHandoff | null {
    try {
        const raw = sessionStorage.getItem(COMPOSE_HANDOFF_KEY);
        if (!raw) return null;
        sessionStorage.removeItem(COMPOSE_HANDOFF_KEY);
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        const h = parsed as Partial<ComposeHandoff>;
        if (typeof h.body !== "string" || !h.platform) return null;
        return { platform: h.platform, body: h.body, title: h.title ?? null, source: h.source };
    } catch {
        return null;
    }
}

/** Images laid out the way a feed lays them out: one wide, two side by side, a grid past that. */
function ImageGrid({
    items,
}: {
    items: Array<{ key: string | number; url: string; alt: string }>;
}) {
    if (items.length === 0) return null;
    return (
        <div
            className={cn(
                "bg-line-2 grid gap-0.5 overflow-hidden",
                items.length === 1 ? "grid-cols-1" : "grid-cols-2"
            )}
        >
            {items.map((item, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- a local preview of the file being attached
                <img
                    key={item.key}
                    src={item.url}
                    alt={item.alt}
                    className={cn(
                        "bg-panel-2 w-full object-cover",
                        items.length === 1
                            ? "aspect-[16/10]"
                            : items.length === 3 && i === 0
                              ? "col-span-2 aspect-[16/9]"
                              : "aspect-square"
                    )}
                />
            ))}
        </div>
    );
}

/**
 * One channel's preview, laid out like a feed post: who it is from, the
 * text folded where LinkedIn folds it ("…see more"), the images, and the
 * count against the channel's limit. Over the limit, the overflow is
 * marked and the post cannot be sent.
 */
function ChannelPreview({
    channel,
    body,
    title,
    attachments,
    whenLabel,
}: {
    channel: BrandChannel;
    body: string;
    title: string;
    attachments: Attachment[];
    whenLabel: string;
}) {
    const t = useTranslations("growth.brand");
    const tRules = useTranslations("growth.brand.composeRules");
    const tc = useTranslations("common.status");
    const { count } = useGrowthFormat();
    const [expanded, setExpanded] = useState(false);
    const text = body.trim();
    const length = postLength(body);
    const over = overLimit(channel, body);
    const note = channelMediaNote(
        tRules,
        channel,
        attachments.map(a => ({ mimeType: a.file.type, size: a.file.size }))
    );
    const fold = channel.platform === "linkedin" && !over && !expanded ? previewText(text) : null;
    const images = channel.capabilities.images
        ? attachments.map(a => ({ key: a.key, url: a.localUrl, alt: a.alt }))
        : [];
    return (
        <article
            aria-label={t("compose.previewFor", { name: channel.name })}
            className={cn(
                "border-line bg-panel overflow-hidden rounded-lg border",
                (over || note?.tone === "error") && "border-danger/60"
            )}
        >
            <header className="flex items-center gap-2.5 px-3 pt-3">
                <ChannelAvatar
                    name={channel.name}
                    kind={channel.kind}
                    avatarUrl={channel.avatarUrl}
                    size={36}
                />
                <div className="min-w-0 flex-1">
                    <div className="text-ink truncate text-[13px] font-semibold">
                        {channel.name}
                    </div>
                    <div className="text-ink-3 truncate text-[11.5px]">
                        {t(`kinds.${channel.kind}`)} · {NETWORK_LABEL[channel.platform]} ·{" "}
                        {whenLabel}
                    </div>
                </div>
                {channel.limit !== null && (
                    <span
                        className={cn(
                            "shrink-0 font-mono text-[11px] tabular-nums",
                            over ? "text-danger" : "text-ink-3"
                        )}
                    >
                        {count(length)}/{count(channel.limit)}
                    </span>
                )}
            </header>
            {channel.platform === "reddit" && (
                <div className="text-ink px-3 pt-2 text-[13px] font-medium">
                    {firstNonEmpty(title, text.split("\n")[0]) ?? tc("untitled")}
                </div>
            )}
            <p className="text-ink-2 whitespace-pre-wrap break-words px-3 py-2.5 text-[13px] leading-[1.45]">
                {!text ? (
                    <span className="text-ink-3">{t("compose.yourPost")}</span>
                ) : over && channel.limit !== null ? (
                    <>
                        {text.slice(0, channel.limit)}
                        <span className="text-danger bg-danger-soft">
                            {text.slice(channel.limit)}
                        </span>
                    </>
                ) : fold?.more ? (
                    <>
                        {fold.shown}
                        <button
                            type="button"
                            onClick={() => setExpanded(true)}
                            className="text-ink-3 hover:text-ink focus-visible:ring-brand/50 rounded-sm outline-none focus-visible:ring-2"
                        >
                            {t("compose.seeMore")}
                        </button>
                    </>
                ) : (
                    text
                )}
            </p>
            <ImageGrid items={images} />
            {(over || note) && (
                <p
                    className={cn(
                        "border-line-2 border-t px-3 py-2 text-xs",
                        over || note?.tone === "error" ? "text-danger" : "text-ink-3"
                    )}
                >
                    {over
                        ? t("compose.overLimit", {
                              count: length - (channel.limit ?? 0),
                              name: channel.name,
                          })
                        : note?.text}
                </p>
            )}
        </article>
    );
}

/**
 * One text, several channels. Each selected channel shows the post as it
 * will go out, with its count against its limit; images upload the moment
 * they are picked; the primary button is whatever the time choice makes it.
 * A campaign hands its edited post here to be scheduled.
 */
export function ComposeScreen() {
    const t = useTranslations("growth.brand");
    const tRules = useTranslations("growth.brand.composeRules");
    const tChannels = useTranslations("growth.brand.channels");
    const tCounts = useTranslations("growth.common.counts");
    const tc = useTranslations("common");
    const locale = useLocale();
    const { count, joinList } = useGrowthFormat();
    const router = useToolRouter();
    const paths = useGrowthPaths();
    const accounts = useResource("brand:accounts", () => brandApi.accounts());

    const [body, setBody] = useState("");
    const [title, setTitle] = useState("");
    const [selected, setSelected] = useState<string[]>([]);
    const [when, setWhen] = useState<When>("later");
    const [at, setAt] = useState(() => toLocalInput(nextSlot()));
    const [source, setSource] = useState<BrandPostSource | undefined>(undefined);
    const [handoff, setHandoff] = useState<ComposeHandoff | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [seeded, setSeeded] = useState(false);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [mediaProblem, setMediaProblem] = useState<string | null>(null);
    const handoffRead = useRef(false);
    const nextKey = useRef(1);
    const fileInput = useRef<HTMLInputElement>(null);
    const attachmentsRef = useRef(attachments);
    attachmentsRef.current = attachments;

    // The latest post test of this draft. It is polled until it ends; a
    // finished test of the exact text goes out with the post, so its result
    // can be compared with the real one later.
    const [testId, setTestId] = useState<number | null>(null);
    const [testOpen, setTestOpen] = useState(false);
    const [startingTest, setStartingTest] = useState(false);
    const [testProblem, setTestProblem] = useState<string | null>(null);
    const [testEnded, setTestEnded] = useState(false);
    const testRes = useResource(
        testId === null ? null : `brand:post-test:${testId}`,
        () => brandApi.postTest(testId!),
        { pollMs: testId !== null && !testEnded ? 1500 : null }
    );
    const test = testRes.data?.test.runId === testId ? (testRes.data?.test ?? null) : null;
    const ended = test !== null && !isLive(test.status);
    if (ended !== testEnded) setTestEnded(ended);
    const testStale = test !== null && normalizeDraft(body) !== normalizeDraft(test.text);

    // A hand-off from Campaigns is read once (it is removed as it is read).
    useEffect(() => {
        if (handoffRead.current) return;
        handoffRead.current = true;
        const h = readHandoff();
        if (!h) return;
        setHandoff(h);
        setBody(h.body);
        setTitle(h.title ?? "");
        setSource(h.source ?? { kind: "campaign" });
    }, []);

    // Then start with the hand-off's network, else the company's Pages.
    useEffect(() => {
        if (seeded || !accounts.data) return;
        setSelected(defaultChannelSelection(accounts.data.channels, handoff?.platform));
        setSeeded(true);
    }, [accounts.data, handoff, seeded]);

    // Object URLs live until the screen goes.
    useEffect(
        () => () => {
            for (const a of attachmentsRef.current) URL.revokeObjectURL(a.localUrl);
        },
        []
    );

    const all = useMemo(() => accounts.data?.channels ?? [], [accounts.data]);
    const offered = useMemo(() => composeChannels(all), [all]);
    const groups = useMemo(() => groupByNetwork(offered, byKindThenName), [offered]);
    const chosen = offered.filter(c => selected.includes(c.id) && isPostable(c));

    const length = postLength(body);
    const ready = attachments.filter(a => a.status === "ready");
    const uploading = attachments.some(a => a.status === "uploading");
    const failedUpload = attachments.some(a => a.status === "error");
    const over = chosen.filter(c => overLimit(c, body));
    const mediaErrors = chosen.flatMap(c => {
        const note = channelMediaNote(
            tRules,
            c,
            attachments.map(a => ({ mimeType: a.file.type, size: a.file.size }))
        );
        return note?.tone === "error" ? [{ channel: c, text: note.text }] : [];
    });
    // Viewers and Guests read Brand; posting speaks as the company.
    const canPublish = accounts.data?.canPublish ?? true;
    const canSave =
        canPublish &&
        length > 0 &&
        chosen.length > 0 &&
        over.length === 0 &&
        mediaErrors.length === 0 &&
        !uploading &&
        !failedUpload &&
        !submitting;
    const canSend = canSave && (when !== "later" || Boolean(at));
    const blocked = !canPublish
        ? t("compose.readOnly")
        : over.length > 0
          ? t("compose.tooLong", { names: joinList(over.map(c => c.name)) })
          : mediaErrors.length > 0
            ? mediaErrors[0]!.text
            : uploading
              ? t("compose.uploading")
              : failedUpload
                ? t("compose.uploadFailedBlock")
                : null;

    const whenLabel =
        when === "now"
            ? t("compose.whenNow")
            : when === "draft"
              ? t("compose.whenDraft")
              : at
                ? t("compose.whenAt", {
                      date: dayAndMonth(new Date(at), locale),
                      time: timeOfDay(new Date(at), locale),
                  })
                : t("compose.pickTime");

    const toggle = (id: string, on: boolean) =>
        setSelected(current =>
            on ? [...new Set([...current, id])] : current.filter(c => c !== id)
        );

    const upload = async (key: number, file: File) => {
        setAttachments(list =>
            list.map(a => (a.key === key ? { ...a, status: "uploading", error: null } : a))
        );
        try {
            const { media } = await brandApi.uploadMedia(file);
            setAttachments(list =>
                list.map(a => (a.key === key ? { ...a, status: "ready", media } : a))
            );
        } catch (e) {
            const error = e instanceof Error ? e.message : t("compose.uploadFailed");
            setAttachments(list =>
                list.map(a => (a.key === key ? { ...a, status: "error", error } : a))
            );
        }
    };

    const addFiles = (files: FileList | null) => {
        if (!files) return;
        const list = [...files];
        const room = MEDIA_MAX_COUNT - attachments.length;
        const problems: string[] = [];
        if (list.length > room)
            problems.push(
                t("compose.tooMany", {
                    max: MEDIA_MAX_COUNT,
                    count: list.length - Math.max(0, room),
                })
            );
        const added: Attachment[] = [];
        for (const file of list.slice(0, Math.max(0, room))) {
            const why = mediaRejection(tRules, file);
            if (why) {
                problems.push(why);
                continue;
            }
            added.push({
                key: nextKey.current++,
                file,
                localUrl: URL.createObjectURL(file),
                status: "uploading",
                media: null,
                error: null,
                alt: "",
            });
        }
        setMediaProblem(problems.length > 0 ? problems.join(" ") : null);
        if (added.length === 0) return;
        setAttachments(current => [...current, ...added]);
        for (const a of added) void upload(a.key, a.file);
    };

    const removeAttachment = (key: number) => {
        setAttachments(list => {
            const gone = list.find(a => a.key === key);
            if (gone) URL.revokeObjectURL(gone.localUrl);
            return list.filter(a => a.key !== key);
        });
        setMediaProblem(null);
    };

    const startTest = async () => {
        setStartingTest(true);
        setTestProblem(null);
        try {
            const networks = [...new Set(chosen.map(c => c.platform))];
            const { test: started } = await brandApi.startPostTest({
                text: body.trim(),
                networks,
            });
            setTestEnded(!isLive(started.status));
            setTestId(started.runId);
            setTestOpen(true);
        } catch (e) {
            const status = e instanceof BrandApiError ? e.status : null;
            const message = e instanceof Error ? e.message : t("compose.testStartFailed");
            setTestProblem(
                status === 403
                    ? t("compose.testForbidden")
                    : status === 402
                      ? t("compose.noCredits", { message })
                      : message
            );
        } finally {
            setStartingTest(false);
        }
    };

    const submit = async () => {
        setSubmitting(true);
        try {
            const result = await brandApi.compose({
                channels: chosen.map(c => c.id),
                body: body.trim(),
                title:
                    chosen.some(c => c.platform === "reddit") && title.trim() ? title.trim() : null,
                media: ready
                    .filter(a => a.media)
                    .map(a => ({ id: a.media!.id, alt: a.alt.trim() || null })),
                scheduledAt: when === "later" ? new Date(at).toISOString() : null,
                publishNow: when === "now",
                source,
                // Only a finished test of exactly this text says anything about it.
                postTestId: test && test.status === "done" && !testStale ? test.runId : undefined,
            });
            const name = (p: (typeof result.posts)[number]) =>
                p.channel?.name ?? NETWORK_LABEL[p.platform];
            const failed = result.posts.filter(p => p.status === "failed");
            if (when === "now") {
                if (failed.length === result.posts.length)
                    toast.error(failed[0]?.error ?? t("compose.allFailed"));
                else if (failed.length > 0)
                    toast.warning(
                        t("compose.partial", {
                            count: result.posts.length - failed.length,
                            names: joinList(failed.map(name)),
                        })
                    );
                else toast.success(t("compose.published", { count: result.posts.length }));
            } else if (when === "later") {
                toast.success(t("compose.scheduled", { count: result.posts.length }));
            } else {
                toast(t("compose.saved", { count: result.posts.length }));
            }
            if (result.postTest?.stale) toast.warning(t("compose.staleTest"));
            router.push(paths.brand("/calendar"));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("compose.saveFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    if (accounts.data && offered.length === 0) {
        return (
            <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
                <PageHeader size="md" title={t("common.compose")} />
                <EmptyState
                    title={all.length > 0 ? t("compose.allOff") : t("compose.nothingToPost")}
                    body={all.length > 0 ? t("compose.allOffBody") : t("compose.nothingToPostBody")}
                    action={
                        <Button asChild size="sm">
                            <ToolLink href={paths.brand("/accounts")}>
                                {all.length > 0
                                    ? t("common.openAccounts")
                                    : t("common.connectAccount")}
                            </ToolLink>
                        </Button>
                    }
                />
            </div>
        );
    }

    return (
        <div className="mx-auto flex max-w-[1140px] flex-col gap-6">
            <PageHeader
                size="md"
                title={t("compose.title")}
                accent={t("compose.accent")}
                sub={t("compose.sub")}
            />
            {accounts.error && (
                <InlineError message={accounts.error} onRetry={() => void accounts.reload()} />
            )}

            <div className="@max-lg:grid-cols-1 grid grid-cols-[minmax(0,1fr)_360px] gap-6">
                <div className="flex flex-col gap-5">
                    <div>
                        <Label htmlFor="brand-body" className="text-ink-3 text-xs font-normal">
                            {t("common.post")}
                        </Label>
                        <Textarea
                            id="brand-body"
                            value={body}
                            onChange={e => setBody(e.target.value)}
                            rows={9}
                            placeholder={t("compose.placeholder")}
                            className="mt-1.5 text-[14px] leading-[1.5]"
                        />
                        <div className="text-ink-3 mt-1 flex justify-between gap-3 text-xs tabular-nums">
                            <span>
                                {source?.kind === "campaign"
                                    ? t("compose.fromCampaign")
                                    : chosen.some(c => c.platform === "linkedin")
                                      ? t("compose.linkedinFold")
                                      : ""}
                            </span>
                            <span className="shrink-0">
                                {t("compose.characters", { count: length })}
                            </span>
                        </div>
                    </div>

                    {chosen.some(c => c.platform === "reddit") && (
                        <div>
                            <Label htmlFor="brand-title" className="text-ink-3 text-xs font-normal">
                                {t("compose.redditTitle")}
                            </Label>
                            <Input
                                id="brand-title"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                placeholder={t("compose.redditTitlePlaceholder")}
                                className="mt-1.5"
                                maxLength={300}
                            />
                        </div>
                    )}

                    <div>
                        <SectionHeading
                            title={t("compose.images")}
                            aside={t("compose.imagesAside", { max: MEDIA_MAX_COUNT })}
                        />
                        <div className="flex flex-wrap items-start gap-3">
                            {attachments.map(a => (
                                <div key={a.key} className="flex w-[132px] flex-col gap-1.5">
                                    <div className="border-line bg-panel-2 relative size-[132px] overflow-hidden rounded-lg border">
                                        {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the file being attached */}
                                        <img
                                            src={a.localUrl}
                                            alt=""
                                            className={cn(
                                                "size-full object-cover",
                                                a.status !== "ready" && "opacity-50"
                                            )}
                                        />
                                        {a.status === "uploading" && (
                                            <span className="bg-surface/40 absolute inset-0 flex items-center justify-center">
                                                <Spinner className="text-ink motion-reduce:animate-none" />
                                            </span>
                                        )}
                                        {a.status === "error" && (
                                            <span className="bg-surface/70 absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center">
                                                <span className="text-danger text-[11px] leading-tight">
                                                    {a.error}
                                                </span>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-6 px-2 text-[11px]"
                                                    onClick={() => void upload(a.key, a.file)}
                                                >
                                                    <RotateCw className="size-3" aria-hidden />
                                                    {tc("actions.retry")}
                                                </Button>
                                            </span>
                                        )}
                                        <Button
                                            size="icon"
                                            variant="secondary"
                                            className="absolute right-1 top-1 size-6 rounded-full"
                                            aria-label={t("compose.remove", { name: a.file.name })}
                                            onClick={() => removeAttachment(a.key)}
                                        >
                                            <X className="size-3.5" aria-hidden />
                                        </Button>
                                    </div>
                                    <Textarea
                                        value={a.alt}
                                        onChange={e =>
                                            setAttachments(list =>
                                                list.map(x =>
                                                    x.key === a.key
                                                        ? { ...x, alt: e.target.value }
                                                        : x
                                                )
                                            )
                                        }
                                        placeholder={t("compose.describe")}
                                        aria-label={t("compose.altFor", { name: a.file.name })}
                                        maxLength={1000}
                                        rows={2}
                                        // Two lines that wrap: alt text is a sentence, and 132px shows
                                        // only a few words of one line.
                                        className="min-h-0 resize-none px-2 py-1 text-[12px] leading-snug"
                                    />
                                    <span className="text-ink-3 truncate text-[11px]">
                                        {fileSize(a.file.size)} ·{" "}
                                        {t(`compose.attachment.${a.status}`)}
                                    </span>
                                </div>
                            ))}
                            {attachments.length < MEDIA_MAX_COUNT && (
                                <>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => fileInput.current?.click()}
                                    >
                                        <ImagePlus className="size-3.5" aria-hidden />
                                        {t("compose.addImage")}
                                    </Button>
                                    <input
                                        ref={fileInput}
                                        type="file"
                                        accept={MEDIA_ACCEPT}
                                        multiple
                                        className="sr-only"
                                        tabIndex={-1}
                                        aria-hidden
                                        onChange={e => {
                                            addFiles(e.target.files);
                                            e.target.value = "";
                                        }}
                                    />
                                </>
                            )}
                        </div>
                        {mediaProblem && (
                            <p role="alert" className="text-danger mt-1.5 text-xs">
                                {mediaProblem}
                            </p>
                        )}
                    </div>

                    <div>
                        <SectionHeading
                            title={t("common.channels")}
                            aside={
                                <ToolLink
                                    href={paths.brand("/accounts")}
                                    className="hover:text-ink"
                                >
                                    {t("common.accounts")}
                                </ToolLink>
                            }
                        />
                        {accounts.loading ? (
                            <SkeletonRows rows={3} height={44} />
                        ) : (
                            <div className="flex flex-col gap-3">
                                {groups.map(group => (
                                    <div key={group.platform}>
                                        <div className="text-ink-3 mb-1 flex items-center gap-1.5 text-xs">
                                            <NetworkMark
                                                platform={group.platform}
                                                size={14}
                                                muted
                                            />
                                            {NETWORK_LABEL[group.platform]}
                                        </div>
                                        <div className="border-line bg-panel rounded-lg border">
                                            {group.items.map(channel => {
                                                const reason = unavailableReason(
                                                    tChannels,
                                                    channel
                                                );
                                                const id = `brand-ch-${channel.id}`;
                                                const on = selected.includes(channel.id) && !reason;
                                                return (
                                                    <div
                                                        key={channel.id}
                                                        className="border-line-2 grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 border-t px-3 py-2 first:border-t-0"
                                                    >
                                                        <Checkbox
                                                            id={id}
                                                            checked={on}
                                                            disabled={Boolean(reason)}
                                                            onCheckedChange={v =>
                                                                toggle(channel.id, v === true)
                                                            }
                                                        />
                                                        <ChannelAvatar
                                                            name={channel.name}
                                                            kind={channel.kind}
                                                            avatarUrl={channel.avatarUrl}
                                                            size={24}
                                                            muted={Boolean(reason)}
                                                        />
                                                        <div className="min-w-0">
                                                            <Label
                                                                htmlFor={id}
                                                                className={cn(
                                                                    "text-[13px] font-normal",
                                                                    reason
                                                                        ? "text-ink-3"
                                                                        : "text-ink"
                                                                )}
                                                            >
                                                                <span className="truncate">
                                                                    {channel.name}
                                                                </span>
                                                                <span className="text-ink-3 text-xs">
                                                                    {t(`kinds.${channel.kind}`)}
                                                                </span>
                                                            </Label>
                                                            {reason && (
                                                                <p className="text-danger mt-0.5 text-xs">
                                                                    {reason}{" "}
                                                                    <ToolLink
                                                                        href={paths.brand(
                                                                            "/accounts"
                                                                        )}
                                                                        className="text-ink-2 hover:text-ink underline underline-offset-2"
                                                                    >
                                                                        {t(
                                                                            "compose.reconnectInAccounts"
                                                                        )}
                                                                    </ToolLink>
                                                                </p>
                                                            )}
                                                        </div>
                                                        <span
                                                            className={cn(
                                                                "font-mono text-[11.5px] tabular-nums",
                                                                on && overLimit(channel, body)
                                                                    ? "text-danger"
                                                                    : "text-ink-3"
                                                            )}
                                                        >
                                                            {channel.limit === null
                                                                ? t("compose.noLimit")
                                                                : `${count(length)} / ${count(channel.limit)}`}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="border-line bg-panel flex flex-col gap-3 rounded-lg border p-4">
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
                            <RadioGroup
                                value={when}
                                onValueChange={v => setWhen(v as When)}
                                className="flex flex-wrap items-center gap-x-5 gap-y-2"
                                aria-label={t("compose.whenAria")}
                            >
                                {(["later", "now", "draft"] as const).map(value => (
                                    <div key={value} className="inline-flex items-center gap-2">
                                        <RadioGroupItem value={value} id={`brand-when-${value}`} />
                                        <Label
                                            htmlFor={`brand-when-${value}`}
                                            className="text-ink text-[13px] font-normal"
                                        >
                                            {t(`compose.when.${value}`)}
                                        </Label>
                                    </div>
                                ))}
                            </RadioGroup>
                            {when === "later" && (
                                <Input
                                    type="datetime-local"
                                    value={at}
                                    onChange={e => setAt(e.target.value)}
                                    className="h-8 w-auto text-[13px]"
                                    aria-label={t("compose.whenToPublish")}
                                />
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <Button size="sm" disabled={!canSend} onClick={() => void submit()}>
                                {submitting
                                    ? tc("status.saving")
                                    : when === "now"
                                      ? t("compose.publishTo", { count: chosen.length })
                                      : when === "later"
                                        ? t("compose.schedule")
                                        : t("compose.saveDraft")}
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={!body.trim() || !canPublish || startingTest}
                                onClick={() => void startTest()}
                            >
                                <FlaskConical aria-hidden />
                                {startingTest ? t("compose.startingTest") : t("compose.testPost")}
                            </Button>
                            {blocked && <span className="text-danger text-xs">{blocked}</span>}
                            {!blocked && chosen.length === 0 && seeded && (
                                <span className="text-ink-3 text-xs">
                                    {t("compose.pickChannel")}
                                </span>
                            )}
                        </div>
                        <PostTestNote
                            problem={testProblem}
                            test={test}
                            stale={testStale}
                            starting={startingTest}
                            onView={() => setTestOpen(true)}
                            onTestAgain={() => void startTest()}
                        />
                    </div>
                    <PostTestSheet
                        open={testOpen}
                        onOpenChange={setTestOpen}
                        test={test}
                        error={testRes.error}
                        onRetry={() => void testRes.reload()}
                        stale={testStale}
                        testing={startingTest}
                        onTestAgain={() => void startTest()}
                    />
                </div>

                <aside className="flex flex-col gap-3">
                    <SectionHeading
                        title={t("compose.preview")}
                        aside={tCounts("channels", { count: chosen.length })}
                    />
                    {chosen.length === 0 ? (
                        <p className="text-ink-3 text-[13px]">{t("compose.previewEmpty")}</p>
                    ) : (
                        chosen.map(channel => (
                            <ChannelPreview
                                key={channel.id}
                                channel={channel}
                                body={body}
                                title={title}
                                attachments={attachments}
                                whenLabel={whenLabel}
                            />
                        ))
                    )}
                </aside>
            </div>
        </div>
    );
}

/**
 * One line under the buttons about the latest post test: running, its
 * result, or that the draft has changed since and the result no longer
 * describes it.
 */
function PostTestNote({
    problem,
    test,
    stale,
    starting,
    onView,
    onTestAgain,
}: {
    problem: string | null;
    test: PostTestResult | null;
    stale: boolean;
    starting: boolean;
    onView: () => void;
    onTestAgain: () => void;
}) {
    const t = useTranslations("growth.brand");
    const tc = useTranslations("common.actions");
    const tw = useTranslations("scenarios.words");
    const locale = useLocale();
    const link =
        "text-ink-2 hover:text-ink focus-visible:ring-brand/50 rounded-sm underline underline-offset-2 outline-none focus-visible:ring-2";
    if (problem) {
        return (
            <p role="alert" className="text-danger text-xs">
                {problem}
            </p>
        );
    }
    if (!test) return null;
    if (stale) {
        return (
            <p className="text-warn text-xs">
                {t("compose.testNote.stale")}{" "}
                <button type="button" className={link} disabled={starting} onClick={onTestAgain}>
                    {starting ? t("postTest.starting") : t("postTest.testAgain")}
                </button>
            </p>
        );
    }
    const reception = test.reception;
    return (
        <p className="text-ink-3 text-xs" aria-live="polite">
            {isLive(test.status)
                ? t("compose.testNote.testing", {
                      progress: progressLabel(tw, {
                          ...test,
                          agents: SCENARIO_LIMITS.postTest.agents,
                      }).toLowerCase(),
                  })
                : test.status === "done" && reception
                  ? t("compose.testNote.tested", {
                        engaged: reception.engaged,
                        exposed: reception.exposed,
                        rate: formatPercent(reception.engagementRate, locale),
                    })
                  : test.status === "failed"
                    ? t("compose.testNote.failed")
                    : t("compose.testNote.cancelled")}{" "}
            <button type="button" className={link} onClick={onView}>
                {test.status === "done" ? t("compose.testNote.seeResult") : tc("view")}
            </button>
        </p>
    );
}

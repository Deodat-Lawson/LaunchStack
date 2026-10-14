"use client";

import { ImagePlus, RotateCw, X } from "lucide-react";
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
import { plural } from "~/lib/tools/format";
import { useResource } from "~/lib/tools/useResource";
import { cn } from "~/lib/utils";

import { useGrowthPaths } from "../../_lib/paths";
import { ChannelAvatar } from "../_components/ChannelAvatar";
import { NETWORK_LABEL, NetworkMark } from "../_components/NetworkMark";
import {
    KIND_WORD,
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
import { count } from "../_lib/numbers";
import { dayAndMonth, nextSlot, timeOfDay, toLocalInput } from "../_lib/time";
import {
    COMPOSE_HANDOFF_KEY,
    brandApi,
    type BrandChannel,
    type BrandMedia,
    type BrandPostSource,
    type ComposeHandoff,
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
function firstNonEmpty(...values: Array<string | undefined>): string {
    for (const value of values) {
        const trimmed = value?.trim();
        if (trimmed) return trimmed;
    }
    return "Untitled";
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
    const [expanded, setExpanded] = useState(false);
    const text = body.trim();
    const length = postLength(body);
    const over = overLimit(channel, body);
    const note = channelMediaNote(
        channel,
        attachments.map(a => ({ mimeType: a.file.type, size: a.file.size }))
    );
    const fold = channel.platform === "linkedin" && !over && !expanded ? previewText(text) : null;
    const images = channel.capabilities.images
        ? attachments.map(a => ({ key: a.key, url: a.localUrl, alt: a.alt }))
        : [];
    return (
        <article
            aria-label={`Preview for ${channel.name}`}
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
                        {KIND_WORD[channel.kind]} · {NETWORK_LABEL[channel.platform]} · {whenLabel}
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
                    {firstNonEmpty(title, text.split("\n")[0])}
                </div>
            )}
            <p className="text-ink-2 whitespace-pre-wrap break-words px-3 py-2.5 text-[13px] leading-[1.45]">
                {!text ? (
                    <span className="text-ink-3">Your post appears here.</span>
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
                            …see more
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
                        ? `${count(length - (channel.limit ?? 0))} characters over ${channel.name}'s limit.`
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
        ? "Your role can read Brand but not post as the company. Ask an admin for Member access."
        : over.length > 0
          ? `Too long for ${over.map(c => c.name).join(", ")}`
          : mediaErrors.length > 0
            ? mediaErrors[0]!.text
            : uploading
              ? "Waiting for images to finish uploading"
              : failedUpload
                ? "An image did not upload; retry or remove it"
                : null;

    const whenLabel =
        when === "now"
            ? "Now"
            : when === "draft"
              ? "Draft"
              : at
                ? `${dayAndMonth(new Date(at))}, ${timeOfDay(new Date(at))}`
                : "Pick a time";

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
            const error = e instanceof Error ? e.message : "The upload failed";
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
                `A post takes ${MEDIA_MAX_COUNT} images at most; ${plural(list.length - Math.max(0, room), "image")} left out.`
            );
        const added: Attachment[] = [];
        for (const file of list.slice(0, Math.max(0, room))) {
            const why = mediaRejection(file);
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
            });
            const name = (p: (typeof result.posts)[number]) =>
                p.channel?.name ?? NETWORK_LABEL[p.platform];
            const failed = result.posts.filter(p => p.status === "failed");
            if (when === "now") {
                if (failed.length === result.posts.length)
                    toast.error(failed[0]?.error ?? "The networks did not accept the post");
                else if (failed.length > 0)
                    toast.warning(
                        `Published to ${plural(result.posts.length - failed.length, "channel")}; ${failed.map(name).join(", ")} failed`
                    );
                else toast.success(`Published to ${plural(result.posts.length, "channel")}`);
            } else if (when === "later") {
                toast.success(`Scheduled on ${plural(result.posts.length, "channel")}`);
            } else {
                toast(`Saved ${plural(result.posts.length, "draft")}`);
            }
            router.push(paths.brand("/calendar"));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not save the post");
        } finally {
            setSubmitting(false);
        }
    };

    if (accounts.data && offered.length === 0) {
        return (
            <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
                <PageHeader size="md" title="Compose" />
                <EmptyState
                    title={
                        all.length > 0 ? "Every channel is switched off" : "Nothing to post to yet"
                    }
                    body={
                        all.length > 0
                            ? "An admin turned off Offer in Compose for every channel. Switch one back on in Accounts."
                            : "Posts go out as a LinkedIn Page or profile, or a Bluesky account. Connect one first."
                    }
                    action={
                        <Button asChild size="sm">
                            <ToolLink href={paths.brand("/accounts")}>
                                {all.length > 0 ? "Open Accounts" : "Connect an account"}
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
                title="Say it once,"
                accent="everywhere it belongs"
                sub="Pick the channels, check each preview against its limit, then publish now or put it on the calendar."
            />
            {accounts.error && (
                <InlineError message={accounts.error} onRetry={() => void accounts.reload()} />
            )}

            <div className="@max-lg:grid-cols-1 grid grid-cols-[minmax(0,1fr)_360px] gap-6">
                <div className="flex flex-col gap-5">
                    <div>
                        <Label htmlFor="brand-body" className="text-ink-3 text-xs font-normal">
                            Post
                        </Label>
                        <Textarea
                            id="brand-body"
                            value={body}
                            onChange={e => setBody(e.target.value)}
                            rows={9}
                            placeholder="What do you want people to know this week?"
                            className="mt-1.5 text-[14px] leading-[1.5]"
                        />
                        <div className="text-ink-3 mt-1 flex justify-between gap-3 text-xs tabular-nums">
                            <span>
                                {source?.kind === "campaign"
                                    ? "From a campaign draft; edit freely."
                                    : chosen.some(c => c.platform === "linkedin")
                                      ? "LinkedIn folds a post after about 210 characters; lead with the point."
                                      : ""}
                            </span>
                            <span className="shrink-0">{count(length)} characters</span>
                        </div>
                    </div>

                    {chosen.some(c => c.platform === "reddit") && (
                        <div>
                            <Label htmlFor="brand-title" className="text-ink-3 text-xs font-normal">
                                Reddit title
                            </Label>
                            <Input
                                id="brand-title"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                placeholder="Falls back to the first line"
                                className="mt-1.5"
                                maxLength={300}
                            />
                        </div>
                    )}

                    <div>
                        <SectionHeading
                            title="Images"
                            aside={`JPEG, PNG, GIF or WebP · up to 5 MB · ${MEDIA_MAX_COUNT} per post`}
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
                                                    Retry
                                                </Button>
                                            </span>
                                        )}
                                        <Button
                                            size="icon"
                                            variant="secondary"
                                            className="absolute right-1 top-1 size-6 rounded-full"
                                            aria-label={`Remove ${a.file.name}`}
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
                                        placeholder="Describe it"
                                        aria-label={`Alt text for ${a.file.name}`}
                                        maxLength={1000}
                                        rows={2}
                                        // Two lines that wrap: alt text is a sentence, and 132px shows
                                        // only a few words of one line.
                                        className="min-h-0 resize-none px-2 py-1 text-[12px] leading-snug"
                                    />
                                    <span className="text-ink-3 truncate text-[11px]">
                                        {fileSize(a.file.size)} ·{" "}
                                        {a.status === "uploading"
                                            ? "uploading"
                                            : a.status === "ready"
                                              ? "ready"
                                              : "not uploaded"}
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
                                        Add image
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
                            title="Channels"
                            aside={
                                <ToolLink
                                    href={paths.brand("/accounts")}
                                    className="hover:text-ink"
                                >
                                    Accounts
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
                                                const reason = unavailableReason(channel);
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
                                                                    {KIND_WORD[channel.kind]}
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
                                                                        Reconnect in Accounts
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
                                                                ? "no limit"
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
                                aria-label="When"
                            >
                                {(
                                    [
                                        ["later", "Schedule for"],
                                        ["now", "Publish now"],
                                        ["draft", "Save as draft"],
                                    ] as Array<[When, string]>
                                ).map(([value, label]) => (
                                    <div key={value} className="inline-flex items-center gap-2">
                                        <RadioGroupItem value={value} id={`brand-when-${value}`} />
                                        <Label
                                            htmlFor={`brand-when-${value}`}
                                            className="text-ink text-[13px] font-normal"
                                        >
                                            {label}
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
                                    aria-label="When to publish"
                                />
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <Button size="sm" disabled={!canSend} onClick={() => void submit()}>
                                {submitting
                                    ? "Saving…"
                                    : when === "now"
                                      ? `Publish to ${plural(chosen.length, "channel")}`
                                      : when === "later"
                                        ? "Schedule"
                                        : "Save draft"}
                            </Button>
                            {blocked && <span className="text-danger text-xs">{blocked}</span>}
                            {!blocked && chosen.length === 0 && seeded && (
                                <span className="text-ink-3 text-xs">Pick a channel first.</span>
                            )}
                        </div>
                    </div>
                </div>

                <aside className="flex flex-col gap-3">
                    <SectionHeading title="Preview" aside={plural(chosen.length, "channel")} />
                    {chosen.length === 0 ? (
                        <p className="text-ink-3 text-[13px]">
                            Pick a channel to see the post as it will go out.
                        </p>
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

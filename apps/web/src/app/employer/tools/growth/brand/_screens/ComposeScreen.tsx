"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

import { InlineError } from "../../_components/EmptyState";
import { PageHeader, SectionHeading } from "../../_components/PageHeader";
import { plural } from "../../_lib/format";
import { useGrowthPaths } from "../../_lib/paths";
import { useResource } from "../../_lib/useResource";
import { NETWORK_LABEL, NETWORK_LIMIT, NetworkMark } from "../_components/NetworkMark";
import { nextSlot, toLocalInput } from "../_lib/time";
import {
    BRAND_PLATFORMS,
    COMPOSE_HANDOFF_KEY,
    brandApi,
    type BrandPlatform,
    type BrandPostSource,
    type ComposeHandoff,
} from "../api";

type When = "now" | "later" | "draft";

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

/**
 * One text, several networks. Each selected network shows the text as it
 * will go, with its count against its limit; the primary button is whatever
 * the time choice makes it. A campaign hands its edited post here to be
 * scheduled.
 */
export function ComposeScreen() {
    const router = useRouter();
    const paths = useGrowthPaths();
    const accounts = useResource("brand:accounts", () => brandApi.accounts());

    const [body, setBody] = useState("");
    const [title, setTitle] = useState("");
    const [selected, setSelected] = useState<BrandPlatform[]>([]);
    const [when, setWhen] = useState<When>("later");
    const [at, setAt] = useState(() => toLocalInput(nextSlot()));
    const [source, setSource] = useState<BrandPostSource | undefined>(undefined);
    const [submitting, setSubmitting] = useState(false);
    const [seeded, setSeeded] = useState(false);

    // A hand-off from Campaigns wins; otherwise start with the connected networks.
    useEffect(() => {
        if (seeded) return;
        const handoff = readHandoff();
        if (handoff) {
            setBody(handoff.body);
            setTitle(handoff.title ?? "");
            setSelected([handoff.platform]);
            setSource(handoff.source ?? { kind: "campaign" });
            setSeeded(true);
            return;
        }
        if (!accounts.data) return;
        const connected = accounts.data.accounts.filter(a => a.configured).map(a => a.platform);
        setSelected(connected.length > 0 ? connected : ["linkedin"]);
        setSeeded(true);
    }, [accounts.data, seeded]);

    const limits = useMemo(() => {
        const out: Record<BrandPlatform, number | null> = { ...NETWORK_LIMIT };
        for (const a of accounts.data?.accounts ?? []) out[a.platform] = a.limit;
        return out;
    }, [accounts.data]);
    const configured = useMemo(() => {
        const out = new Set<BrandPlatform>();
        for (const a of accounts.data?.accounts ?? []) if (a.configured) out.add(a.platform);
        return out;
    }, [accounts.data]);

    const length = body.trim().length;
    const over = selected.filter(p => limits[p] !== null && length > (limits[p] ?? Infinity));
    const notConnected = selected.filter(p => !configured.has(p));
    const canSave = length > 0 && selected.length > 0 && over.length === 0 && !submitting;
    const canSend = canSave && (when !== "later" || Boolean(at));

    const toggle = (platform: BrandPlatform, on: boolean) =>
        setSelected(current =>
            on ? [...new Set([...current, platform])] : current.filter(p => p !== platform)
        );

    const submit = async () => {
        setSubmitting(true);
        try {
            const result = await brandApi.compose({
                platforms: selected,
                body: body.trim(),
                title: selected.includes("reddit") && title.trim() ? title.trim() : null,
                scheduledAt: when === "later" ? new Date(at).toISOString() : null,
                publishNow: when === "now",
                source,
            });
            const failed = result.posts.filter(p => p.status === "failed");
            if (when === "now") {
                if (failed.length === result.posts.length)
                    toast.error(failed[0]?.error ?? "The networks did not accept the post");
                else if (failed.length > 0)
                    toast.warning(
                        `Published to ${plural(result.posts.length - failed.length, "network")}; ${failed.map(p => NETWORK_LABEL[p.platform]).join(", ")} failed`
                    );
                else toast.success(`Published to ${plural(result.posts.length, "network")}`);
            } else if (when === "later") {
                toast.success(`Scheduled on ${plural(result.posts.length, "network")}`);
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

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
            <PageHeader
                size="md"
                title="Say it once,"
                accent="everywhere it belongs"
                sub="Pick the networks, check each preview against its limit, then publish now or put it on the calendar."
            />
            {accounts.error && (
                <InlineError message={accounts.error} onRetry={() => void accounts.reload()} />
            )}

            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_340px]">
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
                        <div className="text-ink-3 mt-1 flex justify-between text-xs tabular-nums">
                            <span>
                                {selected.some(p => p === "reddit")
                                    ? "Reddit posts go to the account's own profile."
                                    : source?.kind === "campaign"
                                      ? "From a campaign draft; edit freely."
                                      : ""}
                            </span>
                            <span>{length.toLocaleString()} characters</span>
                        </div>
                    </div>

                    {selected.includes("reddit") && (
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
                        <SectionHeading title="Networks" />
                        <div className="border-line bg-panel rounded-lg border">
                            {BRAND_PLATFORMS.map(platform => {
                                const on = selected.includes(platform);
                                const limit = limits[platform];
                                const tooLong = limit !== null && length > limit;
                                const id = `brand-net-${platform}`;
                                return (
                                    <div
                                        key={platform}
                                        className="border-line-2 grid grid-cols-[auto_20px_minmax(0,1fr)_auto] items-center gap-3 border-t px-3 py-2 first:border-t-0"
                                    >
                                        <Checkbox
                                            id={id}
                                            checked={on}
                                            onCheckedChange={v => toggle(platform, v === true)}
                                        />
                                        <NetworkMark
                                            platform={platform}
                                            size={18}
                                            muted={!configured.has(platform)}
                                        />
                                        <Label
                                            htmlFor={id}
                                            className="text-ink text-[13px] font-normal"
                                        >
                                            {NETWORK_LABEL[platform]}
                                            {!configured.has(platform) && (
                                                <span className="text-ink-3"> · not connected</span>
                                            )}
                                        </Label>
                                        <span
                                            className={cn(
                                                "font-mono text-[11.5px] tabular-nums",
                                                on && tooLong ? "text-danger" : "text-ink-3"
                                            )}
                                        >
                                            {limit === null
                                                ? "no limit"
                                                : `${length.toLocaleString()} / ${limit.toLocaleString()}`}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                        {notConnected.length > 0 && (
                            <p className="text-ink-3 mt-1.5 text-xs">
                                {notConnected.map(p => NETWORK_LABEL[p]).join(", ")}{" "}
                                {notConnected.length === 1 ? "is" : "are"} not connected here; a
                                post to {notConnected.length === 1 ? "it" : "them"} will fail until
                                it is. Scheduling still works.
                            </p>
                        )}
                    </div>

                    <div className="border-line bg-panel flex flex-col gap-3 rounded-lg border p-4">
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
                            {(
                                [
                                    ["later", "Schedule for"],
                                    ["now", "Publish now"],
                                    ["draft", "Save as draft"],
                                ] as Array<[When, string]>
                            ).map(([value, label]) => (
                                <label key={value} className="inline-flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="brand-when"
                                        className="accent-brand"
                                        checked={when === value}
                                        onChange={() => setWhen(value)}
                                    />
                                    {label}
                                </label>
                            ))}
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
                        <div className="flex items-center gap-2">
                            <Button size="sm" disabled={!canSend} onClick={() => void submit()}>
                                {submitting
                                    ? "Saving…"
                                    : when === "now"
                                      ? `Publish to ${plural(selected.length, "network")}`
                                      : when === "later"
                                        ? "Schedule"
                                        : "Save draft"}
                            </Button>
                            {over.length > 0 && (
                                <span className="text-danger text-xs">
                                    Too long for {over.map(p => NETWORK_LABEL[p]).join(", ")}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <aside className="flex flex-col gap-3">
                    <SectionHeading title="Preview" aside={plural(selected.length, "network")} />
                    {selected.length === 0 ? (
                        <p className="text-ink-3 text-[13px]">
                            Pick a network to see the post as it will go.
                        </p>
                    ) : (
                        selected.map(platform => {
                            const limit = limits[platform];
                            const text = body.trim();
                            const cut = limit !== null && text.length > limit;
                            return (
                                <div
                                    key={platform}
                                    className={cn(
                                        "border-line bg-panel rounded-lg border p-3",
                                        cut && "border-danger/60"
                                    )}
                                >
                                    <div className="flex items-center gap-2">
                                        <NetworkMark platform={platform} size={18} />
                                        <span className="text-ink text-[13px] font-medium">
                                            {NETWORK_LABEL[platform]}
                                        </span>
                                        <span className="text-ink-3 ml-auto font-mono text-[11px] tabular-nums">
                                            {limit === null ? "" : `${text.length}/${limit}`}
                                        </span>
                                    </div>
                                    {platform === "reddit" && (
                                        <div className="text-ink mt-2 text-[13px] font-medium">
                                            {firstNonEmpty(title, text.split("\n")[0])}
                                        </div>
                                    )}
                                    <p className="text-ink-2 mt-2 whitespace-pre-wrap break-words text-[13px] leading-[1.45]">
                                        {text ? (
                                            cut ? (
                                                <>
                                                    {text.slice(0, limit ?? undefined)}
                                                    <span className="text-danger bg-danger-soft">
                                                        {text.slice(limit ?? undefined)}
                                                    </span>
                                                </>
                                            ) : (
                                                text
                                            )
                                        ) : (
                                            <span className="text-ink-4">
                                                Your post appears here.
                                            </span>
                                        )}
                                    </p>
                                </div>
                            );
                        })
                    )}
                </aside>
            </div>
        </div>
    );
}

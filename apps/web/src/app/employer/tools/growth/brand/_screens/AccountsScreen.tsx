"use client";

import { ChevronRight, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useToolSearchParams } from "~/components/tool-app/nav";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { useResource } from "~/lib/tools/useResource";
import { cn } from "~/lib/utils";

import { useErrorText } from "~/lib/tools/errorText";
import { useCopyText } from "~/lib/tools/copyText";
import { useGrowthFormat } from "../../_lib/format";
import { ChannelAvatar } from "../_components/ChannelAvatar";
import { NETWORK_LABEL, NetworkMark } from "../_components/NetworkMark";
import {
    byKindThenName,
    capabilityWords,
    groupByNetwork,
    tokenExpiry,
    type Tone,
} from "../_lib/channels";
import {
    LINKEDIN_CONNECT_HREF,
    brandApi,
    type BrandAccounts,
    type BrandChannel,
    type BrandConnection,
    type BrandNetwork,
} from "../api";

const APP_PASSWORDS_URL = "https://bsky.app/settings/app-passwords";
const APP_PASSWORD_PATTERN = "[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}";

/** A dot and a word, in the tone's colour. */
function ToneWord({ tone, children }: { tone: Tone; children: React.ReactNode }) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 text-xs",
                tone === "ok" && "text-ink-2",
                tone === "warn" && "text-warn-ink",
                tone === "danger" && "text-danger"
            )}
        >
            <span
                className={cn(
                    "size-[7px] shrink-0 rounded-full",
                    tone === "ok" && "bg-success",
                    tone === "warn" && "bg-warn",
                    tone === "danger" && "bg-danger"
                )}
            />
            {children}
        </span>
    );
}

type BrandT = ReturnType<typeof useTranslations<"growth.brand">>;

/** "2 Pages · 1 Profile" for a network's heading. */
function kindSummary(t: BrandT, channels: BrandChannel[]): string {
    const counts = new Map<BrandChannel["kind"], number>();
    for (const c of channels) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
    return [...counts.entries()]
        .map(([kind, n]) => t(`kindCounts.${kind}`, { count: n }))
        .join(" · ");
}

// ── Channels ──────────────────────────────────────────────────────────────

function ChannelRow({
    channel,
    canManage,
    onToggle,
}: {
    channel: BrandChannel;
    canManage: boolean;
    onToggle: (channel: BrandChannel, enabled: boolean) => Promise<void>;
}) {
    const t = useTranslations("growth.brand");
    const tChannels = useTranslations("growth.brand.channels");
    const [busy, setBusy] = useState(false);
    const switchId = `brand-channel-${channel.id}`;
    const caps = capabilityWords(tChannels, channel.capabilities);
    return (
        <div className="border-line-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t px-4 py-3 first:border-t-0">
            <ChannelAvatar
                name={channel.name}
                kind={channel.kind}
                avatarUrl={channel.avatarUrl}
                size={32}
                muted={!channel.enabled}
                className="row-span-2"
            />
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span
                    className={cn(
                        "truncate text-[14px] font-medium",
                        channel.enabled ? "text-ink" : "text-ink-2"
                    )}
                >
                    {channel.name}
                </span>
                <span className="text-ink-3 text-xs">{t(`kinds.${channel.kind}`)}</span>
                {channel.handle && channel.handle !== channel.name && (
                    <span className="text-ink-3 truncate font-mono text-[11.5px]">
                        {channel.handle}
                    </span>
                )}
                {channel.profileUrl && (
                    <a
                        href={channel.profileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ink-3 hover:text-ink focus-visible:ring-brand/50 rounded-sm outline-none focus-visible:ring-2"
                        aria-label={t("accounts.openOnNetwork", {
                            name: channel.name,
                            network: NETWORK_LABEL[channel.platform],
                        })}
                    >
                        <ExternalLink className="size-3" aria-hidden />
                    </a>
                )}
            </div>
            <div className="row-span-2 flex items-center gap-2">
                {canManage ? (
                    <>
                        <Label
                            htmlFor={switchId}
                            className="text-ink-2 text-xs font-normal @max-sm:sr-only"
                        >
                            {t("accounts.offerInCompose")}
                        </Label>
                        <Switch
                            id={switchId}
                            checked={channel.enabled}
                            disabled={busy}
                            onCheckedChange={on => {
                                setBusy(true);
                                void onToggle(channel, on).finally(() => setBusy(false));
                            }}
                        />
                    </>
                ) : (
                    <span className="text-ink-3 text-xs">
                        {channel.enabled ? t("accounts.offered") : t("accounts.hidden")}
                    </span>
                )}
            </div>
            <div className="text-ink-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                {channel.status === "reconnect" ? (
                    <ToneWord tone="danger">
                        {channel.statusReason
                            ? t("accounts.reconnectStatusReason", { reason: channel.statusReason })
                            : t("accounts.reconnectStatus")}
                    </ToneWord>
                ) : (
                    <ToneWord tone="ok">{t("accounts.active")}</ToneWord>
                )}
                {channel.followers !== null && (
                    <span className="tabular-nums">
                        {t("accounts.followers", { count: channel.followers })}
                    </span>
                )}
                {caps.length > 0 && <span>{caps.join(" · ")}</span>}
            </div>
        </div>
    );
}

function ChannelsSection({
    channels,
    canManage,
    onToggle,
}: {
    channels: BrandChannel[];
    canManage: boolean;
    onToggle: (channel: BrandChannel, enabled: boolean) => Promise<void>;
}) {
    const t = useTranslations("growth.brand");
    const groups = groupByNetwork(channels, byKindThenName);
    return (
        <section className="flex flex-col gap-5">
            {groups.map(group => (
                <div key={group.platform}>
                    <div className="mb-2 flex items-center gap-2">
                        <NetworkMark platform={group.platform} size={18} />
                        <h2 className="text-ink text-[13px] font-semibold">
                            {NETWORK_LABEL[group.platform]}
                        </h2>
                        <span className="text-ink-3 text-xs">{kindSummary(t, group.items)}</span>
                    </div>
                    <div className="border-line bg-panel rounded-lg border">
                        {group.items.map(channel => (
                            <ChannelRow
                                key={channel.id}
                                channel={channel}
                                canManage={canManage}
                                onToggle={onToggle}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </section>
    );
}

// ── Connections ───────────────────────────────────────────────────────────

function ConnectionRow({
    connection,
    channels,
    canManage,
    onRefresh,
    onDisconnect,
    onReconnectBluesky,
}: {
    connection: BrandConnection;
    channels: BrandChannel[];
    canManage: boolean;
    onRefresh: (connection: BrandConnection) => Promise<void>;
    onDisconnect: (connection: BrandConnection) => void;
    onReconnectBluesky: (connection: BrandConnection) => void;
}) {
    const t = useTranslations("growth.brand.accounts");
    const tChannels = useTranslations("growth.brand.channels");
    const tc = useTranslations("common.actions");
    const { shortDate, joinNatural } = useGrowthFormat();
    const [refreshing, setRefreshing] = useState(false);
    const expiry = tokenExpiry(tChannels, connection);
    const mine = channels.filter(c => c.connectionId === connection.id);
    const broken = connection.status === "revoked" || mine.some(c => c.status === "reconnect");
    const isLinkedIn = connection.platform === "linkedin";
    return (
        <div className="border-line-2 flex flex-col gap-2 border-t px-4 py-3 first:border-t-0">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 @max-md:grid-cols-[auto_minmax(0,1fr)]">
                <NetworkMark platform={connection.platform} size={22} />
                <div className="min-w-0">
                    <div className="text-ink truncate text-[14px] font-medium">
                        {connection.accountName ?? NETWORK_LABEL[connection.platform]}
                    </div>
                    <div className="text-ink-3 truncate text-xs">
                        {NETWORK_LABEL[connection.platform]} ·{" "}
                        {connection.connectedBy
                            ? t("connectedBy", {
                                  name: connection.connectedBy,
                                  date: shortDate(connection.connectedAt),
                              })
                            : t("connectedOn", { date: shortDate(connection.connectedAt) })}
                        {mine.length > 0 && ` · ${joinNatural(mine.map(c => c.name))}`}
                    </div>
                </div>
                <div className="@max-md:col-start-2">
                    {connection.status === "revoked" ? (
                        <ToneWord tone="danger">
                            {t("signedOutBy", { network: NETWORK_LABEL[connection.platform] })}
                        </ToneWord>
                    ) : (
                        <ToneWord tone={expiry.tone}>{expiry.word}</ToneWord>
                    )}
                </div>
                {canManage && (
                    <div className="flex flex-wrap items-center gap-1.5 @max-md:col-start-2">
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={refreshing || connection.status === "revoked"}
                            onClick={() => {
                                setRefreshing(true);
                                void onRefresh(connection).finally(() => setRefreshing(false));
                            }}
                        >
                            {refreshing
                                ? t("checking")
                                : isLinkedIn
                                  ? t("refreshPages")
                                  : t("refreshProfile")}
                        </Button>
                        {isLinkedIn ? (
                            <Button asChild size="sm" variant={broken ? "default" : "outline"}>
                                <a href={LINKEDIN_CONNECT_HREF}>{t("reconnect")}</a>
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                variant={broken ? "default" : "outline"}
                                onClick={() => onReconnectBluesky(connection)}
                            >
                                {t("reconnect")}
                            </Button>
                        )}
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger hover:text-danger"
                            onClick={() => onDisconnect(connection)}
                        >
                            {tc("disconnect")}
                        </Button>
                    </div>
                )}
            </div>
            {connection.error && (
                <p className="text-danger pl-[34px] text-xs">{connection.error}</p>
            )}
            <div className="pl-[34px]">
                {connection.scopes.length > 0 ? (
                    <Collapsible>
                        <CollapsibleTrigger className="text-ink-3 hover:text-ink focus-visible:ring-brand/50 group inline-flex items-center gap-1 rounded-sm text-xs outline-none focus-visible:ring-2">
                            <ChevronRight
                                className="size-3 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
                                aria-hidden
                            />
                            {t("permissionsGranted", { count: connection.scopes.length })}
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <ul className="mt-1.5 flex flex-wrap gap-1">
                                {connection.scopes.map(scope => (
                                    <li
                                        key={scope}
                                        className="border-line text-ink-2 rounded-md border px-1.5 py-0.5 font-mono text-[11px]"
                                    >
                                        {scope}
                                    </li>
                                ))}
                            </ul>
                        </CollapsibleContent>
                    </Collapsible>
                ) : (
                    <span className="text-ink-3 text-xs">
                        {connection.platform === "bluesky"
                            ? t("appPasswordSignIn")
                            : t("noPermissions")}
                    </span>
                )}
            </div>
        </div>
    );
}

// ── Connect ───────────────────────────────────────────────────────────────

function SetupSteps({ network }: { network: BrandNetwork }) {
    const word = useCopyText();
    return (
        <div className="flex flex-col gap-1.5">
            {network.setup.length > 0 && (
                <ol className="text-ink-2 list-decimal space-y-0.5 pl-5 text-[13px]">
                    {network.setup.map((step, i) => (
                        <li key={step}>{word(network.setupCopy?.[i], step)}</li>
                    ))}
                </ol>
            )}
            <p className="text-ink-3 text-xs">{word(network.noteCopy, network.note)}</p>
        </div>
    );
}

function BlueskyForm({
    handleRef,
    handle,
    setHandle,
    primary,
    onConnected,
}: {
    handleRef: React.RefObject<HTMLInputElement | null>;
    handle: string;
    setHandle: (v: string) => void;
    primary: boolean;
    onConnected: (handle: string) => Promise<void>;
}) {
    const t = useTranslations("growth.brand.accounts");
    const errorText = useErrorText();
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        if (!new RegExp(`^${APP_PASSWORD_PATTERN}$`).test(password.trim())) {
            setError(t("notAppPassword"));
            return;
        }
        setBusy(true);
        try {
            const result = await brandApi.connectBluesky({
                identifier: handle.trim().replace(/^@/, ""),
                appPassword: password.trim(),
            });
            setPassword("");
            setHandle("");
            await onConnected(result.connection.accountName ?? handle.trim());
        } catch (e) {
            setError(errorText(e, t("blueskyRefused")));
        } finally {
            setBusy(false);
        }
    };
    return (
        <form onSubmit={e => void submit(e)} className="flex flex-col gap-2" noValidate>
            <div className="grid grid-cols-2 gap-2 @max-md:grid-cols-1">
                <div>
                    <Label htmlFor="bsky-handle" className="text-ink-3 text-xs font-normal">
                        {t("handle")}
                    </Label>
                    <Input
                        id="bsky-handle"
                        ref={handleRef}
                        value={handle}
                        onChange={e => setHandle(e.target.value)}
                        placeholder="yourcompany.bsky.social"
                        autoComplete="username"
                        required
                        className="mt-1 h-8 text-[13px]"
                    />
                </div>
                <div>
                    <Label htmlFor="bsky-password" className="text-ink-3 text-xs font-normal">
                        {t("appPassword")}
                    </Label>
                    <Input
                        id="bsky-password"
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="xxxx-xxxx-xxxx-xxxx"
                        pattern={APP_PASSWORD_PATTERN}
                        title={t("patternTitle")}
                        autoComplete="off"
                        required
                        aria-invalid={error ? true : undefined}
                        aria-describedby="bsky-help"
                        className="mt-1 h-8 font-mono text-[13px]"
                    />
                </div>
            </div>
            <p id="bsky-help" className="text-ink-3 text-xs">
                {t.rich("passwordHelp", {
                    link: chunks => (
                        <a
                            href={APP_PASSWORDS_URL}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand-ink focus-visible:ring-brand/50 rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2"
                        >
                            {chunks}
                        </a>
                    ),
                })}
            </p>
            <div className="flex flex-wrap items-center gap-3">
                <Button
                    type="submit"
                    size="sm"
                    variant={primary ? "default" : "outline"}
                    disabled={busy || !handle.trim() || !password.trim()}
                >
                    {busy ? t("signingIn") : t("connectBluesky")}
                </Button>
                {error && (
                    <span role="alert" className="text-danger text-xs">
                        {error}
                    </span>
                )}
            </div>
        </form>
    );
}

function ConnectRow({ network, children }: { network: BrandNetwork; children: React.ReactNode }) {
    const t = useTranslations("growth.brand.accounts");
    return (
        <div className="border-line-2 grid grid-cols-[200px_minmax(0,1fr)] gap-3 border-t px-4 py-4 first:border-t-0 @max-md:grid-cols-1">
            {/* The mark sits on the name's line, and the status lines hang under the
                name (indented by the mark's width), so every network's tile, name and
                status start at the same x and the first line meets the description. */}
            <div className="min-w-0">
                <div className="flex h-6 items-center gap-2.5">
                    <NetworkMark platform={network.platform} size={24} muted={!network.available} />
                    <div className="text-ink truncate text-[14px] font-medium">{network.label}</div>
                </div>
                <div className="pl-[34px]">
                    <div className="mt-1">
                        {network.available ? (
                            <ToneWord tone="ok">
                                {network.connect === "deployment" ? t("setUp") : t("available")}
                            </ToneWord>
                        ) : (
                            <span className="text-ink-3 inline-flex items-center gap-1.5 text-xs">
                                <span className="border-line size-[7px] rounded-full border" />
                                {t("notSetUp")}
                            </span>
                        )}
                    </div>
                    <div className="text-ink-3 mt-1 font-mono text-[11.5px] tabular-nums">
                        {network.limit === null
                            ? t("noLimit")
                            : t("characters", { count: network.limit })}
                    </div>
                </div>
            </div>
            <div className="min-w-0 pt-0.5 text-[13px]">{children}</div>
        </div>
    );
}

// ── Screen ────────────────────────────────────────────────────────────────

/**
 * Where a workspace connects its own accounts. Channels (the places posts go
 * out as) come first, grouped by network, with the admin's switch for which
 * ones Compose offers; then the sign-ins that brought them, with how long
 * each lasts; then how to connect more. Members read all of it; admins
 * change it.
 */
/**
 * What a LinkedIn sign-in that came back without channels to post to means:
 * the callback's code → `accounts.connectProblems.<key>`.
 */
const CONNECT_PROBLEMS = new Map<string, "denied" | "error" | "partial" | "noChannels">([
    ["denied", "denied"],
    ["error", "error"],
    ["partial", "partial"],
    ["no-channels", "noChannels"],
]);

export function AccountsScreen() {
    const t = useTranslations("growth.brand.accounts");
    const word = useCopyText();
    const errorText = useErrorText();
    const tc = useTranslations("common.actions");
    const { joinNatural } = useGrowthFormat();
    const params = useToolSearchParams();
    const res = useResource("brand:accounts", () => brandApi.accounts());
    const data = res.data;
    const [pendingDisconnect, setPendingDisconnect] = useState<BrandConnection | null>(null);
    const [blueskyHandle, setBlueskyHandle] = useState("");
    const blueskyRef = useRef<HTMLInputElement>(null);
    // A LinkedIn sign-in that came back without channels says why here (the
    // callback sends a code; the words are ours). The workspace's own toast
    // covers the clean "connected" return.
    const problem = CONNECT_PROBLEMS.get(params.get("connect") ?? "");
    const returnError = problem ? t(`connectProblems.${problem}`) : null;

    const setAccounts = (update: (current: BrandAccounts) => BrandAccounts) => res.mutate(update);

    const toggle = async (channel: BrandChannel, enabled: boolean) => {
        const swap = (on: boolean) =>
            setAccounts(a => ({
                ...a,
                channels: a.channels.map(c => (c.id === channel.id ? { ...c, enabled: on } : c)),
            }));
        swap(enabled);
        try {
            await brandApi.setChannelEnabled(channel.id, enabled);
            toast(
                enabled
                    ? t("offeredToast", { name: channel.name })
                    : t("hiddenToast", { name: channel.name })
            );
        } catch (e) {
            swap(!enabled);
            toast.error(errorText(e, t("changeFailed", { name: channel.name })));
        }
    };

    const refresh = async (connection: BrandConnection) => {
        const before = new Set(
            (data?.channels ?? []).filter(c => c.connectionId === connection.id).map(c => c.id)
        );
        try {
            const result = await brandApi.refreshConnection(connection.id);
            const added = result.channels.filter(c => !before.has(c.id));
            const names = joinNatural(added.map(c => c.name));
            toast.success(
                added.length > 0
                    ? connection.platform === "linkedin"
                        ? t("foundPages", { count: added.length, names })
                        : t("foundAccounts", { count: added.length, names })
                    : t("upToDate", {
                          name: connection.accountName ?? NETWORK_LABEL[connection.platform],
                      })
            );
            await res.reload();
        } catch (e) {
            toast.error(errorText(e, t("unreachable")));
        }
    };

    const disconnect = async (connection: BrandConnection) => {
        try {
            await brandApi.disconnect(connection.id);
            toast(
                t("disconnected", {
                    name: connection.accountName ?? NETWORK_LABEL[connection.platform],
                })
            );
            await res.reload();
        } catch (e) {
            toast.error(errorText(e, t("disconnectFailed")));
        }
    };

    const focusBluesky = (handle?: string) => {
        if (handle !== undefined) setBlueskyHandle(handle);
        const input = blueskyRef.current;
        if (!input) return;
        input.scrollIntoView({ block: "center", behavior: "smooth" });
        input.focus();
    };

    const channels = data?.channels ?? [];
    const connections = data?.connections ?? [];
    const networks = data?.networks ?? [];
    const canManage = data?.canManage ?? false;
    const linkedin = networks.find(n => n.platform === "linkedin");
    const hasLinkedIn = connections.some(c => c.platform === "linkedin");
    const hasBluesky = connections.some(c => c.platform === "bluesky");
    // One primary action. With nothing connected the empty state carries it;
    // otherwise it is connecting LinkedIn while there is none, else Bluesky.
    const empty = channels.length === 0;
    const linkedInAvailable = Boolean(linkedin?.available && canManage);
    const linkedInPrimary = linkedInAvailable && !hasLinkedIn && !empty;
    const blueskyPrimary = !linkedInPrimary && !hasBluesky && !(empty && linkedInAvailable);

    const pendingChannels = pendingDisconnect
        ? channels.filter(c => c.connectionId === pendingDisconnect.id)
        : [];

    return (
        <div className="mx-auto flex max-w-[1000px] flex-col gap-7">
            <PageHeader
                size="md"
                title={t("title")}
                sub={
                    data
                        ? canManage
                            ? channels.length > 0
                                ? t("subChannels", { count: channels.length })
                                : t("subConnect")
                            : t("subAskAdmin")
                        : undefined
                }
            />
            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
            {returnError && <InlineError message={returnError} />}

            {res.loading ? (
                <SkeletonRows rows={4} height={64} />
            ) : data ? (
                <>
                    {channels.length === 0 ? (
                        <EmptyState
                            title={t("empty")}
                            body={canManage ? t("emptyBodyManage") : t("emptyBodyAsk")}
                            action={
                                canManage ? (
                                    linkedin?.available ? (
                                        <Button asChild size="sm">
                                            <a href={LINKEDIN_CONNECT_HREF}>
                                                {t("connectLinkedIn")}
                                            </a>
                                        </Button>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => focusBluesky()}
                                        >
                                            {t("connectBluesky")}
                                        </Button>
                                    )
                                ) : undefined
                            }
                        />
                    ) : (
                        <ChannelsSection
                            channels={channels}
                            canManage={canManage}
                            onToggle={toggle}
                        />
                    )}

                    {connections.length > 0 && (
                        <section>
                            <SectionHeading
                                title={t("connections")}
                                aside={t("connectionsAside")}
                            />
                            <div className="border-line bg-panel rounded-lg border">
                                {connections.map(connection => (
                                    <ConnectionRow
                                        key={connection.id}
                                        connection={connection}
                                        channels={channels}
                                        canManage={canManage}
                                        onRefresh={refresh}
                                        onDisconnect={setPendingDisconnect}
                                        onReconnectBluesky={c =>
                                            focusBluesky(c.accountName ?? undefined)
                                        }
                                    />
                                ))}
                            </div>
                        </section>
                    )}

                    <section>
                        <SectionHeading title={t("connect")} aside={t("connectAside")} />
                        <div className="border-line bg-panel rounded-lg border">
                            {networks.map(network => (
                                <ConnectRow key={network.platform} network={network}>
                                    {network.connect === "oauth" ? (
                                        network.available ? (
                                            <div className="flex flex-col gap-2">
                                                <p className="text-ink-2 max-w-[70ch]">
                                                    {network.pages
                                                        ? t("linkedinPages")
                                                        : t("linkedinProfilesOnly")}
                                                </p>
                                                {canManage && (
                                                    <div>
                                                        <Button
                                                            asChild
                                                            size="sm"
                                                            variant={
                                                                linkedInPrimary
                                                                    ? "default"
                                                                    : "outline"
                                                            }
                                                        >
                                                            <a href={LINKEDIN_CONNECT_HREF}>
                                                                {hasLinkedIn
                                                                    ? t("connectAnotherLinkedIn")
                                                                    : t("connectLinkedIn")}
                                                            </a>
                                                        </Button>
                                                    </div>
                                                )}
                                                <p className="text-ink-3 text-xs">
                                                    {word(network.noteCopy, network.note)}
                                                </p>
                                            </div>
                                        ) : (
                                            <SetupSteps network={network} />
                                        )
                                    ) : network.connect === "app-password" ? (
                                        canManage ? (
                                            <div className="flex flex-col gap-2">
                                                <p className="text-ink-2 max-w-[70ch]">
                                                    {t("blueskyIntro")}
                                                </p>
                                                <BlueskyForm
                                                    handleRef={blueskyRef}
                                                    handle={blueskyHandle}
                                                    setHandle={setBlueskyHandle}
                                                    primary={blueskyPrimary}
                                                    onConnected={async handle => {
                                                        toast.success(
                                                            t("connectedBluesky", { handle })
                                                        );
                                                        await res.reload();
                                                    }}
                                                />
                                                <p className="text-ink-3 text-xs">
                                                    {word(network.noteCopy, network.note)}
                                                </p>
                                            </div>
                                        ) : (
                                            <p className="text-ink-2">
                                                {word(network.noteCopy, network.note)}
                                            </p>
                                        )
                                    ) : (
                                        <div className="flex flex-col gap-1.5">
                                            <p className="text-ink-2">
                                                {network.available
                                                    ? t("operatorAvailable")
                                                    : t("operator")}
                                            </p>
                                            <SetupSteps network={network} />
                                        </div>
                                    )}
                                </ConnectRow>
                            ))}
                        </div>
                    </section>
                </>
            ) : null}

            <ConfirmDialog
                open={pendingDisconnect !== null}
                onOpenChange={open => {
                    if (!open) setPendingDisconnect(null);
                }}
                title={t("confirmTitle", {
                    name:
                        pendingDisconnect?.accountName ??
                        (pendingDisconnect ? NETWORK_LABEL[pendingDisconnect.platform] : ""),
                })}
                description={
                    pendingDisconnect
                        ? pendingChannels.length > 0
                            ? `${t("confirmLeaves", {
                                  names: joinNatural(pendingChannels.map(c => c.name)),
                                  count: pendingChannels.length,
                              })} ${t("confirmRest", { count: pendingChannels.length })}`
                            : t("confirmRest", { count: pendingChannels.length })
                        : undefined
                }
                confirmLabel={tc("disconnect")}
                onConfirm={() => {
                    if (pendingDisconnect) void disconnect(pendingDisconnect);
                }}
            />
        </div>
    );
}

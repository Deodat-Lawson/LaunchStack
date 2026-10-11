"use client";

import { ChevronRight, ExternalLink } from "lucide-react";
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
import { joinNatural, plural, shortDate } from "~/lib/tools/format";
import { useResource } from "~/lib/tools/useResource";
import { cn } from "~/lib/utils";

import { ChannelAvatar } from "../_components/ChannelAvatar";
import { NETWORK_LABEL, NetworkMark } from "../_components/NetworkMark";
import {
    KIND_WORD,
    byKindThenName,
    capabilityWords,
    groupByNetwork,
    tokenExpiry,
    type Tone,
} from "../_lib/channels";
import { count } from "../_lib/numbers";
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
                tone === "warn" && "text-warn",
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

/** "2 Pages · 1 Profile" for a network's heading. */
function kindSummary(channels: BrandChannel[]): string {
    const counts = new Map<string, number>();
    for (const c of channels)
        counts.set(KIND_WORD[c.kind], (counts.get(KIND_WORD[c.kind]) ?? 0) + 1);
    return [...counts.entries()].map(([word, n]) => plural(n, word)).join(" · ");
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
    const [busy, setBusy] = useState(false);
    const switchId = `brand-channel-${channel.id}`;
    const caps = capabilityWords(channel.capabilities);
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
                <span className="text-ink-3 text-xs">{KIND_WORD[channel.kind]}</span>
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
                        aria-label={`Open ${channel.name} on ${NETWORK_LABEL[channel.platform]}`}
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
                            className="text-ink-2 @max-sm:sr-only text-xs font-normal"
                        >
                            Offer in Compose
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
                        {channel.enabled ? "Offered in Compose" : "Hidden from Compose"}
                    </span>
                )}
            </div>
            <div className="text-ink-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                {channel.status === "reconnect" ? (
                    <ToneWord tone="danger">
                        Reconnect{channel.statusReason ? ` — ${channel.statusReason}` : ""}
                    </ToneWord>
                ) : (
                    <ToneWord tone="ok">Active</ToneWord>
                )}
                {channel.followers !== null && (
                    <span className="tabular-nums">
                        {count(channel.followers)}{" "}
                        {channel.followers === 1 ? "follower" : "followers"}
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
                        <span className="text-ink-3 text-xs">{kindSummary(group.items)}</span>
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
    const [refreshing, setRefreshing] = useState(false);
    const expiry = tokenExpiry(connection);
    const mine = channels.filter(c => c.connectionId === connection.id);
    const broken = connection.status === "revoked" || mine.some(c => c.status === "reconnect");
    const isLinkedIn = connection.platform === "linkedin";
    return (
        <div className="border-line-2 flex flex-col gap-2 border-t px-4 py-3 first:border-t-0">
            <div className="@max-md:grid-cols-[auto_minmax(0,1fr)] grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2">
                <NetworkMark platform={connection.platform} size={22} />
                <div className="min-w-0">
                    <div className="text-ink truncate text-[14px] font-medium">
                        {connection.accountName ?? NETWORK_LABEL[connection.platform]}
                    </div>
                    <div className="text-ink-3 truncate text-xs">
                        {NETWORK_LABEL[connection.platform]} ·{" "}
                        {connection.connectedBy
                            ? `connected by ${connection.connectedBy} on ${shortDate(connection.connectedAt)}`
                            : `connected ${shortDate(connection.connectedAt)}`}
                        {mine.length > 0 && ` · ${joinNatural(mine.map(c => c.name))}`}
                    </div>
                </div>
                <div className="@max-md:col-start-2">
                    {connection.status === "revoked" ? (
                        <ToneWord tone="danger">
                            Signed out by {NETWORK_LABEL[connection.platform]}
                        </ToneWord>
                    ) : (
                        <ToneWord tone={expiry.tone}>{expiry.word}</ToneWord>
                    )}
                </div>
                {canManage && (
                    <div className="@max-md:col-start-2 flex flex-wrap items-center gap-1.5">
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
                                ? "Checking…"
                                : isLinkedIn
                                  ? "Refresh Pages"
                                  : "Refresh profile"}
                        </Button>
                        {isLinkedIn ? (
                            <Button asChild size="sm" variant={broken ? "default" : "outline"}>
                                <a href={LINKEDIN_CONNECT_HREF}>Reconnect</a>
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                variant={broken ? "default" : "outline"}
                                onClick={() => onReconnectBluesky(connection)}
                            >
                                Reconnect
                            </Button>
                        )}
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger hover:text-danger"
                            onClick={() => onDisconnect(connection)}
                        >
                            Disconnect
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
                            {plural(connection.scopes.length, "permission")} granted
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
                            ? "Signed in with an app password"
                            : "No permissions listed"}
                    </span>
                )}
            </div>
        </div>
    );
}

// ── Connect ───────────────────────────────────────────────────────────────

function SetupSteps({ network }: { network: BrandNetwork }) {
    return (
        <div className="flex flex-col gap-1.5">
            {network.setup.length > 0 && (
                <ol className="text-ink-2 list-decimal space-y-0.5 pl-5 text-[13px]">
                    {network.setup.map(step => (
                        <li key={step}>{step}</li>
                    ))}
                </ol>
            )}
            <p className="text-ink-3 text-xs">{network.note}</p>
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
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        if (!new RegExp(`^${APP_PASSWORD_PATTERN}$`).test(password.trim())) {
            setError(
                "That is not an app password: they look like xxxx-xxxx-xxxx-xxxx. Your account password does not work here."
            );
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
            setError(e instanceof Error ? e.message : "Bluesky did not accept that sign-in");
        } finally {
            setBusy(false);
        }
    };
    return (
        <form onSubmit={e => void submit(e)} className="flex flex-col gap-2" noValidate>
            <div className="@max-md:grid-cols-1 grid grid-cols-2 gap-2">
                <div>
                    <Label htmlFor="bsky-handle" className="text-ink-3 text-xs font-normal">
                        Handle
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
                        App password
                    </Label>
                    <Input
                        id="bsky-password"
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="xxxx-xxxx-xxxx-xxxx"
                        pattern={APP_PASSWORD_PATTERN}
                        title="Four groups of four letters or digits: xxxx-xxxx-xxxx-xxxx"
                        autoComplete="off"
                        required
                        aria-invalid={error ? true : undefined}
                        aria-describedby="bsky-help"
                        className="mt-1 h-8 font-mono text-[13px]"
                    />
                </div>
            </div>
            <p id="bsky-help" className="text-ink-3 text-xs">
                Not your account password.{" "}
                <a
                    href={APP_PASSWORDS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-ink focus-visible:ring-brand/50 rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2"
                >
                    Create an app password in Bluesky › Settings › Privacy and security
                </a>
                .
            </p>
            <div className="flex flex-wrap items-center gap-3">
                <Button
                    type="submit"
                    size="sm"
                    variant={primary ? "default" : "outline"}
                    disabled={busy || !handle.trim() || !password.trim()}
                >
                    {busy ? "Signing in…" : "Connect Bluesky"}
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
    return (
        <div className="border-line-2 @max-md:grid-cols-1 grid grid-cols-[200px_minmax(0,1fr)] gap-3 border-t px-4 py-4 first:border-t-0">
            <div className="flex items-start gap-3">
                <NetworkMark platform={network.platform} size={28} muted={!network.available} />
                <div className="min-w-0">
                    <div className="text-ink text-[14px] font-medium">{network.label}</div>
                    <div className="mt-0.5">
                        {network.available ? (
                            <ToneWord tone="ok">
                                {network.connect === "deployment" ? "Set up" : "Available"}
                            </ToneWord>
                        ) : (
                            <span className="text-ink-3 inline-flex items-center gap-1.5 text-xs">
                                <span className="border-line size-[7px] rounded-full border" />
                                Not set up
                            </span>
                        )}
                    </div>
                    <div className="text-ink-3 mt-1 font-mono text-[11.5px] tabular-nums">
                        {network.limit === null
                            ? "no hard limit"
                            : `${count(network.limit)} characters`}
                    </div>
                </div>
            </div>
            <div className="min-w-0 text-[13px]">{children}</div>
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
/** What a LinkedIn sign-in that came back without channels to post to means. */
const CONNECT_PROBLEMS = new Map<string, string>([
    ["denied", "The LinkedIn sign-in was cancelled, so nothing was connected."],
    [
        "error",
        "LinkedIn did not complete the sign-in. Try again; if it keeps failing, check the app's redirect URL and LINKEDIN_OAUTH_SCOPES against its Auth tab.",
    ],
    ["partial", "LinkedIn is connected, but its Pages could not be read. Use Refresh Pages below."],
    [
        "no-channels",
        "LinkedIn is connected, but the sign-in gave no permission to post. Check LINKEDIN_OAUTH_SCOPES against the app's Auth tab.",
    ],
]);

export function AccountsScreen() {
    const params = useToolSearchParams();
    const res = useResource("brand:accounts", () => brandApi.accounts());
    const data = res.data;
    const [pendingDisconnect, setPendingDisconnect] = useState<BrandConnection | null>(null);
    const [blueskyHandle, setBlueskyHandle] = useState("");
    const blueskyRef = useRef<HTMLInputElement>(null);
    // A LinkedIn sign-in that came back without channels says why here (the
    // callback sends a code; the words are ours). The workspace's own toast
    // covers the clean "connected" return.
    const returnError = CONNECT_PROBLEMS.get(params.get("connect") ?? "") ?? null;

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
                    ? `${channel.name} is offered in Compose`
                    : `${channel.name} is hidden from Compose`
            );
        } catch (e) {
            swap(!enabled);
            toast.error(e instanceof Error ? e.message : `Could not change ${channel.name}`);
        }
    };

    const refresh = async (connection: BrandConnection) => {
        const before = new Set(
            (data?.channels ?? []).filter(c => c.connectionId === connection.id).map(c => c.id)
        );
        try {
            const result = await brandApi.refreshConnection(connection.id);
            const added = result.channels.filter(c => !before.has(c.id));
            const what = connection.platform === "linkedin" ? "Page" : "account";
            toast.success(
                added.length > 0
                    ? `Found ${plural(added.length, `new ${what}`)}: ${joinNatural(added.map(c => c.name))}`
                    : `${connection.accountName ?? NETWORK_LABEL[connection.platform]} is up to date`
            );
            await res.reload();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not reach the network");
        }
    };

    const disconnect = async (connection: BrandConnection) => {
        try {
            await brandApi.disconnect(connection.id);
            toast(`Disconnected ${connection.accountName ?? NETWORK_LABEL[connection.platform]}`);
            await res.reload();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not disconnect");
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
                title="Accounts"
                sub={
                    data
                        ? canManage
                            ? channels.length > 0
                                ? `Posts go out as these ${plural(channels.length, "channel")}. Switch off the ones nobody posts to and Compose stops offering them.`
                                : "Connect the accounts this workspace posts as."
                            : "Ask a workspace admin to connect accounts."
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
                            title="No accounts connected yet"
                            body={
                                canManage
                                    ? "Brand posts go out as a LinkedIn Page or profile, or a Bluesky account. Connect one and Compose, the calendar and analytics start working."
                                    : "Brand posts go out as a LinkedIn Page or profile, or a Bluesky account. Ask a workspace admin to connect accounts."
                            }
                            action={
                                canManage ? (
                                    linkedin?.available ? (
                                        <Button asChild size="sm">
                                            <a href={LINKEDIN_CONNECT_HREF}>Connect LinkedIn</a>
                                        </Button>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => focusBluesky()}
                                        >
                                            Connect Bluesky
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
                                title="Connections"
                                aside="Who signed in, and how long it lasts"
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
                        <SectionHeading title="Connect" aside="Networks on this deployment" />
                        <div className="border-line bg-panel rounded-lg border">
                            {networks.map(network => (
                                <ConnectRow key={network.platform} network={network}>
                                    {network.connect === "oauth" ? (
                                        network.available ? (
                                            <div className="flex flex-col gap-2">
                                                <p className="text-ink-2 max-w-[70ch]">
                                                    {network.pages
                                                        ? "Signs in as a LinkedIn member and brings their profile and every Page they administer. LinkedIn asks the member to approve; the sign-in renews itself for up to a year."
                                                        : "This deployment's LinkedIn app covers profiles only; Pages need the Community Management API."}
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
                                                                    ? "Connect another LinkedIn member"
                                                                    : "Connect LinkedIn"}
                                                            </a>
                                                        </Button>
                                                    </div>
                                                )}
                                                <p className="text-ink-3 text-xs">{network.note}</p>
                                            </div>
                                        ) : (
                                            <SetupSteps network={network} />
                                        )
                                    ) : network.connect === "app-password" ? (
                                        canManage ? (
                                            <div className="flex flex-col gap-2">
                                                <p className="text-ink-2 max-w-[70ch]">
                                                    Signs in with the account&apos;s handle and an
                                                    app password, which can be revoked in Bluesky at
                                                    any time.
                                                </p>
                                                <BlueskyForm
                                                    handleRef={blueskyRef}
                                                    handle={blueskyHandle}
                                                    setHandle={setBlueskyHandle}
                                                    primary={blueskyPrimary}
                                                    onConnected={async handle => {
                                                        toast.success(
                                                            `Connected Bluesky as ${handle}`
                                                        );
                                                        await res.reload();
                                                    }}
                                                />
                                                <p className="text-ink-3 text-xs">{network.note}</p>
                                            </div>
                                        ) : (
                                            <p className="text-ink-2">{network.note}</p>
                                        )
                                    ) : (
                                        <div className="flex flex-col gap-1.5">
                                            <p className="text-ink-2">
                                                Set by the operator for the whole deployment
                                                {network.available
                                                    ? ": every workspace can post as it."
                                                    : "."}
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
                title={`Disconnect ${pendingDisconnect?.accountName ?? (pendingDisconnect ? NETWORK_LABEL[pendingDisconnect.platform] : "")}?`}
                description={
                    pendingDisconnect
                        ? `${pendingChannels.length > 0 ? `${joinNatural(pendingChannels.map(c => c.name))} ${pendingChannels.length === 1 ? "leaves" : "leave"} Compose. ` : ""}Posts scheduled on ${pendingChannels.length === 1 ? "it" : "them"} will fail until someone reconnects. Published posts stay on the calendar.`
                        : undefined
                }
                confirmLabel="Disconnect"
                onConfirm={() => {
                    if (pendingDisconnect) void disconnect(pendingDisconnect);
                }}
            />
        </div>
    );
}

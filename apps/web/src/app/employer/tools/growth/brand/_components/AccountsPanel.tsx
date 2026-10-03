"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";

import { InlineError } from "../../_components/EmptyState";
import { Panel } from "../../_components/Panel";
import { SkeletonRows } from "../../_components/SkeletonRows";
import { shortDate } from "../../_lib/format";
import { NetworkMark } from "./NetworkMark";
import { brandApi, type BrandAccount } from "../api";

/** Status as a dot and a word, with where the credential comes from. */
function AccountStatus({ account }: { account: BrandAccount }) {
    const scopeWord =
        account.scope === "workspace"
            ? "this workspace"
            : account.scope === "deployment"
              ? "deployment-wide (from the server's environment)"
              : null;
    return (
        <div className="mt-0.5 flex flex-col gap-0.5 text-xs">
            <div
                className={cn(
                    "inline-flex flex-wrap items-center gap-1.5",
                    account.status === "connected" && "text-ink-2",
                    account.status === "revoked" && "text-danger",
                    account.status === "not_connected" && "text-ink-3"
                )}
            >
                <span
                    className={cn(
                        "size-[7px] shrink-0 rounded-full",
                        account.status === "connected" && "bg-success",
                        account.status === "revoked" && "bg-danger",
                        account.status === "not_connected" && "border-line border"
                    )}
                />
                {account.status === "connected" && "Connected"}
                {account.status === "revoked" && "Needs reconnecting"}
                {account.status === "not_connected" && "Not connected"}
                {account.status !== "not_connected" && scopeWord && (
                    <span className="text-ink-3">· {scopeWord}</span>
                )}
                {account.status === "connected" && account.connectedAt && (
                    <span className="text-ink-3">· since {shortDate(account.connectedAt)}</span>
                )}
            </div>
            {account.identity && (
                <div className="text-ink-3 truncate font-mono text-[11.5px]">
                    {account.identity}
                </div>
            )}
            {account.status === "revoked" && account.lastError && (
                <p className="text-danger max-w-[60ch]">{account.lastError}</p>
            )}
        </div>
    );
}

/** One network: its status, the connect form, and what connecting takes. */
function NetworkBlock({ account, onChanged }: { account: BrandAccount; onChanged: () => void }) {
    const [formOpen, setFormOpen] = useState(account.status === "revoked");
    const [values, setValues] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmDisconnect, setConfirmDisconnect] = useState(false);

    const complete = account.fields.every(f => (values[f.key] ?? "").trim().length > 0);
    const verb = account.status === "not_connected" ? "Connect" : "Reconnect";

    const connect = async () => {
        if (!complete || busy) return;
        setBusy(true);
        setError(null);
        try {
            const trimmed: Record<string, string> = {};
            for (const f of account.fields) trimmed[f.key] = (values[f.key] ?? "").trim();
            const { account: next } = await brandApi.connect(account.platform, trimmed);
            toast.success(
                next.identity
                    ? `Connected ${next.label} as ${next.identity}`
                    : `Connected ${next.label}`
            );
            setValues({});
            setFormOpen(false);
            onChanged();
        } catch (e) {
            setError(e instanceof Error ? e.message : "The network did not accept the values");
        } finally {
            setBusy(false);
        }
    };

    const disconnect = async () => {
        setBusy(true);
        try {
            await brandApi.disconnect(account.platform);
            toast(`Disconnected ${account.label}`);
            onChanged();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not disconnect");
        } finally {
            setBusy(false);
        }
    };

    return (
        <section
            className="border-line-2 flex flex-col gap-3 border-t px-4 py-4 first:border-t-0"
            aria-label={account.label}
        >
            <div className="flex items-start gap-3">
                <NetworkMark platform={account.platform} size={28} muted={!account.configured} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                        <h3 className="text-ink text-[14px] font-medium">{account.label}</h3>
                        <span className="text-ink-3 shrink-0 font-mono text-[11.5px] tabular-nums">
                            {account.limit === null
                                ? "no hard limit"
                                : `${account.limit.toLocaleString()} characters`}
                        </span>
                    </div>
                    <AccountStatus account={account} />
                </div>
            </div>

            <Collapsible open={formOpen} onOpenChange={setFormOpen}>
                <div className="flex flex-wrap items-center gap-2">
                    <CollapsibleTrigger asChild>
                        <Button size="sm" variant="outline">
                            {verb}
                            <ChevronDown
                                className={cn(
                                    "size-3.5 transition-transform motion-reduce:transition-none",
                                    formOpen && "rotate-180"
                                )}
                            />
                        </Button>
                    </CollapsibleTrigger>
                    {account.scope === "workspace" && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger hover:text-danger"
                            disabled={busy}
                            onClick={() => setConfirmDisconnect(true)}
                        >
                            Disconnect
                        </Button>
                    )}
                </div>
                <CollapsibleContent>
                    <form
                        className="border-line bg-surface mt-3 flex flex-col gap-3 rounded-lg border p-3"
                        onSubmit={e => {
                            e.preventDefault();
                            void connect();
                        }}
                    >
                        {account.fields.map(field => {
                            const id = `brand-account-${account.platform}-${field.key}`;
                            return (
                                <div key={field.key}>
                                    <Label htmlFor={id} className="text-ink-3 text-xs font-normal">
                                        {field.label}
                                    </Label>
                                    <Input
                                        id={id}
                                        type={field.secret ? "password" : "text"}
                                        autoComplete={field.secret ? "new-password" : "off"}
                                        spellCheck={false}
                                        placeholder={field.placeholder}
                                        value={values[field.key] ?? ""}
                                        onChange={e =>
                                            setValues(current => ({
                                                ...current,
                                                [field.key]: e.target.value,
                                            }))
                                        }
                                        className={cn(
                                            "mt-1.5 h-8 text-[13px]",
                                            !field.secret && "font-mono"
                                        )}
                                        aria-invalid={error ? true : undefined}
                                    />
                                    {field.hint && (
                                        <p className="text-ink-3 mt-1 text-xs">{field.hint}</p>
                                    )}
                                </div>
                            );
                        })}
                        <div className="flex flex-wrap items-center gap-3">
                            <Button size="sm" type="submit" disabled={!complete || busy}>
                                {busy ? "Checking…" : "Connect"}
                            </Button>
                            {error && (
                                <span role="alert" className="text-danger text-xs">
                                    {error}
                                </span>
                            )}
                        </div>
                    </form>
                </CollapsibleContent>
            </Collapsible>

            <div className="text-[13px]">
                <div className="text-ink-3 text-xs">
                    {account.status === "connected" ? "Connected with" : "To connect"}
                </div>
                <ol className="text-ink-2 mt-1 list-decimal space-y-0.5 pl-5">
                    {account.requires.map(step => (
                        <li key={step}>{step}</li>
                    ))}
                </ol>
                <p className="text-ink-3 mt-2 max-w-[60ch] text-xs">{account.note}</p>
            </div>

            <ConfirmDialog
                open={confirmDisconnect}
                onOpenChange={setConfirmDisconnect}
                title={`Disconnect ${account.label}?`}
                description="The credential is forgotten here; nothing changes at the network. Scheduled posts to it fail until it is connected again."
                confirmLabel="Disconnect"
                onConfirm={() => void disconnect()}
            />
        </section>
    );
}

/**
 * Where posts go, and whose account they go from. One block per network:
 * the status, a form to connect or reconnect, and what connecting takes.
 */
export function AccountsPanel({
    open,
    onOpenChange,
    accounts,
    loading,
    error,
    onRetry,
    onChanged,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    accounts: BrandAccount[] | null;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    onChanged: () => void;
}) {
    const list = accounts ?? [];
    const connected = list.filter(a => a.configured).length;
    return (
        <Panel
            open={open}
            onOpenChange={onOpenChange}
            size="md"
            title="Accounts"
            description="Where posts go, and whose account they go from."
            header={
                accounts ? (
                    <p className="text-ink-3 text-xs tabular-nums">
                        {connected} of {list.length} networks connected. A workspace connection wins
                        over one set in the server&apos;s environment.
                    </p>
                ) : undefined
            }
        >
            {error && <InlineError message={error} onRetry={onRetry} className="mb-4" />}
            {loading && !accounts ? (
                <SkeletonRows rows={4} height={120} />
            ) : (
                <div className="border-line bg-panel rounded-lg border">
                    {list.map(account => (
                        <NetworkBlock
                            key={account.platform}
                            account={account}
                            onChanged={onChanged}
                        />
                    ))}
                </div>
            )}
        </Panel>
    );
}

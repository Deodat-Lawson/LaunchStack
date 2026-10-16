"use client";

/**
 * Assistants (MCP) — connect Claude, ChatGPT and Gemini to this workspace.
 *
 * Body only, mounted in Account: everything here is the viewer's own, and
 * Account is the one section every member can open (Integrations is for
 * `connectors.manage`). The server URL with per-assistant steps, the
 * assistants this person has connected here, and their access keys. Each
 * connection and key acts as them, in this workspace only, and can never see
 * more than they can.
 *
 * The workspace's hand-made OAuth clients (Gemini Enterprise) are policy, not
 * personal, so they live in Integrations: `AssistantOAuthClients`.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Check, Copy, Plus } from "lucide-react";
import { toast } from "sonner";

import { Field, TextInput } from "~/components/field";
import { Card, Section } from "~/components/layout/page-shell";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { cn } from "~/lib/utils";

import { relativeTime } from "./people/format";

// ---------------------------------------------------------------------------
// The API's shapes (GET /api/assistants)
// ---------------------------------------------------------------------------

export type McpOffReason = "disabled" | "no-base-url" | "insecure-base-url";

export type McpAvailabilityView =
    | { enabled: true; serverUrl: string }
    | { enabled: false; reason: McpOffReason };

interface ConnectionView {
    clientId: string;
    name: string;
    scopes: string[];
    connectedAt: string | null;
    lastActiveAt: string | null;
}

type KeyAccess = "read" | "read-write";

interface AccessKeyView {
    id: number;
    name: string;
    displayPrefix: string;
    access: KeyAccess;
    createdAt: string;
    lastUsedAt: string | null;
}

interface AssistantsOverview {
    availability: McpAvailabilityView;
    connections: ConnectionView[];
    keys: AccessKeyView[];
    canSave: boolean;
    canManageClients: boolean;
}

const WRITE_SCOPE = "launchstack:write";

/** Why assistants can't connect, in words a member can act on. */
export const MCP_OFF_REASONS: Record<McpOffReason, string> = {
    disabled:
        "The assistant server is turned off on this LaunchStack server. Ask whoever runs it to turn it on (MCP_SERVER_ENABLED).",
    "no-base-url":
        "This LaunchStack server doesn't know its own web address, so assistants can't sign in. Ask whoever runs it to set BETTER_AUTH_URL.",
    "insecure-base-url":
        "Assistants can only sign in to a LaunchStack server reached over HTTPS. This one's address is plain HTTP; ask whoever runs it to serve it over HTTPS.",
};

const ACCESS_LABEL: Record<KeyAccess, string> = {
    read: "Search and read",
    "read-write": "Search, read and save conversations",
};

async function errorMessage(res: Response, fallback: string): Promise<string> {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return typeof body?.error === "string" && body.error ? body.error : fallback;
}

// ---------------------------------------------------------------------------
// Shared pieces (also used by AssistantOAuthClients)
// ---------------------------------------------------------------------------

export function CopyButton({ value, label }: { value: string; label: string }) {
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 1600);
        return () => clearTimeout(timer);
    }, [copied]);
    return (
        <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`Copy ${label}`}
            onClick={() => {
                void navigator.clipboard
                    ?.writeText(value)
                    .then(() => setCopied(true))
                    .catch(() =>
                        toast.error("Couldn't copy. Select the text and copy it yourself.")
                    );
            }}
        >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
        </Button>
    );
}

/** A value to paste somewhere else: monospaced, wraps anywhere, with a copy button. */
export function CopyField({
    value,
    label,
    className,
}: {
    value: string;
    /** What is copied, for the button's accessible name ("server URL"). */
    label: string;
    className?: string;
}) {
    return (
        <div className={cn("flex items-start gap-2", className)}>
            <code className="border-line bg-panel-2 text-ink-2 min-w-0 flex-1 select-all whitespace-pre-wrap rounded-lg border px-3 py-[7px] font-mono text-[12px] leading-[18px] [overflow-wrap:anywhere]">
                {value}
            </code>
            <CopyButton value={value} label={label} />
        </div>
    );
}

/** One labelled CopyField, for lists of values to paste (endpoints, IDs). */
export function CopyRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="mb-3 last:mb-0">
            <div className="text-ink-2 mb-1.5 text-xs font-semibold">{label}</div>
            <CopyField value={value} label={label.toLowerCase()} />
        </div>
    );
}

export function OffNote({ reason }: { reason: McpOffReason }) {
    return (
        <div
            role="status"
            className="border-warn/30 bg-warn-soft text-ink-2 rounded-[10px] border px-3.5 py-2.5 text-[13px] leading-normal"
        >
            {MCP_OFF_REASONS[reason]}
        </div>
    );
}

function AccessBadge({ write }: { write: boolean }) {
    return (
        <Badge variant={write ? "info" : "secondary"}>
            {write ? "Read and save" : "Read only"}
        </Badge>
    );
}

const listRow = (index: number) =>
    cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3",
        index > 0 && "border-line border-t"
    );

// ---------------------------------------------------------------------------
// Connect an assistant
// ---------------------------------------------------------------------------

const ASSISTANTS = [
    { id: "claude", label: "Claude" },
    { id: "chatgpt", label: "ChatGPT" },
    { id: "gemini", label: "Gemini Enterprise" },
    { id: "claude-code", label: "Claude Code" },
    { id: "codex", label: "Codex CLI" },
    { id: "gemini-cli", label: "Gemini CLI" },
    { id: "api", label: "Scripts and APIs" },
] as const;

function Steps({ children }: { children: React.ReactNode }) {
    return (
        <ol className="text-ink-2 m-0 list-decimal space-y-2 pl-5 text-[13px] leading-relaxed">
            {children}
        </ol>
    );
}

function Note({ children }: { children: React.ReactNode }) {
    return <p className="text-ink-3 m-0 mt-3 text-[12px] leading-normal">{children}</p>;
}

function Menu({ children }: { children: React.ReactNode }) {
    return <strong className="text-ink font-semibold">{children}</strong>;
}

function ConnectSteps({ url, canManageClients }: { url: string; canManageClients: boolean }) {
    return (
        <Tabs defaultValue="claude" className="gap-3">
            <TabsList
                aria-label="Assistant"
                className="h-auto w-full flex-wrap justify-start gap-1"
            >
                {ASSISTANTS.map(assistant => (
                    <TabsTrigger
                        key={assistant.id}
                        value={assistant.id}
                        className="h-8 flex-none px-2.5 text-[12.5px]"
                    >
                        {assistant.label}
                    </TabsTrigger>
                ))}
            </TabsList>

            <TabsContent value="claude">
                <Steps>
                    <li>
                        In Claude (claude.ai or the desktop app), open{" "}
                        <Menu>Customize › Connectors › Add custom connector</Menu> and paste the
                        server URL.
                    </li>
                    <li>
                        Choose <Menu>Sign in now</Menu>, and for the OAuth client pick{" "}
                        <Menu>Use Claude&apos;s published identity</Menu> (
                        <Menu>Register automatically</Menu> also works).
                    </li>
                    <li>Sign in to LaunchStack and pick this workspace.</li>
                </Steps>
                <Note>
                    Free plans can add one custom connector. On Team and Enterprise, an Owner first
                    adds it under <Menu>Organization settings › Connectors › Add › Custom</Menu>;
                    then each member connects from Customize › Connectors.
                </Note>
                <Note>
                    For a script or a shared setup, choose No sign-in and add the request header{" "}
                    <code className="font-mono">Authorization: Bearer &lt;access key&gt;</code>{" "}
                    instead. Claude still marks that option beta for some organizations.
                </Note>
            </TabsContent>

            <TabsContent value="chatgpt">
                <Steps>
                    <li>
                        In ChatGPT, open{" "}
                        <Menu>Settings › Apps & Connectors › Advanced settings</Menu> and turn on{" "}
                        <Menu>Developer mode</Menu>.
                    </li>
                    <li>
                        Create a connector named LaunchStack with the server URL, and choose OAuth
                        for authentication.
                    </li>
                    <li>Sign in to LaunchStack and pick this workspace.</li>
                </Steps>
                <Note>
                    Full use, including saving conversations, needs a Business, Enterprise or Edu
                    plan, where a workspace admin publishes the connector. On Pro, ChatGPT can only
                    search and fetch.
                </Note>
            </TabsContent>

            <TabsContent value="gemini">
                <Steps>
                    <li>
                        {canManageClients
                            ? "Create an OAuth client in Settings › Integrations, under OAuth clients for assistants. It gives you a client ID and secret, and the URLs and scopes to paste."
                            : "A LaunchStack admin creates an OAuth client in Settings › Integrations. It gives them a client ID and secret, and the URLs and scopes to paste."}
                    </li>
                    <li>
                        A Google Cloud admin opens{" "}
                        <Menu>Gemini Enterprise › Connected data stores › Custom MCP Server</Menu>{" "}
                        and pastes the server URL, authorization URL, token URL, client ID, client
                        secret and scopes.
                    </li>
                    <li>
                        Each person then signs in to LaunchStack from Gemini and picks this
                        workspace.
                    </li>
                </Steps>
                <Note>
                    Google blocks custom MCP data stores by default: an organization policy admin
                    has to turn off “Disable custom mcp server connector for gemini enterprise”, and
                    whoever creates the data store needs the Discovery Engine Editor role.
                </Note>
            </TabsContent>

            <TabsContent value="claude-code">
                <CopyField
                    value={`claude mcp add --transport http launchstack ${url}`}
                    label="command"
                />
                <Note>
                    Then run <code className="font-mono">/mcp</code> in Claude Code, choose
                    launchstack and sign in.
                </Note>
            </TabsContent>

            <TabsContent value="codex">
                <CopyField value={`codex mcp add launchstack --url ${url}`} label="command" />
                <CopyField
                    value="codex mcp login launchstack"
                    label="sign-in command"
                    className="mt-2"
                />
                <Note>The second command opens your browser to sign in.</Note>
            </TabsContent>

            <TabsContent value="gemini-cli">
                <CopyField
                    value={`gemini mcp add --transport http launchstack ${url}`}
                    label="command"
                />
                <Note>
                    Then run <code className="font-mono">/mcp auth launchstack</code> in Gemini CLI
                    to sign in.
                </Note>
            </TabsContent>

            <TabsContent value="api">
                <p className="text-ink-2 m-0 mb-2 text-[13px] leading-relaxed">
                    Create an access key below and send it with every request to the server URL:
                </p>
                <CopyField value="Authorization: Bearer <access key>" label="header" />
                <Note>
                    The server speaks MCP over streamable HTTP. Keys never expire; revoke them here.
                </Note>
            </TabsContent>
        </Tabs>
    );
}

// ---------------------------------------------------------------------------
// Access key dialog
// ---------------------------------------------------------------------------

function CreateKeyDialog({
    open,
    onOpenChange,
    canSave,
    onCreated,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    canSave: boolean;
    onCreated: () => void;
}) {
    const [name, setName] = useState("");
    const [access, setAccess] = useState<KeyAccess>("read");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [secret, setSecret] = useState<string | null>(null);

    // Closing forgets everything, the secret above all.
    const close = (next: boolean) => {
        if (next) return onOpenChange(true);
        onOpenChange(false);
        setName("");
        setAccess("read");
        setError(null);
        setSecret(null);
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!name.trim() || busy) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/assistants/keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name.trim(), access }),
            });
            if (!res.ok) throw new Error(await errorMessage(res, "Could not create the key."));
            const body = (await res.json()) as { secret: string };
            setSecret(body.secret);
            onCreated();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not create the key.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="sm:max-w-[480px]">
                {secret ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Copy your key now</DialogTitle>
                            <DialogDescription>
                                You won&apos;t see it again. If you lose it, revoke it and create
                                another.
                            </DialogDescription>
                        </DialogHeader>
                        <CopyField value={secret} label="access key" />
                        <DialogFooter>
                            <Button onClick={() => close(false)}>Done</Button>
                        </DialogFooter>
                    </>
                ) : (
                    <form onSubmit={submit} className="grid gap-4">
                        <DialogHeader>
                            <DialogTitle>Create an access key</DialogTitle>
                            <DialogDescription>
                                The key acts as you, in this workspace only. Anyone who has it can
                                do what you choose here.
                            </DialogDescription>
                        </DialogHeader>
                        <div>
                            <Field
                                label="Name"
                                htmlFor="assistant-key-name"
                                hint="So you can tell your keys apart, e.g. “Nightly export script”."
                            >
                                <TextInput
                                    id="assistant-key-name"
                                    value={name}
                                    maxLength={80}
                                    autoFocus
                                    autoComplete="off"
                                    onChange={e => setName(e.target.value)}
                                />
                            </Field>
                            <div className="text-ink-2 mb-2 text-xs font-semibold">
                                What it can do
                            </div>
                            <RadioGroup
                                value={access}
                                onValueChange={value => setAccess(value as KeyAccess)}
                                aria-label="What the key can do"
                            >
                                <AccessOption
                                    value="read"
                                    title={ACCESS_LABEL.read}
                                    detail="Search the workspace and open the documents you can see."
                                />
                                {canSave && (
                                    <AccessOption
                                        value="read-write"
                                        title={ACCESS_LABEL["read-write"]}
                                        detail="Also save an assistant's conversation into the workspace as a document."
                                    />
                                )}
                            </RadioGroup>
                            {!canSave && (
                                <p className="text-ink-3 m-0 mt-2 text-[12px] leading-normal">
                                    Saving conversations needs permission to add documents, which
                                    your role doesn&apos;t include.
                                </p>
                            )}
                            {error && (
                                <p role="alert" className="text-danger m-0 mt-3 text-[12.5px]">
                                    {error}
                                </p>
                            )}
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => close(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={!name.trim() || busy}>
                                {busy ? "Creating…" : "Create key"}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}

function AccessOption({
    value,
    title,
    detail,
}: {
    value: KeyAccess;
    title: string;
    detail: string;
}) {
    const id = `assistant-key-access-${value}`;
    return (
        <div className="flex items-start gap-2.5">
            <RadioGroupItem value={value} id={id} className="mt-0.5" />
            <Label htmlFor={id} className="block font-normal leading-normal">
                <span className="text-ink block text-[13px] font-semibold">{title}</span>
                <span className="text-ink-3 block text-[12px]">{detail}</span>
            </Label>
        </div>
    );
}

// ---------------------------------------------------------------------------
// The block
// ---------------------------------------------------------------------------

type Pending =
    | { kind: "connection"; clientId: string; name: string }
    | { kind: "key"; id: number; name: string };

export function AssistantsBlock() {
    const [data, setData] = useState<AssistantsOverview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [pending, setPending] = useState<Pending | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch("/api/assistants", { cache: "no-store" });
            if (!res.ok) throw new Error(await errorMessage(res, "Could not load assistants."));
            setData((await res.json()) as AssistantsOverview);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not load assistants.");
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const revoke = async (target: Pending) => {
        const key = target.kind === "key" ? `key:${target.id}` : `connection:${target.clientId}`;
        setBusy(key);
        try {
            const url =
                target.kind === "key"
                    ? `/api/assistants/keys/${target.id}`
                    : `/api/assistants/connections/${encodeURIComponent(target.clientId)}`;
            const res = await fetch(url, { method: "DELETE" });
            if (!res.ok && res.status !== 404) {
                throw new Error(await errorMessage(res, "Could not revoke it."));
            }
            toast.success(
                target.kind === "key" ? `Revoked “${target.name}”` : `Disconnected ${target.name}`
            );
            await refresh();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not revoke it.");
        } finally {
            setBusy(null);
        }
    };

    const availability = data?.availability;

    return (
        <div data-testid="assistants-block">
            <Section
                title="Assistants (MCP)"
                description="Let Claude, ChatGPT and Gemini search this workspace and save conversations into it. Each connection acts as you, in this workspace only, and sees only what you can."
            >
                {error && !data ? (
                    <div className="flex flex-wrap items-center gap-3">
                        <p role="alert" className="text-danger m-0 text-[13px]">
                            {error}
                        </p>
                        <Button size="sm" variant="outline" onClick={() => void refresh()}>
                            Try again
                        </Button>
                    </div>
                ) : !availability ? (
                    <p className="text-ink-3 m-0 text-[13px]">Loading…</p>
                ) : availability.enabled ? (
                    <Card>
                        <div className="text-ink-2 mb-1.5 text-xs font-semibold">Server URL</div>
                        <CopyField value={availability.serverUrl} label="server URL" />
                        <p className="text-ink-3 m-0 mt-2 text-[12px] leading-normal">
                            Paste it into the assistant. It sends you here to sign in and asks which
                            workspace to use.
                        </p>
                        <div className="border-line mt-5 border-t pt-4">
                            <h3 className="text-ink m-0 mb-3 text-[13px] font-semibold">
                                Connect an assistant
                            </h3>
                            <ConnectSteps
                                url={availability.serverUrl}
                                canManageClients={data.canManageClients}
                            />
                        </div>
                    </Card>
                ) : (
                    <OffNote reason={availability.reason} />
                )}
            </Section>

            {data && (
                <>
                    <Section
                        title="Connected assistants"
                        description="Assistants you have signed in to this workspace. Revoking one cuts it off at its next request; what it already saved stays."
                    >
                        <Card padding={0}>
                            {data.connections.length === 0 ? (
                                <div className="text-ink-3 px-5 py-4 text-[13px]">
                                    No assistants connected yet.
                                </div>
                            ) : (
                                data.connections.map((connection, index) => (
                                    <div key={connection.clientId} className={listRow(index)}>
                                        <div className="min-w-0 flex-1 basis-[220px]">
                                            <div className="text-ink flex flex-wrap items-center gap-2 text-[13px] font-semibold [overflow-wrap:anywhere]">
                                                {connection.name}
                                                <AccessBadge
                                                    write={connection.scopes.includes(WRITE_SCOPE)}
                                                />
                                            </div>
                                            <div className="text-ink-3 text-[12px]">
                                                {connection.connectedAt
                                                    ? `Connected ${relativeTime(connection.connectedAt)}`
                                                    : "Connected"}
                                                {connection.lastActiveAt
                                                    ? ` · last active ${relativeTime(connection.lastActiveAt)}`
                                                    : ""}
                                            </div>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={busy === `connection:${connection.clientId}`}
                                            onClick={() =>
                                                setPending({
                                                    kind: "connection",
                                                    clientId: connection.clientId,
                                                    name: connection.name,
                                                })
                                            }
                                        >
                                            Revoke
                                        </Button>
                                    </div>
                                ))
                            )}
                        </Card>
                    </Section>

                    <Section
                        title="Access keys"
                        description="For scripts, API calls and command-line tools that can't sign in through a browser. A key acts as you, in this workspace only."
                    >
                        {data.availability.enabled && (
                            <div className="mb-3">
                                <Button size="sm" onClick={() => setCreating(true)}>
                                    <Plus />
                                    Create access key
                                </Button>
                            </div>
                        )}
                        <Card padding={0}>
                            {data.keys.length === 0 ? (
                                <div className="text-ink-3 px-5 py-4 text-[13px]">
                                    No access keys yet.
                                </div>
                            ) : (
                                data.keys.map((key, index) => (
                                    <div key={key.id} className={listRow(index)}>
                                        <div className="min-w-0 flex-1 basis-[220px]">
                                            <div className="text-ink flex flex-wrap items-center gap-2 text-[13px] font-semibold [overflow-wrap:anywhere]">
                                                {key.name}
                                                <AccessBadge write={key.access === "read-write"} />
                                            </div>
                                            <div className="text-ink-3 text-[12px]">
                                                <span className="font-mono">
                                                    {key.displayPrefix}…
                                                </span>
                                                {` · created ${relativeTime(key.createdAt)} · `}
                                                {key.lastUsedAt
                                                    ? `last used ${relativeTime(key.lastUsedAt)}`
                                                    : "never used"}
                                            </div>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={busy === `key:${key.id}`}
                                            onClick={() =>
                                                setPending({
                                                    kind: "key",
                                                    id: key.id,
                                                    name: key.name,
                                                })
                                            }
                                        >
                                            Revoke
                                        </Button>
                                    </div>
                                ))
                            )}
                        </Card>
                    </Section>

                    <CreateKeyDialog
                        open={creating}
                        onOpenChange={setCreating}
                        canSave={data.canSave}
                        onCreated={() => void refresh()}
                    />
                </>
            )}

            <ConfirmDialog
                open={pending !== null}
                onOpenChange={open => {
                    if (!open) setPending(null);
                }}
                title={
                    pending?.kind === "key"
                        ? `Revoke “${pending.name}”?`
                        : `Disconnect ${pending?.name ?? "this assistant"}?`
                }
                description={
                    pending?.kind === "key"
                        ? "Anything using this key stops working at its next request. This can't be undone."
                        : "It loses access to this workspace at its next request. Conversations it already saved stay. You can connect it again any time."
                }
                confirmLabel={pending?.kind === "key" ? "Revoke key" : "Revoke"}
                onConfirm={() => {
                    if (pending) void revoke(pending);
                }}
            />
        </div>
    );
}

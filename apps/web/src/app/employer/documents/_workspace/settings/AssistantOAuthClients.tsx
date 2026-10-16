"use client";

/**
 * Assistants (MCP): OAuth clients for manual setup — the admin half.
 *
 * Mounted in Integrations, next to the workspace's other connections, and
 * only for `settings.manage` (the routes refuse everyone else too). Some
 * assistants don't register themselves: Gemini Enterprise asks an admin for a
 * client ID, a client secret and the OAuth endpoints, and calls back to a
 * fixed Google redirect URI. A client made here belongs to the workspace; the
 * people who connect through it still each sign in as themselves.
 *
 * The secret is shown once, in the dialog that created it.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Field, TextInput } from "~/components/field";
import { Card, Section } from "~/components/layout/page-shell";
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
import { usePermissions } from "~/lib/use-permissions";
import { cn } from "~/lib/utils";

import { CopyRow, OffNote, type McpAvailabilityView } from "./AssistantsBlock";
import { relativeTime } from "./people/format";

interface OAuthEndpointsView {
    authorization: string;
    token: string;
    discovery: string;
    scopes: string;
}

interface ClientView {
    clientId: string;
    name: string;
    redirectUris: string[];
    authMethod: string;
    createdAt: string | null;
}

interface ClientsOverview {
    availability: McpAvailabilityView;
    endpoints: OAuthEndpointsView | null;
    suggestedRedirectUri: string;
    clients: ClientView[];
}

interface CreatedClient {
    client: ClientView;
    clientSecret: string;
    serverUrl: string;
    endpoints: OAuthEndpointsView;
}

type AuthMethod = "client_secret_post" | "client_secret_basic";

const AUTH_METHODS: { value: AuthMethod; title: string; detail: string }[] = [
    {
        value: "client_secret_post",
        title: "In the request body",
        detail: "client_secret_post. Try this first.",
    },
    {
        value: "client_secret_basic",
        title: "In an HTTP Basic header",
        detail: "client_secret_basic. Use it if signing in fails with “invalid_client”.",
    },
];

async function errorMessage(res: Response, fallback: string): Promise<string> {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return typeof body?.error === "string" && body.error ? body.error : fallback;
}

function Endpoints({ serverUrl, endpoints }: { serverUrl: string; endpoints: OAuthEndpointsView }) {
    return (
        <>
            <CopyRow label="Server URL" value={serverUrl} />
            <CopyRow label="Authorization URL" value={endpoints.authorization} />
            <CopyRow label="Token URL" value={endpoints.token} />
            <CopyRow label="Scopes" value={endpoints.scopes} />
        </>
    );
}

function CreateClientDialog({
    open,
    onOpenChange,
    suggestedRedirectUri,
    onCreated,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    suggestedRedirectUri: string;
    onCreated: () => void;
}) {
    const [name, setName] = useState("Gemini Enterprise");
    const [redirectUri, setRedirectUri] = useState(suggestedRedirectUri);
    const [authMethod, setAuthMethod] = useState<AuthMethod>("client_secret_post");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [created, setCreated] = useState<CreatedClient | null>(null);

    // Closing forgets everything, the secret above all.
    const close = (next: boolean) => {
        if (next) return onOpenChange(true);
        onOpenChange(false);
        setName("Gemini Enterprise");
        setRedirectUri(suggestedRedirectUri);
        setAuthMethod("client_secret_post");
        setError(null);
        setCreated(null);
    };

    const canSubmit = name.trim().length > 0 && redirectUri.trim().startsWith("https://");

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canSubmit || busy) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/assistants/clients", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    redirectUris: [redirectUri.trim()],
                    authMethod,
                }),
            });
            if (!res.ok) throw new Error(await errorMessage(res, "Could not create the client."));
            setCreated((await res.json()) as CreatedClient);
            onCreated();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not create the client.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[520px]">
                {created ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Copy the client secret now</DialogTitle>
                            <DialogDescription>
                                You won&apos;t see the secret again. If it&apos;s lost, delete this
                                client and create another. Paste these into the assistant&apos;s
                                OAuth settings.
                            </DialogDescription>
                        </DialogHeader>
                        <div>
                            <CopyRow label="Client ID" value={created.client.clientId} />
                            <CopyRow label="Client secret" value={created.clientSecret} />
                            <Endpoints
                                serverUrl={created.serverUrl}
                                endpoints={created.endpoints}
                            />
                        </div>
                        <DialogFooter>
                            <Button onClick={() => close(false)}>Done</Button>
                        </DialogFooter>
                    </>
                ) : (
                    <form onSubmit={submit} className="grid gap-4">
                        <DialogHeader>
                            <DialogTitle>Create an OAuth client</DialogTitle>
                            <DialogDescription>
                                For an assistant that asks for a client ID and secret instead of
                                registering itself, such as Gemini Enterprise.
                            </DialogDescription>
                        </DialogHeader>
                        <div>
                            <Field label="Name" htmlFor="assistant-client-name">
                                <TextInput
                                    id="assistant-client-name"
                                    value={name}
                                    maxLength={80}
                                    autoComplete="off"
                                    onChange={e => setName(e.target.value)}
                                />
                            </Field>
                            <Field
                                label="Redirect URI"
                                htmlFor="assistant-client-redirect"
                                hint="Filled in with Gemini Enterprise's. Another assistant shows its own in its OAuth settings; it must start with https://."
                            >
                                <TextInput
                                    id="assistant-client-redirect"
                                    value={redirectUri}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="font-mono text-[12.5px]"
                                    onChange={e => setRedirectUri(e.target.value)}
                                />
                            </Field>
                            <div className="text-ink-2 mb-2 text-xs font-semibold">
                                How the assistant sends the secret
                            </div>
                            <RadioGroup
                                value={authMethod}
                                onValueChange={value => setAuthMethod(value as AuthMethod)}
                                aria-label="How the assistant sends the secret"
                            >
                                {AUTH_METHODS.map(method => {
                                    const id = `assistant-client-auth-${method.value}`;
                                    return (
                                        <div
                                            key={method.value}
                                            className="flex items-start gap-2.5"
                                        >
                                            <RadioGroupItem
                                                value={method.value}
                                                id={id}
                                                className="mt-0.5"
                                            />
                                            <Label
                                                htmlFor={id}
                                                className="block font-normal leading-normal"
                                            >
                                                <span className="text-ink block text-[13px] font-semibold">
                                                    {method.title}
                                                </span>
                                                <span className="text-ink-3 block text-[12px]">
                                                    {method.detail}
                                                </span>
                                            </Label>
                                        </div>
                                    );
                                })}
                            </RadioGroup>
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
                            <Button type="submit" disabled={!canSubmit || busy}>
                                {busy ? "Creating…" : "Create client"}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}

function ClientsSection() {
    const [data, setData] = useState<ClientsOverview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [pending, setPending] = useState<ClientView | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch("/api/assistants/clients", { cache: "no-store" });
            if (!res.ok) throw new Error(await errorMessage(res, "Could not load OAuth clients."));
            setData((await res.json()) as ClientsOverview);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not load OAuth clients.");
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const remove = async (client: ClientView) => {
        setBusy(client.clientId);
        try {
            const res = await fetch(
                `/api/assistants/clients/${encodeURIComponent(client.clientId)}`,
                { method: "DELETE" }
            );
            if (!res.ok && res.status !== 404) {
                throw new Error(await errorMessage(res, "Could not delete the client."));
            }
            toast.success(`Deleted “${client.name}”`);
            await refresh();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not delete the client.");
        } finally {
            setBusy(null);
        }
    };

    const availability = data?.availability;

    return (
        <Section
            title="OAuth clients for assistants"
            description="For assistants that ask an admin for a client ID and secret instead of registering themselves, such as Gemini Enterprise. Everyone in the workspace can then connect through the client, each signing in as themselves. Claude, ChatGPT and the command-line tools don't need one."
        >
            <div data-testid="assistant-oauth-clients">
                {error && !data ? (
                    <div className="flex flex-wrap items-center gap-3">
                        <p role="alert" className="text-danger m-0 text-[13px]">
                            {error}
                        </p>
                        <Button size="sm" variant="outline" onClick={() => void refresh()}>
                            Try again
                        </Button>
                    </div>
                ) : !data || !availability ? (
                    <p className="text-ink-3 m-0 text-[13px]">Loading…</p>
                ) : (
                    <>
                        {availability.enabled ? (
                            <div className="mb-3">
                                <Button size="sm" onClick={() => setCreating(true)}>
                                    <Plus />
                                    Create OAuth client
                                </Button>
                            </div>
                        ) : (
                            <div className="mb-3">
                                <OffNote reason={availability.reason} />
                            </div>
                        )}

                        <Card padding={0}>
                            {data.clients.length === 0 ? (
                                <div className="text-ink-3 px-5 py-4 text-[13px]">
                                    No OAuth clients yet.
                                </div>
                            ) : (
                                data.clients.map((client, index) => (
                                    <div
                                        key={client.clientId}
                                        className={cn(
                                            "flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3",
                                            index > 0 && "border-line border-t"
                                        )}
                                    >
                                        <div className="min-w-0 flex-1 basis-[220px]">
                                            <div className="text-ink text-[13px] font-semibold [overflow-wrap:anywhere]">
                                                {client.name}
                                            </div>
                                            <div className="text-ink-3 font-mono text-[11.5px] [overflow-wrap:anywhere]">
                                                {client.clientId}
                                            </div>
                                            <div className="text-ink-3 text-[12px] [overflow-wrap:anywhere]">
                                                Returns to {client.redirectUris.join(", ")}
                                                {client.createdAt
                                                    ? ` · created ${relativeTime(client.createdAt)}`
                                                    : ""}
                                            </div>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={busy === client.clientId}
                                            onClick={() => setPending(client)}
                                        >
                                            Delete
                                        </Button>
                                    </div>
                                ))
                            )}
                        </Card>

                        {availability.enabled && data.endpoints && (
                            <Card className="mt-3.5">
                                <div className="text-ink mb-3 text-[13px] font-semibold">
                                    What the assistant asks for
                                </div>
                                <Endpoints
                                    serverUrl={availability.serverUrl}
                                    endpoints={data.endpoints}
                                />
                                <p className="text-ink-3 m-0 mt-3 text-[12px] leading-normal [overflow-wrap:anywhere]">
                                    Discovery document, if it asks for one:{" "}
                                    <span className="font-mono">{data.endpoints.discovery}</span>
                                </p>
                            </Card>
                        )}

                        <CreateClientDialog
                            open={creating}
                            onOpenChange={setCreating}
                            suggestedRedirectUri={data.suggestedRedirectUri}
                            onCreated={() => void refresh()}
                        />
                    </>
                )}
            </div>

            <ConfirmDialog
                open={pending !== null}
                onOpenChange={open => {
                    if (!open) setPending(null);
                }}
                title={`Delete “${pending?.name ?? "this client"}”?`}
                description="Everyone connected through it is disconnected, and the assistant can't sign in again until you give it a new client ID and secret. This can't be undone."
                confirmLabel="Delete client"
                onConfirm={() => {
                    if (pending) void remove(pending);
                }}
            />
        </Section>
    );
}

/** Nothing at all for anyone without `settings.manage`. */
export function AssistantOAuthClients() {
    const { loaded, can } = usePermissions();
    if (!loaded || !can("settings.manage")) return null;
    return <ClientsSection />;
}

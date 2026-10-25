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
import { useTranslations } from "next-intl";
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
import { useTimeFormat } from "./people/format";

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

/** Words: `settings.oauthClients.authMethods.<key>` (`title`, `detail`). */
const AUTH_METHODS: { value: AuthMethod; key: "post" | "basic" }[] = [
    { value: "client_secret_post", key: "post" },
    { value: "client_secret_basic", key: "basic" },
];

async function errorMessage(res: Response, fallback: string): Promise<string> {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return typeof body?.error === "string" && body.error ? body.error : fallback;
}

function Endpoints({ serverUrl, endpoints }: { serverUrl: string; endpoints: OAuthEndpointsView }) {
    const t = useTranslations("settings.oauthClients.endpoints");
    return (
        <>
            <CopyRow label={t("serverUrl")} value={serverUrl} />
            <CopyRow label={t("authorizationUrl")} value={endpoints.authorization} />
            <CopyRow label={t("tokenUrl")} value={endpoints.token} />
            <CopyRow label={t("scopes")} value={endpoints.scopes} />
            <p className="text-ink-3 m-0 text-xs leading-normal">{t("pkce")}</p>
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
    const t = useTranslations("settings.oauthClients");
    const tc = useTranslations("common");
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
            if (!res.ok) throw new Error(await errorMessage(res, t("createFailed")));
            setCreated((await res.json()) as CreatedClient);
            onCreated();
        } catch (err) {
            setError(err instanceof Error ? err.message : t("createFailed"));
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
                            <DialogTitle>{t("created.title")}</DialogTitle>
                            <DialogDescription>{t("created.description")}</DialogDescription>
                        </DialogHeader>
                        <div>
                            <CopyRow label={t("clientId")} value={created.client.clientId} />
                            <CopyRow label={t("clientSecret")} value={created.clientSecret} />
                            <Endpoints
                                serverUrl={created.serverUrl}
                                endpoints={created.endpoints}
                            />
                        </div>
                        <DialogFooter>
                            <Button onClick={() => close(false)}>{tc("actions.done")}</Button>
                        </DialogFooter>
                    </>
                ) : (
                    <form onSubmit={submit} className="grid gap-4">
                        <DialogHeader>
                            <DialogTitle>{t("create.title")}</DialogTitle>
                            <DialogDescription>{t("create.description")}</DialogDescription>
                        </DialogHeader>
                        <div>
                            <Field label={tc("fields.name")} htmlFor="assistant-client-name">
                                <TextInput
                                    id="assistant-client-name"
                                    value={name}
                                    maxLength={80}
                                    autoComplete="off"
                                    onChange={e => setName(e.target.value)}
                                />
                            </Field>
                            <Field
                                label={t("create.redirectUri")}
                                htmlFor="assistant-client-redirect"
                                hint={t("create.redirectHint")}
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
                                {t("create.sendsSecret")}
                            </div>
                            <RadioGroup
                                value={authMethod}
                                onValueChange={value => setAuthMethod(value as AuthMethod)}
                                aria-label={t("create.sendsSecret")}
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
                                                    {t(`authMethods.${method.key}.title`)}
                                                </span>
                                                <span className="text-ink-3 block text-[12px]">
                                                    {t(`authMethods.${method.key}.detail`)}
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
                                {tc("actions.cancel")}
                            </Button>
                            <Button type="submit" disabled={!canSubmit || busy}>
                                {busy ? t("create.creating") : t("create.submit")}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}

function ClientsSection() {
    const t = useTranslations("settings.oauthClients");
    const tc = useTranslations("common");
    const time = useTimeFormat();
    const [data, setData] = useState<ClientsOverview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [pending, setPending] = useState<ClientView | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch("/api/assistants/clients", { cache: "no-store" });
            if (!res.ok) throw new Error(await errorMessage(res, t("loadFailed")));
            setData((await res.json()) as ClientsOverview);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : t("loadFailed"));
        }
    }, [t]);

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
                throw new Error(await errorMessage(res, t("deleteFailed")));
            }
            toast.success(t("deleted", { name: client.name }));
            await refresh();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t("deleteFailed"));
        } finally {
            setBusy(null);
        }
    };

    const availability = data?.availability;

    return (
        <Section title={t("section.title")} description={t("section.description")}>
            <div data-testid="assistant-oauth-clients">
                {error && !data ? (
                    <div className="flex flex-wrap items-center gap-3">
                        <p role="alert" className="text-danger m-0 text-[13px]">
                            {error}
                        </p>
                        <Button size="sm" variant="outline" onClick={() => void refresh()}>
                            {tc("actions.tryAgain")}
                        </Button>
                    </div>
                ) : !data || !availability ? (
                    <p className="text-ink-3 m-0 text-[13px]">{tc("status.loading")}</p>
                ) : (
                    <>
                        {availability.enabled ? (
                            <div className="mb-3">
                                <Button size="sm" onClick={() => setCreating(true)}>
                                    <Plus />
                                    {t("createButton")}
                                </Button>
                            </div>
                        ) : (
                            <div className="mb-3">
                                <OffNote reason={availability.reason} />
                            </div>
                        )}

                        <Card padding={0}>
                            {data.clients.length === 0 ? (
                                <div className="text-ink-3 px-5 py-4 text-[13px]">{t("none")}</div>
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
                                                {t("returnsTo", {
                                                    uris: client.redirectUris.join(", "),
                                                })}
                                                {client.createdAt
                                                    ? ` · ${t("createdAt", { when: time.relative(client.createdAt) })}`
                                                    : ""}
                                            </div>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={busy === client.clientId}
                                            onClick={() => setPending(client)}
                                        >
                                            {busy === client.clientId
                                                ? t("deleting")
                                                : tc("actions.delete")}
                                        </Button>
                                    </div>
                                ))
                            )}
                        </Card>

                        {availability.enabled && data.endpoints && (
                            <Card className="mt-3.5">
                                <div className="text-ink mb-3 text-[13px] font-semibold">
                                    {t("asksFor")}
                                </div>
                                <Endpoints
                                    serverUrl={availability.serverUrl}
                                    endpoints={data.endpoints}
                                />
                                <p className="text-ink-3 m-0 mt-3 text-[12px] leading-normal [overflow-wrap:anywhere]">
                                    {t("discovery")}{" "}
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
                title={t("confirm.title", { name: pending?.name ?? t("confirm.thisClient") })}
                description={t("confirm.description")}
                confirmLabel={t("confirm.confirmLabel")}
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

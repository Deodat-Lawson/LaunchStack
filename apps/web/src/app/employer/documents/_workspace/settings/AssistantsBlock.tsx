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

import React, { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
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

import { useTimeFormat } from "./people/format";

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

/** Why assistants can't connect: `settings.assistants.offReasons.<key>`, in words a member can act on. */
const MCP_OFF_REASON_KEYS = {
    disabled: "disabled",
    "no-base-url": "noBaseUrl",
    "insecure-base-url": "insecureBaseUrl",
} as const satisfies Record<McpOffReason, string>;

/** What a key may do: `settings.assistants.access.<key>`. */
const ACCESS_KEYS = { read: "read", "read-write": "readWrite" } as const satisfies Record<
    KeyAccess,
    string
>;

async function errorMessage(res: Response, fallback: string): Promise<string> {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return typeof body?.error === "string" && body.error ? body.error : fallback;
}

// ---------------------------------------------------------------------------
// Shared pieces (also used by AssistantOAuthClients)
// ---------------------------------------------------------------------------

export function CopyButton({ value, label }: { value: string; label: string }) {
    const t = useTranslations("settings.assistants");
    const tc = useTranslations("common");
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
            aria-label={t("copy", { label })}
            onClick={() => {
                void navigator.clipboard
                    ?.writeText(value)
                    .then(() => setCopied(true))
                    .catch(() => toast.error(t("copyFailed")));
            }}
        >
            {copied ? <Check /> : <Copy />}
            {copied ? tc("actions.copied") : tc("actions.copy")}
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
    const t = useTranslations("settings.assistants");
    return (
        <div
            role="status"
            className="border-warn/30 bg-warn-soft text-ink-2 rounded-[10px] border px-3.5 py-2.5 text-[13px] leading-normal"
        >
            {t(`offReasons.${MCP_OFF_REASON_KEYS[reason]}`)}
        </div>
    );
}

function AccessBadge({ write }: { write: boolean }) {
    const t = useTranslations("settings.assistants");
    return (
        <Badge variant={write ? "info" : "secondary"}>
            {write ? t("badge.write") : t("badge.read")}
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
    // Said in the reader's language: `settings.assistants.tabs.api`.
    { id: "api", label: null },
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

/** The tags the connect steps' messages use. */
const menu = (chunks: ReactNode) => <Menu>{chunks}</Menu>;
const code = (chunks: ReactNode) => <code className="font-mono">{chunks}</code>;

function ConnectSteps({ url, canManageClients }: { url: string; canManageClients: boolean }) {
    const t = useTranslations("settings.assistants");
    const header = `Authorization: Bearer <${t("accessKey")}>`;
    return (
        <Tabs defaultValue="claude" className="gap-3">
            <TabsList
                aria-label={t("assistantTabs")}
                className="h-auto w-full flex-wrap justify-start gap-1"
            >
                {ASSISTANTS.map(assistant => (
                    <TabsTrigger
                        key={assistant.id}
                        value={assistant.id}
                        className="h-8 flex-none px-2.5 text-[12.5px]"
                    >
                        {assistant.label ?? t("tabs.api")}
                    </TabsTrigger>
                ))}
            </TabsList>

            <TabsContent value="claude">
                <Steps>
                    <li>{t.rich("claude.step1", { menu })}</li>
                    <li>{t.rich("claude.step2", { menu })}</li>
                    <li>{t("signInPick")}</li>
                </Steps>
                <Note>{t.rich("claude.note1", { menu })}</Note>
                <Note>{t.rich("claude.note2", { header, code })}</Note>
            </TabsContent>

            <TabsContent value="chatgpt">
                <Steps>
                    <li>{t.rich("chatgpt.step1", { menu })}</li>
                    <li>{t("chatgpt.step2")}</li>
                    <li>{t("signInPick")}</li>
                </Steps>
                <Note>{t("chatgpt.note")}</Note>
            </TabsContent>

            <TabsContent value="gemini">
                <Steps>
                    <li>{canManageClients ? t("gemini.step1Admin") : t("gemini.step1Member")}</li>
                    <li>{t.rich("gemini.step2", { menu })}</li>
                    <li>{t("gemini.step3")}</li>
                </Steps>
                <Note>{t("gemini.note")}</Note>
            </TabsContent>

            <TabsContent value="claude-code">
                <CopyField
                    value={`claude mcp add --transport http launchstack ${url}`}
                    label={t("copyLabels.command")}
                />
                <Note>{t.rich("claudeCode.note", { code })}</Note>
            </TabsContent>

            <TabsContent value="codex">
                <CopyField
                    value={`codex mcp add launchstack --url ${url}`}
                    label={t("copyLabels.command")}
                />
                <CopyField
                    value="codex mcp login launchstack"
                    label={t("copyLabels.signInCommand")}
                    className="mt-2"
                />
                <Note>{t("codex.note")}</Note>
            </TabsContent>

            <TabsContent value="gemini-cli">
                <CopyField
                    value={`gemini mcp add --transport http launchstack ${url}`}
                    label={t("copyLabels.command")}
                />
                <Note>{t.rich("geminiCli.note", { code })}</Note>
            </TabsContent>

            <TabsContent value="api">
                <p className="text-ink-2 m-0 mb-2 text-[13px] leading-relaxed">{t("api.intro")}</p>
                <CopyField value={header} label={t("copyLabels.header")} />
                <Note>{t("api.note")}</Note>
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
    const t = useTranslations("settings.assistants");
    const tc = useTranslations("common");
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
            if (!res.ok) throw new Error(await errorMessage(res, t("createKeyFailed")));
            const body = (await res.json()) as { secret: string };
            setSecret(body.secret);
            onCreated();
        } catch (err) {
            setError(err instanceof Error ? err.message : t("createKeyFailed"));
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
                            <DialogTitle>{t("keyCreated.title")}</DialogTitle>
                            <DialogDescription>{t("keyCreated.description")}</DialogDescription>
                        </DialogHeader>
                        <CopyField value={secret} label={t("accessKey")} />
                        <DialogFooter>
                            <Button onClick={() => close(false)}>{tc("actions.done")}</Button>
                        </DialogFooter>
                    </>
                ) : (
                    <form onSubmit={submit} className="grid gap-4">
                        <DialogHeader>
                            <DialogTitle>{t("createKey.title")}</DialogTitle>
                            <DialogDescription>{t("createKey.description")}</DialogDescription>
                        </DialogHeader>
                        <div>
                            <Field
                                label={tc("fields.name")}
                                htmlFor="assistant-key-name"
                                hint={t("createKey.nameHint")}
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
                                {t("createKey.whatItCan")}
                            </div>
                            <RadioGroup
                                value={access}
                                onValueChange={value => setAccess(value as KeyAccess)}
                                aria-label={t("createKey.whatKeyCan")}
                            >
                                <AccessOption
                                    value="read"
                                    title={t(`access.${ACCESS_KEYS.read}`)}
                                    detail={t("createKey.readDetail")}
                                />
                                {canSave && (
                                    <AccessOption
                                        value="read-write"
                                        title={t(`access.${ACCESS_KEYS["read-write"]}`)}
                                        detail={t("createKey.writeDetail")}
                                    />
                                )}
                            </RadioGroup>
                            {!canSave && (
                                <p className="text-ink-3 m-0 mt-2 text-[12px] leading-normal">
                                    {t("createKey.noSave")}
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
                                {tc("actions.cancel")}
                            </Button>
                            <Button type="submit" disabled={!name.trim() || busy}>
                                {busy ? t("creating") : t("createKey.submit")}
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
    const t = useTranslations("settings.assistants");
    const tc = useTranslations("common");
    const time = useTimeFormat();
    const [data, setData] = useState<AssistantsOverview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [pending, setPending] = useState<Pending | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch("/api/assistants", { cache: "no-store" });
            if (!res.ok) throw new Error(await errorMessage(res, t("loadFailed")));
            setData((await res.json()) as AssistantsOverview);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : t("loadFailed"));
        }
    }, [t]);

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
                throw new Error(await errorMessage(res, t("revokeFailed")));
            }
            toast.success(
                target.kind === "key"
                    ? t("revokedKey", { name: target.name })
                    : t("disconnectedAssistant", { name: target.name })
            );
            await refresh();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t("revokeFailed"));
        } finally {
            setBusy(null);
        }
    };

    const availability = data?.availability;

    return (
        <div data-testid="assistants-block">
            <Section title={t("section.title")} description={t("section.description")}>
                {error && !data ? (
                    <div className="flex flex-wrap items-center gap-3">
                        <p role="alert" className="text-danger m-0 text-[13px]">
                            {error}
                        </p>
                        <Button size="sm" variant="outline" onClick={() => void refresh()}>
                            {tc("actions.tryAgain")}
                        </Button>
                    </div>
                ) : !availability ? (
                    <p className="text-ink-3 m-0 text-[13px]">{tc("status.loading")}</p>
                ) : availability.enabled ? (
                    <Card>
                        <div className="text-ink-2 mb-1.5 text-xs font-semibold">
                            {t("serverUrl")}
                        </div>
                        <CopyField
                            value={availability.serverUrl}
                            label={t("copyLabels.serverUrl")}
                        />
                        <p className="text-ink-3 m-0 mt-2 text-[12px] leading-normal">
                            {t("pasteIt")}
                        </p>
                        <div className="border-line mt-5 border-t pt-4">
                            <h3 className="text-ink m-0 mb-3 text-[13px] font-semibold">
                                {t("connectTitle")}
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
                    <Section title={t("connected.title")} description={t("connected.description")}>
                        <Card padding={0}>
                            {data.connections.length === 0 ? (
                                <div className="text-ink-3 px-5 py-4 text-[13px]">
                                    {t("connected.none")}
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
                                                    ? t("connected.connectedAt", {
                                                          when: time.relative(
                                                              connection.connectedAt
                                                          ),
                                                      })
                                                    : t("connected.connected")}
                                                {connection.lastActiveAt
                                                    ? ` · ${t("connected.lastActive", { when: time.relative(connection.lastActiveAt) })}`
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
                                            {busy === `connection:${connection.clientId}`
                                                ? t("revoking")
                                                : tc("actions.revoke")}
                                        </Button>
                                    </div>
                                ))
                            )}
                        </Card>
                    </Section>

                    <Section title={t("keys.title")} description={t("keys.description")}>
                        {data.availability.enabled && (
                            <div className="mb-3">
                                <Button size="sm" onClick={() => setCreating(true)}>
                                    <Plus />
                                    {t("keys.create")}
                                </Button>
                            </div>
                        )}
                        <Card padding={0}>
                            {data.keys.length === 0 ? (
                                <div className="text-ink-3 px-5 py-4 text-[13px]">
                                    {t("keys.none")}
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
                                                {` · ${t("keys.created", { when: time.relative(key.createdAt) })} · `}
                                                {key.lastUsedAt
                                                    ? t("keys.lastUsed", {
                                                          when: time.relative(key.lastUsedAt),
                                                      })
                                                    : t("keys.neverUsed")}
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
                                            {busy === `key:${key.id}`
                                                ? t("revoking")
                                                : tc("actions.revoke")}
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
                        ? t("confirm.revokeKey", { name: pending.name })
                        : t("confirm.disconnect", {
                              name: pending?.name ?? t("confirm.thisAssistant"),
                          })
                }
                description={
                    pending?.kind === "key" ? t("confirm.keyBody") : t("confirm.connectionBody")
                }
                confirmLabel={
                    pending?.kind === "key" ? t("confirm.revokeKeyLabel") : tc("actions.revoke")
                }
                onConfirm={() => {
                    if (pending) void revoke(pending);
                }}
            />
        </div>
    );
}

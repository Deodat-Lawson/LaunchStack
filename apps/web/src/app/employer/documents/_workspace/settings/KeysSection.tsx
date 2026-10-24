"use client";

/**
 * Settings › Bring your own keys.
 *
 * Body only. Two keys, both optional — leave either one empty and that part
 * of the workspace runs on the server's own credentials:
 *
 * - **API key** (`WorkspaceModelPanel`): the workspace's own provider account
 *   for chat, drafting, meetings and background work, connected through
 *   OpenRouter or an address and API key.
 * - **Embedding key**: an OpenAI-compatible key and the endpoint it belongs
 *   to, for the vectors behind semantic search.
 *
 * One primary action at a time: the model editor's Save while it is open,
 * otherwise the embedding form's.
 *
 * OpenRouter's connect flow is a top-level navigation that comes back here
 * with `?openrouter=<outcome>`; the section turns that into a note and takes
 * the parameter back out of the address bar.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Card, Section } from "~/components/layout/page-shell";
import { Field, TextInput } from "~/components/field";

import {
    usePublishedActions,
    type SettingsSectionActions,
    type SettingsSectionProps,
} from "./contract";
import { StatusNote, type StatusTone } from "./ui";
import {
    WORKSPACE_ENDPOINT_URL,
    WorkspaceModelPanel,
    type WorkspaceEndpointView,
} from "./WorkspaceModelPanel";

// ---------------------------------------------------------------------------
// OpenRouter's return leg
// ---------------------------------------------------------------------------

type OpenRouterOutcome = "connected" | "denied" | "expired" | "unavailable" | "error";

const OPENROUTER_OUTCOMES: readonly OpenRouterOutcome[] = [
    "connected",
    "denied",
    "expired",
    "unavailable",
    "error",
];

type KeysT = ReturnType<typeof useTranslations<"settings.keys">>;

function openRouterNote(
    t: KeysT,
    outcome: OpenRouterOutcome,
    endpoint: WorkspaceEndpointView | null
): { tone: StatusTone; message: string } {
    switch (outcome) {
        case "connected":
            return endpoint?.active
                ? { tone: "ok", message: t("openRouter.connectedActive") }
                : { tone: "ok", message: t("openRouter.connected") };
        case "denied":
            return { tone: "muted", message: t("openRouter.denied") };
        case "expired":
            return { tone: "warn", message: t("openRouter.expired") };
        case "unavailable":
            return { tone: "danger", message: t("openRouter.unavailable") };
        case "error":
            return { tone: "danger", message: t("openRouter.error") };
    }
}

/**
 * Reads `?openrouter=` once and removes it, keeping the rest of the address
 * (the `#byok` hash included) so a reload doesn't repeat the message.
 */
function takeOpenRouterOutcome(): OpenRouterOutcome | null {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const value = params.get("openrouter");
    if (value === null) return null;
    params.delete("openrouter");
    const query = params.toString();
    window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
    );
    return (OPENROUTER_OUTCOMES as readonly string[]).includes(value)
        ? (value as OpenRouterOutcome)
        : null;
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

export function KeysSection({ onActions }: SettingsSectionProps) {
    const t = useTranslations("settings.keys");
    const [endpoint, setEndpoint] = useState<WorkspaceEndpointView | null>(null);
    const [endpointLoaded, setEndpointLoaded] = useState(false);
    const [endpointError, setEndpointError] = useState<string | null>(null);

    // The model editor's Save, while it is open.
    const [editorActions, setEditorActions] = useState<SettingsSectionActions | null>(null);
    // The embedding form's Save otherwise.
    const [embeddingActions, setEmbeddingActions] = useState<SettingsSectionActions | null>(null);
    const [openRouter, setOpenRouter] = useState<OpenRouterOutcome | null>(null);

    useEffect(() => {
        const outcome = takeOpenRouterOutcome();
        if (outcome) setOpenRouter(outcome);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch(WORKSPACE_ENDPOINT_URL);
                const body = (await res.json().catch(() => ({}))) as {
                    endpoint?: WorkspaceEndpointView | null;
                    error?: string;
                };
                if (!res.ok)
                    throw new Error(
                        body.error ?? t("endpointFailedStatus", { status: res.status })
                    );
                if (!cancelled) {
                    setEndpoint(body.endpoint ?? null);
                    setEndpointError(null);
                }
            } catch (err) {
                if (!cancelled) {
                    setEndpointError(err instanceof Error ? err.message : t("endpointFailed"));
                }
            } finally {
                if (!cancelled) setEndpointLoaded(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [t]);

    const endpointChanged = useCallback((next: WorkspaceEndpointView | null) => {
        setEndpoint(next);
        // The panel says what just happened; an OpenRouter note from before
        // the change would now be describing the past.
        setOpenRouter(null);
    }, []);

    usePublishedActions(onActions, editorActions ?? embeddingActions ?? {}, [
        editorActions,
        embeddingActions,
    ]);

    const note = openRouter ? openRouterNote(t, openRouter, endpoint) : null;

    return (
        <>
            {note && <StatusNote tone={note.tone}>{note.message}</StatusNote>}

            <WorkspaceModelPanel
                endpoint={endpoint}
                loaded={endpointLoaded}
                loadError={endpointError}
                onEndpointChange={endpointChanged}
                registerActions={setEditorActions}
                openAtModels={openRouter === "connected" && endpoint !== null && !endpoint.models}
            />

            <EmbeddingKey registerActions={setEmbeddingActions} />
        </>
    );
}

// ---------------------------------------------------------------------------
// Embedding key
// ---------------------------------------------------------------------------

interface RedactedKey {
    hasKey: boolean;
    last4: string | null;
}

/** The slice of `/api/fetchCompany` this section reads. */
interface EmbeddingConfig {
    embeddingOpenAIApiKey: RedactedKey;
    embeddingOpenAIBaseUrl: string | null;
    /** The model the workspace's index embeds with; null when unknown here. */
    embeddingModel: {
        indexKey: string;
        provider: string;
        model: string;
        dimension: number;
    } | null;
}

interface SaveResult {
    success?: boolean;
    message?: string;
    /** Request validation answers with `error`, the route itself with `message`. */
    error?: string;
}

async function saveCredentials(body: Record<string, unknown>, fallback: string): Promise<void> {
    const response = await fetch("/api/updateCompany", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => null)) as SaveResult | null;
    if (!response.ok || result?.success !== true) {
        throw new Error(result?.message ?? result?.error ?? fallback);
    }
}

function EmbeddingKey({
    registerActions,
}: {
    registerActions: (actions: SettingsSectionActions | null) => void;
}) {
    const t = useTranslations("settings.keys.embedding");
    const tc = useTranslations("common");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const [storedKey, setStoredKey] = useState<RedactedKey | null>(null);
    const [storedBaseUrl, setStoredBaseUrl] = useState<string | null>(null);
    const [model, setModel] = useState<EmbeddingConfig["embeddingModel"]>(null);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [status, setStatus] = useState<{ message: string; tone: StatusTone } | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const response = await fetch("/api/fetchCompany", { method: "GET" });
                if (!response.ok) throw new Error("Failed to fetch company info");
                const data = (await response.json()) as EmbeddingConfig;
                if (cancelled) return;
                setStoredKey(data.embeddingOpenAIApiKey);
                setStoredBaseUrl(data.embeddingOpenAIBaseUrl ?? null);
                setBaseUrl(data.embeddingOpenAIBaseUrl ?? "");
                setModel(data.embeddingModel ?? null);
            } catch (error) {
                console.error(error);
                if (!cancelled) {
                    setStatus({ message: t("loadFailed"), tone: "danger" });
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [t]);

    const typedKey = apiKey.trim();
    const trimmedUrl = baseUrl.trim();
    const urlChanged = trimmedUrl !== (storedBaseUrl ?? "");
    const dirty = typedKey.length > 0 || urlChanged;

    const save = useCallback(async () => {
        setSaving(true);
        setStatus(null);
        try {
            const body: Record<string, unknown> = {};
            if (typedKey) body.embeddingOpenAIApiKey = typedKey;
            // The address travels with a new key, and on its own only when it
            // changed: the server asks for the key again before moving a saved
            // key to a different address.
            if (typedKey || urlChanged) body.embeddingOpenAIBaseUrl = trimmedUrl || null;
            await saveCredentials(body, t("saveFailed"));

            if (typedKey) setStoredKey({ hasKey: true, last4: typedKey.slice(-4) });
            setStoredBaseUrl(trimmedUrl || null);
            setApiKey("");
            setStatus({ tone: "ok", message: t("saved") });
        } catch (error) {
            setStatus({
                tone: "danger",
                message: error instanceof Error && error.message ? error.message : t("saveFailed"),
            });
        } finally {
            setSaving(false);
        }
    }, [typedKey, urlChanged, trimmedUrl, t]);

    const remove = useCallback(async () => {
        setSaving(true);
        setStatus(null);
        try {
            await saveCredentials(
                { embeddingOpenAIApiKey: null, embeddingOpenAIBaseUrl: null },
                t("removeFailed")
            );
            setStoredKey({ hasKey: false, last4: null });
            setStoredBaseUrl(null);
            setBaseUrl("");
            setApiKey("");
            setStatus({ tone: "ok", message: t("removed") });
        } catch (error) {
            setStatus({
                tone: "danger",
                message:
                    error instanceof Error && error.message ? error.message : t("removeFailed"),
            });
        } finally {
            setSaving(false);
        }
    }, [t]);

    useEffect(() => {
        registerActions({
            primaryLabel: tc("actions.saveChanges"),
            primaryBusyLabel: tc("status.saving"),
            onPrimary: save,
            busy: saving,
            // Nothing to save until something is edited — a permanently-enabled
            // Save button teaches people to ignore it.
            disabled: loading || !dirty,
        });
        return () => registerActions(null);
    }, [registerActions, save, saving, loading, dirty, tc]);

    const hasKey = Boolean(storedKey?.hasKey);
    // An Ollama or Hugging Face index never reads this key.
    const keyUnused = model !== null && model.provider !== "openai";

    return (
        <Section title={t("title")} description={t("description")}>
            {status && <StatusNote tone={status.tone}>{status.message}</StatusNote>}
            {loading ? (
                <StatusNote tone="muted">{t("loading")}</StatusNote>
            ) : (
                <Card>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="text-ink min-w-0 flex-1 text-[13px]">
                            {hasKey ? (
                                <>
                                    {t.rich("keyEnding", {
                                        last4: storedKey?.last4 ?? "****",
                                        mono: chunks => <span className="mono">{chunks}</span>,
                                    })}
                                    {storedBaseUrl && (
                                        <>
                                            {" · "}
                                            <span className="mono text-ink-3 break-all text-[11.5px]">
                                                {storedBaseUrl}
                                            </span>
                                        </>
                                    )}
                                </>
                            ) : (
                                <span className="text-ink-3">{t("usingServerKey")}</span>
                            )}
                        </div>
                        <Badge variant={hasKey ? "success" : "secondary"}>
                            {hasKey ? t("yourKey") : t("notSet")}
                        </Badge>
                        {hasKey && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-danger hover:text-danger"
                                onClick={() => setConfirmRemove(true)}
                                disabled={saving}
                            >
                                {tc("actions.remove")}
                            </Button>
                        )}
                    </div>
                    {model && (
                        <p className="text-ink-3 m-0 mt-1.5 text-[12.5px] leading-normal">
                            {keyUnused
                                ? t.rich("indexOtherProvider", {
                                      model: model.model,
                                      provider: model.provider,
                                      mono: chunks => <span className="mono">{chunks}</span>,
                                  })
                                : t.rich("indexModel", {
                                      model: model.model,
                                      dimension: model.dimension,
                                      mono: chunks => <span className="mono">{chunks}</span>,
                                  })}
                        </p>
                    )}

                    <div className="mt-4">
                        {hasKey && !storedBaseUrl && (
                            <StatusNote tone="warn">{t("noEndpoint")}</StatusNote>
                        )}

                        <Field
                            label={t("keyLabel")}
                            htmlFor="embedding-api-key"
                            hint={hasKey ? t("keepHint") : t("serverHint")}
                        >
                            <TextInput
                                id="embedding-api-key"
                                type="password"
                                value={apiKey}
                                onChange={e => setApiKey(e.target.value)}
                                placeholder={
                                    hasKey
                                        ? t("keepPlaceholder", {
                                              last4: storedKey?.last4 ?? "****",
                                          })
                                        : "<your-api-key>"
                                }
                                autoComplete="off"
                            />
                        </Field>
                        <Field
                            label={t("endpointLabel")}
                            htmlFor="embedding-base-url"
                            hint={t("endpointHint")}
                        >
                            <TextInput
                                id="embedding-base-url"
                                type="url"
                                inputMode="url"
                                value={baseUrl}
                                onChange={e => setBaseUrl(e.target.value)}
                                placeholder="https://api.openai.com/v1"
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </Field>
                    </div>
                </Card>
            )}

            <ConfirmDialog
                open={confirmRemove}
                onOpenChange={setConfirmRemove}
                title={t("confirmTitle")}
                description={t("confirmDescription")}
                confirmLabel={tc("actions.remove")}
                onConfirm={() => void remove()}
            />
        </Section>
    );
}

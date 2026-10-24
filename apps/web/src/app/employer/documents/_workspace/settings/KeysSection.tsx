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

function openRouterNote(
    outcome: OpenRouterOutcome,
    endpoint: WorkspaceEndpointView | null
): { tone: StatusTone; message: string } {
    switch (outcome) {
        case "connected":
            return endpoint?.active
                ? { tone: "ok", message: "OpenRouter is connected, and this workspace uses it." }
                : {
                      tone: "ok",
                      message:
                          "OpenRouter is connected. Choose a model to switch your workspace over.",
                  };
        case "denied":
            return {
                tone: "muted",
                message: "OpenRouter sign-in was cancelled. Nothing changed.",
            };
        case "expired":
            return { tone: "warn", message: "That sign-in expired, try again." };
        case "unavailable":
            return {
                tone: "danger",
                message:
                    "This server can't store API keys yet: whoever runs it needs to set EMBEDDING_SECRETS_KEY.",
            };
        case "error":
            return {
                tone: "danger",
                message: "Couldn't connect OpenRouter. Try again, or use an API key instead.",
            };
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
                        body.error ?? `Couldn't read your model setup (${res.status}).`
                    );
                if (!cancelled) {
                    setEndpoint(body.endpoint ?? null);
                    setEndpointError(null);
                }
            } catch (err) {
                if (!cancelled) {
                    setEndpointError(
                        err instanceof Error ? err.message : "Couldn't read your model setup."
                    );
                }
            } finally {
                if (!cancelled) setEndpointLoaded(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

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

    const note = openRouter ? openRouterNote(openRouter, endpoint) : null;

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
                    setStatus({
                        message: "Something went wrong loading the embedding key.",
                        tone: "danger",
                    });
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

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
            await saveCredentials(body, "Couldn't save the embedding key.");

            if (typedKey) setStoredKey({ hasKey: true, last4: typedKey.slice(-4) });
            setStoredBaseUrl(trimmedUrl || null);
            setApiKey("");
            setStatus({ tone: "ok", message: "Embedding key saved." });
        } catch (error) {
            setStatus({
                tone: "danger",
                message:
                    error instanceof Error && error.message
                        ? error.message
                        : "Couldn't save the embedding key.",
            });
        } finally {
            setSaving(false);
        }
    }, [typedKey, urlChanged, trimmedUrl]);

    const remove = useCallback(async () => {
        setSaving(true);
        setStatus(null);
        try {
            await saveCredentials(
                { embeddingOpenAIApiKey: null, embeddingOpenAIBaseUrl: null },
                "Couldn't remove the embedding key."
            );
            setStoredKey({ hasKey: false, last4: null });
            setStoredBaseUrl(null);
            setBaseUrl("");
            setApiKey("");
            setStatus({
                tone: "ok",
                message: "Removed. Embeddings run on the server's key again.",
            });
        } catch (error) {
            setStatus({
                tone: "danger",
                message:
                    error instanceof Error && error.message
                        ? error.message
                        : "Couldn't remove the embedding key.",
            });
        } finally {
            setSaving(false);
        }
    }, []);

    useEffect(() => {
        registerActions({
            primaryLabel: "Save changes",
            primaryBusyLabel: "Saving…",
            onPrimary: save,
            busy: saving,
            // Nothing to save until something is edited — a permanently-enabled
            // Save button teaches people to ignore it.
            disabled: loading || !dirty,
        });
        return () => registerActions(null);
    }, [registerActions, save, saving, loading, dirty]);

    const hasKey = Boolean(storedKey?.hasKey);
    // An Ollama or Hugging Face index never reads this key.
    const keyUnused = model !== null && model.provider !== "openai";

    return (
        <Section
            title="Embedding key"
            description="Optional. An OpenAI-compatible key for the vectors behind semantic search, sent only to the endpoint it belongs to. Without one, embeddings run on the server's key."
        >
            {status && <StatusNote tone={status.tone}>{status.message}</StatusNote>}
            {loading ? (
                <StatusNote tone="muted">Loading the embedding key…</StatusNote>
            ) : (
                <Card>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="text-ink min-w-0 flex-1 text-[13px]">
                            {hasKey ? (
                                <>
                                    Key ending{" "}
                                    <span className="mono">{storedKey?.last4 ?? "****"}</span>
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
                                <span className="text-ink-3">Using the server&rsquo;s key.</span>
                            )}
                        </div>
                        <Badge variant={hasKey ? "success" : "secondary"}>
                            {hasKey ? "Your key" : "Not set"}
                        </Badge>
                        {hasKey && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-danger hover:text-danger"
                                onClick={() => setConfirmRemove(true)}
                                disabled={saving}
                            >
                                Remove
                            </Button>
                        )}
                    </div>
                    {model && (
                        <p className="text-ink-3 m-0 mt-1.5 text-[12.5px] leading-normal">
                            {keyUnused ? (
                                <>
                                    This workspace&rsquo;s index embeds with{" "}
                                    <span className="mono">{model.model}</span> on {model.provider},
                                    which doesn&rsquo;t use an OpenAI-compatible key.
                                </>
                            ) : (
                                <>
                                    This workspace&rsquo;s index embeds with{" "}
                                    <span className="mono">{model.model}</span> ({model.dimension}{" "}
                                    dimensions), so the endpoint has to serve that model.
                                </>
                            )}
                        </p>
                    )}

                    <div className="mt-4">
                        {hasKey && !storedBaseUrl && (
                            <StatusNote tone="warn">
                                The saved key has no endpoint URL, so embedding with it will fail
                                until one is set. Enter the endpoint URL and the key together, then
                                save.
                            </StatusNote>
                        )}

                        <Field
                            label="Embedding API key"
                            htmlFor="embedding-api-key"
                            hint={
                                hasKey
                                    ? "Leave blank to keep the saved key."
                                    : "Leave blank to use the server's key."
                            }
                        >
                            <TextInput
                                id="embedding-api-key"
                                type="password"
                                value={apiKey}
                                onChange={e => setApiKey(e.target.value)}
                                placeholder={
                                    hasKey
                                        ? `Leave blank to keep the key ending ${storedKey?.last4 ?? "****"}`
                                        : "<your-api-key>"
                                }
                                autoComplete="off"
                            />
                        </Field>
                        <Field
                            label="Embeddings endpoint URL"
                            htmlFor="embedding-base-url"
                            hint="The OpenAI-compatible embeddings endpoint this key belongs to. The key is only sent here; changing the address means entering the key again."
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
                title="Remove the embedding key?"
                description="The saved key and its endpoint are deleted, and embeddings run on the server's key again. Documents already indexed stay searchable."
                confirmLabel="Remove"
                onConfirm={() => void remove()}
            />
        </Section>
    );
}

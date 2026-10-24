"use client";

/**
 * Processing — the embedding index, the credentials behind it, and the
 * self-hosted endpoints.
 *
 * Body only. The page header and the Save button live in the settings chrome,
 * which is what makes this read as the same screen as Agents, Integrations,
 * Company, and Analytics rather than as its own page that happens to be
 * reachable from a rail.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Badge } from "~/components/ui/badge";
import { Card, Section } from "~/components/layout/page-shell";
import { Field, SelectInput, TextInput } from "~/components/field";
import { StatusNote, type StatusTone } from "./ui";
import { usePublishedActions, type SettingsSectionProps } from "./contract";

interface RedactedKey {
    hasKey: boolean;
    last4: string | null;
}

interface Company {
    id: number;
    name: string;
    embeddingIndexKey: string | null;
    embeddingOpenAIApiKey: RedactedKey;
    embeddingOpenAIBaseUrl: string | null;
    embeddingHuggingFaceApiKey: RedactedKey;
    embeddingOllamaBaseUrl: string | null;
    embeddingOllamaModel: string | null;
    numberOfEmployees: string;
    createdAt: string;
    updatedAt: string;
}

/** The index keys the server accepts; words in `settings.processing.indexOptions.<key>`. */
const INDEX_OPTIONS = [
    { value: "legacy-openai-1536", key: "legacyOpenai1536" },
    { value: "huggingface-minilm-384", key: "huggingfaceMinilm384" },
    { value: "ollama-768", key: "ollama768" },
] as const;

export function ProcessingSettings({ onActions }: SettingsSectionProps) {
    const t = useTranslations("settings.processing");
    const tc = useTranslations("common");
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [dirty, setDirty] = useState(false);

    const [embeddingIndexKey, setEmbeddingIndexKey] = useState("legacy-openai-1536");
    const [embeddingOpenAIApiKey, setEmbeddingOpenAIApiKey] = useState("");
    const [embeddingOpenAIBaseUrl, setEmbeddingOpenAIBaseUrl] = useState("");
    const [embeddingHuggingFaceApiKey, setEmbeddingHuggingFaceApiKey] = useState("");
    const [embeddingOllamaBaseUrl, setEmbeddingOllamaBaseUrl] = useState("");
    const [embeddingOllamaModel, setEmbeddingOllamaModel] = useState("");

    const [openAIKeyStored, setOpenAIKeyStored] = useState<RedactedKey | null>(null);
    const [openAIBaseUrlStored, setOpenAIBaseUrlStored] = useState<string | null>(null);
    const [huggingFaceKeyStored, setHuggingFaceKeyStored] = useState<RedactedKey | null>(null);

    const [status, setStatus] = useState<{ message: string; tone: StatusTone } | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const response = await fetch("/api/fetchCompany", { method: "GET" });
                if (!response.ok) throw new Error("Failed to fetch company info");
                const data = (await response.json()) as Company;
                if (cancelled) return;

                setEmbeddingIndexKey(data.embeddingIndexKey ?? "legacy-openai-1536");
                setOpenAIKeyStored(data.embeddingOpenAIApiKey);
                setOpenAIBaseUrlStored(data.embeddingOpenAIBaseUrl ?? null);
                setEmbeddingOpenAIBaseUrl(data.embeddingOpenAIBaseUrl ?? "");
                setHuggingFaceKeyStored(data.embeddingHuggingFaceApiKey);
                setEmbeddingOpenAIApiKey("");
                setEmbeddingHuggingFaceApiKey("");
                setEmbeddingOllamaBaseUrl(data.embeddingOllamaBaseUrl ?? "");
                setEmbeddingOllamaModel(data.embeddingOllamaModel ?? "");
                setDirty(false);
            } catch (error) {
                console.error(error);
                if (!cancelled) {
                    setStatus({ message: t("loadFailed"), tone: "danger" });
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })().catch(() => {
            if (!cancelled) setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [t]);

    const handleSave = useCallback(async () => {
        setIsSaving(true);
        setStatus(null);
        try {
            const body: Record<string, unknown> = {
                embeddingIndexKey,
                embeddingOllamaBaseUrl: embeddingOllamaBaseUrl || null,
                embeddingOllamaModel: embeddingOllamaModel || null,
            };
            const newOpenAIKey = embeddingOpenAIApiKey.trim();
            const openAIBaseUrl = embeddingOpenAIBaseUrl.trim();
            if (newOpenAIKey.length > 0) {
                body.embeddingOpenAIApiKey = newOpenAIKey;
            }
            // The address travels with a new key, and on its own only when it
            // changed: the server asks for the key again before moving a saved
            // key to a different address.
            if (newOpenAIKey.length > 0 || openAIBaseUrl !== (openAIBaseUrlStored ?? "")) {
                body.embeddingOpenAIBaseUrl = openAIBaseUrl || null;
            }
            if (embeddingHuggingFaceApiKey.trim().length > 0) {
                body.embeddingHuggingFaceApiKey = embeddingHuggingFaceApiKey.trim();
            }
            const response = await fetch("/api/updateCompany", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const result = (await response.json().catch(() => null)) as {
                success?: boolean;
                message?: string;
                code?: string;
                documentCount?: number;
            } | null;

            if (response.status === 409 && result?.code === "REINDEX_IN_PROGRESS") {
                throw new Error(result.message ?? t("reindexRunning"));
            }
            if (!response.ok || result?.success !== true) {
                throw new Error(result?.message ?? t("updateError"));
            }

            setDirty(false);
            // Credentials are saved on both the 200 and the 202 path.
            if (newOpenAIKey.length > 0) {
                setOpenAIKeyStored({ hasKey: true, last4: newOpenAIKey.slice(-4) });
            }
            if (body.embeddingOpenAIBaseUrl !== undefined) {
                setOpenAIBaseUrlStored(openAIBaseUrl || null);
            }
            if (response.status === 202 && result?.code === "REINDEX_SCHEDULED") {
                setStatus({
                    tone: "warn",
                    message:
                        result.message ??
                        t("reindexScheduled", { count: result.documentCount ?? 0 }),
                });
                return;
            }
            setStatus({ tone: "ok", message: result?.message ?? t("saved") });
            setEmbeddingOpenAIApiKey("");
            setEmbeddingHuggingFaceApiKey("");
        } catch (error) {
            setStatus({
                tone: "danger",
                message: error instanceof Error ? error.message : t("saveFailed"),
            });
        } finally {
            setIsSaving(false);
        }
    }, [
        embeddingIndexKey,
        embeddingOllamaBaseUrl,
        embeddingOllamaModel,
        embeddingOpenAIApiKey,
        embeddingOpenAIBaseUrl,
        openAIBaseUrlStored,
        embeddingHuggingFaceApiKey,
        t,
    ]);

    usePublishedActions(
        onActions,
        {
            primaryLabel: tc("actions.saveChanges"),
            primaryBusyLabel: tc("status.saving"),
            onPrimary: handleSave,
            busy: isSaving,
            // Nothing to save until something is edited — a permanently-enabled Save
            // button teaches people to ignore it.
            disabled: loading || !dirty,
        },
        [handleSave, isSaving, loading, dirty, tc]
    );

    /** Every edit marks the form dirty; the chrome reads that to enable Save. */
    const edit =
        <T,>(setter: (value: T) => void) =>
        (value: T) => {
            setter(value);
            setDirty(true);
        };

    const storedLabel = (k: RedactedKey | null) =>
        k?.hasKey ? t("stored", { last4: k.last4 ?? "****" }) : t("notSet");

    if (loading) {
        return <StatusNote tone="muted">{t("loading")}</StatusNote>;
    }

    const selectedIndex = INDEX_OPTIONS.find(o => o.value === embeddingIndexKey);

    return (
        <>
            {status && <StatusNote tone={status.tone}>{status.message}</StatusNote>}

            <Section title={t("index.title")} description={t("index.description")}>
                <Card>
                    <Field label={t("index.field")}>
                        <SelectInput
                            value={embeddingIndexKey}
                            onChange={e => edit(setEmbeddingIndexKey)(e.target.value)}
                        >
                            {INDEX_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>
                                    {t(`indexOptions.${opt.key}.label`)}
                                </option>
                            ))}
                        </SelectInput>
                        <div className="text-ink-3 mt-1 text-[11px] leading-normal">
                            {selectedIndex && t(`indexOptions.${selectedIndex.key}.description`)}
                        </div>
                    </Field>

                    {embeddingIndexKey === "legacy-openai-1536" && (
                        <>
                            {openAIKeyStored?.hasKey && !openAIBaseUrlStored && (
                                <StatusNote tone="warn">{t("noEndpoint")}</StatusNote>
                            )}
                            <Field
                                label={t("openaiKey")}
                                htmlFor="embedding-openai-key"
                                hint={t("keepHint", { stored: storedLabel(openAIKeyStored) })}
                            >
                                <TextInput
                                    id="embedding-openai-key"
                                    type="password"
                                    value={embeddingOpenAIApiKey}
                                    onChange={e => edit(setEmbeddingOpenAIApiKey)(e.target.value)}
                                    placeholder="<your-api-key>"
                                    autoComplete="off"
                                />
                            </Field>
                            <Field
                                label={t("endpointUrl")}
                                htmlFor="embedding-openai-base-url"
                                hint={t("endpointHint")}
                            >
                                <TextInput
                                    id="embedding-openai-base-url"
                                    type="url"
                                    inputMode="url"
                                    value={embeddingOpenAIBaseUrl}
                                    onChange={e => edit(setEmbeddingOpenAIBaseUrl)(e.target.value)}
                                    placeholder="https://api.openai.com/v1"
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </Field>
                        </>
                    )}

                    {embeddingIndexKey === "huggingface-minilm-384" && (
                        <Field
                            label={t("hfKey")}
                            hint={t("keepHint", { stored: storedLabel(huggingFaceKeyStored) })}
                        >
                            <TextInput
                                type="password"
                                value={embeddingHuggingFaceApiKey}
                                onChange={e => edit(setEmbeddingHuggingFaceApiKey)(e.target.value)}
                                placeholder="hf_…"
                                autoComplete="off"
                            />
                        </Field>
                    )}

                    {embeddingIndexKey === "ollama-768" && (
                        <>
                            <Field
                                label={t("ollamaUrl")}
                                hint={t("example", { value: "http://localhost:11434" })}
                            >
                                <TextInput
                                    value={embeddingOllamaBaseUrl}
                                    onChange={e => edit(setEmbeddingOllamaBaseUrl)(e.target.value)}
                                    placeholder="http://localhost:11434"
                                />
                            </Field>
                            <Field
                                label={t("ollamaModel")}
                                hint={t("example", { value: "nomic-embed-text" })}
                            >
                                <TextInput
                                    value={embeddingOllamaModel}
                                    onChange={e => edit(setEmbeddingOllamaModel)(e.target.value)}
                                    placeholder="nomic-embed-text"
                                />
                            </Field>
                        </>
                    )}
                </Card>
            </Section>

            <Section title={t("byok.title")} description={t("byok.description")}>
                <Card>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
                        <KeyStatus
                            label={t("byok.openaiCompatible")}
                            stored={openAIKeyStored}
                            detail={
                                openAIKeyStored?.hasKey
                                    ? t("byok.endingWithEndpoint", {
                                          last4: openAIKeyStored.last4 ?? "****",
                                          endpoint: openAIBaseUrlStored ?? t("byok.noEndpointUrl"),
                                      })
                                    : undefined
                            }
                        />
                        <KeyStatus label="HuggingFace" stored={huggingFaceKeyStored} />
                        <KeyStatus
                            label="Ollama"
                            stored={embeddingOllamaBaseUrl ? { hasKey: true, last4: null } : null}
                            detail={embeddingOllamaBaseUrl || t("byok.notConfigured")}
                        />
                    </div>
                </Card>
            </Section>
        </>
    );
}

function KeyStatus({
    label,
    stored,
    detail,
}: {
    label: string;
    stored: RedactedKey | null;
    detail?: string;
}) {
    const t = useTranslations("settings.processing");
    const has = Boolean(stored?.hasKey);
    return (
        <div className="border-line bg-panel-2 rounded-[10px] border px-3.5 py-3">
            <div className="mb-1.5 flex items-center justify-between">
                <span className="text-ink text-xs font-semibold">{label}</span>
                <Badge variant={has ? "success" : "secondary"}>
                    {has ? t("byok.configured") : t("notSet")}
                </Badge>
            </div>
            <div className="mono text-ink-3 break-all text-[11px]">
                {detail ?? (stored?.last4 ? t("byok.ending", { last4: stored.last4 }) : "—")}
            </div>
        </div>
    );
}

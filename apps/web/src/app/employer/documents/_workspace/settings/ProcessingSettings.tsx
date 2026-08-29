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
import { useUser } from "~/lib/auth-client";

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
    embeddingHuggingFaceApiKey: RedactedKey;
    embeddingOllamaBaseUrl: string | null;
    embeddingOllamaModel: string | null;
    numberOfEmployees: string;
    createdAt: string;
    updatedAt: string;
}

const INDEX_OPTIONS: { value: string; label: string; desc: string }[] = [
    {
        value: "legacy-openai-1536",
        label: "OpenAI · 1536 dims",
        desc: "text-embedding-3-small. Default. Highest accuracy.",
    },
    {
        value: "huggingface-minilm-384",
        label: "HuggingFace MiniLM · 384 dims",
        desc: "Free inference API. Good balance of cost and quality.",
    },
    {
        value: "ollama-768",
        label: "Ollama (self-hosted)",
        desc: "Run your own embedding model locally via Ollama.",
    },
];

export function ProcessingSettings({ onActions }: SettingsSectionProps) {
    const { user } = useUser();

    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [dirty, setDirty] = useState(false);

    const [embeddingIndexKey, setEmbeddingIndexKey] = useState("legacy-openai-1536");
    const [embeddingOpenAIApiKey, setEmbeddingOpenAIApiKey] = useState("");
    const [embeddingHuggingFaceApiKey, setEmbeddingHuggingFaceApiKey] = useState("");
    const [embeddingOllamaBaseUrl, setEmbeddingOllamaBaseUrl] = useState("");
    const [embeddingOllamaModel, setEmbeddingOllamaModel] = useState("");

    const [openAIKeyStored, setOpenAIKeyStored] = useState<RedactedKey | null>(null);
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
                setHuggingFaceKeyStored(data.embeddingHuggingFaceApiKey);
                setEmbeddingOpenAIApiKey("");
                setEmbeddingHuggingFaceApiKey("");
                setEmbeddingOllamaBaseUrl(data.embeddingOllamaBaseUrl ?? "");
                setEmbeddingOllamaModel(data.embeddingOllamaModel ?? "");
                setDirty(false);
            } catch (error) {
                console.error(error);
                if (!cancelled) {
                    setStatus({
                        message: "Something went wrong loading settings.",
                        tone: "danger",
                    });
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
    }, []);

    const handleSave = useCallback(async () => {
        setIsSaving(true);
        setStatus(null);
        try {
            const body: Record<string, unknown> = {
                embeddingIndexKey,
                embeddingOllamaBaseUrl: embeddingOllamaBaseUrl || null,
                embeddingOllamaModel: embeddingOllamaModel || null,
            };
            if (embeddingOpenAIApiKey.trim().length > 0) {
                body.embeddingOpenAIApiKey = embeddingOpenAIApiKey.trim();
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
                throw new Error(
                    result.message ?? "A reindex is already running. Please wait for it to finish."
                );
            }
            if (!response.ok || result?.success !== true) {
                throw new Error(result?.message ?? "Error updating settings");
            }

            setDirty(false);
            if (response.status === 202 && result?.code === "REINDEX_SCHEDULED") {
                setStatus({
                    tone: "warn",
                    message:
                        result.message ??
                        `Reindex scheduled for ${result.documentCount ?? 0} document chunks. Existing searches keep using the previous index until the rewrite completes.`,
                });
                return;
            }
            setStatus({ tone: "ok", message: result?.message ?? "Company settings saved." });
            setEmbeddingOpenAIApiKey("");
            setEmbeddingHuggingFaceApiKey("");
        } catch (error) {
            setStatus({
                tone: "danger",
                message:
                    error instanceof Error
                        ? error.message
                        : "Failed to update settings. Please try again.",
            });
        } finally {
            setIsSaving(false);
        }
    }, [
        embeddingIndexKey,
        embeddingOllamaBaseUrl,
        embeddingOllamaModel,
        embeddingOpenAIApiKey,
        embeddingHuggingFaceApiKey,
    ]);

    usePublishedActions(
        onActions,
        {
            primaryLabel: "Save changes",
            primaryBusyLabel: "Saving…",
            onPrimary: handleSave,
            busy: isSaving,
            // Nothing to save until something is edited — a permanently-enabled Save
            // button teaches people to ignore it.
            disabled: loading || !dirty,
        },
        [handleSave, isSaving, loading, dirty]
    );

    /** Every edit marks the form dirty; the chrome reads that to enable Save. */
    const edit =
        <T,>(setter: (value: T) => void) =>
        (value: T) => {
            setter(value);
            setDirty(true);
        };

    const storedLabel = (k: RedactedKey | null) =>
        k?.hasKey ? `Stored · ending ${k.last4 ?? "****"}` : "Not set";

    if (loading) {
        return <StatusNote tone="muted">Loading settings…</StatusNote>;
    }

    return (
        <>
            {status && <StatusNote tone={status.tone}>{status.message}</StatusNote>}

            <Section
                title="Identity"
                description="Your Clerk profile. Update it from your account page."
            >
                <Card>
                    <Field label="Full name">
                        <TextInput value={user?.name ?? ""} disabled readOnly />
                    </Field>
                    <Field label="Email">
                        <TextInput value={user?.email ?? ""} disabled readOnly />
                    </Field>
                </Card>
            </Section>

            <Section
                title="Embedding index"
                description="The vector index behind semantic search. Changing it schedules a reindex of the whole corpus; existing searches keep using the previous index until that finishes."
            >
                <Card>
                    <Field label="Index">
                        <SelectInput
                            value={embeddingIndexKey}
                            onChange={e => edit(setEmbeddingIndexKey)(e.target.value)}
                        >
                            {INDEX_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </SelectInput>
                        <div
                            style={{
                                fontSize: 11,
                                color: "var(--ink-3)",
                                marginTop: 4,
                                lineHeight: 1.5,
                            }}
                        >
                            {INDEX_OPTIONS.find(o => o.value === embeddingIndexKey)?.desc}
                        </div>
                    </Field>

                    {embeddingIndexKey === "legacy-openai-1536" && (
                        <Field
                            label="OpenAI API key"
                            hint={`Leave blank to keep the existing key. ${storedLabel(openAIKeyStored)}.`}
                        >
                            <TextInput
                                type="password"
                                value={embeddingOpenAIApiKey}
                                onChange={e => edit(setEmbeddingOpenAIApiKey)(e.target.value)}
                                placeholder="<your-api-key>"
                                autoComplete="off"
                            />
                        </Field>
                    )}

                    {embeddingIndexKey === "huggingface-minilm-384" && (
                        <Field
                            label="HuggingFace API key"
                            hint={`Leave blank to keep the existing key. ${storedLabel(huggingFaceKeyStored)}.`}
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
                            <Field label="Ollama base URL" hint="e.g. http://localhost:11434">
                                <TextInput
                                    value={embeddingOllamaBaseUrl}
                                    onChange={e => edit(setEmbeddingOllamaBaseUrl)(e.target.value)}
                                    placeholder="http://localhost:11434"
                                />
                            </Field>
                            <Field label="Ollama model" hint="e.g. nomic-embed-text">
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

            <Section
                title="Bring your own keys"
                description="What this workspace has stored. Update the fields above to change them."
            >
                <Card>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                            gap: 14,
                        }}
                    >
                        <KeyStatus label="OpenAI" stored={openAIKeyStored} />
                        <KeyStatus label="HuggingFace" stored={huggingFaceKeyStored} />
                        <KeyStatus
                            label="Ollama"
                            stored={embeddingOllamaBaseUrl ? { hasKey: true, last4: null } : null}
                            detail={embeddingOllamaBaseUrl || "Not configured"}
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
    const has = Boolean(stored?.hasKey);
    return (
        <div
            style={{
                padding: "12px 14px",
                border: "1px solid var(--line)",
                borderRadius: 10,
                background: "var(--panel-2)",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 6,
                }}
            >
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>{label}</span>
                <Badge variant={has ? "success" : "secondary"}>
                    {has ? "Configured" : "Not set"}
                </Badge>
            </div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {detail ?? (stored?.last4 ? `ending ${stored.last4}` : "—")}
            </div>
        </div>
    );
}

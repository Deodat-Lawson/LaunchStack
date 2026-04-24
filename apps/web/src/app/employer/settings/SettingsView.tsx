"use client";

import React, { useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

import LoadingPage from "~/app/_components/loading";
import {
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  PageShell,
  Section,
  SelectInput,
  TextInput,
} from "~/app/employer/_components/primitives";

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

export interface SettingsViewProps {
  /**
   * Set when rendering inside the Studio drawer (or any bounded container) so
   * the shell uses `height: 100%` instead of `minHeight: 100vh`. The loading
   * state also inlines a spinner rather than short-circuiting to a full-page
   * loader.
   */
  embedded?: boolean;
}

export function SettingsView({ embedded = false }: SettingsViewProps) {
  const router = useRouter();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [displayName, setDisplayName] = useState(user?.fullName ?? "");
  const [email, setEmail] = useState(user?.emailAddresses[0]?.emailAddress ?? "");

  const [embeddingIndexKey, setEmbeddingIndexKey] = useState("legacy-openai-1536");
  const [embeddingOpenAIApiKey, setEmbeddingOpenAIApiKey] = useState("");
  const [embeddingHuggingFaceApiKey, setEmbeddingHuggingFaceApiKey] = useState("");
  const [embeddingOllamaBaseUrl, setEmbeddingOllamaBaseUrl] = useState("");
  const [embeddingOllamaModel, setEmbeddingOllamaModel] = useState("");

  const [openAIKeyStored, setOpenAIKeyStored] = useState<RedactedKey | null>(null);
  const [huggingFaceKeyStored, setHuggingFaceKeyStored] = useState<RedactedKey | null>(null);

  const [toast, setToast] = useState<{ message: string; tone: "ok" | "warn" | "danger" } | null>(
    null,
  );

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || !userId) {
      if (!embedded) router.push("/");
      return;
    }
    (async () => {
      try {
        const companyResponse = await fetch("/api/fetchCompany", { method: "GET" });
        if (!companyResponse.ok) throw new Error("Failed to fetch company info");
        const data = (await companyResponse.json()) as Company;

        setEmbeddingIndexKey(data.embeddingIndexKey ?? "legacy-openai-1536");
        setOpenAIKeyStored(data.embeddingOpenAIApiKey);
        setHuggingFaceKeyStored(data.embeddingHuggingFaceApiKey);
        setEmbeddingOpenAIApiKey("");
        setEmbeddingHuggingFaceApiKey("");
        setEmbeddingOllamaBaseUrl(data.embeddingOllamaBaseUrl ?? "");
        setEmbeddingOllamaModel(data.embeddingOllamaModel ?? "");

        setDisplayName(user?.fullName ?? "");
        setEmail(user?.emailAddresses[0]?.emailAddress ?? "");
      } catch (error) {
        console.error(error);
        setToast({ message: "Something went wrong loading settings.", tone: "danger" });
      } finally {
        setLoading(false);
      }
    })().catch(() => {
      setLoading(false);
    });
  }, [isLoaded, isSignedIn, userId, user, router, embedded]);

  const handleSave = async () => {
    setIsSaving(true);
    setToast(null);
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
          result.message ??
            "A reindex is already running. Please wait for it to finish.",
        );
      }
      if (!response.ok || result?.success !== true) {
        throw new Error(result?.message ?? "Error updating settings");
      }

      if (response.status === 202 && result?.code === "REINDEX_SCHEDULED") {
        setToast({
          tone: "warn",
          message:
            result.message ??
            `Reindex scheduled for ${result.documentCount ?? 0} document chunks. Existing searches keep using the previous index until the rewrite completes.`,
        });
        return;
      }
      setToast({ tone: "ok", message: result?.message ?? "Company settings saved." });
      setEmbeddingOpenAIApiKey("");
      setEmbeddingHuggingFaceApiKey("");
    } catch (error) {
      setToast({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Failed to update settings. Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return embedded ? (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        Loading settings…
      </div>
    ) : (
      <LoadingPage />
    );
  }

  const storedLabel = (k: RedactedKey | null) =>
    k?.hasKey ? `Stored · ending ${k.last4 ?? "****"}` : "Not set";

  return (
    <PageShell embedded={embedded}>
      <PageHeader
        eyebrow="Processing"
        title="Settings"
        description="Processing configuration — which embedding index powers semantic search, which API keys to use, and self-hosted endpoints. Changes to the embedding index schedule a reindex of your document corpus. Looking for company name / industry / people? Those live in Company metadata."
        actions={
          <Button
            onClick={() => void handleSave()}
            disabled={isSaving}
            style={{ padding: "9px 16px" }}
          >
            {isSaving ? "Saving…" : "Save changes"}
          </Button>
        }
      />

      {toast && (
        <div
          style={{
            marginBottom: 20,
            padding: "10px 14px",
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 1.5,
            background:
              toast.tone === "ok"
                ? "var(--accent-soft)"
                : toast.tone === "warn"
                ? "oklch(0.96 0.07 70)"
                : "oklch(0.96 0.05 25)",
            color:
              toast.tone === "ok"
                ? "var(--accent-ink)"
                : toast.tone === "warn"
                ? "oklch(0.4 0.13 55)"
                : "var(--danger)",
            border:
              "1px solid " +
              (toast.tone === "ok"
                ? "var(--accent-glow)"
                : toast.tone === "warn"
                ? "oklch(0.85 0.12 70)"
                : "oklch(0.85 0.09 25)"),
          }}
        >
          {toast.message}
        </div>
      )}

      <Section title="Identity" description="Your Clerk profile. Update via your account page.">
        <Card>
          <Field label="Full name">
            <TextInput value={displayName} disabled readOnly />
          </Field>
          <Field label="Email">
            <TextInput value={email} disabled readOnly />
          </Field>
        </Card>
      </Section>

      <Section
        title="Embedding index"
        description="The vector index that powers semantic search across your documents. Changing this will schedule a reindex."
      >
        <Card>
          <Field label="Index">
            <SelectInput
              value={embeddingIndexKey}
              onChange={(e) => setEmbeddingIndexKey(e.target.value)}
            >
              {INDEX_OPTIONS.map((opt) => (
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
              {INDEX_OPTIONS.find((o) => o.value === embeddingIndexKey)?.desc}
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
                onChange={(e) => setEmbeddingOpenAIApiKey(e.target.value)}
                placeholder="sk-…"
                autoComplete="off"
              />
            </Field>
          )}

          {embeddingIndexKey === "huggingface-minilm-384" && (
            <Field
              label="HuggingFace API key"
              hint={`Leave blank to keep the existing key. ${storedLabel(
                huggingFaceKeyStored,
              )}.`}
            >
              <TextInput
                type="password"
                value={embeddingHuggingFaceApiKey}
                onChange={(e) => setEmbeddingHuggingFaceApiKey(e.target.value)}
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
                  onChange={(e) => setEmbeddingOllamaBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                />
              </Field>
              <Field label="Ollama model" hint="e.g. nomic-embed-text">
                <TextInput
                  value={embeddingOllamaModel}
                  onChange={(e) => setEmbeddingOllamaModel(e.target.value)}
                  placeholder="nomic-embed-text"
                />
              </Field>
            </>
          )}
        </Card>
      </Section>

      <Section
        title="Self-host / BYOK"
        description="Bring-your-own-keys status. Update the keys above to change them."
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

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <Button onClick={() => void handleSave()} disabled={isSaving}>
          {isSaving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </PageShell>
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
  const has = !!stored?.hasKey;
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
        <Badge tone={has ? "ok" : "neutral"}>{has ? "Configured" : "Not set"}</Badge>
      </div>
      <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
        {detail ?? (stored?.last4 ? `ending ${stored.last4}` : "—")}
      </div>
    </div>
  );
}

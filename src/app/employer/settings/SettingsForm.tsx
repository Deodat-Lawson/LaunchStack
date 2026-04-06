"use client";

import React, { type FC, useState, useEffect } from "react";
import styles from "~/styles/Employer/Settings.module.css";
import {
    SUPPORTED_EMBEDDING_MODELS,
    EMBEDDING_PROVIDERS,
    PROVIDER_LABELS,
    DEFAULT_EMBEDDING_CONFIG,
    type EmbeddingProvider,
} from "~/lib/ai/embedding-config";

interface SettingsFormProps {
    // Display-only fields
    displayName: string;
    email: string;

    // Editable fields
    companyName: string;
    staffCount: string;
    companyType: "company" | "personal";

    // State flags
    isSaving: boolean;

    // Callbacks for updating parent state
    onCompanyNameChange: (value: string) => void;
    onStaffCountChange: (value: string) => void;

    // Callback for saving
    onSave: () => void;
}

interface StoredApiKey {
    provider: string;
    maskedKey: string;
    label: string | null;
    lastUsedAt: string | null;
    createdAt: string;
}

const SettingsForm: FC<SettingsFormProps> = ({
                                                 displayName,
                                                 email,
                                                 companyName,
                                                 staffCount,
                                                 companyType,
                                                 isSaving,
                                                 onCompanyNameChange,
                                                 onStaffCountChange,
                                                 onSave,
                                             }) => {
    const isPersonal = companyType === "personal";

    // Embedding config state
    const [currentProvider, setCurrentProvider] = useState<EmbeddingProvider>(DEFAULT_EMBEDDING_CONFIG.provider);
    const [currentModel, setCurrentModel] = useState(DEFAULT_EMBEDDING_CONFIG.model);
    const [selectedProvider, setSelectedProvider] = useState<EmbeddingProvider>(DEFAULT_EMBEDDING_CONFIG.provider);
    const [selectedModel, setSelectedModel] = useState(DEFAULT_EMBEDDING_CONFIG.model);
    const [isSavingEmbed, setIsSavingEmbed] = useState(false);
    const [embedMessage, setEmbedMessage] = useState<string | null>(null);
    const [connectedProviders, setConnectedProviders] = useState<string[]>([]);

    // API key management state
    const [storedKeys, setStoredKeys] = useState<StoredApiKey[]>([]);
    const [newKeyProvider, setNewKeyProvider] = useState<EmbeddingProvider>("openai");
    const [newKeyValue, setNewKeyValue] = useState("");
    const [showNewKey, setShowNewKey] = useState(false);
    const [isSavingKey, setIsSavingKey] = useState(false);
    const [keyMessage, setKeyMessage] = useState<string | null>(null);
    const [showAddKey, setShowAddKey] = useState(false);

    const availableModels = SUPPORTED_EMBEDDING_MODELS.filter(
        (m) => m.provider === selectedProvider
    );

    // Load current config and API keys
    useEffect(() => {
        fetch("/api/company/embedding-config")
            .then((res) => res.json())
            .then((data: { config?: { provider?: string; model?: string }; connectedProviders?: string[] }) => {
                const provider = (data.config?.provider ?? DEFAULT_EMBEDDING_CONFIG.provider) as EmbeddingProvider;
                const model = data.config?.model ?? DEFAULT_EMBEDDING_CONFIG.model;
                setCurrentProvider(provider);
                setCurrentModel(model);
                setSelectedProvider(provider);
                setSelectedModel(model);
                setConnectedProviders(data.connectedProviders ?? []);
            })
            .catch(() => {});

        void loadApiKeys();
    }, []);

    const loadApiKeys = async () => {
        try {
            const res = await fetch("/api/company/api-keys");
            const data = (await res.json()) as { keys?: StoredApiKey[] };
            setStoredKeys(data.keys ?? []);
        } catch {
            // Ignore
        }
    };

    const handleProviderChange = (provider: EmbeddingProvider) => {
        setSelectedProvider(provider);
        const firstModel = SUPPORTED_EMBEDDING_MODELS.find((m) => m.provider === provider);
        if (firstModel) setSelectedModel(firstModel.model);
        setEmbedMessage(null);
    };

    const handleSaveEmbedding = async () => {
        const chosen = SUPPORTED_EMBEDDING_MODELS.find(
            (m) => m.provider === selectedProvider && m.model === selectedModel
        );
        if (!chosen) return;

        setIsSavingEmbed(true);
        setEmbedMessage(null);
        try {
            const res = await fetch("/api/company/embedding-config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider: chosen.provider,
                    model: chosen.model,
                    dimensions: chosen.dimensions,
                }),
            });
            const data = (await res.json()) as { success?: boolean; warning?: string; error?: string };
            if (data.success) {
                setCurrentProvider(selectedProvider);
                setCurrentModel(selectedModel);
                setEmbedMessage(data.warning ?? "Embedding model updated successfully.");
            } else {
                setEmbedMessage(data.error ?? "Failed to update embedding model.");
            }
        } catch {
            setEmbedMessage("Failed to update embedding model.");
        } finally {
            setIsSavingEmbed(false);
        }
    };

    const handleSaveApiKey = async () => {
        if (!newKeyValue.trim()) return;

        setIsSavingKey(true);
        setKeyMessage(null);
        try {
            const res = await fetch("/api/company/api-keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider: newKeyProvider,
                    apiKey: newKeyValue,
                }),
            });
            const data = (await res.json()) as { success?: boolean; maskedKey?: string; error?: string };
            if (data.success) {
                setKeyMessage(`${PROVIDER_LABELS[newKeyProvider]} API key saved successfully.`);
                setNewKeyValue("");
                setShowAddKey(false);
                void loadApiKeys();
                // Update connected providers
                if (!connectedProviders.includes(newKeyProvider)) {
                    setConnectedProviders([...connectedProviders, newKeyProvider]);
                }
            } else {
                setKeyMessage(data.error ?? "Failed to save API key.");
            }
        } catch {
            setKeyMessage("Failed to save API key.");
        } finally {
            setIsSavingKey(false);
        }
    };

    const handleDeleteApiKey = async (provider: string) => {
        try {
            const res = await fetch("/api/company/api-keys", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ provider }),
            });
            const data = (await res.json()) as { success?: boolean };
            if (data.success) {
                void loadApiKeys();
                setConnectedProviders(connectedProviders.filter((p) => p !== provider));
                setKeyMessage(`${PROVIDER_LABELS[provider as EmbeddingProvider] ?? provider} API key removed.`);
            }
        } catch {
            setKeyMessage("Failed to remove API key.");
        }
    };

    const configChanged = selectedProvider !== currentProvider || selectedModel !== currentModel;

    return (
        <div className={styles.settingsContainer}>
            <h1 className={styles.settingsTitle}>Settings</h1>

            {/* Display Name */}
            <div className={styles.formGroup}>
                <label htmlFor="displayName" className={styles.label}>
                    Display Name
                </label>
                <input
                    id="displayName"
                    type="text"
                    className={styles.input}
                    value={displayName}
                    disabled
                />
            </div>

            {/* Email */}
            <div className={styles.formGroup}>
                <label htmlFor="email" className={styles.label}>
                    Email
                </label>
                <input
                    id="email"
                    type="email"
                    className={styles.input}
                    value={email}
                    disabled
                />
            </div>

            {/* Company / Workspace Name */}
            <div className={styles.formGroup}>
                <label htmlFor="companyName" className={styles.label}>
                    {isPersonal ? "Workspace Name" : "Company Name"}
                </label>
                <input
                    id="companyName"
                    type="text"
                    className={styles.input}
                    value={companyName}
                    onChange={(e) => onCompanyNameChange(e.target.value)}
                />
            </div>

            {/* Staff Count — hidden for personal workspaces */}
            {!isPersonal && (
                <div className={styles.formGroup}>
                    <label htmlFor="staffCount" className={styles.label}>
                        Number of Staff
                    </label>
                    <input
                        id="staffCount"
                        type="number"
                        className={styles.input}
                        value={staffCount}
                        onChange={(e) => onStaffCountChange(e.target.value)}
                    />
                </div>
            )}

            {/* Save Button */}
            <button
                onClick={onSave}
                className={styles.saveButton}
                disabled={isSaving}
            >
                {isSaving ? "Saving..." : "Save"}
            </button>

            {/* ── API Keys ──────────────────────────────────── */}
            <hr style={{ margin: "2rem 0", borderColor: "var(--color-gray-300, #d1d5db)" }} />
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "1rem" }}>
                API Keys
            </h2>
            <p style={{ fontSize: "0.875rem", opacity: 0.7, marginBottom: "1rem" }}>
                Connect your own API keys for embedding providers.
            </p>

            {/* Stored keys table */}
            {storedKeys.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                    {storedKeys.map((k) => (
                        <div
                            key={k.provider}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "0.75rem",
                                border: "1px solid var(--color-gray-200, #e5e7eb)",
                                borderRadius: "0.5rem",
                                marginBottom: "0.5rem",
                            }}
                        >
                            <div>
                                <span style={{ fontWeight: 600 }}>
                                    {PROVIDER_LABELS[k.provider as EmbeddingProvider] ?? k.provider}
                                </span>
                                <span style={{ marginLeft: "0.75rem", fontSize: "0.875rem", opacity: 0.6, fontFamily: "monospace" }}>
                                    {k.maskedKey}
                                </span>
                            </div>
                            <button
                                onClick={() => void handleDeleteApiKey(k.provider)}
                                style={{
                                    background: "none",
                                    border: "1px solid var(--color-red-300, #fca5a5)",
                                    color: "var(--color-red-600, #dc2626)",
                                    borderRadius: "0.375rem",
                                    padding: "0.25rem 0.75rem",
                                    fontSize: "0.8rem",
                                    cursor: "pointer",
                                }}
                            >
                                Remove
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Provider status list */}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                {EMBEDDING_PROVIDERS.map((p) => {
                    const isConnected = connectedProviders.includes(p);
                    return (
                        <span
                            key={p}
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.25rem",
                                padding: "0.25rem 0.75rem",
                                borderRadius: "1rem",
                                fontSize: "0.8rem",
                                border: `1px solid ${isConnected ? "var(--color-green-300, #86efac)" : "var(--color-gray-200, #e5e7eb)"}`,
                                background: isConnected ? "var(--color-green-50, #f0fdf4)" : "transparent",
                                color: isConnected ? "var(--color-green-700, #15803d)" : "var(--color-gray-500, #6b7280)",
                            }}
                        >
                            {isConnected ? "●" : "○"} {PROVIDER_LABELS[p]}
                        </span>
                    );
                })}
            </div>

            {/* Add key form */}
            {!showAddKey ? (
                <button
                    onClick={() => setShowAddKey(true)}
                    style={{
                        background: "none",
                        border: "1px dashed var(--color-gray-300, #d1d5db)",
                        borderRadius: "0.5rem",
                        padding: "0.5rem 1rem",
                        cursor: "pointer",
                        width: "100%",
                        fontSize: "0.875rem",
                        color: "var(--color-text-secondary, #6b7280)",
                    }}
                >
                    + Add API Key
                </button>
            ) : (
                <div style={{ border: "1px solid var(--color-gray-200, #e5e7eb)", borderRadius: "0.5rem", padding: "1rem" }}>
                    <div className={styles.formGroup}>
                        <label className={styles.label}>Provider</label>
                        <select
                            className={styles.input}
                            value={newKeyProvider}
                            onChange={(e) => setNewKeyProvider(e.target.value as EmbeddingProvider)}
                        >
                            {EMBEDDING_PROVIDERS.map((p) => (
                                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                            ))}
                        </select>
                    </div>
                    <div className={styles.formGroup}>
                        <label className={styles.label}>API Key</label>
                        <div style={{ position: "relative" }}>
                            <input
                                type={showNewKey ? "text" : "password"}
                                className={styles.input}
                                value={newKeyValue}
                                onChange={(e) => setNewKeyValue(e.target.value)}
                                placeholder={`Enter your ${PROVIDER_LABELS[newKeyProvider]} API key`}
                            />
                            <button
                                type="button"
                                onClick={() => setShowNewKey(!showNewKey)}
                                style={{
                                    position: "absolute",
                                    right: "0.5rem",
                                    top: "50%",
                                    transform: "translateY(-50%)",
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    fontSize: "0.75rem",
                                    color: "var(--color-text-secondary, #6b7280)",
                                }}
                            >
                                {showNewKey ? "Hide" : "Show"}
                            </button>
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button
                            onClick={() => void handleSaveApiKey()}
                            className={styles.saveButton}
                            disabled={isSavingKey || !newKeyValue.trim()}
                            style={{ flex: 1 }}
                        >
                            {isSavingKey ? "Validating & Saving..." : "Save Key"}
                        </button>
                        <button
                            onClick={() => { setShowAddKey(false); setNewKeyValue(""); setKeyMessage(null); }}
                            style={{
                                background: "none",
                                border: "1px solid var(--color-gray-300, #d1d5db)",
                                borderRadius: "0.375rem",
                                padding: "0.5rem 1rem",
                                cursor: "pointer",
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {keyMessage && (
                <p style={{ fontSize: "0.8rem", marginTop: "0.5rem", opacity: 0.8 }}>
                    {keyMessage}
                </p>
            )}

            {/* ── Embedding Model ──────────────────────────────────── */}
            <hr style={{ margin: "2rem 0", borderColor: "var(--color-gray-300, #d1d5db)" }} />
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "1rem" }}>
                Embedding Model
            </h2>

            <div className={styles.formGroup}>
                <label className={styles.label}>Provider</label>
                <select
                    className={styles.input}
                    value={selectedProvider}
                    onChange={(e) => handleProviderChange(e.target.value as EmbeddingProvider)}
                >
                    {EMBEDDING_PROVIDERS.map((p) => {
                        const isConnected = connectedProviders.includes(p) || p === "openai";
                        return (
                            <option key={p} value={p} disabled={!isConnected}>
                                {PROVIDER_LABELS[p]}{!isConnected ? " (add API key first)" : ""}
                            </option>
                        );
                    })}
                </select>
            </div>

            <div className={styles.formGroup}>
                <label className={styles.label}>Model</label>
                <select
                    className={styles.input}
                    value={selectedModel}
                    onChange={(e) => {
                        setSelectedModel(e.target.value);
                        setEmbedMessage(null);
                    }}
                >
                    {availableModels.map((m) => (
                        <option key={m.model} value={m.model}>
                            {m.label} — {m.dimensions}d — {m.costPer1MTokens}/1M tokens
                        </option>
                    ))}
                </select>
                {configChanged && (
                    <p style={{ fontSize: "0.8rem", color: "var(--color-amber-600, #d97706)", marginTop: "0.5rem" }}>
                        Changing the embedding model requires re-embedding all existing documents for accurate search.
                        New documents will use the updated model automatically.
                    </p>
                )}
                {embedMessage && (
                    <p style={{ fontSize: "0.8rem", marginTop: "0.5rem", opacity: 0.8 }}>
                        {embedMessage}
                    </p>
                )}
            </div>

            {configChanged && (
                <button
                    onClick={() => void handleSaveEmbedding()}
                    className={styles.saveButton}
                    disabled={isSavingEmbed}
                >
                    {isSavingEmbed ? "Saving..." : "Update Embedding Model"}
                </button>
            )}
        </div>
    );
};

export default SettingsForm;

"use client";

import React, { type FC, useState, useEffect } from "react";
import styles from "~/styles/Employer/Settings.module.css";
import {
    SUPPORTED_EMBEDDING_MODELS,
    DEFAULT_EMBEDDING_CONFIG,
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
    const [currentModel, setCurrentModel] = useState(DEFAULT_EMBEDDING_CONFIG.model);
    const [selectedModel, setSelectedModel] = useState(DEFAULT_EMBEDDING_CONFIG.model);
    const [isSavingEmbed, setIsSavingEmbed] = useState(false);
    const [embedMessage, setEmbedMessage] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/company/embedding-config")
            .then((res) => res.json())
            .then((data: { config?: { model?: string } }) => {
                const model = data.config?.model ?? DEFAULT_EMBEDDING_CONFIG.model;
                setCurrentModel(model);
                setSelectedModel(model);
            })
            .catch(() => {});
    }, []);

    const handleSaveEmbedding = async () => {
        const chosen = SUPPORTED_EMBEDDING_MODELS.find((m) => m.model === selectedModel);
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
            const data = (await res.json()) as { success?: boolean; warning?: string };
            if (data.success) {
                setCurrentModel(selectedModel);
                setEmbedMessage(data.warning ?? "Embedding model updated.");
            }
        } catch {
            setEmbedMessage("Failed to update embedding model.");
        } finally {
            setIsSavingEmbed(false);
        }
    };

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

            {/* ── AI Configuration ──────────────────────────────────── */}
            <hr style={{ margin: "2rem 0", borderColor: "var(--color-gray-300, #d1d5db)" }} />
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "1rem" }}>
                AI Configuration
            </h2>

            <div className={styles.formGroup}>
                <label className={styles.label}>Embedding Model</label>
                <select
                    className={styles.input}
                    value={selectedModel}
                    onChange={(e) => {
                        setSelectedModel(e.target.value);
                        setEmbedMessage(null);
                    }}
                >
                    {SUPPORTED_EMBEDDING_MODELS.map((m) => (
                        <option key={m.model} value={m.model}>
                            {m.label} — {m.costPer1MTokens}/1M tokens
                        </option>
                    ))}
                </select>
                {selectedModel !== currentModel && (
                    <p style={{ fontSize: "0.8rem", color: "var(--color-amber-600, #d97706)", marginTop: "0.5rem" }}>
                        Changing the embedding model affects how new documents are processed.
                        Existing documents will keep their current embeddings.
                    </p>
                )}
                {embedMessage && (
                    <p style={{ fontSize: "0.8rem", marginTop: "0.5rem", opacity: 0.8 }}>
                        {embedMessage}
                    </p>
                )}
            </div>

            {selectedModel !== currentModel && (
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
"use client";

import React, { type FC } from "react";
import styles from "~/styles/Employer/Settings.module.css";

interface SettingsFormProps {
    // Display-only fields
    displayName: string;
    email: string;

    // Editable fields
    companyName: string;
    staffCount: string;
    embeddingIndexKey: string;
    embeddingOpenAIApiKey: string;
    embeddingHuggingFaceApiKey: string;
    embeddingOllamaBaseUrl: string;
    embeddingOllamaModel: string;

    // State flags
    isSaving: boolean;

    // Callbacks for updating parent state
    onCompanyNameChange: (value: string) => void;
    onStaffCountChange: (value: string) => void;
    onEmbeddingIndexKeyChange: (value: string) => void;
    onEmbeddingOpenAIApiKeyChange: (value: string) => void;
    onEmbeddingHuggingFaceApiKeyChange: (value: string) => void;
    onEmbeddingOllamaBaseUrlChange: (value: string) => void;
    onEmbeddingOllamaModelChange: (value: string) => void;

    // Callback for saving
    onSave: () => void;
}

const SettingsForm: FC<SettingsFormProps> = ({
                                                 displayName,
                                                 email,
                                                 companyName,
                                                 staffCount,
                                                 embeddingIndexKey,
                                                 embeddingOpenAIApiKey,
                                                 embeddingHuggingFaceApiKey,
                                                 embeddingOllamaBaseUrl,
                                                 embeddingOllamaModel,
                                                 isSaving,
                                                 onCompanyNameChange,
                                                 onStaffCountChange,
                                                 onEmbeddingIndexKeyChange,
                                                 onEmbeddingOpenAIApiKeyChange,
                                                 onEmbeddingHuggingFaceApiKeyChange,
                                                 onEmbeddingOllamaBaseUrlChange,
                                                 onEmbeddingOllamaModelChange,
                                                 onSave,
                                             }) => {
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

            {/* Company Name */}
            <div className={styles.formGroup}>
                <label htmlFor="companyName" className={styles.label}>
                    Company Name
                </label>
                <input
                    id="companyName"
                    type="text"
                    className={styles.input}
                    value={companyName}
                    onChange={(e) => onCompanyNameChange(e.target.value)}
                />
            </div>

            {/* Staff Count */}
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

            <div className={styles.formGroup}>
                <label htmlFor="embeddingIndexKey" className={styles.label}>
                    Default Embedding Index
                </label>
                <select
                    id="embeddingIndexKey"
                    className={styles.input}
                    value={embeddingIndexKey}
                    onChange={(e) => onEmbeddingIndexKeyChange(e.target.value)}
                >
                    <option value="legacy-openai-1536">OpenAI Legacy (1536)</option>
                    <option value="ollama-default">Ollama Default</option>
                    <option value="huggingface-default">Hugging Face Default</option>
                    <option value="sidecar-default">Sidecar Default</option>
                </select>
            </div>

            <div className={styles.formGroup}>
                <label htmlFor="embeddingOpenAIApiKey" className={styles.label}>
                    OpenAI API Key (optional)
                </label>
                <input
                    id="embeddingOpenAIApiKey"
                    type="password"
                    className={styles.input}
                    value={embeddingOpenAIApiKey}
                    onChange={(e) => onEmbeddingOpenAIApiKeyChange(e.target.value)}
                />
            </div>

            <div className={styles.formGroup}>
                <label htmlFor="embeddingHuggingFaceApiKey" className={styles.label}>
                    Hugging Face API Key (optional)
                </label>
                <input
                    id="embeddingHuggingFaceApiKey"
                    type="password"
                    className={styles.input}
                    value={embeddingHuggingFaceApiKey}
                    onChange={(e) => onEmbeddingHuggingFaceApiKeyChange(e.target.value)}
                />
            </div>

            <div className={styles.formGroup}>
                <label htmlFor="embeddingOllamaBaseUrl" className={styles.label}>
                    Ollama Base URL (optional)
                </label>
                <input
                    id="embeddingOllamaBaseUrl"
                    type="text"
                    className={styles.input}
                    value={embeddingOllamaBaseUrl}
                    onChange={(e) => onEmbeddingOllamaBaseUrlChange(e.target.value)}
                />
            </div>

            <div className={styles.formGroup}>
                <label htmlFor="embeddingOllamaModel" className={styles.label}>
                    Ollama Model (optional)
                </label>
                <input
                    id="embeddingOllamaModel"
                    type="text"
                    className={styles.input}
                    value={embeddingOllamaModel}
                    onChange={(e) => onEmbeddingOllamaModelChange(e.target.value)}
                />
            </div>

            <p className={styles.label}>
                Optional provider fields are demo-only and currently stored in plaintext. Leave them blank to keep using server env defaults.
            </p>

            {/* Save Button */}
            <button
                onClick={onSave}
                className={styles.saveButton}
                disabled={isSaving}
            >
                {isSaving ? "Saving..." : "Save"}
            </button>
        </div>
    );
};

export default SettingsForm;

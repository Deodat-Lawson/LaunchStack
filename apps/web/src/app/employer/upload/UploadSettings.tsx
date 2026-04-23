"use client";

import React, { useCallback, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Settings } from "lucide-react";

interface BatchSettings {
  category: string;
  processingMethod: string;
  uploadDate: string;
  storageMethod: string;
}

interface UploadSettingsProps {
  categories: { id: string; name: string }[];
  batchSettings: BatchSettings;
  onBatchSettingsChange: React.Dispatch<React.SetStateAction<BatchSettings>>;
  onApplyBatchSettings: () => void;
  processingMethods: { value: string; label: string; description: string }[];
  isUploadThingConfigured: boolean;
  currentStorageValue: string;
  onToggleChange: (value: string) => void;
  isUpdatingPreference: boolean;
  onAddCategory?: (name: string) => Promise<void>;
  storageProvider?: "s3" | "database";
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--ink-2)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 9,
  border: "1px solid var(--line)",
  background: "var(--panel)",
  fontSize: 14,
  color: "var(--ink)",
  outline: "none",
  fontFamily: "inherit",
};

export function UploadSettings({
  categories,
  batchSettings,
  onBatchSettingsChange,
  onApplyBatchSettings,
  processingMethods,
  isUploadThingConfigured,
  currentStorageValue,
  onToggleChange,
  isUpdatingPreference,
  onAddCategory,
  storageProvider,
}: UploadSettingsProps) {
  const [expanded, setExpanded] = useState(false);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [isSavingCategory, setIsSavingCategory] = useState(false);

  const handleAddCategoryInline = useCallback(async () => {
    if (!newCategoryName.trim() || !onAddCategory) return;
    const name = newCategoryName.trim();
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      onBatchSettingsChange((prev) => ({ ...prev, category: name }));
      setNewCategoryName("");
      setIsAddingCategory(false);
      return;
    }
    setIsSavingCategory(true);
    try {
      await onAddCategory(name);
      onBatchSettingsChange((prev) => ({ ...prev, category: name }));
      setNewCategoryName("");
      setIsAddingCategory(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingCategory(false);
    }
  }, [newCategoryName, onAddCategory, categories, onBatchSettingsChange]);

  const categoryLabel = batchSettings.category
    ? categories.find((c) => c.name === batchSettings.category)?.name ??
      batchSettings.category
    : null;

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Settings size={14} color="var(--ink-3)" />
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
            Settings
          </span>
          {categoryLabel && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 500,
                background: "var(--accent-soft)",
                color: "var(--accent-ink)",
              }}
            >
              {categoryLabel}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp size={16} color="var(--ink-3)" />
        ) : (
          <ChevronDown size={16} color="var(--ink-3)" />
        )}
      </button>

      {expanded && (
        <div
          style={{
            padding: "16px 20px 20px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Category */}
          <div>
            <label style={labelStyle} htmlFor="batch-category">
              Category
            </label>
            {!isAddingCategory ? (
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  id="batch-category"
                  value={batchSettings.category}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === "__add_new__") {
                      setIsAddingCategory(true);
                    } else {
                      onBatchSettingsChange((prev) => ({ ...prev, category: value }));
                    }
                  }}
                  style={inputStyle}
                >
                  <option value="">Select a category (optional)</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                  {onAddCategory && (
                    <option value="__add_new__">+ Add new category…</option>
                  )}
                </select>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Enter category name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAddCategoryInline();
                    } else if (e.key === "Escape") {
                      setIsAddingCategory(false);
                      setNewCategoryName("");
                    }
                  }}
                  disabled={isSavingCategory}
                  autoFocus
                  style={inputStyle}
                />
                <button
                  onClick={() => void handleAddCategoryInline()}
                  disabled={!newCategoryName.trim() || isSavingCategory}
                  style={{
                    background:
                      !newCategoryName.trim() || isSavingCategory
                        ? "var(--line)"
                        : "var(--accent)",
                    color:
                      !newCategoryName.trim() || isSavingCategory
                        ? "var(--ink-3)"
                        : "white",
                    border: "none",
                    padding: "8px 14px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor:
                      !newCategoryName.trim() || isSavingCategory
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  {isSavingCategory ? "…" : "Add"}
                </button>
                <button
                  onClick={() => {
                    setIsAddingCategory(false);
                    setNewCategoryName("");
                  }}
                  style={{
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    color: "var(--ink-2)",
                    padding: "8px 14px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Processing method */}
          {processingMethods.length > 1 && (
            <div>
              <label style={{ ...labelStyle, marginBottom: 10 }}>
                Processing method
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {processingMethods.map((method) => {
                  const checked = batchSettings.processingMethod === method.value;
                  return (
                    <label
                      key={method.value}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "10px 12px",
                        borderRadius: 9,
                        border: `1px solid ${
                          checked ? "var(--accent)" : "var(--line)"
                        }`,
                        background: checked ? "var(--accent-soft)" : "var(--panel)",
                        cursor: "pointer",
                        transition: "background 120ms, border-color 120ms",
                      }}
                    >
                      <input
                        type="radio"
                        name="processing-method"
                        value={method.value}
                        checked={checked}
                        onChange={(e) =>
                          onBatchSettingsChange((prev) => ({
                            ...prev,
                            processingMethod: e.target.value,
                          }))
                        }
                        style={{
                          marginTop: 2,
                          accentColor: "var(--accent)",
                        }}
                      />
                      <div>
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: 600,
                            color: checked ? "var(--accent-ink)" : "var(--ink)",
                          }}
                        >
                          {method.label}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--ink-3)",
                            marginTop: 2,
                            lineHeight: 1.45,
                          }}
                        >
                          {method.description}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Upload date */}
          <div>
            <label style={labelStyle} htmlFor="uploadDate">
              Upload date
            </label>
            <input
              id="uploadDate"
              type="date"
              value={batchSettings.uploadDate}
              onChange={(e) =>
                onBatchSettingsChange((prev) => ({
                  ...prev,
                  uploadDate: e.target.value,
                }))
              }
              style={inputStyle}
            />
            <div
              style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4 }}
            >
              Optional: override the upload date for all documents
            </div>
          </div>

          {/* Storage method */}
          <div>
            <label style={labelStyle} htmlFor="storageMethod">
              Storage method
            </label>
            {storageProvider === "s3" ? (
              <div
                style={{
                  ...inputStyle,
                  background: "var(--line-2)",
                  color: "var(--ink-2)",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                S3
              </div>
            ) : (
              <select
                id="storageMethod"
                value={currentStorageValue}
                onChange={(e) => onToggleChange(e.target.value)}
                style={inputStyle}
              >
                <option value="database">Vercel Blob</option>
                <option value="cloud" disabled={!isUploadThingConfigured}>
                  UploadThing
                  {!isUploadThingConfigured && " (not configured)"}
                </option>
              </select>
            )}
            {isUpdatingPreference && (
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                  marginTop: 4,
                }}
              >
                Updating preference…
              </div>
            )}
          </div>

          <div>
            <button
              onClick={onApplyBatchSettings}
              style={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
                color: "var(--ink-2)",
                padding: "8px 14px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Plus size={13} />
              Apply to all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

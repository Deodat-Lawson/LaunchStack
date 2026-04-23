"use client";

import React from "react";
import {
  X,
  Check,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";

interface DocumentFile {
  id: string;
  file: File;
  title: string;
  category: string;
  uploadDate: string;
  processingMethod: string;
  storageMethod: string;
  status: "pending" | "uploading" | "success" | "error";
  progress: number;
  error?: string;
}

interface FileQueueProps {
  documents: DocumentFile[];
  categories: { id: string; name: string }[];
  expandedDocId: string | null;
  errors: Record<string, string>;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<DocumentFile>) => void;
  onClearAll: () => void;
  onToggleExpand: (id: string) => void;
  formatFileSize: (bytes: number) => string;
}

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

export function FileQueue({
  documents,
  categories,
  expandedDocId,
  errors,
  onRemove,
  onUpdate,
  onClearAll,
  onToggleExpand,
  formatFileSize,
}: FileQueueProps) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: 22,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--ink-3)",
            textTransform: "uppercase",
          }}
        >
          Queue · {documents.length} {documents.length === 1 ? "file" : "files"}
        </div>
        <button
          onClick={onClearAll}
          style={{
            background: "transparent",
            border: "1px solid var(--line)",
            color: "var(--ink-2)",
            padding: "6px 12px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Clear all
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {documents.map((doc, index) => {
          const isExpanded = expandedDocId === doc.id;
          const iconBg =
            doc.status === "success"
              ? "oklch(0.95 0.05 155)"
              : doc.status === "error"
                ? "oklch(0.95 0.05 25)"
                : doc.status === "uploading"
                  ? "var(--accent-soft)"
                  : "var(--line-2)";
          const iconColor =
            doc.status === "success"
              ? "oklch(0.4 0.14 155)"
              : doc.status === "error"
                ? "var(--danger)"
                : doc.status === "uploading"
                  ? "var(--accent-ink)"
                  : "var(--ink-2)";

          return (
            <div
              key={doc.id}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 11,
                overflow: "hidden",
                background: "var(--panel)",
              }}
            >
              <button
                onClick={() => onToggleExpand(doc.id)}
                style={{
                  width: "100%",
                  padding: 14,
                  background: "var(--line-2)",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  textAlign: "left",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: iconBg,
                      color: iconColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {doc.status === "success" ? (
                      <Check size={14} />
                    ) : doc.status === "error" ? (
                      <AlertCircle size={14} />
                    ) : doc.status === "uploading" ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      index + 1
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "var(--ink)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {doc.title}
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>
                      {formatFileSize(doc.file.size)}
                      {doc.status === "error" && doc.error && (
                        <span style={{ color: "var(--danger)", marginLeft: 8 }}>
                          · {doc.error}
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      color: "var(--ink-3)",
                    }}
                  >
                    {doc.status === "uploading" && (
                      <span
                        className="mono"
                        style={{
                          fontSize: 11.5,
                          color: "var(--accent-ink)",
                          fontWeight: 600,
                        }}
                      >
                        {doc.progress}%
                      </span>
                    )}
                    {doc.status === "pending" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(doc.id);
                        }}
                        aria-label="Remove file"
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--ink-3)",
                          padding: 4,
                          borderRadius: 6,
                          cursor: "pointer",
                          display: "inline-flex",
                        }}
                      >
                        <X size={14} />
                      </button>
                    )}
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {doc.status === "uploading" && (
                  <div
                    style={{
                      height: 3,
                      borderRadius: 3,
                      background: "var(--line)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${doc.progress}%`,
                        height: "100%",
                        background: "var(--accent)",
                        transition: "width 180ms",
                      }}
                    />
                  </div>
                )}
              </button>

              {isExpanded && doc.status === "pending" && (
                <div
                  style={{
                    padding: 16,
                    borderTop: "1px solid var(--line)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                  }}
                >
                  <div>
                    <label
                      htmlFor={`title-${doc.id}`}
                      style={{
                        display: "block",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--ink-2)",
                        marginBottom: 6,
                      }}
                    >
                      Document title <span style={{ color: "var(--danger)" }}>*</span>
                    </label>
                    <input
                      id={`title-${doc.id}`}
                      value={doc.title}
                      onChange={(e) => onUpdate(doc.id, { title: e.target.value })}
                      placeholder="Enter document title"
                      style={{
                        ...inputStyle,
                        borderColor: errors[`title-${doc.id}`]
                          ? "var(--danger)"
                          : "var(--line)",
                      }}
                    />
                    {errors[`title-${doc.id}`] && (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "var(--danger)",
                          marginTop: 4,
                        }}
                      >
                        {errors[`title-${doc.id}`]}
                      </div>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor={`category-${doc.id}`}
                      style={{
                        display: "block",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--ink-2)",
                        marginBottom: 6,
                      }}
                    >
                      Category
                    </label>
                    <select
                      id={`category-${doc.id}`}
                      value={doc.category}
                      onChange={(e) => onUpdate(doc.id, { category: e.target.value })}
                      style={inputStyle}
                    >
                      <option value="">Select a category (optional)</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={() => onRemove(doc.id)}
                    style={{
                      alignSelf: "flex-start",
                      background: "transparent",
                      border: "1px solid var(--line)",
                      color: "var(--danger)",
                      padding: "7px 12px",
                      borderRadius: 8,
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Trash2 size={13} />
                    Remove from queue
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

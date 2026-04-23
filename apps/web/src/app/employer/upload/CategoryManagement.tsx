"use client";

import React, { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

interface Category {
  id: string;
  name: string;
}

interface CategoryManagementProps {
  categories: Category[];
  onAddCategory: (newCategory: string) => Promise<void>;
  onRemoveCategory: (id: string, categoryName: string) => Promise<void>;
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "10px 12px",
  borderRadius: 9,
  border: "1px solid var(--line)",
  background: "var(--panel)",
  fontSize: 14,
  color: "var(--ink)",
  outline: "none",
  fontFamily: "inherit",
};

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "var(--scrim)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: "92vw",
          background: "var(--panel)",
          borderRadius: 14,
          boxShadow: "0 24px 64px var(--scrim-shadow), 0 0 0 1px var(--line)",
          padding: 24,
        }}
      >
        <div
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: "var(--ink)",
            letterSpacing: "-0.01em",
            marginBottom: 6,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 13.5,
            color: "var(--ink-3)",
            lineHeight: 1.55,
            marginBottom: 20,
          }}
        >
          {description}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
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
          <button
            onClick={onConfirm}
            style={{
              background: "var(--danger)",
              border: "none",
              color: "white",
              padding: "8px 14px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const CategoryManagement: React.FC<CategoryManagementProps> = ({
  categories,
  onAddCategory,
  onRemoveCategory,
}) => {
  const [newCategory, setNewCategory] = useState("");
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await onAddCategory(newCategory);
      setNewCategory("");
    } catch (error) {
      console.error("Error adding category:", error);
    }
  };

  const confirmDeleteCategory = async () => {
    if (!categoryToDelete) return;
    try {
      await onRemoveCategory(categoryToDelete.id, categoryToDelete.name);
      setCategoryToDelete(null);
    } catch (error) {
      console.error("Error removing category:", error);
    }
  };

  const disabled = !newCategory.trim();

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
        className="mono"
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.1em",
          color: "var(--ink-3)",
          textTransform: "uppercase",
          marginBottom: 12,
        }}
      >
        Manage categories
      </div>

      <form
        onSubmit={handleAddCategory}
        style={{ display: "flex", gap: 8, marginBottom: 18 }}
      >
        <input
          type="text"
          placeholder="New category name"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          style={inputStyle}
        />
        <button
          type="submit"
          disabled={disabled}
          style={{
            background: disabled ? "var(--line)" : "var(--accent)",
            color: disabled ? "var(--ink-3)" : "white",
            border: "none",
            padding: "10px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: disabled ? "not-allowed" : "pointer",
            boxShadow: disabled ? "none" : "0 1px 4px var(--accent-glow)",
            whiteSpace: "nowrap",
          }}
        >
          Add category
        </button>
      </form>

      {categories.length === 0 ? (
        <div
          style={{
            padding: "28px 20px",
            borderRadius: 11,
            border: "1px dashed var(--line)",
            background: "var(--line-2)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 13.5, color: "var(--ink-2)", fontWeight: 600 }}>
            No categories yet
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>
            Add one above, or create one while uploading.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {categories.map((cat) => (
            <div
              key={cat.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                background: "var(--line-2)",
                borderRadius: 9,
              }}
            >
              <span style={{ fontSize: 13.5, color: "var(--ink)" }}>{cat.name}</span>
              <button
                onClick={() => setCategoryToDelete(cat)}
                aria-label={`Delete ${cat.name} category`}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--ink-3)",
                  padding: 6,
                  borderRadius: 6,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--danger)";
                  e.currentTarget.style.background = "oklch(0.96 0.04 25)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--ink-3)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!categoryToDelete}
        title="Delete category"
        description={`Are you sure you want to delete "${categoryToDelete?.name ?? ""}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onCancel={() => setCategoryToDelete(null)}
        onConfirm={() => void confirmDeleteCategory()}
      />
    </div>
  );
};

export default CategoryManagement;

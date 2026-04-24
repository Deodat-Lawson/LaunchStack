"use client";

import { useState, useMemo, useEffect } from "react";
import { ArrowLeft, FileText, Loader2, AlertCircle, Sparkles } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/app/employer/documents/components/ui/select";
import type { TemplateField } from "@launchstack/features/legal-templates";
import { legalTheme as s } from "./LegalGeneratorTheme";

interface LegalDocumentTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  isLegal: true;
  fields: TemplateField[];
}

interface LegalDocumentConfigProps {
  template: LegalDocumentTemplate;
  onBack: () => void;
  onGenerate: (data: Record<string, string>) => void;
  isGenerating?: boolean;
  serverErrors?: Record<string, string>;
  globalError?: string | null;
  initialData?: Record<string, string>;
  /** Shown on the back button (e.g. after chat vs from template library). */
  backButtonLabel?: string;
  /** Optional note under the title (e.g. after legal assistant). */
  flowHint?: string;
}

export function LegalDocumentConfig({
  template,
  onBack,
  onGenerate,
  isGenerating = false,
  serverErrors,
  globalError = null,
  initialData,
  backButtonLabel = "Back to templates",
  flowHint,
}: LegalDocumentConfigProps) {
  const [formData, setFormData] = useState<Record<string, string>>(() => {
    if (!initialData) return {};
    const coerced: Record<string, string> = {};
    for (const [k, v] of Object.entries(initialData)) {
      coerced[k] = String(v);
    }
    return coerced;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!serverErrors) return;
    setErrors(serverErrors);
  }, [serverErrors]);

  const fieldGroups = useMemo(() => {
    const groups: { label: string; fields: TemplateField[] }[] = [];
    let currentGroup: TemplateField[] = [];
    let lastType = "";

    for (const field of template.fields) {
      if (field.key.includes("signature") || field.key.includes("signatory")) {
        if (currentGroup.length > 0) {
          groups.push({ label: "Document Details", fields: [...currentGroup] });
          currentGroup = [];
        }
        currentGroup.push(field);
        lastType = "signature";
      } else if (lastType === "signature") {
        currentGroup.push(field);
      } else {
        currentGroup.push(field);
      }
    }

    if (currentGroup.length > 0) {
      if (lastType === "signature") {
        groups.push({ label: "Signatures & Dates", fields: currentGroup });
      } else {
        groups.push({ label: "Document Details", fields: currentGroup });
      }
    }

    if (groups.length === 0) {
      groups.push({ label: "Document Details", fields: template.fields });
    }

    return groups;
  }, [template.fields]);

  const filledRequired = useMemo(() => {
    const required = template.fields.filter((f) => f.required);
    const filled = required.filter((f) => String(formData[f.key] ?? "").trim() !== "").length;
    return { filled, total: required.length };
  }, [template.fields, formData]);

  const handleChange = (key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const validate = (): { valid: boolean; firstInvalidField?: string } => {
    const newErrors: Record<string, string> = {};
    for (const field of template.fields) {
      const val = String(formData[field.key] ?? "");
      if (field.required && val.trim() === "") {
        newErrors[field.key] = `${field.label} is required`;
      }
      if (
        field.type === "select" &&
        val &&
        field.options &&
        !field.options.includes(val)
      ) {
        newErrors[field.key] = `Invalid selection for ${field.label}`;
      }
    }
    setErrors(newErrors);
    const firstInvalidField = Object.keys(newErrors)[0];
    return {
      valid: Object.keys(newErrors).length === 0,
      firstInvalidField,
    };
  };

  const handleSubmit = () => {
    const { valid, firstInvalidField } = validate();
    if (!valid) {
      if (firstInvalidField) {
        const field = document.getElementById(firstInvalidField);
        field?.scrollIntoView({ behavior: "smooth", block: "center" });
        field?.focus();
      }
      return;
    }
    onGenerate(formData);
  };

  const renderField = (field: TemplateField) => {
    const hasError = !!errors[field.key];
    const labelEl = (
      <label
        htmlFor={field.key}
        className={`${s.label} ${hasError ? s.labelError : ""}`}
      >
        {field.label}
        {field.required && <span className={s.required}>*</span>}
      </label>
    );

    const errorMsg = hasError && (
      <p
        className="flex items-center gap-1"
        style={{ fontSize: 12, color: "var(--danger)", margin: 0 }}
      >
        <AlertCircle className="h-3 w-3" />
        {errors[field.key]}
      </p>
    );

    const colSpan = field.type === "textarea" ? "md:col-span-2" : "";

    switch (field.type) {
      case "select":
        return (
          <div key={field.key} className={`space-y-2 ${colSpan}`}>
            {labelEl}
            <Select
              value={formData[field.key] ?? ""}
              onValueChange={(val) => handleChange(field.key, val)}
            >
              <SelectTrigger
                id={field.key}
                className={s.input}
                style={{
                  height: 42,
                  ...(hasError
                    ? {
                        borderColor: "var(--danger)",
                        boxShadow:
                          "0 0 0 3px oklch(from var(--danger) l c h / 0.18)",
                      }
                    : {}),
                }}
              >
                <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {field.options?.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errorMsg}
          </div>
        );

      case "textarea":
        return (
          <div key={field.key} className={`space-y-2 ${colSpan}`}>
            {labelEl}
            <textarea
              id={field.key}
              className={s.textarea}
              value={formData[field.key] ?? ""}
              onChange={(e) => handleChange(field.key, e.target.value)}
              placeholder={`Enter ${field.label.toLowerCase()}`}
              aria-invalid={hasError ? "true" : undefined}
            />
            {errorMsg}
          </div>
        );

      case "date":
        return (
          <div key={field.key} className={`space-y-2 ${colSpan}`}>
            {labelEl}
            <input
              id={field.key}
              type="date"
              className={s.input}
              value={formData[field.key] ?? ""}
              onChange={(e) => handleChange(field.key, e.target.value)}
              aria-invalid={hasError ? "true" : undefined}
            />
            {errorMsg}
          </div>
        );

      case "number":
        return (
          <div key={field.key} className={`space-y-2 ${colSpan}`}>
            {labelEl}
            <input
              id={field.key}
              type="number"
              className={s.input}
              value={formData[field.key] ?? ""}
              onChange={(e) => handleChange(field.key, e.target.value)}
              placeholder={`Enter ${field.label.toLowerCase()}`}
              aria-invalid={hasError ? "true" : undefined}
            />
            {errorMsg}
          </div>
        );

      default:
        return (
          <div key={field.key} className={`space-y-2 ${colSpan}`}>
            {labelEl}
            <input
              id={field.key}
              type="text"
              className={s.input}
              value={formData[field.key] ?? ""}
              onChange={(e) => handleChange(field.key, e.target.value)}
              placeholder={`Enter ${field.label.toLowerCase()}`}
              aria-invalid={hasError ? "true" : undefined}
            />
            {errorMsg}
          </div>
        );
    }
  };

  const progressPct =
    filledRequired.total > 0
      ? Math.round((filledRequired.filled / filledRequired.total) * 100)
      : 100;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-8 pb-5 md:px-10 md:pt-10">
        <div className="mx-auto w-full max-w-4xl">
          <button
            className={`${s.btn} ${s.btnGhost} ${s.btnSm}`}
            onClick={onBack}
            style={{ marginBottom: 18, paddingLeft: 6, paddingRight: 10 }}
          >
            <ArrowLeft className="h-4 w-4" />
            {backButtonLabel}
          </button>

          <div className="flex items-start gap-4">
            <div className={s.brandMark}>
              <FileText className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <span className={s.eyebrow}>Template fields</span>
              <h1 className={s.title} style={{ fontSize: "clamp(26px, 2.6vw, 34px)" }}>
                {template.name}
              </h1>
              <p className={s.sub} style={{ maxWidth: 680 }}>
                {template.description}
              </p>
              {flowHint ? (
                <div
                  className={s.banner}
                  style={{ padding: "12px 14px", marginTop: 12 }}
                >
                  <div className="flex items-start gap-3">
                    <Sparkles
                      className="h-4 w-4 flex-shrink-0 mt-0.5"
                      style={{ color: "var(--accent)" }}
                    />
                    <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
                      {flowHint}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {filledRequired.total > 0 && (
            <div className="mt-6 flex items-center gap-3">
              <div className={s.progressTrack}>
                <div
                  className={s.progressFill}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span style={{ fontSize: 12, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                {filledRequired.filled}/{filledRequired.total} required
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className={`flex-1 overflow-y-auto ${s.scrollbar}`}>
        <div className="mx-auto w-full max-w-4xl px-6 pb-10 md:px-10">
          <div className="space-y-6">
            {fieldGroups.map((group, groupIdx) => (
              <section key={groupIdx} className={s.panel} style={{ padding: 22 }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--ink)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {group.label}
                </h2>
                <hr className={s.hair} style={{ margin: "14px 0 18px" }} />
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  {group.fields.map(renderField)}
                </div>
              </section>
            ))}

            {(Object.keys(errors).length > 0 || globalError) && (
              <div className={`${s.banner} ${s.bannerDanger}`} style={{ padding: 16 }}>
                <div className="flex items-start gap-3">
                  <AlertCircle
                    className="h-4 w-4 flex-shrink-0 mt-0.5"
                    style={{ color: "var(--danger)" }}
                  />
                  <div className="space-y-2">
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--danger)",
                      }}
                    >
                      {globalError ??
                        "Please fill in all required fields before generating the document."}
                    </p>
                    {Object.keys(errors).length > 0 && (
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 18,
                          fontSize: 12,
                          color: "var(--danger)",
                          listStyle: "disc",
                        }}
                      >
                        {Object.entries(errors).map(([key, message]) => (
                          <li key={key} style={{ marginTop: 3 }}>
                            {message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                className={`${s.btn} ${s.btnOutline}`}
                onClick={onBack}
                disabled={isGenerating}
              >
                Cancel
              </button>
              <button
                className={`${s.btn} ${s.btnAccent} ${s.btnLg}`}
                onClick={handleSubmit}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating document…
                  </>
                ) : (
                  <>
                    <FileText className="h-4 w-4" />
                    Generate document
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

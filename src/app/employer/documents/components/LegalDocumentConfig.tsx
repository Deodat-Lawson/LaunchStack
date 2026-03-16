"use client";

import { useState, useMemo, useEffect } from "react";
import { ArrowLeft, FileText, Loader2, AlertCircle } from "lucide-react";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Input } from "~/app/employer/documents/components/ui/input";
import { Label } from "~/app/employer/documents/components/ui/label";
import { Textarea } from "~/app/employer/documents/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/app/employer/documents/components/ui/select";
import { Card } from "~/app/employer/documents/components/ui/card";
import type { TemplateField } from "~/lib/legal-templates/template-registry";

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
}

export function LegalDocumentConfig({
  template,
  onBack,
  onGenerate,
  isGenerating = false,
  serverErrors,
  globalError = null,
}: LegalDocumentConfigProps) {
  const [formData, setFormData] = useState<Record<string, string>>({});
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
      if (
        field.key.includes("signature") ||
        field.key.includes("signatory")
      ) {
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
      const val = formData[field.key] ?? "";
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
    return { valid: Object.keys(newErrors).length === 0, firstInvalidField };
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

    switch (field.type) {
      case "select":
        return (
          <div key={field.key} className="space-y-2">
            <Label
              htmlFor={field.key}
              className={`text-sm font-medium ${hasError ? "text-red-500" : "text-foreground"}`}
            >
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Select
              value={formData[field.key] ?? ""}
              onValueChange={(val) => handleChange(field.key, val)}
            >
              <SelectTrigger
                id={field.key}
                className={hasError ? "border-red-500" : ""}
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
            {hasError && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {errors[field.key]}
              </p>
            )}
          </div>
        );

      case "textarea":
        return (
          <div key={field.key} className="space-y-2 col-span-2">
            <Label
              htmlFor={field.key}
              className={`text-sm font-medium ${hasError ? "text-red-500" : "text-foreground"}`}
            >
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Textarea
              id={field.key}
              value={formData[field.key] ?? ""}
              onChange={(e) => handleChange(field.key, e.target.value)}
              placeholder={`Enter ${field.label.toLowerCase()}`}
              className={`min-h-[80px] ${hasError ? "border-red-500" : ""}`}
            />
            {hasError && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {errors[field.key]}
              </p>
            )}
          </div>
        );

      case "date":
        return (
          <div key={field.key} className="space-y-2">
            <Label
              htmlFor={field.key}
              className={`text-sm font-medium ${hasError ? "text-red-500" : "text-foreground"}`}
            >
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={field.key}
              type="date"
              value={formData[field.key] ?? ""}
              onChange={(e) => handleChange(field.key, e.target.value)}
              className={hasError ? "border-red-500" : ""}
            />
            {hasError && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {errors[field.key]}
              </p>
            )}
          </div>
        );

      case "number":
        return (
          <div key={field.key} className="space-y-2">
            <Label
              htmlFor={field.key}
              className={`text-sm font-medium ${hasError ? "text-red-500" : "text-foreground"}`}
            >
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={field.key}
              type="number"
              value={formData[field.key] ?? ""}
              onChange={(e) => handleChange(field.key, e.target.value)}
              placeholder={`Enter ${field.label.toLowerCase()}`}
              className={hasError ? "border-red-500" : ""}
            />
            {hasError && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {errors[field.key]}
              </p>
            )}
          </div>
        );

      default:
        return (
          <div key={field.key} className="space-y-2">
            <Label
              htmlFor={field.key}
              className={`text-sm font-medium ${hasError ? "text-red-500" : "text-foreground"}`}
            >
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={field.key}
              type="text"
              value={formData[field.key] ?? ""}
              onChange={(e) => handleChange(field.key, e.target.value)}
              placeholder={`Enter ${field.label.toLowerCase()}`}
              className={hasError ? "border-red-500" : ""}
            />
            {hasError && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {errors[field.key]}
              </p>
            )}
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-shrink-0 bg-background border-b border-border p-6">
        <div className="max-w-4xl mx-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="mb-4 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Templates
          </Button>

          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-600 rounded-xl shadow-lg shadow-blue-500/20">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {template.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                {template.description}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {fieldGroups.map((group, groupIdx) => (
            <Card key={groupIdx} className="p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4">
                {group.label}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {group.fields.map(renderField)}
              </div>
            </Card>
          ))}

          {(Object.keys(errors).length > 0 || globalError) && (
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm text-red-600 dark:text-red-400 font-medium">
                    {globalError ?? "Please fill in all required fields before generating the document."}
                  </p>
                  {Object.keys(errors).length > 0 && (
                    <ul className="list-disc pl-5 text-xs text-red-600 dark:text-red-400 space-y-1">
                      {Object.entries(errors).map(([key, message]) => (
                        <li key={key}>{message}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pb-6">
            <Button variant="outline" onClick={onBack} disabled={isGenerating}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isGenerating}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating Document...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 mr-2" />
                  Generate Document
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

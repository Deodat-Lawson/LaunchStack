import { TEMPLATE_REGISTRY, type TemplateField } from "./template-registry";

export interface FieldValidationError {
  key: string;
  label: string;
  message: string;
}

export interface DocumentValidationResult {
  valid: boolean;
  errors: FieldValidationError[];
}

const PERCENTAGE_FIELD_KEYS = new Set([
  "founder_1_equity_pct",
  "founder_2_equity_pct",
  "equity_percentage",
  "discount_rate",
]);

function isPercentageField(key: string): boolean {
  return PERCENTAGE_FIELD_KEYS.has(key) || key.endsWith("_pct");
}

function isPositiveIntField(key: string): boolean {
  return (
    key.endsWith("_months") ||
    key.endsWith("_years") ||
    key.endsWith("_days") ||
    key === "total_shares" ||
    key === "eligibility_age" ||
    key === "vacation_days"
  );
}

export function validateFieldValue(
  key: string,
  value: string,
  field: TemplateField,
): string | null {
  const cleaned = value.replace(/<[^>]*>/g, "").trim();

  if (field.required && (cleaned === "" || cleaned === `[${key}]`)) {
    return `${field.label} is required`;
  }

  if (cleaned === "" || cleaned === `[${key}]`) return null;

  if (field.type === "number") {
    const num = Number(cleaned);
    if (isNaN(num)) return `${field.label} must be a valid number`;
    if (num < 0) return `${field.label} cannot be negative`;
    if (isPercentageField(key) && num > 100)
      return `${field.label} must be between 0% and 100%`;
    if (isPositiveIntField(key) && num <= 0)
      return `${field.label} must be greater than 0`;
  }

  if (
    field.type === "select" &&
    field.options &&
    !field.options.includes(cleaned)
  ) {
    return `Invalid value for ${field.label}`;
  }

  return null;
}

export function extractFieldValuesFromSections(
  sectionContents: string[],
): Record<string, string> {
  const values: Record<string, string> = {};
  const regex =
    /<mark[^>]*data-field-key=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/mark>/gi;

  for (const html of sectionContents) {
    let match;
    while ((match = regex.exec(html)) !== null) {
      const key = match[2] ?? "";
      const rawVal = (match[3] ?? "").replace(/<[^>]*>/g, "").trim();
      if (!key) continue;
      if (!(key in values) || values[key]!.startsWith("[")) {
        values[key] = rawVal;
      }
    }
  }

  return values;
}

export function validateDocument(
  fieldValues: Record<string, string>,
  templateFields: TemplateField[],
): DocumentValidationResult {
  const errors: FieldValidationError[] = [];
  const seen = new Set<string>();

  for (const field of templateFields) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);

    const value = fieldValues[field.key] ?? "";
    const error = validateFieldValue(field.key, value, field);
    if (error) {
      errors.push({ key: field.key, label: field.label, message: error });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Builds the flat field map expected by Docxtemplater from the editor HTML plus optional
 * stored snapshot. Every template field key is present so the Word file matches the page.
 */
export function buildTemplateFieldDataForDocx(
  templateId: string,
  contentHtml: string,
  fallback?: Record<string, string>,
): Record<string, string> {
  const template = TEMPLATE_REGISTRY[templateId];
  if (!template) return {};
  const fromMarks = extractFieldValuesFromSections([contentHtml]);
  const out: Record<string, string> = {};
  for (const f of template.fields) {
    out[f.key] = fromMarks[f.key] ?? fallback?.[f.key] ?? "";
  }
  return out;
}

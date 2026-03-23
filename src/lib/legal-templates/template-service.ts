import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import fs from "fs";
import path from "path";
import { TEMPLATE_REGISTRY } from "./template-registry";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface GenerateResult {
  success: boolean;
  errors: string[];
  document: Buffer | null;
  filename: string;
}

export function validateData(
  templateId: string,
  data: Record<string, string>
): ValidationResult {
  const template = TEMPLATE_REGISTRY[templateId];
  if (!template) {
    return { valid: false, errors: [`Unknown template: ${templateId}`] };
  }

  const errors: string[] = [];
  for (const field of template.fields) {
    const val = data[field.key] ?? "";
    if (field.required && val.trim() === "") {
      errors.push(`Missing required field: ${field.label} (${field.key})`);
    }
    if (
      field.type === "select" &&
      val &&
      field.options &&
      !field.options.includes(val)
    ) {
      errors.push(
        `Invalid value for ${field.label}: "${val}". Must be one of: ${field.options.join(", ")}`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

export function fillTemplate(
  templatePath: string,
  data: Record<string, string>
): Buffer {
  const fullPath = path.resolve(process.cwd(), "public", templatePath);
  const content = fs.readFileSync(fullPath);
  const zip = new PizZip(content);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter(part: { module?: string; value: string }) {
      if (!part.module) {
        return `[${part.value}]`;
      }
      return "";
    },
  });

  doc.render(data);

  return doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  }) as Buffer;
}

export function generateDocument(
  templateId: string,
  data: Record<string, string>
): GenerateResult {
  const template = TEMPLATE_REGISTRY[templateId];
  if (!template) {
    return {
      success: false,
      errors: [`Unknown template: ${templateId}`],
      document: null,
      filename: "",
    };
  }

  const validation = validateData(templateId, data);
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors,
      document: null,
      filename: "",
    };
  }

  const filledDoc = fillTemplate(template.file, data);

  return {
    success: true,
    errors: [],
    document: filledDoc,
    filename: `${template.id}-${Date.now()}.docx`,
  };
}

export { TEMPLATE_REGISTRY };

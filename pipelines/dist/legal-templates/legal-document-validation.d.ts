import { type TemplateField } from "./template-registry.js";
export interface FieldValidationError {
    key: string;
    label: string;
    message: string;
}
export interface DocumentValidationResult {
    valid: boolean;
    errors: FieldValidationError[];
}
export declare function validateFieldValue(key: string, value: string, field: TemplateField): string | null;
export declare function extractFieldValuesFromSections(sectionContents: string[]): Record<string, string>;
export declare function validateDocument(fieldValues: Record<string, string>, templateFields: TemplateField[]): DocumentValidationResult;
/**
 * Builds the flat field map expected by Docxtemplater from the editor HTML plus optional
 * stored snapshot. Every template field key is present so the Word file matches the page.
 */
export declare function buildTemplateFieldDataForDocx(templateId: string, contentHtml: string, fallback?: Record<string, string>): Record<string, string>;
//# sourceMappingURL=legal-document-validation.d.ts.map
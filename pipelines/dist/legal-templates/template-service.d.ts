import { TEMPLATE_REGISTRY } from "./template-registry.js";
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    fieldErrors: Record<string, string>;
}
export interface GenerateResult {
    success: boolean;
    errors: string[];
    document: Buffer | null;
    filename: string;
    fieldErrors?: Record<string, string>;
}
export declare function validateData(templateId: string, data: Record<string, string>): ValidationResult;
export declare function fillTemplate(templatePath: string, data: Record<string, string>): Buffer;
export declare function generateDocument(templateId: string, data: Record<string, string>): GenerateResult;
export { TEMPLATE_REGISTRY };
//# sourceMappingURL=template-service.d.ts.map
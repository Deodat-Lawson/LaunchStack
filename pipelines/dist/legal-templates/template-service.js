import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import fs from "fs";
import path from "path";
import { TEMPLATE_REGISTRY } from "./template-registry.js";
export function validateData(templateId, data) {
    const template = TEMPLATE_REGISTRY[templateId];
    if (!template) {
        return {
            valid: false,
            errors: [`Unknown template: ${templateId}`],
            fieldErrors: {},
        };
    }
    const errors = [];
    const fieldErrors = {};
    for (const field of template.fields) {
        const val = data[field.key] ?? "";
        if (field.required && val.trim() === "") {
            const message = `${field.label} is required`;
            errors.push(message);
            fieldErrors[field.key] = message;
        }
        if (field.type === "select" && val && field.options && !field.options.includes(val)) {
            const message = `Invalid selection for ${field.label}`;
            errors.push(message);
            fieldErrors[field.key] = message;
        }
    }
    return { valid: errors.length === 0, errors, fieldErrors };
}
export function fillTemplate(templatePath, data) {
    const fullPath = path.resolve(process.cwd(), "public", templatePath);
    const content = fs.readFileSync(fullPath);
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        nullGetter(part) {
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
    });
}
export function generateDocument(templateId, data) {
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
            fieldErrors: validation.fieldErrors,
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
//# sourceMappingURL=template-service.js.map

export interface TemplateField {
    key: string;
    label: string;
    type: "text" | "textarea" | "date" | "number" | "select";
    required: boolean;
    options?: string[];
}
export interface LegalTemplate {
    id: string;
    name: string;
    file: string;
    description: string;
    fields: TemplateField[];
}
export declare const TEMPLATE_REGISTRY: Record<string, LegalTemplate>;
//# sourceMappingURL=template-registry.d.ts.map

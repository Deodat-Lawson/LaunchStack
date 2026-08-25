import type { LegalTemplate } from "./template-registry.js";
export interface EditorSection {
    id: string;
    type: "title" | "heading" | "paragraph";
    label?: string;
    content: string;
    editable?: boolean;
}
export declare function buildEditorSections(template: LegalTemplate, data: Record<string, string>): EditorSection[];
//# sourceMappingURL=section-builders.d.ts.map
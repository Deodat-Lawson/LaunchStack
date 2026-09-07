// Client-safe surface — exports here must not import node:fs / node:path /
// docxtemplater / pizzip, otherwise Next transpilation fails when a client
// component pulls this barrel in. The Node-only document generator
// (generateDocument, fillTemplate, validateData) lives on the
// `./template-service` subpath and is imported by server code only.
export { TEMPLATE_REGISTRY } from "./template-registry.js";
export { buildEditorSections } from "./section-builders.js";
export { parseLegalDocumentHtmlToSections } from "./html-to-sections.js";
export { validateFieldValue, extractFieldValuesFromSections, validateDocument, buildTemplateFieldDataForDocx, } from "./legal-document-validation.js";
//# sourceMappingURL=index.js.map
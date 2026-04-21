// Client-safe surface — exports here must not import node:fs / node:path /
// docxtemplater / pizzip, otherwise Next transpilation fails when a client
// component pulls this barrel in. The Node-only document generator
// (generateDocument, fillTemplate, validateData) lives on the
// `./template-service` subpath and is imported by server code only.

export {
  TEMPLATE_REGISTRY,
  type LegalTemplate,
  type TemplateField,
} from "./template-registry";
export {
  buildEditorSections,
  type EditorSection,
} from "./section-builders";
export { parseLegalDocumentHtmlToSections } from "./html-to-sections";
export {
  validateFieldValue,
  extractFieldValuesFromSections,
  validateDocument,
  buildTemplateFieldDataForDocx,
  type DocumentValidationResult,
  type FieldValidationError,
} from "./legal-document-validation";

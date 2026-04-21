export {
  TEMPLATE_REGISTRY,
  type LegalTemplate,
  type TemplateField,
} from "./template-registry";
export {
  validateData,
  fillTemplate,
  generateDocument,
  type GenerateResult,
  type ValidationResult,
} from "./template-service";
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

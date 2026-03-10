// Document-related types

/** Display category for document preview (PDF, image, docx, xlsx, pptx, text, etc.) */
export type DocumentDisplayType =
  | "pdf"
  | "image"
  | "docx"   // Word documents (.doc, .docx, .odt)
  | "xlsx"   // Spreadsheets (.xls, .xlsx, .ods, .csv)
  | "pptx"   // Presentations (.ppt, .pptx, .odp)
  | "text"   // Plain text, HTML, Markdown
  | "unknown";

export interface DocumentType {
  id: number;
  title: string;
  category: string;
  aiSummary?: string;
  url: string;
  /** MIME type when available (from API); otherwise inferred from URL/title */
  mimeType?: string;
}

/** Infer display type from document for viewer rendering */
export function getDocumentDisplayType(doc: { url: string; title: string; mimeType?: string }): DocumentDisplayType {
  const mime = (doc.mimeType ?? "").toLowerCase();
  if (mime) {
    if (mime === "application/pdf") return "pdf";
    if (mime.startsWith("image/")) return "image";
    // Word / DOCX
    if (
      mime.includes("word") ||
      mime === "application/vnd.oasis.opendocument.text"
    )
      return "docx";
    // PowerPoint / PPTX (check before generic "document" to avoid false match)
    if (
      mime.includes("powerpoint") ||
      mime.includes("presentation") ||
      mime === "application/vnd.oasis.opendocument.presentation"
    )
      return "pptx";
    // Excel / XLSX
    if (
      mime.includes("excel") ||
      mime.includes("spreadsheet") ||
      mime === "application/vnd.oasis.opendocument.spreadsheet"
    )
      return "xlsx";
    if (mime.startsWith("text/") || mime === "application/csv") return "text";
  }
  const src = `${doc.url} ${doc.title}`.toLowerCase();
  if (/\b\.pdf\b/.test(src)) return "pdf";
  if (/\.(png|jpg|jpeg|gif|webp|tiff|tif|bmp|svg)\b/.test(src)) return "image";
  if (/\.(docx?|odt)\b/.test(src)) return "docx";
  if (/\.(pptx?|odp)\b/.test(src)) return "pptx";
  if (/\.(xlsx?|ods)\b/.test(src)) return "xlsx";
  if (/\.(txt|md|html?|csv)\b/.test(src)) return "text";
  return "unknown";
}

export interface CategoryGroup {
  name: string;
  isOpen: boolean;
  documents: DocumentType[];
}


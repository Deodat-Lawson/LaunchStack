# Usage Examples

## Document upload (cloud or database storage)

Upload and process a document via `uploadDocument`. Supports both cloud URLs (UploadThing) and database paths (`/api/files/...`).

```typescript
const response = await fetch("/api/uploadDocument", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: "user_xxx",
    documentUrl: "https://utfs.io/f/xxx", // or /api/files/123 for DB storage
    documentName: "report.pdf",
    category: "Compliance",
    storageType: "cloud", // or "database"
    mimeType: "application/pdf",
    preferredProvider: "azure", // optional: azure, datalab, landing_ai
  }),
});

const result = await response.json();
```

## Local upload (database storage)

For direct upload to database storage:

```typescript
const formData = new FormData();
formData.append("file", file);
formData.append("userId", userId);
formData.append("documentName", file.name);
formData.append("categoryId", categoryId);

const response = await fetch("/api/upload-local", {
  method: "POST",
  body: formData,
});

const result = await response.json();
```

## Document Q&A

Ask runs on one endpoint, from a signed-in workspace session. `searchScope` picks what it answers from: one `document`, the `selected` documents, or `none` for a general question. The model searches the web itself when the question needs it and a search key is configured.

```typescript
const response = await fetch("/api/agents/documentQ&A/AIChat/query", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    question: "What are the key compliance requirements?",
    searchScope: "document",
    documentId: 123,
  }),
});

const { summarizedAnswer, references, webSources } = await response.json();
```

## Predictive analysis

```typescript
const response = await fetch("/api/agents/predictive-document-analysis", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    documentId: "123",
    categoryId: "456",
  }),
});

const analysis = await response.json();
```

## Supported document types (ingestion)

The unified ingestion layer supports:

- **PDF** — native extraction or OCR for scanned
- **DOCX** — Mammoth
- **XLSX** — SheetJS
- **PPTX** — custom adapter
- **Images** — OCR (Azure, Tesseract, etc.)
- **CSV, text, HTML, Markdown** — native or Cheerio

## OCR provider notes

- OCR behavior is controlled via provider keys in environment variables.
- If OCR UI options are not visible, verify OCR keys are present.
- Use OCR for scanned/image-based PDFs; digital PDFs usually do not need it.
- `preferredProvider` can be `azure`, `datalab`, or `landing_ai` when multiple are configured.

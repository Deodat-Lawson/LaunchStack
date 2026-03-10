/**
 * OCR-to-Vector Pipeline Types
 * Strictly typed structures for normalized OCR output and chunking
 */

/**
 * Represents a single table extracted from a document page
 */
export interface ExtractedTable {
  /** Raw table data as rows of cells */
  rows: string[][];
  /** Markdown representation for LLM consumption */
  markdown: string;
  /** Optional: bounding box or position info */
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Number of rows in the table */
  rowCount: number;
  /** Number of columns in the table */
  columnCount: number;
}

/**
 * Normalized page content structure - the canonical format
 * all OCR providers must map to
 */
export interface PageContent {
  pageNumber: number;
  textBlocks: string[];
  tables: ExtractedTable[];
}

/**
 * Document-level normalized output
 */
export interface NormalizedDocument {
  pages: PageContent[];
  metadata: DocumentMetadata;
}

/**
 * Metadata about the processed document
 */
export interface DocumentMetadata {
  totalPages: number;
  provider: OCRProvider;
  processingTimeMs: number;
  confidenceScore?: number;
  documentType?: DocumentType;
  hasHandwriting?: boolean;
  language?: string;
}

/**
 * Supported OCR providers
 */
export type OCRProvider = "AZURE" | "LANDING_AI" | "NATIVE_PDF" | "DATALAB" | "INGESTION";

/**
 * Document complexity assessment result
 */
export interface ComplexityAssessment {
  score: number; // 0-100
  isHandwritten: boolean;
  hasComplexTables: boolean;
  hasMixedContent: boolean;
  recommendedProvider: OCRProvider;
  samplePageNumber: number;
}

/**
 * Document type classification
 */
export type DocumentType =
  | "contract"
  | "financial"
  | "scanned"
  | "handwritten"
  | "general"
  | "other";

/**
 * Chunk types for vectorization
 */
export type ChunkType = "text" | "table";

/**
 * A single chunk ready for embedding
 */
export interface DocumentChunk {
  /** Unique identifier for the chunk */
  id: string;
  /** The content to be embedded */
  content: string;
  /** Type of content */
  type: ChunkType;
  /** Metadata for retrieval context */
  metadata: ChunkMetadata;
  /** Sub-chunks for finer retrieval (Parent-Child architecture) */
  children?: DocumentChunk[];
}

/**
 * Metadata attached to each chunk
 */
export interface ChunkMetadata {
  pageNumber: number;
  chunkIndex: number;
  totalChunksInPage: number;
  isTable: boolean;
  tableIndex?: number;
  /** For tables: brief description of table contents */
  tableDescription?: string;
  /** Source document info */
  documentId?: number;
  documentTitle?: string;
  /** Structure path for contextual retrieval */
  structurePath?: string;
}

/**
 * Final vectorized chunk ready for database insertion
 */
export interface VectorizedChunk {
  content: string;
  metadata: ChunkMetadata;
  vector: number[];
  /** Matryoshka 512-dim embedding for fast index */
  vectorShort?: number[]; 
  /** Vectorized children */
  children?: VectorizedChunk[];
}

/**
 * OCR Adapter interface - all providers must implement this
 */
export interface OCRAdapter {
  /**
   * Process a document and return normalized page content
   * @param documentUrl - URL or path to the document
   * @param options - Provider-specific options
   */
  uploadDocument(
    documentUrl: string,
    options?: OCRAdapterOptions
  ): Promise<NormalizedDocument>;

  /**
   * Extract a single page for complexity assessment
   * @param documentUrl - URL or path to the document
   * @param pageNumber - Page to extract (1-indexed)
   */
  extractPage(documentUrl: string, pageNumber: number): Promise<PageContent>;

  /**
   * Get the provider name
   */
  getProviderName(): OCRProvider;
}

/**
 * Common options for OCR adapters
 */
export interface OCRAdapterOptions {
  /** Force OCR even on native PDFs */
  forceOCR?: boolean;
  /** Use LLM for enhanced extraction */
  useLLM?: boolean;
  /** Target output format */
  outputFormat?: "markdown" | "json" | "structured";
  /** Specific pages to process (1-indexed) */
  pages?: number[];
  /** Language hint for OCR */
  language?: string;
}

/**
 * Provider-specific raw responses for debugging
 */
export interface RawProviderResponse {
  provider: OCRProvider;
  rawData: unknown;
  timestamp: string;
}

/**
 * Inngest event payload for document processing
 */
export interface ProcessDocumentEventData {
  jobId: string;
  documentUrl: string;
  documentName: string;
  companyId: string;
  userId: string;
  documentId: number;
  category: string;
  /** MIME type of the uploaded file (used by the ingestion router) */
  mimeType?: string;
  options?: {
    forceOCR?: boolean;
    preferredProvider?: OCRProvider;
  };
}

/**
 * Result of the complete OCR-to-Vector pipeline
 */
export interface PipelineResult {
  success: boolean;
  jobId: string;
  documentId?: number;
  chunks: VectorizedChunk[];
  metadata: {
    totalChunks: number;
    textChunks: number;
    tableChunks: number;
    totalPages: number;
    provider: OCRProvider;
    processingTimeMs: number;
    embeddingTimeMs: number;
    estimatedCostCents?: number;
  };
  error?: string;
}


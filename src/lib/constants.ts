/**
 * Common constants used across the PDR AI application
 */

// Analysis Types
export const ANALYSIS_TYPES = [
  'contract',
  'financial',
  'technical',
  'compliance',
  'general'
] as const;

export type AnalysisType = typeof ANALYSIS_TYPES[number];

// Timeout Limits
export const TIMEOUT_LIMITS = {
  MIN_MS: 5000,  // 5 seconds
  MAX_MS: 120000, // 2 minutes
  DEFAULT_MS: 30000 // 30 seconds
} as const;

// Cache Configuration
export const CACHE_CONFIG = {
  TTL_HOURS: 24,
  MAX_ENTRIES: 1000
} as const;

// Document Processing (SUPPORTED_FORMATS aligned with ingestion/upload-accepted)
export const DOCUMENT_LIMITS = {
  MAX_FILE_SIZE_MB: 50,
  MAX_PAGES: 1000,
  SUPPORTED_FORMATS: [
    'pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif', 'webp', 'gif', 'bmp',
    'docx', 'doc', 'xlsx', 'xls', 'csv', 'pptx', 'ppt',
    'txt', 'md', 'markdown', 'html', 'htm',
  ] as const
} as const;

// Batch Document Upload
export const BATCH_UPLOAD_CONFIG = {
  /** Maximum number of files accepted in a single batch request. */
  MAX_FILES: 20,
  /** Combined size cap for all files in a batch (MB). */
  MAX_TOTAL_SIZE_MB: 500,
  /** Number of files processed concurrently through the OCR/embedding pipeline. */
  MAX_CONCURRENT_UPLOADS: 3,
  /** Front-end polling interval when waiting for batch job completion (ms). */
  QUEUE_POLL_INTERVAL_MS: 2000,
} as const;

/** Convenience alias used by upload route validation. */
export const BATCH_UPLOAD_MAX_FILES = BATCH_UPLOAD_CONFIG.MAX_FILES;

// Predictive Analysis batching
export const ANALYSIS_BATCH_CONFIG = {
  MAX_CHUNKS_PER_CALL: 10,
  MAX_CHARACTERS_PER_CALL: 12000,
  MAX_CONCURRENCY: 12
} as const;

// Priority Levels
export const PRIORITY_LEVELS = [
  'immediate',
  'high',
  'medium',
  'low'
] as const;

export type PriorityLevel = typeof PRIORITY_LEVELS[number];

// Urgency Levels
export const URGENCY_LEVELS = [
  'critical',
  'high',
  'medium',
  'low'
] as const;

export type UrgencyLevel = typeof URGENCY_LEVELS[number];

// Error Types
export const ERROR_TYPES = {
  VALIDATION: 'validation',
  TIMEOUT: 'timeout',
  DATABASE: 'database',
  EXTERNAL_SERVICE: 'external_service',
  AI_SERVICE: 'ai_service',
  UNKNOWN: 'unknown'
} as const;

export type ErrorType = typeof ERROR_TYPES[keyof typeof ERROR_TYPES];

// HTTP Status Codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TIMEOUT: 408,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503
} as const;

// Default Messages
export const DEFAULT_MESSAGES = {
  LOADING: "Please wait while we set up your workspace",
  ERROR_GENERIC: "An unexpected error occurred. Please try again.",
  SUCCESS_ANALYSIS: "Document analysis completed successfully",
  NO_DOCUMENTS: "No documents found",
  INVALID_REQUEST: "Invalid request data provided"
} as const;

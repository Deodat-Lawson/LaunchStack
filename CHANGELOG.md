# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **OCR Processing Feature** - Advanced optical character recognition for scanned documents
  - New OCR service module (`src/app/api/services/ocrService.ts`) with Datalab Marker API integration
  - Asynchronous submission and polling architecture for OCR processing
  - Configurable OCR options (force_ocr, use_llm, output_format, strip_existing_ocr)
  - Comprehensive error handling and retry logic with 5-minute timeout
  - Database schema enhancements: `ocrEnabled`, `ocrProcessed`, `ocrMetadata` fields
  - Frontend OCR checkbox in document upload interface with help text
  - Custom styling for OCR checkbox with dark theme support
  - Optional `DATALAB_API_KEY` environment variable for OCR functionality
- Enhanced environment variable validation in `src/env.js` with comprehensive schema for all required variables
- New constants file (`src/lib/constants.ts`) for centralized configuration management
- API utilities (`src/lib/api-utils.ts`) for standardized error handling and response patterns
- Comprehensive TypeScript types (`src/types/api.ts`) for better type safety across the application
- Missing environment variables in `.env.example` file with proper documentation

### Enhanced
- **Document Upload API** (`src/app/api/uploadDocument/route.ts`):
  - Dual-path processing architecture: OCR path for scanned documents, standard path for digital PDFs
  - Unified chunking and embedding pipeline for both processing methods
  - Stores OCR metadata with document records for tracking and analytics
  - Support for `enableOCR` parameter in upload requests
  - Improved type safety with proper TypeScript interfaces

- **Predictive Document Analysis API** (`src/app/api/agents/predictive-document-analysis/route.ts`):
  - Improved input validation with detailed error messages
  - Enhanced error handling with specific error types and HTTP status codes
  - Better timeout and configuration management using centralized constants
  - More descriptive error responses with timestamps and error categorization
  - Improved type safety with proper TypeScript interfaces

- **Loading Component** (`src/app/_components/loading.tsx`):
  - Added proper TypeScript interface with optional props
  - Enhanced accessibility with ARIA labels and roles
  - Improved component reusability with configurable message and title props
  - Better semantic HTML structure

### Improved
- Code organization with centralized constants and utilities
- Type safety across API endpoints and components
- Error handling consistency throughout the application
- Development experience with better IntelliSense and type checking
- Documentation and code maintainability

### Fixed
- **Document lifecycle correctness:** Uploads, new versions, ZIP children, and archive summaries now atomically persist their document/version/job state, converge retries through stable idempotency keys, dispatch only after job creation, and propagate strict version IDs. Users no longer get stranded or duplicate document trees when a request or dispatch is retried; dispatch remains non-outbox and ambiguous remote acceptance relies on stable event-ID dedupe/retry.
- **TypeScript/ESLint Compliance**:
  - Replaced all `any` types with proper TypeScript types in `ocrService.ts`
  - Fixed unsafe type assignments and member access violations
  - Removed trivially inferred type annotations
  - Replaced logical OR (`||`) with nullish coalescing (`??`) for safer null/undefined handling
  - Improved type safety in `uploadDocument/route.ts`
  - All linter errors resolved (38 errors fixed)

### Technical Improvements
- Centralized configuration management
- Standardized API response patterns
- Enhanced error categorization and handling
- Better separation of concerns
- Improved code reusability and maintainability

### Environment & Configuration
- Added comprehensive environment variable validation
- Updated `.env.example` with all required variables and documentation
- Better configuration management with centralized constants
- Improved development setup documentation
- Added `DATALAB_API_KEY` for optional OCR functionality

### Documentation
- **README.md** - Comprehensive OCR feature documentation:
  - Added OCR processing section with detailed usage guide
  - When to use OCR (scanned documents, image-based PDFs, handwritten content)
  - Backend infrastructure details (service module, database schema, API integration)
  - Frontend integration documentation (UI, validation, styling)
  - Processing flow diagrams for both standard and OCR paths
  - OCR vs Standard processing comparison table
  - Error handling documentation
  - Datalab API setup instructions
  - Environment variables reference updated with `DATALAB_API_KEY`
  - API endpoints section updated with OCR support details
  - Project structure updated to include OCR service
  - Added OCR troubleshooting section
- **CHANGELOG.md** - Documented all OCR feature additions and linter fixes

## [Previous Versions]
This changelog starts from the current state of the codebase. Previous version history can be found in the git commit history.
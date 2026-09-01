const VECTOR_PATTERN = /\[[-\d.,eE+\s]{200,}\]/g;

/**
 * Error messages from failed vector queries can embed the full query vector
 * (thousands of characters of floats). Strip it before logging.
 */
export function sanitizeErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) return "Unknown error";
    const msg = error.message;
    if (msg.length < 300) return msg;
    return msg.replace(VECTOR_PATTERN, "[<embedding vector>]").slice(0, 500);
}

/**
 * A transcription that failed for a reason the uploader can act on.
 *
 * `message` is the operator's detail (status codes, the vendor's own words)
 * and goes to the log; `userMessage` is the one sentence the person who added
 * the recording sees in place of a generic "failed to upload".
 */
export class TranscriptionError extends Error {
    readonly userMessage: string;
    /** HTTP status the upload route answers with: 422 for the file, 502 for the vendor. */
    readonly status: number;

    constructor(message: string, userMessage: string, status = 422) {
        super(message);
        this.name = "TranscriptionError";
        this.userMessage = userMessage;
        this.status = status;
    }
}

export function isTranscriptionError(error: unknown): error is TranscriptionError {
    return error instanceof TranscriptionError;
}

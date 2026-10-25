/**
 * What to tell a person when a source fails to process.
 *
 * The worker records the raw error — for a rate-limited embedding call that
 * is a provider's whole JSON body, `RESOURCE_EXHAUSTED` and all. That text
 * is for operators. People get one plain sentence, whether running it again
 * could help, and the raw text only behind a details toggle.
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";

export type SourceFailureCategory =
    | "embedding_quota"
    | "embedding_unavailable"
    | "ocr_unavailable"
    | "transcription_unavailable"
    | "misconfigured"
    | "file_unreadable"
    | "file_missing"
    | "timeout"
    | "interrupted"
    | "internal"
    | "unknown";

export interface SourceFailure {
    category: SourceFailureCategory;
    /** A few words for the source row, short enough to sit beside Retry: "Usage limit hit". */
    label: string;
    /** One sentence a person can act on. */
    message: string;
    /** Could running it again work? When not, people are pointed at support instead. */
    retryable: boolean;
    /** The raw error without the pipeline's prefix — for the details toggle and support. */
    detail: string | null;
}

const COPY: Record<SourceFailureCategory, Omit<SourceFailure, "category" | "detail">> = {
    embedding_quota: {
        label: "Usage limit hit",
        message: "The embedding service is over its usage limit. Try again in a few minutes.",
        retryable: true,
    },
    embedding_unavailable: {
        label: "Embedding offline",
        message: "The embedding service is unavailable. Try again in a few minutes.",
        retryable: true,
    },
    ocr_unavailable: {
        label: "OCR unavailable",
        message: "The OCR service is unavailable. Try again in a few minutes.",
        retryable: true,
    },
    transcription_unavailable: {
        label: "Transcriber offline",
        message: "The transcription service is unavailable. Try again in a few minutes.",
        retryable: true,
    },
    misconfigured: {
        label: "Not set up",
        message: "This server isn't set up to process this file. Retrying won't help yet.",
        retryable: false,
    },
    file_unreadable: {
        label: "Couldn't read file",
        message:
            "Couldn't read this file. It may be damaged, password-protected, or in a format we can't open.",
        retryable: false,
    },
    file_missing: {
        label: "File missing",
        message: "Couldn't load the uploaded file. Try uploading it again.",
        retryable: false,
    },
    timeout: {
        label: "Took too long",
        message: "Processing took too long and was stopped. Try again.",
        retryable: true,
    },
    interrupted: {
        label: "Interrupted",
        message: "Processing kept stopping before it could finish. Try again.",
        retryable: true,
    },
    internal: {
        label: "Processing error",
        message: "Something went wrong on our side while processing this file.",
        retryable: false,
    },
    unknown: {
        label: "Couldn't process",
        message: "Something went wrong while processing this file.",
        retryable: true,
    },
};

/** Words for the category in a support request. */
export const SOURCE_FAILURE_CATEGORY_NAMES: Record<SourceFailureCategory, string> = {
    embedding_quota: "Embedding usage limit",
    embedding_unavailable: "Embedding service unavailable",
    ocr_unavailable: "OCR service unavailable",
    transcription_unavailable: "Transcription service unavailable",
    misconfigured: "Server configuration",
    file_unreadable: "Unreadable file",
    file_missing: "Missing file",
    timeout: "Timed out",
    interrupted: "Interrupted",
    internal: "Internal error",
    unknown: "Unknown error",
};

export function isSourceFailureCategory(value: unknown): value is SourceFailureCategory {
    return typeof value === "string" && Object.hasOwn(COPY, value);
}

/** The dead-event handler's prefix (apps/worker/src/ports/failure.ts). */
const PIPELINE_PREFIX = /^pipeline event dead:\s*/i;

/** Errors raised while embedding: the client's own messages and its provider wrapper. */
const EMBEDDING = /embedding|OpenAI API error/i;
const TRANSCRIPTION = /transcri|ffmpeg|ffprobe/i;
const QUOTA = /\b429\b|RESOURCE_EXHAUSTED|rate[ -]?limit|quota|too many requests/i;
const NETWORK = /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|network/i;
/**
 * The HTTP status an error reports — "returned 502", "error: 401",
 * "failed (503)", "URL: 404" — and not any three-digit number ("Page 512").
 */
function httpStatus(text: string): number | null {
    const match =
        /(?:returned|failed|error|status|url)\b[^\d\n]{0,12}([1-5]\d\d)\b|\(([1-5]\d\d)\)/i.exec(
            text
        );
    const code = match?.[1] ?? match?.[2];
    return code ? Number(code) : null;
}

function isServerError(text: string): boolean {
    const status = httpStatus(text);
    return (status !== null && status >= 500) || /unavailable|bad gateway/i.test(text);
}

function isClientError(text: string): boolean {
    const status = httpStatus(text);
    return status !== null && status >= 400 && status < 500;
}

function categorize(text: string): SourceFailureCategory {
    // A producer bug: the payload never matched the protocol. Replays repeat it.
    if (/protocol validation/i.test(text)) return "internal";

    if (
        /not configured|is not set|is required|EmbeddingConfiguration|no pending index key/i.test(
            text
        )
    ) {
        return "misconfigured";
    }

    if (QUOTA.test(text)) {
        if (EMBEDDING.test(text)) return "embedding_quota";
        return TRANSCRIPTION.test(text) ? "transcription_unavailable" : "ocr_unavailable";
    }

    if (
        /Invalid data found when processing input|produced no chunks|reported no duration|Invalid ZIP entry|password|encrypt|corrupt|malformed|invalid pdf|not a pdf|unsupported (?:file|format|media|mime)|could not (?:parse|decode)/i.test(
            text
        )
    ) {
        return "file_unreadable";
    }

    if (/timed? ?out|timeout|ETIMEDOUT/i.test(text)) return "timeout";
    if (/stale claim|reclaimed/i.test(text)) return "interrupted";

    // Fetching the stored file itself: a 4xx means it is gone or refused.
    if (/fetch failed|failed to (?:download|fetch)/i.test(text) && httpStatus(text) !== null) {
        return isClientError(text) ? "file_missing" : "ocr_unavailable";
    }

    if (EMBEDDING.test(text)) {
        if (NETWORK.test(text) || isServerError(text)) return "embedding_unavailable";
        // The provider refused the request itself — a key, a model, a dimension.
        if (isClientError(text)) return "misconfigured";
    }

    if (TRANSCRIPTION.test(text)) return "transcription_unavailable";

    if (/Pipeline state .* not found|mismatch|root document structure|withDbRetry/i.test(text)) {
        return "internal";
    }

    if (
        NETWORK.test(text) ||
        /converter|OCR|Azure|Landing\.AI|Datalab|Docling|Polling failed/i.test(text) ||
        isServerError(text)
    ) {
        return "ocr_unavailable";
    }

    return "unknown";
}

/**
 * Turn the worker's raw error into what a person should see. Nothing raw
 * becomes the message; an empty error is "something went wrong", retryable.
 */
export function describeSourceFailure(raw: string | null | undefined): SourceFailure {
    const stripped = raw?.replace(PIPELINE_PREFIX, "").trim();
    const detail = stripped === undefined || stripped === "" ? null : stripped;
    const category = detail ? categorize(detail) : "unknown";
    return { category, ...COPY[category], detail };
}

/** What a "Contact us about this error" link carries to the contact form. */
export interface SourceFailureReport {
    /** The source's title. */
    document: string;
    documentId?: number;
    category: SourceFailureCategory;
    /** The OCR job id — the trace id operators filter the worker's logs by. */
    jobId?: string;
}

const REPORT_TOPIC = "source-failure";
const MAX_TITLE = 200;
const MAX_JOB_ID = 128;

/**
 * The contact page, pre-filled for one failure. Carries ids and the category,
 * never the raw error: operators find that in the logs by the job id.
 */
export function sourceFailureContactHref(report: SourceFailureReport): string {
    const params = new URLSearchParams({
        topic: REPORT_TOPIC,
        document: report.document.slice(0, MAX_TITLE),
        category: report.category,
    });
    if (report.documentId !== undefined) params.set("documentId", String(report.documentId));
    if (report.jobId) params.set("job", report.jobId.slice(0, MAX_JOB_ID));
    return `/employer/contact?${params.toString()}`;
}

/** The report a contact link carried, or null when the page was opened some other way. */
export function readSourceFailureReport(
    params: Record<string, string | string[] | undefined>
): SourceFailureReport | null {
    const one = (key: string) => {
        const value = params[key];
        const trimmed = (Array.isArray(value) ? value[0] : value)?.trim();
        return trimmed === "" ? undefined : trimmed;
    };
    const document = one("document");
    const category = one("category");
    if (one("topic") !== REPORT_TOPIC || !document || !isSourceFailureCategory(category)) {
        return null;
    }
    const documentId = Number(one("documentId"));
    return {
        document: document.slice(0, MAX_TITLE),
        documentId: Number.isInteger(documentId) && documentId > 0 ? documentId : undefined,
        category,
        jobId: one("job")?.slice(0, MAX_JOB_ID),
    };
}

/** The subject and opening lines a failure report pre-fills. */
export function sourceFailureReportText(report: SourceFailureReport): {
    subject: string;
    details: string;
} {
    return {
        subject: `Problem processing "${report.document}"`,
        details: [
            `Document: ${report.document}`,
            report.documentId !== undefined ? `Document ID: ${report.documentId}` : null,
            `Error: ${SOURCE_FAILURE_CATEGORY_NAMES[report.category]} (${report.category})`,
            report.jobId ? `Job / trace ID: ${report.jobId}` : null,
        ]
            .filter((line): line is string => line !== null)
            .join("\n"),
    };
}

// ---------------------------------------------------------------------------
// In the reader's language
// ---------------------------------------------------------------------------
//
// `COPY` and `SOURCE_FAILURE_CATEGORY_NAMES` above are the English, kept for
// callers that have no translator (the server, tests). What a person reads
// goes through `sources.failure` instead: pass its `t` to the functions
// below, or call `useSourceFailureCopy()` in a component.

/** `useTranslations("sources.failure")`. */
export type SourceFailureTranslator = ReturnType<typeof useTranslations<"sources.failure">>;

/** The failure with its label and message in the reader's language. */
export function localizeSourceFailure(
    failure: SourceFailure,
    t: SourceFailureTranslator
): SourceFailure {
    return {
        ...failure,
        label: t(`categories.${failure.category}.label`),
        message: t(`categories.${failure.category}.message`),
    };
}

/** The category's words in a support request, in the reader's language. */
export function sourceFailureCategoryName(
    category: SourceFailureCategory,
    t: SourceFailureTranslator
): string {
    return t(`categories.${category}.name`);
}

/** `sourceFailureReportText` in the reader's language. */
export function localizedSourceFailureReportText(
    report: SourceFailureReport,
    t: SourceFailureTranslator
): { subject: string; details: string } {
    return {
        subject: t("report.subject", { document: report.document }),
        details: [
            t("report.document", { document: report.document }),
            report.documentId !== undefined
                ? t("report.documentId", { id: String(report.documentId) })
                : null,
            t("report.error", {
                name: sourceFailureCategoryName(report.category, t),
                category: report.category,
            }),
            report.jobId ? t("report.jobId", { jobId: report.jobId }) : null,
        ]
            .filter((line): line is string => line !== null)
            .join("\n"),
    };
}

/**
 * Everything above, bound to the reader's language: `describe` is
 * `describeSourceFailure` with translated words.
 */
export function useSourceFailureCopy(): {
    describe: (raw: string | null | undefined) => SourceFailure;
    categoryName: (category: SourceFailureCategory) => string;
    reportText: (report: SourceFailureReport) => { subject: string; details: string };
} {
    const t = useTranslations("sources.failure");
    return useMemo(
        () => ({
            describe: raw => localizeSourceFailure(describeSourceFailure(raw), t),
            categoryName: category => sourceFailureCategoryName(category, t),
            reportText: report => localizedSourceFailureReportText(report, t),
        }),
        [t]
    );
}

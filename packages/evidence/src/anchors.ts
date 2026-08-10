/**
 * Stable citation anchors (ADR-005 §1, §4).
 *
 * An anchor pins a claim to an immutable source version plus a span inside
 * it. `anchorKey` produces the canonical, orderable string form that answers
 * and stored references use; `parseAnchorKey` is its inverse. `chunkId` and
 * `quote` are presentation hints and are never part of anchor identity.
 */

/** Page span in a paged source. Pages are 1-based; `endPage` is inclusive. */
export interface PageSpan {
  kind: "page";
  page: number;
  /** Inclusive end page. Omitted (or equal to `page`) for a single page. */
  endPage?: number;
}

/**
 * Time span in an audio/video source, in seconds from the start.
 * `endSeconds` may equal `startSeconds` (an instant) but never precede it.
 */
export interface TimeSpan {
  kind: "time";
  startSeconds: number;
  endSeconds: number;
}

/**
 * Character range in a text source. `start` is inclusive, `end` exclusive;
 * `end` may equal `start` (a caret position) but never precede it.
 */
export interface CharSpan {
  kind: "char";
  start: number;
  end: number;
}

/** The location of cited evidence inside one immutable source version. */
export type AnchorSpan = PageSpan | TimeSpan | CharSpan;

/**
 * A citation into an immutable source version. Identity is
 * (sourceId, sourceVersionId, span) — see `anchorKey`. `chunkId` and `quote`
 * are optional presentation hints excluded from identity.
 */
export interface CitationAnchor {
  sourceId: number;
  sourceVersionId: number;
  span: AnchorSpan;
  /** Retrieval-chunk hint; not part of anchor identity. */
  chunkId?: number;
  /** Quoted snippet shown with the citation; not part of anchor identity. */
  quote?: string;
}

/** `anchorKey` output parsed back into its identity fields. */
export type ParsedAnchorKey = Pick<
  CitationAnchor,
  "sourceId" | "sourceVersionId" | "span"
>;

const isPositiveInt = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

/**
 * Structural validity of a span: integer 1-based pages, finite non-negative
 * seconds, integer non-negative character offsets — and never an inverted
 * range (`endPage < page`, `endSeconds < startSeconds`, `end < start`).
 * Equal endpoints are allowed (single page, instant, caret).
 */
export function isValidAnchorSpan(span: AnchorSpan): boolean {
  switch (span.kind) {
    case "page":
      if (!isPositiveInt(span.page)) return false;
      return (
        span.endPage === undefined ||
        (Number.isInteger(span.endPage) && span.endPage >= span.page)
      );
    case "time":
      return (
        Number.isFinite(span.startSeconds) &&
        span.startSeconds >= 0 &&
        Number.isFinite(span.endSeconds) &&
        span.endSeconds >= span.startSeconds
      );
    case "char":
      return (
        Number.isInteger(span.start) &&
        span.start >= 0 &&
        Number.isInteger(span.end) &&
        span.end >= span.start
      );
    default:
      return false;
  }
}

/** Validity of a full anchor: positive integer ids plus a valid span. */
export function isValidCitationAnchor(anchor: CitationAnchor): boolean {
  return (
    isPositiveInt(anchor.sourceId) &&
    isPositiveInt(anchor.sourceVersionId) &&
    isValidAnchorSpan(anchor.span)
  );
}

/** Seconds serialized in plain decimal only, so keys stay parseable. */
const DECIMAL_SECONDS = /^\d+(?:\.\d+)?$/;

function formatSeconds(value: number): string {
  const text = String(value);
  if (!DECIMAL_SECONDS.test(text)) {
    throw new RangeError(
      `Time-span seconds must serialize as plain decimal, got ${text}`,
    );
  }
  return text;
}

/**
 * Canonical string identity of an anchor, e.g. "src:12/ver:34/page:5-8",
 * "src:12/ver:34/time:12.5-31.2", "src:12/ver:34/char:100-250".
 *
 * Independent of the optional `chunkId`/`quote` fields. A page span whose
 * `endPage` equals `page` collapses to the single-page form so equal anchors
 * always share one key. Throws `RangeError` on an invalid anchor (see
 * `isValidCitationAnchor`) so malformed keys can never be produced.
 */
export function anchorKey(anchor: CitationAnchor): string {
  if (!isValidCitationAnchor(anchor)) {
    throw new RangeError("Cannot build an anchor key from an invalid anchor");
  }
  const span = anchor.span;
  let spanPart: string;
  switch (span.kind) {
    case "page":
      spanPart =
        span.endPage !== undefined && span.endPage !== span.page
          ? `page:${span.page}-${span.endPage}`
          : `page:${span.page}`;
      break;
    case "time":
      spanPart = `time:${formatSeconds(span.startSeconds)}-${formatSeconds(
        span.endSeconds,
      )}`;
      break;
    case "char":
      spanPart = `char:${span.start}-${span.end}`;
      break;
  }
  return `src:${anchor.sourceId}/ver:${anchor.sourceVersionId}/${spanPart}`;
}

const KEY_SHAPE = /^src:([1-9]\d*)\/ver:([1-9]\d*)\/(page|time|char):(.+)$/;
const PAGE_BODY = /^([1-9]\d*)(?:-([1-9]\d*))?$/;
const TIME_BODY = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/;
const CHAR_BODY = /^(0|[1-9]\d*)-(0|[1-9]\d*)$/;

function parseSafeInt(text: string): number | null {
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Exact inverse of `anchorKey`: `anchorKey(parseAnchorKey(key)!) === key`
 * for every key `anchorKey` can produce (the non-canonical equal-endpoint
 * page form "page:5-5" is also accepted and re-canonicalizes to "page:5").
 * Returns null — never throws — on anything malformed: wrong shape, unknown
 * span kind, non-numeric or unsafe integers, or inverted ranges.
 */
export function parseAnchorKey(key: string): ParsedAnchorKey | null {
  const match = KEY_SHAPE.exec(key);
  if (!match) return null;
  const sourceId = parseSafeInt(match[1]!);
  const sourceVersionId = parseSafeInt(match[2]!);
  if (sourceId === null || sourceVersionId === null) return null;

  const kind = match[3]!;
  const body = match[4]!;
  let span: AnchorSpan;
  if (kind === "page") {
    const pageMatch = PAGE_BODY.exec(body);
    if (!pageMatch) return null;
    const page = parseSafeInt(pageMatch[1]!);
    if (page === null) return null;
    if (pageMatch[2] === undefined) {
      span = { kind: "page", page };
    } else {
      const endPage = parseSafeInt(pageMatch[2]);
      if (endPage === null) return null;
      span = { kind: "page", page, endPage };
    }
  } else if (kind === "time") {
    const timeMatch = TIME_BODY.exec(body);
    if (!timeMatch) return null;
    span = {
      kind: "time",
      startSeconds: Number(timeMatch[1]!),
      endSeconds: Number(timeMatch[2]!),
    };
  } else {
    const charMatch = CHAR_BODY.exec(body);
    if (!charMatch) return null;
    const start = parseSafeInt(charMatch[1]!);
    const end = parseSafeInt(charMatch[2]!);
    if (start === null || end === null) return null;
    span = { kind: "char", start, end };
  }

  if (!isValidAnchorSpan(span)) return null;
  return { sourceId, sourceVersionId, span };
}

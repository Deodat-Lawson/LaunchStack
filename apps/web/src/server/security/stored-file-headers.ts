/**
 * Response headers for serving a stored upload back from this origin.
 *
 * The stored type is whatever the uploader claimed: `/api/upload-local`
 * accepts a file on its extension alone and keeps the type the client sent,
 * so `report.pdf` can arrive typed `text/html`. Served inline from here, a
 * type like that runs the file's scripts with the viewer's session.
 *
 * So no stored type is trusted to be harmless. The few a browser only ever
 * renders (PDF, raster images, audio, video) are served as they are.
 * Everything else gets `Content-Security-Policy: sandbox`: the file still
 * renders (an uploaded web page reads the same, text is still text) but in an
 * opaque origin with scripts, forms and plugins off, whether the viewer frames
 * it or someone opens the URL in a tab. Downloads are unaffected. PDFs stay
 * outside the sandbox because Chrome will not open its PDF viewer inside one.
 *
 * `nosniff` holds the browser to the declared type, and that type is rebuilt
 * from its parsed essence plus a validated charset, never echoed: a browser
 * reads `image/png, text/html` as its last entry.
 */

/** `type/subtype` in RFC 6838's restricted-name alphabet: no wildcards, commas or quotes. */
const MIME_ESSENCE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

const CHARSET_PARAM = /;\s*charset\s*=\s*"?([a-z0-9_.:-]+)"?\s*(?:;|$)/i;

/**
 * Types that render without running anything. Nothing with a `+` suffix: an
 * XML document runs XHTML-namespaced `<script>`, which is how SVG executes.
 */
const RENDERS_INERT = /^(?:application\/pdf|(?:image|audio|video)\/[^+]+)$/;

const UNKNOWN_TYPE = "application/octet-stream";

/** Anything that does not parse as a single type is served as opaque bytes. */
function parseContentType(value: string): { essence: string; charset?: string } {
    const paramsAt = value.indexOf(";");
    const essence = (paramsAt === -1 ? value : value.slice(0, paramsAt)).trim().toLowerCase();
    if (!MIME_ESSENCE.test(essence)) return { essence: UNKNOWN_TYPE };
    const charset = paramsAt === -1 ? undefined : CHARSET_PARAM.exec(value.slice(paramsAt))?.[1];
    return { essence, charset: charset?.toLowerCase() };
}

export function storedFileHeaders(contentType: string | null | undefined): Record<string, string> {
    const { essence, charset } = parseContentType(contentType ?? "");

    return {
        "Content-Type": charset ? `${essence}; charset=${charset}` : essence,
        "X-Content-Type-Options": "nosniff",
        ...(RENDERS_INERT.test(essence) ? {} : { "Content-Security-Policy": "sandbox" }),
    };
}

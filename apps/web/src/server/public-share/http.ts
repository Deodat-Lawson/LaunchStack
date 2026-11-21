/**
 * The envelope every `/api/s/<token>/…` route answers in.
 *
 * - The token is the only credential. It resolves through
 *   `resolvePublicLink`, and an unknown, turned-off, expired or switched-off
 *   link, or one whose file is gone, all get the same 404.
 * - Responses are never cached by anything in between (`private, no-store`),
 *   so turning a link off works on the next request; never indexed; and never
 *   send the link on as a Referer when the page links out.
 * - Each caller (by IP) gets its own budget per route, so one viewer can
 *   neither guess tokens at speed nor pull a large file in a loop.
 */

import { NextResponse } from "next/server";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { PUBLIC_LINK_PAGE_HEADERS } from "~/lib/public-link-paths";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { clientIpKey, type RateLimitConfig } from "~/lib/rate-limiter";
import { resolvePublicLink, type ResolvedPublicLink } from "~/server/workspace/public-links";

import { loadPublicDocumentRow, type PublicDocumentRow } from "./document";

/** One list with the page (`~/lib/public-link-paths`). */
export const PUBLIC_SHARE_HEADERS = PUBLIC_LINK_PAGE_HEADERS;

/** JSON and text reads: generous for a person, slow for a guesser. */
export const PUBLIC_READ_LIMIT: RateLimitConfig = {
    maxRequests: 300,
    windowMs: 15 * 60 * 1000,
    keyGenerator: clientIpKey,
};

/** Bytes: a seeking video asks for many ranges. */
export const PUBLIC_BYTES_LIMIT: RateLimitConfig = {
    maxRequests: 1200,
    windowMs: 15 * 60 * 1000,
    keyGenerator: clientIpKey,
};

export type PublicShareWords = ReturnType<typeof translatorFor<"publicShare.server">>;

export function publicShareWords(request: Request): PublicShareWords {
    return translatorFor(localeOfRequest(request), "publicShare.server");
}

export function withPublicHeaders(response: Response): NextResponse {
    const out =
        response instanceof NextResponse
            ? response
            : new NextResponse(response.body, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
              });
    for (const [key, value] of Object.entries(PUBLIC_SHARE_HEADERS)) out.headers.set(key, value);
    return out;
}

export function publicJson(body: unknown, init?: ResponseInit): NextResponse {
    return withPublicHeaders(NextResponse.json(body, init));
}

export function publicError(
    request: Request,
    status: number,
    key: "notAvailable" | "downloadOff" | "noMedia" | "noMindmap" | "noPreview" | "failed"
): NextResponse {
    return publicJson({ error: publicShareWords(request)(key) }, { status });
}

export interface PublicShareTarget {
    link: ResolvedPublicLink;
    row: PublicDocumentRow;
}

/**
 * Rate-limit, resolve the token, load its file, then run `handler`. Every
 * failure to find a live link reads as the same 404.
 */
export async function publicShareRoute(
    request: Request,
    params: Promise<{ token: string }>,
    limit: RateLimitConfig,
    label: string,
    handler: (target: PublicShareTarget) => Promise<Response>
): Promise<NextResponse> {
    const limited = await withRateLimit(request, limit, async () => {
        try {
            const { token } = await params;
            const link = await resolvePublicLink(token);
            if (!link) return publicError(request, 404, "notAvailable");
            const row = await loadPublicDocumentRow(link);
            if (!row) return publicError(request, 404, "notAvailable");
            return withPublicHeaders(await handler({ link, row }));
        } catch (error) {
            console.error(`[public-share ${label}]`, error);
            return publicError(request, 500, "failed");
        }
    });
    return withPublicHeaders(limited);
}

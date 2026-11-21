import { timingSafeEqual } from "node:crypto";

/** Whether an `Authorization` header carries the metrics scrape token, compared in constant time. */
export function bearerMatches(header: string | null | undefined, token: string): boolean {
    if (!header?.startsWith("Bearer ")) return false;
    const provided = header.slice("Bearer ".length).trim();
    if (!provided || provided.length !== token.length) return false;
    try {
        return timingSafeEqual(Buffer.from(provided), Buffer.from(token));
    } catch {
        return false;
    }
}

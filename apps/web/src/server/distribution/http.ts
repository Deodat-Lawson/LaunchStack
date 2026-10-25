/**
 * Shared bits for the distribution API routes: JSON helpers, the error→status
 * mapping (StageTransitionError carries 409; ToolError carries its own), and
 * bigint-safe serialisation of records.
 */
import { NextResponse } from "next/server";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor, wordOr } from "~/i18n/translate";
import { isStatusCarryingError } from "~/server/api/responses";

export function json(data: unknown, status = 200): NextResponse {
    return NextResponse.json(serialize(data), { status });
}

export function error(
    message: string,
    status: number,
    extra?: Record<string, unknown>
): NextResponse {
    return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * A thrown error as a response. With the request, a status-carrying error
 * that carries a `copy` and the generic 500 are in the reader's language.
 */
export function handleRouteError(scope: string, err: unknown, request?: Request): NextResponse {
    const locale = request ? localeOfRequest(request) : "en";
    if (isStatusCarryingError(err)) {
        return error(wordOr(err.copy, err.message, locale), err.status, { code: err.code });
    }
    console.error(`[distribution] ${scope} error:`, err);
    return error(translatorFor(locale, "errors.api")("internal"), 500);
}

/** bigint → string, Date → ISO; everything else passes through. */
export function serialize<T>(value: T): unknown {
    return JSON.parse(
        JSON.stringify(value, (_key, v: unknown) => {
            if (typeof v === "bigint") return v.toString();
            return v;
        })
    );
}

export async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

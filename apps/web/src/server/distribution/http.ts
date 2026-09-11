/**
 * Shared bits for the distribution API routes: JSON helpers, the error→status
 * mapping (StageTransitionError carries 409; ToolError carries its own), and
 * bigint-safe serialisation of records.
 */
import { NextResponse } from "next/server";

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

export function handleRouteError(scope: string, err: unknown): NextResponse {
    if (isStatusCarryingError(err)) {
        return error(err.message, err.status, { code: err.code });
    }
    console.error(`[distribution] ${scope} error:`, err);
    return error("Internal server error", 500);
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

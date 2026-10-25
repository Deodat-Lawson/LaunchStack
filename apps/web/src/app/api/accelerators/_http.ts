import { z } from "zod";

import { requestTranslator } from "~/i18n/server";
import type { Permission } from "~/lib/authz/permissions";
import { requireWorkspaceContext, type WorkspaceContext } from "~/lib/require-workspace-context";
import { assertAcceleratorAccess, resolveAcceleratorMember } from "~/server/accelerators/access";
import { error, json } from "~/server/distribution/http";

export { json };

/** No caller supplies tenancy, and every response rechecks access after awaited work. */
export async function acceleratorRequest(
    request: Request,
    permission: Permission,
    work: (member: WorkspaceContext) => Promise<unknown>
) {
    const t = requestTranslator(request, "accelerators.errors");
    try {
        const auth = await requireWorkspaceContext();
        if (!auth.success) return auth.response;
        await assertAcceleratorAccess(auth.data, permission);
        const result = await work(auth.data);
        await resolveAcceleratorMember(auth.data.authUserId, auth.data.companyId, permission);
        return json(result);
    } catch (err) {
        const failure = err as { status?: number; code?: string };
        const status =
            failure.status && [400, 401, 402, 403, 404, 409].includes(failure.status)
                ? failure.status
                : err instanceof z.ZodError
                  ? 400
                  : 500;
        const key =
            failure.code === "profile_required"
                ? "profileRequired"
                : failure.code === "run_in_progress"
                  ? "runInProgress"
                  : status === 403 || status === 401
                    ? "fullAccess"
                    : status === 404
                      ? "notFound"
                      : status === 409
                        ? "conflict"
                        : status === 402
                          ? "credits"
                          : status === 400
                            ? "invalid"
                            : "internal";
        if (status === 500) console.error("[accelerators] request failed", err);
        return error(t(key), status, {
            code:
                failure.code ??
                (err instanceof z.ZodError ? "invalid_input" : "accelerators_error"),
        });
    }
}

export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        body = undefined;
    }
    return schema.parse(body);
}

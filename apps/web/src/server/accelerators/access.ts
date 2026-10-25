import type { Permission } from "~/lib/authz/permissions";
import { resolveMemberContext, type WorkspaceContext } from "~/lib/require-workspace-context";

/** A company role alone never grants access to this app's company-wide answers. */
export class AcceleratorAccessError extends Error {
    readonly status = 403;
    readonly code = "accelerators_full_access_required";

    constructor() {
        super(
            "Accelerators requires unrestricted company-document access and the requested permission."
        );
    }
}

export async function assertAcceleratorAccess(
    member: WorkspaceContext,
    permission: Permission = "documents.read"
): Promise<void> {
    if (
        member.status !== "active" ||
        !member.can("documents.read") ||
        !member.can(permission) ||
        (await member.documentScope()).kind !== "everything"
    ) {
        throw new AcceleratorAccessError();
    }
}

/** Resolve again, rather than reusing a request's memoised scope after an AI call. */
export async function resolveAcceleratorMember(
    userId: string,
    companyId: bigint,
    permission: Permission = "documents.read"
): Promise<WorkspaceContext> {
    const member = await resolveMemberContext(userId, companyId);
    if (!member) throw new AcceleratorAccessError();
    await assertAcceleratorAccess(member, permission);
    return member;
}

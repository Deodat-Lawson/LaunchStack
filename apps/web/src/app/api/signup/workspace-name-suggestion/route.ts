import { NextResponse } from "next/server";

import { requireAuthIdentity } from "~/lib/require-workspace-context";
import { getServerSession } from "~/server/auth";
import { suggestAvailableCompanyName } from "~/lib/workspace-slug";

/**
 * A workspace name the caller can actually use, for the signup form to
 * pre-fill.
 *
 * Session-only, like the other signup-time routes: the caller has no
 * workspace yet, which is the entire reason they are here.
 *
 * The suggestion is not reserved. It is a starting point for an editable
 * field, not a claim.
 */
export async function GET() {
    const identity = await requireAuthIdentity();
    if (!identity.success) return identity.response;

    const session = await getServerSession();
    const displayName = session?.user?.name?.trim() ?? "";
    const firstWord = displayName.split(/\s+/)[0] ?? "";
    const preferred = firstWord.length > 0 ? `${firstWord}'s workspace` : "My workspace";

    return NextResponse.json(
        { name: await suggestAvailableCompanyName(preferred) },
        { status: 200 }
    );
}

import { notFound, redirect } from "next/navigation";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { RoleReview } from "./RoleReview";

export const dynamic = "force-dynamic";

/** Authenticated local-only paired-role review; the API rechecks authorization. */
export default async function RolePage() {
    if (process.env.NODE_ENV !== "development" || process.env.VANTAGE_ROLE_M2_ENABLED !== "true") {
        notFound();
    }
    const auth = await requireWorkspaceContext();
    if (!auth.success) {
        if (auth.response.status === 401) redirect("/signin?next=/employer/vantage/roles");
        return (
            <main role="alert" className="p-8">
                The active workspace could not be verified. This review is unavailable.
            </main>
        );
    }
    return <RoleReview />;
}

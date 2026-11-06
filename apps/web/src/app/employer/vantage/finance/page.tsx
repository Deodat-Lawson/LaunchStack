import { notFound, redirect } from "next/navigation";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { FinanceReview } from "./FinanceReview";

export const dynamic = "force-dynamic";

/** Local, authenticated integration surface. The API independently checks access. */
export default async function FinancePage() {
    if (
        process.env.NODE_ENV !== "development" ||
        process.env.VANTAGE_FINANCE_M1_ENABLED !== "true"
    ) {
        notFound();
    }

    const auth = await requireWorkspaceContext();
    if (!auth.success) {
        if (auth.response.status === 401) {
            redirect("/signin?next=/employer/vantage/finance");
        }
        return (
            <main role="alert" className="p-8">
                The active workspace could not be verified. This review is unavailable.
            </main>
        );
    }

    return <FinanceReview />;
}

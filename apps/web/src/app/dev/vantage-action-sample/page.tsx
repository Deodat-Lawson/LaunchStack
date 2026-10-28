import { notFound, redirect } from "next/navigation";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { canUseVantage } from "~/server/vantage/access";
import { assertVantageContextDemoEnabled } from "~/server/vantage/demo-service";
import { ActionWorkspace } from "./ActionWorkspace";
import type { SampleData } from "./sample-model";

export const dynamic = "force-dynamic";

/** Authenticated, development-only snapshot sample. Browser edits never call product mutation APIs. */
export default async function VantageActionSamplePage() {
    if (
        process.env.NODE_ENV !== "development" ||
        process.env.VANTAGE_CONTEXT_DEMO_ENABLED !== "true"
    )
        notFound();
    try {
        assertVantageContextDemoEnabled();
    } catch {
        notFound();
    }
    const auth = await requireWorkspaceContext();
    if (!auth.success) redirect("/signin?next=/dev/vantage-action-sample");
    if (!canUseVantage(auth.data)) notFound();

    const { default: snapshot } = await import("./captured-sample.json");
    if (
        snapshot.provenance.actorId !== auth.data.authUserId ||
        snapshot.provenance.companyId !== String(auth.data.companyId)
    )
        notFound();
    return <ActionWorkspace data={snapshot.data as SampleData} />;
}

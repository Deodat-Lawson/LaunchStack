import { notFound, redirect } from "next/navigation";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { VantageContextPreview } from "../VantageContextPreview";

export const dynamic = "force-dynamic";

/** Real authenticated local demo; intentionally separate from the simulated /dev/vantage. */
export default async function VantageContextPage({
    params,
    searchParams,
}: {
    params: Promise<{ slug?: string[] }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    if (
        process.env.NODE_ENV !== "development" ||
        process.env.VANTAGE_CONTEXT_DEMO_ENABLED !== "true"
    )
        notFound();
    const auth = await requireWorkspaceContext();
    if (!auth.success) redirect("/signin?next=/dev/vantage-context");
    const [{ slug = [] }, query] = await Promise.all([params, searchParams]);
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (Array.isArray(value)) value.forEach(item => search.append(key, item));
        else if (value !== undefined) search.set(key, value);
    }
    const path =
        slug.length === 0
            ? "/context-demo"
            : slug.join("/") === "review"
              ? "/"
              : `/${slug.join("/")}`;
    return <VantageContextPreview at={`${path}${search.size ? `?${search}` : ""}`} />;
}

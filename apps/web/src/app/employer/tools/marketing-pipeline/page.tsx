import { redirect } from "next/navigation";

/** The campaign generator is Brand › Campaigns inside Growth now. */
export default async function LegacyMarketingPipelinePage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const debug = params.debug === "true" ? "?debug=true" : "";
    redirect(`/employer/tools/growth/brand/campaigns${debug}`);
}

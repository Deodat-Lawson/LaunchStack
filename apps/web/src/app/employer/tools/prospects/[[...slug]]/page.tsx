import { redirect } from "next/navigation";

/** Prospects lives inside Growth now; old links and bookmarks follow. */
export default async function LegacyProspectsPage({
    params,
}: {
    params: Promise<{ slug?: string[] }>;
}) {
    const { slug = [] } = await params;
    redirect(`/employer/tools/growth/prospects${slug.length ? `/${slug.join("/")}` : ""}`);
}

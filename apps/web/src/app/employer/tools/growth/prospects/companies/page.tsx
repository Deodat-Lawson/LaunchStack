import { redirect } from "next/navigation";

const BASE = "/employer/tools/growth/prospects";

function url(query: Record<string, string | string[] | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        const v = Array.isArray(value) ? value[0] : value;
        if (v) search.set(key, v);
    }
    const s = search.toString();
    return s ? `${BASE}?${s}` : BASE;
}

/** Companies is a view of the workspace now; old links keep their filter, search and sort. */
export default async function LegacyCompaniesPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const p = await searchParams;
    redirect(url({ view: "companies", filter: p.view, q: p.q, sort: p.sort }));
}

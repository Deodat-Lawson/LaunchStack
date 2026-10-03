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

/** A company opens as a side panel over the list now. */
export default async function LegacyCompanyPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    redirect(url({ view: "companies", company: id }));
}

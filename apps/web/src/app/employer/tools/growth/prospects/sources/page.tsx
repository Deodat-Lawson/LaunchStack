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

/** Sources live inside the segment panel now. */
export default function LegacySourcesPage() {
    redirect(url({ panel: "segment" }));
}

import { redirect } from "next/navigation";

import { toolTabHref, toolTargetFromHref } from "./locations";

/**
 * The whole body of a page that used to be a tool screen. Tools are tabs of
 * the workspace now, so `/employer/tools/growth/prospects/companies?view=new`
 * lands on `/employer/documents?feature=growth&at=/prospects/companies?view=new`
 * — the same screen, inside the tab, with the old query carried over.
 */
export async function redirectToToolTab({
    prefix,
    params,
    searchParams,
}: {
    /** The old page's site path without the catch-all part. */
    prefix: string;
    params: Promise<{ slug?: string[] }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
    const [{ slug }, query] = await Promise.all([params, searchParams]);
    const rest = slug?.length ? `/${slug.map(encodeURIComponent).join("/")}` : "";
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (Array.isArray(value)) value.forEach(v => search.append(key, v));
        else if (value !== undefined) search.set(key, value);
    }
    const qs = search.toString();
    const target = toolTargetFromHref(`${prefix}${rest}${qs ? `?${qs}` : ""}`);
    redirect(target ? toolTabHref(target.toolId, target.at) : "/employer/documents");
}

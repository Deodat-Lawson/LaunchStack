import { redirectToToolTab } from "~/lib/tool-app/redirect";

/**
 * Vantage used to be pages under `/employer/tools/vantage`. It is a tab of
 * the workspace now; every old URL — a bookmark, a history row, an agenda
 * link with `?week=` — lands on the same screen inside the tab.
 */
export default async function Page(props: {
    params: Promise<{ slug?: string[] }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    return redirectToToolTab({ prefix: "/employer/tools/vantage", ...props });
}

import { redirectToToolTab } from "~/lib/tool-app/redirect";

/**
 * Proposals is a tab of the workspace now, not a route tree. Every old page
 * (`/employer/tools/proposals`, `/write/12`, `/funders`, …) — bookmarks,
 * history rows, links the server still builds — lands on the same screen
 * inside the tab.
 */
export default async function Page(props: {
    params: Promise<{ slug?: string[] }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    return redirectToToolTab({ prefix: "/employer/tools/proposals", ...props });
}

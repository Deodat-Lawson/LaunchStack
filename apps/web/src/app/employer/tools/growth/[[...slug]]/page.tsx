import { redirectToToolTab } from "~/lib/tool-app/redirect";

/**
 * Growth is a tab of the workspace now (see `../GrowthTool.tsx`). Every page
 * it used to have — `/employer/tools/growth/prospects/companies?view=new`,
 * `/brand/calendar`, a company — lands on the same screen inside the tab,
 * query and all, so bookmarks and server-built links keep working.
 */
export default async function Page(props: {
    params: Promise<{ slug?: string[] }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    return redirectToToolTab({ prefix: "/employer/tools/growth", ...props });
}

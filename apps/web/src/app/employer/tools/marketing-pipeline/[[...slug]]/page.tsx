import { redirectToToolTab } from "~/lib/tool-app/redirect";

/**
 * The campaign generator is Brand › Campaigns in the Growth tab now. The
 * query rides along, so `?debug=true` still opens the generator's debug
 * panels.
 */
export default async function Page(props: {
    params: Promise<{ slug?: string[] }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    return redirectToToolTab({ prefix: "/employer/tools/marketing-pipeline", ...props });
}

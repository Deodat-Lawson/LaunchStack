import { redirectToToolTab } from "~/lib/tool-app/redirect";

/**
 * Distribution's screens retired into Prospects, which reads the same
 * programs, organisations and relationships inside the Growth tab.
 */
export default async function Page(props: {
    params: Promise<{ slug?: string[] }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    return redirectToToolTab({ prefix: "/employer/tools/distribution", ...props });
}

import { redirectToToolTab } from "~/lib/tool-app/redirect";

/**
 * Prospects' first home, before it moved inside Growth. Old links and
 * bookmarks open the Growth tab on the same Prospects screen.
 */
export default async function Page(props: {
    params: Promise<{ slug?: string[] }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    return redirectToToolTab({ prefix: "/employer/tools/prospects", ...props });
}

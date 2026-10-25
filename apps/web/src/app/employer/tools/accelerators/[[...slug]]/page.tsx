import { redirectToToolTab } from "~/lib/tool-app/redirect";

export default async function Page(props: {
    params: Promise<{ slug?: string[] }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    return redirectToToolTab({ prefix: "/employer/tools/accelerators", ...props });
}

import { redirect } from "next/navigation";

type CallsPageProps = {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CallsPage({ searchParams }: CallsPageProps) {
    const params = searchParams ? await searchParams : {};
    const call = Array.isArray(params.call) ? params.call[0] : params.call;
    const query = new URLSearchParams({ feature: "calls" });
    if (call) query.set("call", call);
    const captureSetup = Array.isArray(params.captureSetup)
        ? params.captureSetup[0]
        : params.captureSetup;
    if (captureSetup === "1") query.set("captureSetup", "1");
    redirect(`/employer/documents?${query.toString()}`);
}

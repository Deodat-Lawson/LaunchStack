import { notFound } from "next/navigation";

import LoadingPage from "~/app/_components/loading";

import { devRoutesEnabled } from "../enabled";

// The gate reads an environment variable, so this page must not be
// prerendered — see ../enabled.ts.
export const dynamic = "force-dynamic";

/**
 * The loading states, held still. In the product they are on screen for a
 * fraction of a second, too briefly to look at. `?variant=pane` shows the
 * in-pane state inside a box the size of a narrow Studio split.
 */
export default async function LoadingPreviewPage({
    searchParams,
}: {
    searchParams: Promise<{ variant?: string }>;
}) {
    if (!devRoutesEnabled()) notFound();
    const { variant } = await searchParams;

    if (variant === "pane") {
        return (
            <div className="bg-surface flex min-h-dvh items-center justify-center p-8">
                <div className="border-line bg-panel flex h-[420px] w-[360px] flex-col rounded-lg border">
                    <LoadingPage variant="pane" />
                </div>
            </div>
        );
    }

    return <LoadingPage label="Opening your workspace…" />;
}

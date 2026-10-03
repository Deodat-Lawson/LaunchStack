import { Suspense } from "react";

import { SkeletonRows } from "~/components/tool-kit/SkeletonRows";

import { AgendaScreen } from "../_screens/AgendaScreen";

/** `?week=` picks the week; the screen reads it, so it needs a boundary. */
export default function Page() {
    return (
        <Suspense
            fallback={<SkeletonRows rows={4} height={48} className="mx-auto max-w-[1100px]" />}
        >
            <AgendaScreen />
        </Suspense>
    );
}

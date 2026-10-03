import { Suspense } from "react";

import { BrandWorkspace } from "./_screens/BrandWorkspace";

/** Brand is one page; the workspace reads its week and panel from the URL. */
export default function Page() {
    return (
        <Suspense fallback={null}>
            <BrandWorkspace />
        </Suspense>
    );
}

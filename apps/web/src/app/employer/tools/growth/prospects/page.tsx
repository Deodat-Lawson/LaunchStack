import { Suspense } from "react";

import { ProspectsWorkspace } from "./_screens/ProspectsWorkspace";

export default function ProspectsPage() {
    return (
        <Suspense fallback={null}>
            <ProspectsWorkspace />
        </Suspense>
    );
}

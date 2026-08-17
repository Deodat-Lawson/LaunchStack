"use client";

import { Suspense } from "react";
// The document workspace is the one sanctioned cross-area import: both
// products render the same workspace feature, which currently lives under
// employer. When it gets a shared home (src/features/), this exception
// goes with it.
// eslint-disable-next-line no-restricted-imports
import { WorkspaceShell } from "~/app/employer/documents/_workspace/WorkspaceShell";

export default function EmployeeDocumentsPage() {
    return (
        <Suspense>
            <WorkspaceShell />
        </Suspense>
    );
}

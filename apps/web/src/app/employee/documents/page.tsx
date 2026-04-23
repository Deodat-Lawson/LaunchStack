"use client";

import { Suspense } from "react";
import { WorkspaceShell } from "~/app/employer/documents/_workspace/WorkspaceShell";

export default function EmployeeDocumentsPage() {
  return (
    <Suspense>
      <WorkspaceShell />
    </Suspense>
  );
}

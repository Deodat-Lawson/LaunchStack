"use client";

import { Suspense } from "react";
import { WorkspaceShell } from "./_workspace/WorkspaceShell";

export default function DocumentsPage() {
  return (
    <Suspense>
      <WorkspaceShell />
    </Suspense>
  );
}

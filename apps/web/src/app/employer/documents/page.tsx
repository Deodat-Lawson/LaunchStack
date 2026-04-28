"use client";

import { Suspense } from "react";
import { useSetBreadcrumbs } from "../_chrome/BreadcrumbContext";
import { WorkspaceShell } from "./_workspace/WorkspaceShell";

const DOCUMENTS_CRUMBS = ["Drift", "Documents"];

export default function DocumentsPage() {
  useSetBreadcrumbs(DOCUMENTS_CRUMBS);
  return (
    <Suspense>
      <WorkspaceShell />
    </Suspense>
  );
}

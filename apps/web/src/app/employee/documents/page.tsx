"use client";

import { Suspense } from "react";
import { DocumentViewerShell } from "~/app/employer/documents/components/DocumentViewerShell";

export default function EmployeeDocumentViewerPage() {
  return (
    <Suspense>
      <DocumentViewerShell userRole="employee" />
    </Suspense>
  );
}

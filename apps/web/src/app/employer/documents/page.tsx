"use client";

import { Suspense } from "react";
import { DocumentViewerShell } from "./components/DocumentViewerShell";

export default function DocumentViewerPage() {
  return (
    <Suspense>
      <DocumentViewerShell userRole="employer" />
    </Suspense>
  );
}

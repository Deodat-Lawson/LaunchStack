"use client";

import { useMemo } from "react";
import { useSetBreadcrumbs } from "../_chrome/BreadcrumbContext";

export interface EmployerChromeProps {
  /** Section label (e.g. "Tools"). Becomes the second breadcrumb. */
  pageLabel?: string;
  /** Page title (e.g. "Marketing pipeline"). Becomes the last breadcrumb. */
  pageTitle?: string;
  /** Kept for backwards compatibility — actions now live in DriftShell topbar. */
  rightActions?: React.ReactNode;
}

/**
 * The visible app chrome (sidebar + topbar + ambient layer) is now provided
 * globally by `DriftShell` in `app/employer/layout.tsx`. This component
 * survives only to feed page-level breadcrumbs into the shared topbar so
 * existing callers don't need to change.
 */
export function EmployerChrome({ pageLabel, pageTitle }: EmployerChromeProps) {
  const crumbs = useMemo(() => {
    const trail = ["Drift"];
    if (pageLabel) trail.push(pageLabel);
    if (pageTitle) trail.push(pageTitle);
    return trail;
  }, [pageLabel, pageTitle]);
  useSetBreadcrumbs(crumbs);
  return null;
}

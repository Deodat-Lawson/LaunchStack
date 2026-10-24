"use client";

import { Suspense, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useSetBreadcrumbs } from "../_chrome/BreadcrumbContext";
import { WorkspaceShell } from "./_workspace/WorkspaceShell";

export default function DocumentsPage() {
    const t = useTranslations("workspace.page");
    // The first crumb is the app's name, which the bar never shows.
    const crumbs = useMemo(() => ["Drift", t("documentsCrumb")], [t]);
    useSetBreadcrumbs(crumbs);
    return (
        <Suspense>
            <WorkspaceShell />
        </Suspense>
    );
}

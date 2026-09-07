"use client";

import { Suspense } from "react";

import { useSetBreadcrumbs } from "../_chrome/BreadcrumbContext";
import { SessionsBrowser } from "./_sessions/ui/SessionsBrowser";

const SESSION_CRUMBS = ["Drift", "Coding sessions"];

export default function AgentSessionsPage() {
    useSetBreadcrumbs(SESSION_CRUMBS);
    return (
        <Suspense>
            <SessionsBrowser />
        </Suspense>
    );
}

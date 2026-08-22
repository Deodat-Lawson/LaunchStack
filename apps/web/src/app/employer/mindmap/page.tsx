"use client";

import { Suspense } from "react";

import { useSetBreadcrumbs } from "../_chrome/BreadcrumbContext";
import { MindmapGallery } from "./_mindmap/ui/MindmapGallery";

const MINDMAP_CRUMBS = ["Drift", "Mindmap"];

export default function MindmapHomePage() {
    useSetBreadcrumbs(MINDMAP_CRUMBS);
    return (
        <Suspense>
            <MindmapGallery />
        </Suspense>
    );
}

"use client";

import { Suspense } from "react";

import { useSetBreadcrumbs } from "../_chrome/BreadcrumbContext";
import { ArtifactGallery } from "./_artifacts/ui/ArtifactGallery";

const ARTIFACT_CRUMBS = ["Drift", "Artifacts"];

export default function ArtifactsHomePage() {
    useSetBreadcrumbs(ARTIFACT_CRUMBS);
    return (
        <Suspense>
            <ArtifactGallery />
        </Suspense>
    );
}

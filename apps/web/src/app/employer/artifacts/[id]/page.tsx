"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "~/components/ui/button";

import { useSetBreadcrumbs } from "../../_chrome/BreadcrumbContext";
import { ArtifactViewer } from "../_artifacts/ui/ArtifactViewer";

/**
 * The viewer route. The artifact is fetched client-side by the viewer — the
 * body can be megabytes of untrusted HTML, and server-rendering it would
 * serialise all of that into the page payload only to hand it to a client
 * component anyway.
 */
export default function ArtifactViewerPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    useSetBreadcrumbs(["Drift", "Artifacts"]);

    const numeric = Number.parseInt(id, 10);
    if (!Number.isInteger(numeric) || numeric <= 0) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-ink text-[15px] font-medium">
                    That artifact link isn&apos;t valid.
                </p>
                <Button asChild variant="outline" size="sm">
                    <Link href="/employer/artifacts">
                        <ArrowLeft className="size-4" />
                        Back to all artifacts
                    </Link>
                </Button>
            </div>
        );
    }

    return <ArtifactViewer id={numeric} />;
}

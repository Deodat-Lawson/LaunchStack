"use client";

import { Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { MarketingPipelineWorkspace } from "~/app/employer/documents/components/marketing-pipeline/MarketingPipelineWorkspace";
import { toPlatformText } from "~/app/employer/documents/components/marketing-pipeline/useMarketingPipelineController";

import { ToolHeader, ToolPage } from "../../_components/ToolHeader";
import { useGrowthUrls } from "../../_lib/paths";
import { COMPOSE_HANDOFF_KEY, type ComposeHandoff } from "../api";

function Workspace() {
    const router = useRouter();
    const urls = useGrowthUrls();
    const params = useSearchParams();
    const debug = params.get("debug") === "true";
    return (
        <MarketingPipelineWorkspace
            embedded
            debug={debug}
            showDnaDebugSection={debug}
            onSchedule={({ platform, message }) => {
                const handoff: ComposeHandoff = {
                    platform,
                    body: toPlatformText(platform, message).trim(),
                    source: { kind: "campaign" },
                };
                try {
                    sessionStorage.setItem(COMPOSE_HANDOFF_KEY, JSON.stringify(handoff));
                } catch {
                    /* a blocked storage only loses the hand-off; Compose opens empty */
                }
                router.push(urls.brand({ panel: "compose" }));
            }}
        />
    );
}

/**
 * The generator, embedded: angles from company knowledge, brand voice,
 * persona, claims checked against sources. Publish from here, or hand the
 * edited post to Compose to put it on the calendar.
 */
export function CampaignsScreen() {
    return (
        <ToolPage width="reading">
            <ToolHeader
                icon={<Sparkles className="size-5" />}
                title="Campaigns"
                description="Drafts grounded in your documents: angles, brand voice, persona and every claim traced to a source. Publish from here or schedule it on the calendar."
            />
            <div className="border-line bg-panel rounded-lg border p-2 md:p-4">
                <Suspense fallback={null}>
                    <Workspace />
                </Suspense>
            </div>
        </ToolPage>
    );
}

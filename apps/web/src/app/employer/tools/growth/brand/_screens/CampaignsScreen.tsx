"use client";

import { useToolRouter, useToolSearchParams } from "~/components/tool-app/nav";
import { MarketingPipelineWorkspace } from "~/app/employer/documents/components/marketing-pipeline/MarketingPipelineWorkspace";
import { toPlatformText } from "~/app/employer/documents/components/marketing-pipeline/useMarketingPipelineController";

import { PageHeader } from "~/components/tools/PageHeader";
import { useGrowthPaths } from "../../_lib/paths";
import { COMPOSE_HANDOFF_KEY, type ComposeHandoff } from "../api";

function Workspace() {
    const router = useToolRouter();
    const paths = useGrowthPaths();
    const params = useToolSearchParams();
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
                router.push(paths.brand("/compose"));
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
        <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
            <PageHeader
                size="md"
                title="Campaigns"
                sub="Drafts grounded in your documents: angles, brand voice, persona and every claim traced to a source. Publish from here or schedule it on the calendar."
            />
            <div className="border-line bg-panel @max-md:p-2 rounded-lg border p-4">
                <Workspace />
            </div>
        </div>
    );
}

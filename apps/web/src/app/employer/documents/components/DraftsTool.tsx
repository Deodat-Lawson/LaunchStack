"use client";

import { FilePlus, Files, Pen, Sparkles } from "lucide-react";

import { ToolFrame, ToolMark, type ToolNavGroup } from "~/components/tool-app/ToolFrame";
import { ToolNavProvider, useToolPathname, type ToolHost } from "~/components/tool-app/nav";

import { DocumentGenerator, useDraftDocuments } from "./DocumentGenerator";
import { DRAFTS_ROOTS, draftsScreenFor } from "./generator/drafts-screens";

/**
 * Templated Drafts: generate a legal document from a template tuned to the
 * workspace's sources, or let the assistant pick the template and pre-fill
 * it from a conversation.
 *
 * A tab of the workspace in the same frame as every other tool. Its screens
 * are paths inside the tab — New document ("/"), My documents
 * ("/documents"), one draft ("/documents/<id>") and the assistant
 * ("/assistant"), see `generator/drafts-screens.ts` — so the screen tabs, Back and
 * Forward work, and the tab reopens where the person left it. The workspace
 * mounts it with `host`; a harness can mount it bare.
 */
export function DraftsTool({ host }: { host?: ToolHost }) {
    return (
        <ToolNavProvider toolId="draft" roots={DRAFTS_ROOTS} host={host}>
            <DraftsFrame />
        </ToolNavProvider>
    );
}

/** The screens: one unlabelled group. The count waits for the list rather than showing 0. */
export function draftsRail(documentCount: number | null): ToolNavGroup[] {
    return [
        {
            id: "drafts",
            items: [
                { to: "/", label: "New document", icon: FilePlus, exact: true },
                { to: "/documents", label: "My documents", icon: Files, count: documentCount },
                { to: "/assistant", label: "Assistant", icon: Sparkles },
            ],
        },
    ];
}

function DraftsFrame() {
    const path = useToolPathname();
    // Above the screens, so the bar can count the drafts and a trip between
    // screens never fetches the list again.
    const drafts = useDraftDocuments();
    return (
        <ToolFrame
            title="Templated Drafts"
            mark={<ToolMark icon={Pen} />}
            groups={draftsRail(drafts.loaded ? drafts.documents.length : null)}
            // Every screen brings its own padding, and the editors and the
            // assistant lay themselves out to the full height of the tab.
            fill
        >
            <DocumentGenerator screen={draftsScreenFor(path)} drafts={drafts} />
        </ToolFrame>
    );
}

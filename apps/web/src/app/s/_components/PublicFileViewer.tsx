"use client";

/**
 * The shared file in the workspace's own viewer, reading only the public
 * link's routes (`~/lib/viewer-endpoints`). The document it is handed has no
 * id (0), no folder and no internal URL: its bytes are `contentUrl`, and how
 * to show it is what the server worked out from the stored file.
 */

import { useMemo, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";

import {
    DISPLAY_TYPE_ICONS,
    DocumentViewer,
} from "~/app/employer/documents/components/DocumentViewer";
import type { DocumentDisplayType, DocumentType } from "~/app/employer/documents/types/document";
import { PublicViewerEndpointsProvider } from "~/lib/viewer-endpoints";

// A PDF opens in the workspace's own pdf.js reader, not the browser's: it
// pages on a phone (Safari frames only page one), and it offers Download
// only when the link allows it. No notes, highlights or Ask: nowhere to keep
// them for someone outside the workspace.
const PdfViewerWithNotes = dynamic(
    () => import("~/components/notes/PdfViewerWithNotes").then(m => m.PdfViewerWithNotes),
    { ssr: false }
);
const NO_NOTES: never[] = [];

const subscribeNever = () => () => undefined;

/**
 * True once this browser has taken over the page. The viewers are drawn only
 * then: a framed file rendered on the server finishes loading before React
 * can hear its `load`, and its spinner would never clear. The words are in
 * the server's HTML anyway (the text version), which is what an agent reads.
 */
function useHydrated(): boolean {
    return useSyncExternalStore(
        subscribeNever,
        () => true,
        () => false
    );
}

export interface PublicViewerFile {
    title: string;
    displayType: DocumentDisplayType;
    mimeType: string | null;
    ocrMetadata: Record<string, unknown> | null;
    contentUrl: string;
    apiBase: string;
    /** The link's download setting, which the viewers' own Download buttons follow. */
    allowDownload: boolean;
}

/** The document object the viewers read, built from what the link shows. */
export function publicViewerDocument(file: PublicViewerFile): DocumentType {
    return {
        id: 0,
        title: file.title,
        url: file.contentUrl,
        category: "",
        mimeType: file.mimeType ?? undefined,
        ocrMetadata: file.ocrMetadata,
        // Nothing is still being read for a public reader: the server says
        // whether there is text, and a viewer shows what there is.
        ocrProcessed: true,
    };
}

export function PublicFileViewer({ file }: { file: PublicViewerFile }) {
    const document = useMemo(() => publicViewerDocument(file), [file]);
    const hydrated = useHydrated();
    if (!hydrated) return <div className="bg-panel-2/30 h-full" aria-hidden />;
    if (file.displayType === "pdf") {
        return (
            <PdfViewerWithNotes
                url={file.contentUrl}
                notes={NO_NOTES}
                downloadUrl={file.allowDownload ? `${file.contentUrl}?download=1` : undefined}
                downloadName={file.title}
            />
        );
    }
    return (
        <PublicViewerEndpointsProvider apiBase={file.apiBase} allowDownload={file.allowDownload}>
            <DocumentViewer document={document} minimal displayType={file.displayType} />
        </PublicViewerEndpointsProvider>
    );
}

/** The workspace's icon for a kind of file. */
export function DisplayTypeIcon({
    type,
    className,
}: {
    type: DocumentDisplayType;
    className?: string;
}) {
    const Icon = DISPLAY_TYPE_ICONS[type];
    return <Icon className={className} aria-hidden />;
}

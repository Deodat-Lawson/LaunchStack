import { FilePlus2, FileText } from "lucide-react";

import { Button } from "~/components/ui/button";
import type { ChatCreatedSource } from "~/lib/chat-turns";
import { displayFolderPath, isUnfiledFolder } from "~/lib/folders/path";

import type { SourceAudience, WorkspaceSource } from "./types";

const AUDIENCE: Record<SourceAudience, string> = {
    private: "Only you",
    shared: "Shared",
    workspace: "Everyone in the workspace",
};

/** "Private · Only you", "Company / Plans · Everyone in the workspace". */
export function createdSourcePlace(source: WorkspaceSource): string {
    const unfiled = isUnfiledFolder(source.folder);
    const place = unfiled ? "Private" : displayFolderPath(source.folder);
    // A loose file is private to whoever added it until they share it (ADR-014).
    const audience = source.access
        ? AUDIENCE[source.access.audience]
        : unfiled
          ? AUDIENCE.private
          : null;
    return audience ? `${place} · ${audience}` : place;
}

/**
 * The documents an answer wrote into the workspace, each with a way to open
 * it. A document the reader cannot open (someone else's chat, shared with
 * them) is left out, as its citations are.
 */
export function CreatedSources({
    created,
    sources,
    onOpen,
}: {
    created: readonly ChatCreatedSource[];
    sources: readonly WorkspaceSource[];
    onOpen?: (source: WorkspaceSource) => void;
}) {
    const rows = created.flatMap(item => {
        const source = sources.find(s => s.documentId === item.documentId);
        return source ? [{ item, source }] : [];
    });
    if (rows.length === 0) return null;
    return (
        <section
            aria-label="Created documents"
            className="border-line bg-line-2 mt-3.5 rounded-[10px] border px-3.5 py-3"
        >
            <div className="mono text-ink-3 mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]">
                <FilePlus2 className="size-3" aria-hidden />
                Created {rows.length} document{rows.length === 1 ? "" : "s"}
            </div>
            <ul className="m-0 list-none p-0">
                {rows.map(({ item, source }) => (
                    <li
                        key={item.documentId}
                        className="border-line flex items-center gap-2.5 border-t py-1.5 first:border-t-0"
                    >
                        <span className="border-line bg-panel text-ink-2 flex size-[22px] shrink-0 items-center justify-center rounded-[5px] border">
                            <FileText className="size-3" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="text-ink block truncate text-xs font-semibold">
                                {source.title}
                            </span>
                            <span className="text-ink-3 block truncate text-[11px]">
                                {createdSourcePlace(source)}
                            </span>
                        </span>
                        {onOpen && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2.5 text-xs"
                                onClick={() => onOpen(source)}
                            >
                                Open
                            </Button>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}

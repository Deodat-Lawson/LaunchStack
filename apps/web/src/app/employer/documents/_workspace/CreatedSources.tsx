import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { FilePlus2, FileText, Network } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import type { ChatCreatedSource } from "~/lib/chat-turns";
import { displayFolderPath, isUnfiledFolder } from "~/lib/folders/path";

import type { SourceAudience, WorkspaceSource } from "./types";

/** The diagram's picture, loaded with the Mindmap model only when an answer drew one. */
const DiagramCardPreview = dynamic(
    () => import("../_mindmap/ui/DiagramCardPreview").then(m => m.DiagramCardPreview),
    { ssr: false, loading: () => <Skeleton className="h-[148px] w-full rounded-none" /> }
);

/**
 * Where a created document went and who can open it, as data the card words:
 * `folder` is null for the Private section (no folder).
 */
export function createdSourcePlace(source: WorkspaceSource): {
    folder: string | null;
    audience: SourceAudience | null;
} {
    const unfiled = isUnfiledFolder(source.folder);
    return {
        folder: unfiled ? null : displayFolderPath(source.folder),
        // A loose file is private to whoever added it until they share it (ADR-014).
        audience: source.access?.audience ?? (unfiled ? "private" : null),
    };
}

/** The workspace source an item names, when the reader can open it. */
function sourceFor(
    item: ChatCreatedSource,
    sources: readonly WorkspaceSource[]
): WorkspaceSource | undefined {
    return item.kind === "diagram"
        ? sources.find(s => s.type === "mindmap" && s.mindmapId === item.mindmapId)
        : sources.find(s => s.documentId === item.documentId);
}

/**
 * What an answer made or changed in the workspace — documents it wrote,
 * diagrams it drew or edited — each with a way to open it. A diagram shows
 * a small picture of itself. Anything the reader cannot open (someone
 * else's chat, shared with them) is left out, as its citations are.
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
    const t = useTranslations("sources.createdSources");
    const rows = created.flatMap(item => {
        const source = sourceFor(item, sources);
        return source ? [{ item, source }] : [];
    });
    if (rows.length === 0) return null;
    const placeLine = (source: WorkspaceSource) => {
        const { folder, audience } = createdSourcePlace(source);
        const place = folder ?? t("private");
        return audience ? t("place", { place, audience: t(`audience.${audience}`) }) : place;
    };
    const changed = rows.filter(({ item }) => item.kind === "diagram" && item.edited).length;
    const drawn = rows.filter(({ item }) => item.kind === "diagram" && !item.edited).length;
    const documents = rows.length - changed - drawn;
    const count = rows.length;
    const heading =
        documents === count
            ? t("count", { count })
            : drawn === count
              ? t("diagramsCount", { count })
              : changed === count
                ? t("changedCount", { count })
                : t("mixedCount", { count });
    return (
        <section
            aria-label={documents === count ? t("aria") : t("ariaMade")}
            className="border-line bg-line-2 mt-3.5 rounded-[10px] border px-3.5 py-3"
        >
            <div className="mono text-ink-3 mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]">
                <FilePlus2 className="size-3" aria-hidden />
                {heading}
            </div>
            <ul className="m-0 list-none p-0">
                {rows.map(({ item, source }) => {
                    const diagram = item.kind === "diagram";
                    return (
                        <li
                            key={diagram ? `m${item.mindmapId}` : `d${item.documentId}`}
                            className="border-line border-t py-1.5 first:border-t-0"
                        >
                            {diagram && (
                                <button
                                    type="button"
                                    onClick={onOpen ? () => onOpen(source) : undefined}
                                    disabled={!onOpen}
                                    aria-label={t("openDiagram", { title: source.title })}
                                    className="border-line bg-panel enabled:hover:border-brand mb-2 block w-full overflow-hidden rounded-md border enabled:cursor-pointer"
                                >
                                    <DiagramCardPreview
                                        mindmapId={item.mindmapId}
                                        version={`${source.size}|${source.added}`}
                                        className="h-[148px] w-full"
                                    />
                                </button>
                            )}
                            <div className="flex items-center gap-2.5">
                                <span className="border-line bg-panel text-ink-2 flex size-[22px] shrink-0 items-center justify-center rounded-[5px] border">
                                    {diagram ? (
                                        <Network className="size-3" aria-hidden />
                                    ) : (
                                        <FileText className="size-3" aria-hidden />
                                    )}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="text-ink block truncate text-xs font-semibold">
                                        {source.title}
                                    </span>
                                    <span className="text-ink-3 block truncate text-[11px]">
                                        {diagram
                                            ? t(item.edited ? "diagramChanged" : "diagramMade", {
                                                  place: placeLine(source),
                                              })
                                            : placeLine(source)}
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
                                        {t("open")}
                                    </Button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

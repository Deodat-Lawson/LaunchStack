import { useTranslations } from "next-intl";
import { FilePlus2, FileText } from "lucide-react";

import { Button } from "~/components/ui/button";
import type { ChatCreatedSource } from "~/lib/chat-turns";
import { displayFolderPath, isUnfiledFolder } from "~/lib/folders/path";

import type { SourceAudience, WorkspaceSource } from "./types";

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
    const t = useTranslations("sources.createdSources");
    const rows = created.flatMap(item => {
        const source = sources.find(s => s.documentId === item.documentId);
        return source ? [{ item, source }] : [];
    });
    if (rows.length === 0) return null;
    const placeLine = (source: WorkspaceSource) => {
        const { folder, audience } = createdSourcePlace(source);
        const place = folder ?? t("private");
        return audience ? t("place", { place, audience: t(`audience.${audience}`) }) : place;
    };
    return (
        <section
            aria-label={t("aria")}
            className="border-line bg-line-2 mt-3.5 rounded-[10px] border px-3.5 py-3"
        >
            <div className="mono text-ink-3 mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]">
                <FilePlus2 className="size-3" aria-hidden />
                {t("count", { count: rows.length })}
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
                                {placeLine(source)}
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
                    </li>
                ))}
            </ul>
        </section>
    );
}

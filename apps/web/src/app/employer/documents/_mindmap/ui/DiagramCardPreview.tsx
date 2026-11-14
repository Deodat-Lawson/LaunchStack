"use client";

import React, { useEffect, useMemo, useState } from "react";

import { Skeleton } from "~/components/ui/skeleton";

import { getMindmap } from "../lib/api";
import { parseDoc } from "../model/serialize";
import { litForReader } from "../model/theme";
import type { MindmapDoc } from "../model/types";
import { DocThumbnail } from "./TemplateThumbnail";
import { useAppThemeMode } from "./useAppThemeMode";

/**
 * A diagram drawn small and still — labels, colours, connectors — for a card
 * outside the editor: the chat answer that drew or changed it. Not the live
 * canvas: a canvas in a scrolling chat would take the wheel for zoom.
 *
 * Read quietly (`?quiet=1`), so showing an old answer does not make its map
 * the "recently opened" one; lit for the reader like the workspace preview.
 * `version` re-reads it when the caller knows it changed.
 */
export function DiagramCardPreview({
    mindmapId,
    version,
    className,
}: {
    mindmapId: number;
    version?: string | number;
    className?: string;
}) {
    const appMode = useAppThemeMode();
    const [doc, setDoc] = useState<MindmapDoc | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setFailed(false);
        getMindmap(mindmapId, { quiet: true })
            .then(detail => {
                if (!cancelled) setDoc(parseDoc(detail.doc, detail.title));
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [mindmapId, version]);

    const lit = useMemo(() => (doc ? litForReader(doc, appMode) : null), [doc, appMode]);

    if (failed) return null;
    return (
        <div className={className}>
            {lit ? (
                <DocThumbnail doc={lit} detail />
            ) : (
                <Skeleton className="size-full rounded-none" />
            )}
        </div>
    );
}

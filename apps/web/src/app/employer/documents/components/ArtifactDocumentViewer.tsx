"use client";

import { useEffect, useState } from "react";
import { Code2, ExternalLink, Eye, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { artifactMarkerOf } from "~/lib/artifact-document";
import type { DocumentType } from "../types/document";
import { ArtifactPreview, SourceView } from "./artifact/ArtifactPreview";
import { artifactTypeMeta } from "./artifact/artifact-meta";

/** Only an http(s) link becomes a link: a stored `javascript:` URL is still a URL. */
function safeHref(url: string | null): string | null {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
    } catch {
        return null;
    }
}

/**
 * An imported Claude artifact, as a source.
 *
 * The file on disk is the artifact's text, stored as `text/plain` so that
 * opening it directly can never run it on this origin. Here it is fetched as
 * text and rendered by ArtifactPreview — HTML and SVG in a sandboxed frame
 * with an opaque origin, Markdown and Mermaid drawn, React and code as source.
 */
export function ArtifactDocumentViewer({ document }: { document: DocumentType }) {
    const t = useTranslations("viewers.artifact");
    const tTypes = useTranslations("viewers.artifactTypes");
    const tc = useTranslations("common");
    const marker = artifactMarkerOf(document.ocrMetadata);
    const type = marker?.artifactType ?? "code";
    const meta = artifactTypeMeta(type);
    const original = safeHref(marker?.sourceUrl ?? null);

    const [content, setContent] = useState<string | null>(null);
    // "" when the failure carried no message — the fallback is worded at render.
    const [error, setError] = useState<string | null>(null);
    const [view, setView] = useState<"preview" | "source">(meta.previewable ? "preview" : "source");

    useEffect(() => {
        let cancelled = false;
        setContent(null);
        setError(null);
        fetch(document.url)
            .then(async response => {
                if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
                return response.text();
            })
            .then(text => {
                if (!cancelled) setContent(text);
            })
            .catch((cause: unknown) => {
                if (!cancelled) setError(cause instanceof Error ? cause.message : "");
            });
        return () => {
            cancelled = true;
        };
    }, [document.url]);

    const Icon = meta.Icon;

    return (
        <div className="bg-surface flex h-full min-h-0 flex-col">
            <div className="border-line flex h-10 shrink-0 items-center gap-2 border-b px-3">
                <Icon className="text-ink-3 size-4 shrink-0" aria-hidden />
                <span className="text-ink-2 truncate text-xs font-medium">{tTypes(type)}</span>
                <span className="text-ink-3 truncate text-xs">{t("claudeArtifact")}</span>
                <div className="flex-1" />
                {meta.previewable && (
                    <ToggleGroup
                        type="single"
                        size="sm"
                        value={view}
                        onValueChange={value => {
                            if (value === "preview" || value === "source") setView(value);
                        }}
                        aria-label={t("viewToggle")}
                    >
                        <ToggleGroupItem value="preview" className="gap-1.5 px-2.5 text-xs">
                            <Eye className="size-3.5" aria-hidden />
                            {tc("actions.preview")}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="source" className="gap-1.5 px-2.5 text-xs">
                            <Code2 className="size-3.5" aria-hidden />
                            {t("source")}
                        </ToggleGroupItem>
                    </ToggleGroup>
                )}
                {original && (
                    <Button asChild variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs">
                        <a href={original} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="size-3.5" aria-hidden />
                            {t("original")}
                        </a>
                    </Button>
                )}
            </div>
            <div className="min-h-0 flex-1">
                {error !== null ? (
                    <div className="text-ink-3 flex h-full items-center justify-center px-6 text-center text-sm">
                        {t("loadFailed", { error: error || t("loadFailedFallback") })}
                    </div>
                ) : content === null ? (
                    <div className="text-ink-3 flex h-full items-center justify-center gap-2 text-sm">
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        {tc("status.loading")}
                    </div>
                ) : view === "preview" ? (
                    <ArtifactPreview type={type} content={content} />
                ) : (
                    <SourceView content={content} />
                )}
            </div>
        </div>
    );
}

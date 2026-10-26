"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

import { toMarkdownOutline } from "../model/serialize";
import { useCommittedDoc } from "./EditorContext";

/**
 * Publish a mindmap into the Sources library.
 *
 * The server renders the outline from the *stored* document and runs it
 * through the ordinary ingestion path, so the result is chunked, embedded and
 * citable like any other source — and what enters the corpus is what was
 * saved, not whatever a client chose to send. The preview below is the same
 * rendering, done locally so the dialog can show it before the round trip.
 * Publishing again updates the same source rather than adding a second one.
 */

export function PublishDialog({
    open,
    onOpenChange,
    mindmapId,
    defaultFolder,
    publishedDocumentId,
    onPublished,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mindmapId: number;
    defaultFolder: string;
    publishedDocumentId: number | null;
    onPublished: (documentId: number) => void;
}) {
    const t = useTranslations("mindmap.publish");
    const tc = useTranslations("common");
    const doc = useCommittedDoc();
    const [folder, setFolder] = useState(defaultFolder);
    const [busy, setBusy] = useState(false);

    // The same rendering the server indexes, so the preview is the truth.
    const outline = toMarkdownOutline(doc, { sections: true });
    const topicCount = doc.pages.reduce((sum, p) => sum + p.nodes.length, 0);

    const publish = async () => {
        setBusy(true);
        try {
            const res = await fetch(`/api/mindmaps/${mindmapId}/publish`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category: folder.trim() || undefined }),
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(body.error ?? `HTTP ${res.status}`);
            }
            const body = (await res.json()) as { document: { id: number } };
            onPublished(body.document.id);
            toast.success(t("published"));
            onOpenChange(false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t("failed"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>
                        {t("description", { title: doc.title, count: topicCount })}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-2">
                    <label className="text-ink-2 block text-[12px] font-medium" htmlFor="mm-folder">
                        {t("folder")}
                    </label>
                    <Input
                        id="mm-folder"
                        value={folder}
                        onChange={e => setFolder(e.target.value)}
                        placeholder={t("unfiled")}
                        onKeyDown={e => e.stopPropagation()}
                    />
                </div>

                <div>
                    <span className="text-ink-3 mb-1 block font-mono text-[10px] font-semibold uppercase tracking-[0.08em]">
                        {tc("actions.preview")}
                    </span>
                    <pre className="border-line bg-panel-2 text-ink-2 max-h-48 overflow-auto rounded-lg border p-3 font-mono text-[11.5px] leading-relaxed">
                        {outline.slice(0, 4000)}
                    </pre>
                </div>

                {publishedDocumentId !== null && (
                    <p className="text-ink-3 flex items-center gap-1.5 text-[12px]">
                        <ExternalLink className="size-3.5" />
                        {t("alreadyPublished")}
                    </p>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {tc("actions.cancel")}
                    </Button>
                    <Button onClick={() => void publish()} disabled={busy}>
                        {busy ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <Sparkles className="size-4" />
                        )}
                        {t("title")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

"use client";

import React, { useState } from "react";
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
    const doc = useCommittedDoc();
    const [folder, setFolder] = useState(defaultFolder);
    const [busy, setBusy] = useState(false);

    const outline = toMarkdownOutline(doc);
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
            toast.success("Added to your sources — it will finish indexing shortly");
            onOpenChange(false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Couldn't publish this mindmap");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>Add to sources</DialogTitle>
                    <DialogDescription>
                        Publishes “{doc.title}” as a citable source, so answers in the workspace can
                        quote it. {topicCount} topic{topicCount === 1 ? "" : "s"} will be indexed.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-2">
                    <label className="text-ink-2 block text-[12px] font-medium" htmlFor="mm-folder">
                        Save to folder
                    </label>
                    <Input
                        id="mm-folder"
                        value={folder}
                        onChange={e => setFolder(e.target.value)}
                        placeholder="Unfiled"
                        onKeyDown={e => e.stopPropagation()}
                    />
                </div>

                <div>
                    <span className="text-ink-3 mb-1 block font-mono text-[10px] font-semibold uppercase tracking-[0.08em]">
                        Preview
                    </span>
                    <pre className="border-line bg-panel-2 text-ink-2 max-h-48 overflow-auto rounded-lg border p-3 font-mono text-[11.5px] leading-relaxed">
                        {outline.slice(0, 4000)}
                    </pre>
                </div>

                {publishedDocumentId !== null && (
                    <p className="text-ink-3 flex items-center gap-1.5 text-[12px]">
                        <ExternalLink className="size-3.5" />
                        Already in your sources — publishing again updates that copy in place.
                    </p>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={() => void publish()} disabled={busy}>
                        {busy ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <Sparkles className="size-4" />
                        )}
                        Add to sources
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

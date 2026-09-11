"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Link2, Loader2, Sparkles } from "lucide-react";
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
import { Label } from "~/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import { detectArtifactType, isClaudeHostedUrl, MAX_ARTIFACT_BYTES } from "~/lib/artifact-content";

import { ArtifactApiError, importArtifact } from "../lib/api";
import { artifactTypeMeta, formatBytes } from "./artifact-meta";

type Mode = "paste" | "upload" | "url";

/**
 * Import a Claude artifact three ways: paste its code, upload the downloaded
 * file, or fetch a (non-claude.ai) URL. claude.ai share links can't be fetched
 * server-side — the page builds the artifact in the browser behind bot
 * protection — so the URL tab steers those to paste/upload up front instead of
 * letting the request fail.
 */
export function ImportArtifactDialog({
    open,
    onOpenChange,
    folders,
    onImported,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    folders: string[];
    onImported?: () => void;
}) {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const [mode, setMode] = useState<Mode>("paste");
    const [content, setContent] = useState("");
    const [fileName, setFileName] = useState<string | null>(null);
    const [url, setUrl] = useState("");
    const [title, setTitle] = useState("");
    const [folder, setFolder] = useState("");
    const [sourceUrl, setSourceUrl] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const detected = useMemo(
        () => (content.trim() ? detectArtifactType(content) : null),
        [content]
    );
    const claudeUrl = mode === "url" && isClaudeHostedUrl(url.trim());

    const reset = () => {
        setContent("");
        setFileName(null);
        setUrl("");
        setTitle("");
        setFolder("");
        setSourceUrl("");
        setError(null);
        setBusy(false);
    };

    const close = (next: boolean) => {
        if (!next) reset();
        onOpenChange(next);
    };

    const pickFile = async (file: File | undefined) => {
        if (!file) return;
        if (file.size > MAX_ARTIFACT_BYTES) {
            setError(
                `That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_ARTIFACT_BYTES)}.`
            );
            return;
        }
        setError(null);
        setFileName(file.name);
        setContent(await file.text());
    };

    const submit = async () => {
        setBusy(true);
        setError(null);
        try {
            const trimmedSource = (mode === "url" ? url : sourceUrl).trim();
            const artifact = await importArtifact({
                title: title.trim() || undefined,
                folder: folder.trim() || undefined,
                sourceUrl: trimmedSource || undefined,
                ...(mode === "url"
                    ? { fetchFromUrl: true }
                    : {
                          content,
                          importMethod: mode,
                      }),
            });
            toast.success("Artifact imported");
            reset();
            onOpenChange(false);
            onImported?.();
            router.push(`/employer/artifacts/${artifact.id}`);
        } catch (err) {
            if (err instanceof ArtifactApiError && err.code === "claude_share_link") {
                setError(err.message);
            } else {
                setError(err instanceof Error ? err.message : "Import failed — try again");
            }
            setBusy(false);
        }
    };

    const canSubmit =
        mode === "url" ? url.trim().length > 0 && !claudeUrl : content.trim().length > 0;

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="sm:max-w-[620px]">
                <DialogHeader>
                    <DialogTitle>Import a Claude artifact</DialogTitle>
                    <DialogDescription>
                        Bring a page, diagram, or snippet built in Claude into this workspace. In
                        Claude, use the artifact&apos;s copy or download control, then paste or
                        upload it here.
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={mode} onValueChange={value => setMode(value as Mode)}>
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="paste">Paste</TabsTrigger>
                        <TabsTrigger value="upload">Upload file</TabsTrigger>
                        <TabsTrigger value="url">From URL</TabsTrigger>
                    </TabsList>

                    <TabsContent value="paste" className="mt-3">
                        <Textarea
                            value={content}
                            onChange={e => setContent(e.target.value)}
                            placeholder="Paste the artifact's HTML, SVG, Markdown, Mermaid, or code…"
                            className="h-44 font-mono text-[12px]"
                        />
                    </TabsContent>

                    <TabsContent value="upload" className="mt-3">
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="border-line text-ink-3 hover:border-brand hover:text-ink-2 flex h-44 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-[13px] transition-colors"
                        >
                            <FileUp className="size-5" />
                            {fileName ? (
                                <span className="text-ink font-medium">{fileName}</span>
                            ) : (
                                <span>Choose a file — .html, .svg, .md, .mmd, .tsx, .txt</span>
                            )}
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".html,.htm,.svg,.md,.markdown,.mmd,.mermaid,.txt,.tsx,.jsx,.ts,.js,.py,.json,.css"
                            className="hidden"
                            onChange={e => void pickFile(e.target.files?.[0])}
                        />
                    </TabsContent>

                    <TabsContent value="url" className="mt-3 space-y-2">
                        <div className="relative">
                            <Link2 className="text-ink-3 pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
                            <Input
                                value={url}
                                onChange={e => setUrl(e.target.value)}
                                placeholder="https://…"
                                className="pl-8"
                            />
                        </div>
                        {claudeUrl ? (
                            <p className="text-warn text-[12.5px] leading-snug">
                                claude.ai pages can&apos;t be fetched from here — Claude renders the
                                artifact in your browser. Copy or download it in Claude, then use
                                Paste or Upload; this link will be kept as the source.
                            </p>
                        ) : (
                            <p className="text-ink-3 text-[12.5px]">
                                Fetches a publicly reachable page and stores it as the artifact.
                            </p>
                        )}
                    </TabsContent>
                </Tabs>

                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="artifact-title">Title</Label>
                        <Input
                            id="artifact-title"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder={detected ? "Detected from content" : "Optional"}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="artifact-folder">Folder</Label>
                        <Input
                            id="artifact-folder"
                            value={folder}
                            onChange={e => setFolder(e.target.value)}
                            placeholder="Unfiled"
                            list="artifact-folder-options"
                        />
                        <datalist id="artifact-folder-options">
                            {folders.map(name => (
                                <option key={name} value={name} />
                            ))}
                        </datalist>
                    </div>
                    {mode !== "url" && (
                        <div className="col-span-2 space-y-1.5">
                            <Label htmlFor="artifact-source">Source link</Label>
                            <Input
                                id="artifact-source"
                                value={sourceUrl}
                                onChange={e => setSourceUrl(e.target.value)}
                                placeholder="https://claude.ai/public/artifacts/… (optional)"
                            />
                        </div>
                    )}
                </div>

                {detected && mode !== "url" && (
                    <p className="text-ink-3 text-[12.5px]">
                        Detected as{" "}
                        <span className="text-ink-2 font-medium">
                            {artifactTypeMeta(detected).label}
                        </span>
                        {" · "}
                        {formatBytes(new Blob([content]).size)} — you can change the type after
                        import if the guess is wrong.
                    </p>
                )}
                {error && <p className="text-danger text-[12.5px] leading-snug">{error}</p>}

                <DialogFooter>
                    <Button variant="outline" onClick={() => close(false)} disabled={busy}>
                        Cancel
                    </Button>
                    <Button onClick={() => void submit()} disabled={busy || !canSubmit}>
                        {busy ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <Sparkles className="size-4" />
                        )}
                        Import
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

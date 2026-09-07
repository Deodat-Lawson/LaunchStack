"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    Check,
    Copy,
    Download,
    ExternalLink,
    Loader2,
    Star,
    Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { ARTIFACT_TYPES } from "~/lib/artifact-content";
import { cn } from "~/lib/utils";

import {
    deleteArtifact,
    getArtifact,
    listArtifacts,
    updateArtifact,
    type ArtifactDetail,
} from "../lib/api";
import { artifactTypeMeta, formatBytes } from "./artifact-meta";
import { ArtifactPreview, SourceView } from "./ArtifactPreview";

/**
 * Full-page artifact viewer: sandboxed preview on top, management verbs in the
 * header. The title renames inline (Enter or blur saves); everything else is a
 * PATCH with a toast.
 */
export function ArtifactViewer({ id }: { id: number }) {
    const router = useRouter();
    const [artifact, setArtifact] = useState<ArtifactDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);
    const [view, setView] = useState<"preview" | "source">("preview");
    const [titleDraft, setTitleDraft] = useState("");
    const [copied, setCopied] = useState(false);
    const [folders, setFolders] = useState<string[]>([]);

    useEffect(() => {
        // Folder list for the "move to" menu; non-critical, so failures are quiet.
        listArtifacts({})
            .then(body => setFolders(body.folders))
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getArtifact(id)
            .then(detail => {
                if (cancelled) return;
                setArtifact(detail);
                setTitleDraft(detail.title);
                setView(artifactTypeMeta(detail.artifactType).previewable ? "preview" : "source");
            })
            .catch(() => {
                if (!cancelled) setMissing(true);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [id]);

    const patch = useCallback(
        async (changes: Parameters<typeof updateArtifact>[1], failMessage: string) => {
            try {
                const updated = await updateArtifact(id, changes);
                setArtifact(updated);
                return true;
            } catch {
                toast.error(failMessage);
                return false;
            }
        },
        [id]
    );

    const commitTitle = async () => {
        const next = titleDraft.trim();
        if (!artifact || !next || next === artifact.title) {
            setTitleDraft(artifact?.title ?? "");
            return;
        }
        const ok = await patch({ title: next }, "Couldn't rename the artifact");
        if (!ok) setTitleDraft(artifact.title);
    };

    const copySource = async () => {
        if (!artifact) return;
        try {
            await navigator.clipboard.writeText(artifact.content);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error("Couldn't copy — your browser blocked clipboard access");
        }
    };

    const trash = async () => {
        try {
            await deleteArtifact(id);
            toast.success("Moved to trash");
            router.push("/employer/artifacts");
        } catch {
            toast.error("Couldn't delete the artifact");
        }
    };

    if (loading) {
        return (
            <div className="text-ink-3 flex h-full items-center justify-center gap-2 text-[13px]">
                <Loader2 className="size-4 animate-spin" />
                Loading…
            </div>
        );
    }
    if (missing || !artifact) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-3">
                <p className="text-ink-2 text-[14px]">That artifact doesn&apos;t exist anymore.</p>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push("/employer/artifacts")}
                >
                    <ArrowLeft className="size-3.5" />
                    Back to artifacts
                </Button>
            </div>
        );
    }

    const meta = artifactTypeMeta(artifact.artifactType);

    return (
        <div className="flex h-full flex-col">
            <header className="border-line bg-panel flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => router.push("/employer/artifacts")}
                >
                    <ArrowLeft className="size-3.5" />
                    Artifacts
                </Button>

                <input
                    value={titleDraft}
                    onChange={e => setTitleDraft(e.target.value)}
                    onBlur={() => void commitTitle()}
                    onKeyDown={e => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setTitleDraft(artifact.title);
                    }}
                    aria-label="Artifact title"
                    className="text-ink hover:bg-panel-2 focus:bg-panel-2 min-w-0 flex-1 truncate rounded-md bg-transparent px-2 py-1 text-[14.5px] font-medium outline-none transition-colors"
                />

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5">
                            <meta.Icon className="size-3.5" />
                            {meta.label}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {ARTIFACT_TYPES.map(type => (
                            <DropdownMenuItem
                                key={type}
                                onSelect={() =>
                                    void patch({ artifactType: type }, "Couldn't change the type")
                                }
                            >
                                {artifactTypeMeta(type).label}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>

                {meta.previewable && (
                    <Tabs value={view} onValueChange={value => setView(value as typeof view)}>
                        <TabsList className="h-8">
                            <TabsTrigger value="preview" className="text-[12.5px]">
                                Preview
                            </TabsTrigger>
                            <TabsTrigger value="source" className="text-[12.5px]">
                                Source
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                )}

                <div className="flex items-center gap-1">
                    <HeaderAction
                        title={artifact.starred ? "Unstar" : "Star"}
                        onClick={() =>
                            void patch({ starred: !artifact.starred }, "Couldn't star that")
                        }
                    >
                        <Star
                            className={cn("size-3.5", artifact.starred && "fill-warn text-warn")}
                        />
                    </HeaderAction>
                    <HeaderAction title="Copy source" onClick={() => void copySource()}>
                        {copied ? (
                            <Check className="text-success size-3.5" />
                        ) : (
                            <Copy className="size-3.5" />
                        )}
                    </HeaderAction>
                    <HeaderAction
                        title="Download"
                        onClick={() => window.open(`/api/artifacts/${artifact.id}/raw`, "_blank")}
                    >
                        <Download className="size-3.5" />
                    </HeaderAction>
                    {artifact.sourceUrl && (
                        <HeaderAction
                            title="Open original in Claude"
                            onClick={() =>
                                window.open(artifact.sourceUrl!, "_blank", "noopener,noreferrer")
                            }
                        >
                            <ExternalLink className="size-3.5" />
                        </HeaderAction>
                    )}
                    <HeaderAction title="Move to trash" onClick={() => void trash()}>
                        <Trash2 className="size-3.5" />
                    </HeaderAction>
                </div>
            </header>

            <div className="bg-surface min-h-0 flex-1">
                {view === "preview" && meta.previewable ? (
                    <ArtifactPreview type={artifact.artifactType} content={artifact.content} />
                ) : (
                    <SourceView content={artifact.content} />
                )}
            </div>

            <footer className="border-line bg-panel text-ink-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-1.5 text-[11.5px]">
                <span>{formatBytes(artifact.sizeBytes)}</span>
                <span>·</span>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="hover:text-ink-2 rounded px-0.5 underline decoration-dotted underline-offset-2 transition-colors"
                            title="Move to another folder"
                        >
                            Folder: {artifact.folder}
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        {[...new Set([...folders, "Unfiled"])].map(name => (
                            <DropdownMenuItem
                                key={name}
                                onSelect={() =>
                                    void patch({ folder: name }, "Couldn't move the artifact")
                                }
                            >
                                {name}
                            </DropdownMenuItem>
                        ))}
                        <DropdownMenuItem
                            onSelect={() => {
                                const name = window.prompt("New folder name")?.trim();
                                if (name) {
                                    void patch({ folder: name }, "Couldn't move the artifact");
                                }
                            }}
                        >
                            New folder…
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                <span>·</span>
                <span>Imported via {artifact.importMethod}</span>
                <span>·</span>
                <span>Updated {new Date(artifact.updatedAt).toLocaleString()}</span>
                {artifact.description && (
                    <>
                        <span>·</span>
                        <span className="truncate">{artifact.description}</span>
                    </>
                )}
            </footer>
        </div>
    );
}

function HeaderAction({
    title,
    onClick,
    children,
}: {
    title: string;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            onClick={onClick}
            className="text-ink-2 hover:bg-panel-2 hover:text-ink flex size-8 items-center justify-center rounded-md transition-colors"
        >
            {children}
        </button>
    );
}

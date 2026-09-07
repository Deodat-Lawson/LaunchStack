"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Folder, Import, Loader2, RotateCcw, Search, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

import { deleteArtifact, listArtifacts, updateArtifact, type ArtifactSummary } from "../lib/api";
import { artifactTypeMeta, formatBytes } from "./artifact-meta";
import { ImportArtifactDialog } from "./ImportArtifactDialog";

/**
 * The Artifacts home: everything the workspace has imported from Claude,
 * with folders, search, star, trash — the same management verbs as Mindmap.
 */

type Scope = "active" | "trash";

export function ArtifactGallery() {
    const router = useRouter();
    const [items, setItems] = useState<ArtifactSummary[]>([]);
    const [folders, setFolders] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [importOpen, setImportOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [scope, setScope] = useState<Scope>("active");
    const [folder, setFolder] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const body = await listArtifacts({ scope, folder: folder ?? undefined });
            setItems(body.artifacts);
            setFolders(body.folders);
        } catch {
            toast.error("Couldn't load your artifacts");
        } finally {
            setLoading(false);
        }
    }, [folder, scope]);

    useEffect(() => {
        void load();
    }, [load]);

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return items;
        return items.filter(item => item.title.toLowerCase().includes(q));
    }, [items, query]);

    const mutate = async (
        id: number,
        action: "star" | "unstar" | "trash" | "restore" | "purge"
    ) => {
        try {
            if (action === "trash" || action === "purge") {
                await deleteArtifact(id, action === "purge");
                toast.success(action === "purge" ? "Deleted permanently" : "Moved to trash");
            } else if (action === "restore") {
                await updateArtifact(id, { restore: true });
                toast.success("Restored");
            } else {
                await updateArtifact(id, { starred: action === "star" });
            }
            await load();
        } catch {
            toast.error("That didn't work — try again");
        }
    };

    return (
        <div className="mx-auto w-full max-w-6xl px-6 pb-16 pt-8">
            <header className="mb-8">
                <h1 className="text-ink text-[26px] font-semibold tracking-tight">
                    Claude Artifacts
                </h1>
                <p className="text-ink-3 mt-1 text-[14px]">
                    Pages, diagrams, and snippets built in Claude — imported here so they outlive
                    the conversation and the whole workspace can use them.
                </p>
            </header>

            <section>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h2 className="text-ink text-[15px] font-semibold">
                        {scope === "trash" ? "Trash" : "Your artifacts"}
                    </h2>
                    <span className="text-ink-3 text-[12px]">{visible.length}</span>
                    <span className="flex-1" />

                    <div className="relative">
                        <Search className="text-ink-3 pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
                        <Input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search…"
                            className="h-8 w-52 pl-8 text-[13px]"
                        />
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8 gap-1.5">
                                <Folder className="size-3.5" />
                                {folder ?? "All folders"}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setFolder(null)}>
                                All folders
                            </DropdownMenuItem>
                            {folders.map(name => (
                                <DropdownMenuItem key={name} onSelect={() => setFolder(name)}>
                                    {name}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <Button
                        variant={scope === "trash" ? "default" : "outline"}
                        size="sm"
                        className="h-8 gap-1.5"
                        onClick={() => setScope(s => (s === "trash" ? "active" : "trash"))}
                    >
                        <Trash2 className="size-3.5" />
                        Trash
                    </Button>

                    <Button size="sm" className="h-8 gap-1.5" onClick={() => setImportOpen(true)}>
                        <Import className="size-3.5" />
                        Import
                    </Button>
                </div>

                {loading ? (
                    <div className="border-line text-ink-3 flex items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-[13px]">
                        <Loader2 className="size-4 animate-spin" />
                        Loading…
                    </div>
                ) : visible.length === 0 ? (
                    <div className="border-line rounded-xl border border-dashed py-16 text-center">
                        <p className="text-ink-2 text-[14px]">
                            {scope === "trash"
                                ? "Nothing in the trash."
                                : "No artifacts yet — import one from Claude to get started."}
                        </p>
                        {scope === "active" && (
                            <Button
                                size="sm"
                                className="mt-4 gap-1.5"
                                onClick={() => setImportOpen(true)}
                            >
                                <Import className="size-3.5" />
                                Import an artifact
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {visible.map(item => {
                            const meta = artifactTypeMeta(item.artifactType);
                            return (
                                <article
                                    key={item.id}
                                    className="border-line bg-panel hover:border-brand hover:shadow-2 group relative overflow-hidden rounded-xl border transition-all"
                                >
                                    <button
                                        type="button"
                                        onClick={() =>
                                            router.push(`/employer/artifacts/${item.id}`)
                                        }
                                        className="block w-full text-left"
                                    >
                                        <div className="bg-panel-2 flex aspect-[4/3] w-full items-center justify-center">
                                            <div className="flex flex-col items-center gap-2">
                                                <span className="bg-brand-soft text-brand-ink flex size-12 items-center justify-center rounded-xl">
                                                    <meta.Icon className="size-6" />
                                                </span>
                                                <span className="text-ink-3 text-[11px] font-medium uppercase tracking-wide">
                                                    {meta.label}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="p-3">
                                            <h3 className="text-ink truncate text-[13.5px] font-medium">
                                                {item.title}
                                            </h3>
                                            <p className="text-ink-3 mt-0.5 text-[11.5px]">
                                                {formatBytes(item.sizeBytes)} · {item.folder} ·{" "}
                                                {new Date(item.updatedAt).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </button>

                                    <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                                        {scope === "active" ? (
                                            <>
                                                <IconAction
                                                    title={item.starred ? "Unstar" : "Star"}
                                                    onClick={() =>
                                                        void mutate(
                                                            item.id,
                                                            item.starred ? "unstar" : "star"
                                                        )
                                                    }
                                                >
                                                    <Star
                                                        className={cn(
                                                            "size-3.5",
                                                            item.starred && "fill-warn text-warn"
                                                        )}
                                                    />
                                                </IconAction>
                                                <IconAction
                                                    title="Download"
                                                    onClick={() =>
                                                        window.open(
                                                            `/api/artifacts/${item.id}/raw`,
                                                            "_blank"
                                                        )
                                                    }
                                                >
                                                    <Download className="size-3.5" />
                                                </IconAction>
                                                <IconAction
                                                    title="Move to trash"
                                                    onClick={() => void mutate(item.id, "trash")}
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </IconAction>
                                            </>
                                        ) : (
                                            <>
                                                <IconAction
                                                    title="Restore"
                                                    onClick={() => void mutate(item.id, "restore")}
                                                >
                                                    <RotateCcw className="size-3.5" />
                                                </IconAction>
                                                <IconAction
                                                    title="Delete permanently"
                                                    onClick={() => void mutate(item.id, "purge")}
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </IconAction>
                                            </>
                                        )}
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </section>

            <ImportArtifactDialog
                open={importOpen}
                onOpenChange={setImportOpen}
                folders={folders}
                onImported={() => void load()}
            />
        </div>
    );
}

function IconAction({
    title,
    onClick,
    children,
}: {
    title: string;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            onClick={onClick}
            className="border-line bg-panel text-ink-2 shadow-1 hover:bg-panel-2 hover:text-ink flex size-7 items-center justify-center rounded-md border transition-colors"
        >
            {children}
        </button>
    );
}

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Folder, Loader2, Plus, RotateCcw, Search, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

// The gallery only offers the choice; the editor builds the document on open.
import { TEMPLATE_CATEGORIES, TEMPLATE_META } from "../model/template-meta";
import { createMindmap, type MindmapSummary } from "../lib/api";
import { TemplateThumbnail } from "./TemplateThumbnail";

/**
 * The Mindmap home: templates on top, the workspace's documents below.
 *
 * Creating posts a `templateId` and nothing else — the editor builds the
 * document from the registry when it opens an empty map. Template definitions
 * therefore live in one place, adding one never needs a server change, and this
 * page does not have to pull the shape library in to render a picker.
 */

type Scope = "active" | "trash";

export function MindmapGallery() {
    const router = useRouter();
    const [items, setItems] = useState<MindmapSummary[]>([]);
    const [folders, setFolders] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [scope, setScope] = useState<Scope>("active");
    const [folder, setFolder] = useState<string | null>(null);
    const [category, setCategory] = useState<string>("All");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ scope });
            if (folder) params.set("folder", folder);
            const res = await fetch(`/api/mindmaps?${params.toString()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = (await res.json()) as {
                mindmaps: MindmapSummary[];
                folders: string[];
            };
            setItems(body.mindmaps);
            setFolders(body.folders);
        } catch {
            toast.error("Couldn't load your mindmaps");
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

    const templates = useMemo(
        () =>
            category === "All" ? TEMPLATE_META : TEMPLATE_META.filter(t => t.category === category),
        [category]
    );

    // Only the template *id* is posted: the editor builds the document from the
    // registry when it opens an empty map, so template definitions live in one
    // place and adding one never needs a server change.
    const create = async (templateId: string) => {
        setCreating(templateId);
        try {
            const template = TEMPLATE_META.find(t => t.id === templateId);
            const created = await createMindmap({
                title: template && template.id !== "blank" ? template.name : "Untitled mindmap",
                templateId,
                folder: folder ?? undefined,
            });
            router.push(`/employer/mindmap/${created.id}`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Couldn't create that mindmap");
            setCreating(null);
        }
    };

    const mutate = async (
        id: number,
        action: "star" | "unstar" | "trash" | "restore" | "purge" | "duplicate"
    ) => {
        try {
            if (action === "duplicate") {
                const res = await fetch(`/api/mindmaps/${id}/duplicate`, { method: "POST" });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                toast.success("Duplicated");
            } else if (action === "trash" || action === "purge") {
                const res = await fetch(
                    `/api/mindmaps/${id}${action === "purge" ? "?purge=1" : ""}`,
                    { method: "DELETE" }
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                toast.success(action === "purge" ? "Deleted permanently" : "Moved to trash");
            } else {
                const res = await fetch(`/api/mindmaps/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(
                        action === "restore" ? { restore: true } : { starred: action === "star" }
                    ),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
            }
            await load();
        } catch {
            toast.error("That didn't work — try again");
        }
    };

    return (
        <div className="mx-auto w-full max-w-6xl px-6 pb-16 pt-8">
            <header className="mb-8">
                <h1 className="text-ink text-[26px] font-semibold tracking-tight">Mindmap</h1>
                <p className="text-ink-3 mt-1 text-[14px]">
                    Diagrams, mindmaps and flowcharts — and any of them can become a source your
                    workspace can cite.
                </p>
            </header>

            {/* Templates */}
            <section className="mb-10">
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-ink text-[15px] font-semibold">Start something new</h2>
                    <div className="flex gap-1">
                        {["All", ...TEMPLATE_CATEGORIES].map(name => (
                            <button
                                key={name}
                                type="button"
                                onClick={() => setCategory(name)}
                                className={cn(
                                    "rounded-full px-2.5 py-1 text-[12px] transition-colors",
                                    category === name
                                        ? "bg-brand-soft text-brand-ink"
                                        : "text-ink-3 hover:bg-panel-2"
                                )}
                            >
                                {name}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    {templates.map(template => (
                        <button
                            key={template.id}
                            type="button"
                            disabled={creating !== null}
                            onClick={() => void create(template.id)}
                            className="border-line bg-panel hover:border-brand hover:shadow-2 group flex flex-col overflow-hidden rounded-xl border text-left transition-all hover:-translate-y-0.5 disabled:opacity-60"
                        >
                            <div className="bg-panel-2 relative aspect-[4/3] w-full overflow-hidden">
                                <TemplateThumbnail templateId={template.id} />
                                {creating === template.id && (
                                    <span className="bg-panel/70 absolute inset-0 flex items-center justify-center">
                                        <Loader2 className="text-brand size-5 animate-spin" />
                                    </span>
                                )}
                            </div>
                            <div className="p-2.5">
                                <div className="flex items-center gap-1.5">
                                    <span aria-hidden>{template.glyph}</span>
                                    <span className="text-ink truncate text-[13px] font-medium">
                                        {template.name}
                                    </span>
                                </div>
                                <p className="text-ink-3 mt-0.5 line-clamp-2 text-[11.5px] leading-snug">
                                    {template.description}
                                </p>
                            </div>
                        </button>
                    ))}
                </div>
            </section>

            {/* Documents */}
            <section>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h2 className="text-ink text-[15px] font-semibold">
                        {scope === "trash" ? "Trash" : "Your mindmaps"}
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

                    <Button size="sm" className="h-8 gap-1.5" onClick={() => void create("blank")}>
                        <Plus className="size-3.5" />
                        New
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
                                : "No mindmaps yet — pick a template above."}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {visible.map(item => (
                            <article
                                key={item.id}
                                className="border-line bg-panel hover:border-brand hover:shadow-2 group relative overflow-hidden rounded-xl border transition-all"
                            >
                                <button
                                    type="button"
                                    onClick={() => router.push(`/employer/mindmap/${item.id}`)}
                                    className="block w-full text-left"
                                >
                                    <div className="bg-panel-2 aspect-[4/3] w-full overflow-hidden">
                                        {item.thumbnail ? (
                                            // Data-URI snapshot rendered by the editor on save.
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={item.thumbnail}
                                                alt=""
                                                className="size-full object-contain"
                                            />
                                        ) : (
                                            <div className="text-ink-4 flex size-full items-center justify-center text-[12px]">
                                                No preview yet
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-3">
                                        <h3 className="text-ink truncate text-[13.5px] font-medium">
                                            {item.title}
                                        </h3>
                                        <p className="text-ink-3 mt-0.5 text-[11.5px]">
                                            {item.nodeCount} shape{item.nodeCount === 1 ? "" : "s"}{" "}
                                            · {item.folder} ·{" "}
                                            {new Date(item.updatedAt).toLocaleDateString()}
                                        </p>
                                        {item.publishedAt && (
                                            <span className="bg-brand-soft text-brand-ink mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium">
                                                In sources
                                            </span>
                                        )}
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
                                                title="Duplicate"
                                                onClick={() => void mutate(item.id, "duplicate")}
                                            >
                                                <Copy className="size-3.5" />
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
                        ))}
                    </div>
                )}
            </section>
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

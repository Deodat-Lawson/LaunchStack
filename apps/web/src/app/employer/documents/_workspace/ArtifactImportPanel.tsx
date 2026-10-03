"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
    ARTIFACT_TYPES,
    MAX_ARTIFACT_BYTES,
    artifactFileExtension,
    deriveArtifactTitle,
    detectArtifactType,
    type ArtifactType,
} from "~/lib/artifact-content";
import { ARTIFACT_TYPE_META } from "../components/artifact/artifact-meta";
import { registerDocument, uploadFileToStorage } from "./sourceUpload";

/** What a file picked here may be: the formats a Claude artifact is saved as. */
const ACCEPT = ".html,.htm,.svg,.md,.markdown,.mmd,.jsx,.tsx,.js,.ts,.txt";

/**
 * How ingestion reads each type. The stored file is always text/plain — an
 * artifact is untrusted code, and a stored HTML or SVG file opened directly
 * would run on this origin — but HTML and Markdown are read as what they are,
 * so search and citations see their text rather than their markup.
 */
function ingestMimeFor(type: ArtifactType): string {
    if (type === "html") return "text/html";
    if (type === "markdown") return "text/markdown";
    return "text/plain";
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

/** A name that storage accepts as a file name, from a human title. */
function fileBase(title: string): string {
    return (
        title
            .replace(/[^a-zA-Z0-9\s\-_]/g, "")
            .trim()
            .replace(/\s+/g, "-")
            .slice(0, 100) || "artifact"
    );
}

/**
 * An artifact becomes a source: the same upload and registration every file
 * goes through, plus the marker that tells the viewer to render it in a
 * sandbox. Used by the form below and by moving over old artifacts.
 */
export async function addArtifactSource(input: {
    content: string;
    type: ArtifactType;
    title: string;
    sourceUrl?: string | null;
    category: string;
}): Promise<void> {
    const file = new File(
        [input.content],
        `${fileBase(input.title)}.${artifactFileExtension(input.type)}`,
        { type: "text/plain" }
    );
    const stored = await uploadFileToStorage(file);
    await registerDocument({
        file,
        url: stored.url,
        provider: stored.provider,
        category: input.category,
        documentName: input.title,
        mimeType: ingestMimeFor(input.type),
        artifact: {
            artifactType: input.type,
            sourceUrl: input.sourceUrl && isHttpUrl(input.sourceUrl) ? input.sourceUrl : null,
        },
    });
}

/** An artifact from the Claude Artifacts tool, before artifacts were sources. */
interface LegacyArtifact {
    id: number;
    title: string;
    artifactType: string;
    sourceUrl: string | null;
}

async function listLegacyArtifacts(): Promise<LegacyArtifact[]> {
    const res = await fetch("/api/artifacts?scope=active");
    if (!res.ok) return [];
    const body = (await res.json()) as { artifacts?: LegacyArtifact[] };
    return body.artifacts ?? [];
}

/** Read an old artifact, add it as a source, then move the old copy to the archive. */
async function moveLegacyArtifact(artifact: LegacyArtifact, category: string): Promise<void> {
    const res = await fetch(`/api/artifacts/${artifact.id}`);
    if (!res.ok) throw new Error(`Couldn't read "${artifact.title}" (HTTP ${res.status})`);
    const { artifact: detail } = (await res.json()) as {
        artifact: LegacyArtifact & { content: string };
    };
    const type = (ARTIFACT_TYPES as readonly string[]).includes(detail.artifactType)
        ? (detail.artifactType as ArtifactType)
        : detectArtifactType(detail.content);
    await addArtifactSource({
        content: detail.content,
        type,
        title: detail.title,
        sourceUrl: detail.sourceUrl,
        category,
    });
    // Soft delete: the old copy goes to Settings → Archive, where it can be
    // restored, rather than being destroyed the moment its source exists.
    const removed = await fetch(`/api/artifacts/${artifact.id}`, { method: "DELETE" });
    if (!removed.ok)
        throw new Error(`Added "${artifact.title}", but couldn't archive the old copy`);
}

export interface ArtifactImportPanelProps {
    userId: string | null;
    /** The Save-to folder picked at the foot of Add a source. */
    category: string;
    onUploaded: () => void;
}

/**
 * Add a source → Claude artifact. A page, diagram, component or document built
 * in Claude, pasted or uploaded, becomes a source: listed, searchable,
 * citable, and opened in a sandboxed preview.
 *
 * There is no "paste a link" mode. claude.ai share links cannot be read from a
 * server, so the code itself is what comes in; the link can ride along as the
 * way back to the original.
 */
export function ArtifactImportPanel({ userId, category, onUploaded }: ArtifactImportPanelProps) {
    const [mode, setMode] = useState<"paste" | "file">("paste");
    const [content, setContent] = useState("");
    const [fileName, setFileName] = useState<string | null>(null);
    const [typeChoice, setTypeChoice] = useState<ArtifactType | null>(null);
    const [title, setTitle] = useState("");
    const [sourceUrl, setSourceUrl] = useState("");
    const [busy, setBusy] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    const detected = useMemo(() => detectArtifactType(content), [content]);
    const type = typeChoice ?? detected;
    const suggestedTitle = useMemo(
        () =>
            deriveArtifactTitle(content, type) ??
            (fileName ? fileName.replace(/\.[^.]+$/, "") : null) ??
            "Claude artifact",
        [content, type, fileName]
    );
    const linkError =
        sourceUrl.trim() && !isHttpUrl(sourceUrl.trim()) ? "Use an http(s) link." : null;
    const tooBig = new Blob([content]).size > MAX_ARTIFACT_BYTES;

    const [legacy, setLegacy] = useState<LegacyArtifact[]>([]);
    const [moving, setMoving] = useState<{ done: number; total: number } | null>(null);
    useEffect(() => {
        let cancelled = false;
        void listLegacyArtifacts()
            .then(items => {
                if (!cancelled) setLegacy(items);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    const readFile = async (file: File) => {
        if (file.size > MAX_ARTIFACT_BYTES) {
            toast.error("That file is over 10 MB — an artifact is a single self-contained file.");
            return;
        }
        setContent(await file.text());
        setFileName(file.name);
        setTypeChoice(null);
    };

    const submit = async () => {
        if (!userId) {
            toast.error("Sign in to add sources");
            return;
        }
        if (!content.trim() || linkError || tooBig) return;
        const name = title.trim() || suggestedTitle;
        setBusy(true);
        try {
            await addArtifactSource({
                content,
                type,
                title: name,
                sourceUrl: sourceUrl.trim() || null,
                category,
            });
            toast.success(`"${name}" added to "${category}"`);
            onUploaded();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't add the artifact");
        } finally {
            setBusy(false);
        }
    };

    const moveAll = async () => {
        const items = legacy;
        let done = 0;
        const failures: string[] = [];
        setMoving({ done, total: items.length });
        for (const item of items) {
            try {
                await moveLegacyArtifact(item, category);
            } catch (err) {
                failures.push(err instanceof Error ? err.message : `"${item.title}" failed`);
            }
            done += 1;
            setMoving({ done, total: items.length });
        }
        setMoving(null);
        const moved = items.length - failures.length;
        if (moved > 0) {
            toast.success(
                `${moved} artifact${moved === 1 ? "" : "s"} added to "${category}". The old copies are in Settings → Archive.`
            );
        }
        if (failures.length > 0) toast.error(failures.join("\n"));
        setLegacy(await listLegacyArtifacts().catch(() => []));
        if (moved > 0) onUploaded();
    };

    return (
        <div className="flex flex-col gap-4">
            <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={mode}
                onValueChange={value => {
                    if (value === "paste" || value === "file") setMode(value);
                }}
                className="self-start"
                aria-label="How to bring the artifact in"
            >
                <ToggleGroupItem value="paste" className="gap-1.5 px-3 text-xs">
                    <ClipboardPaste className="size-3.5" aria-hidden />
                    Paste code
                </ToggleGroupItem>
                <ToggleGroupItem value="file" className="gap-1.5 px-3 text-xs">
                    <FileUp className="size-3.5" aria-hidden />
                    Upload a file
                </ToggleGroupItem>
            </ToggleGroup>

            {mode === "paste" ? (
                <Textarea
                    value={content}
                    onChange={event => {
                        setContent(event.target.value);
                        setFileName(null);
                    }}
                    disabled={busy}
                    aria-label="Artifact code"
                    placeholder="Paste the artifact's code — an HTML page, a React component, SVG, Markdown or a Mermaid diagram."
                    className="min-h-44 resize-y font-mono text-[12.5px] leading-relaxed"
                />
            ) : (
                <div className="border-line flex items-center gap-3 rounded-lg border border-dashed p-4">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => fileInput.current?.click()}
                    >
                        <FileUp className="size-4" aria-hidden />
                        Choose a file
                    </Button>
                    <span className="text-ink-3 min-w-0 truncate text-xs">
                        {fileName ?? "HTML, SVG, Markdown, Mermaid, JSX or TSX — up to 10 MB"}
                    </span>
                    <input
                        ref={fileInput}
                        type="file"
                        accept={ACCEPT}
                        className="hidden"
                        aria-label="Artifact file"
                        onChange={event => {
                            const file = event.target.files?.[0];
                            if (file) void readFile(file);
                            event.target.value = "";
                        }}
                    />
                </div>
            )}

            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="artifact-type" className="text-ink-3 text-xs">
                        Type {typeChoice === null && content.trim() ? "(detected)" : ""}
                    </Label>
                    <Select
                        value={type}
                        onValueChange={value => setTypeChoice(value as ArtifactType)}
                        disabled={busy}
                    >
                        <SelectTrigger id="artifact-type" className="h-9 text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {ARTIFACT_TYPES.map(option => (
                                <SelectItem key={option} value={option}>
                                    {ARTIFACT_TYPE_META[option].label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="artifact-title" className="text-ink-3 text-xs">
                        Title
                    </Label>
                    <Input
                        id="artifact-title"
                        value={title}
                        onChange={event => setTitle(event.target.value)}
                        placeholder={suggestedTitle}
                        disabled={busy}
                        className="h-9 text-sm"
                    />
                </div>
            </div>

            <div className="flex flex-col gap-1.5">
                <Label htmlFor="artifact-link" className="text-ink-3 text-xs">
                    Link to the original (optional)
                </Label>
                <Input
                    id="artifact-link"
                    type="url"
                    value={sourceUrl}
                    onChange={event => setSourceUrl(event.target.value)}
                    placeholder="https://claude.ai/…"
                    disabled={busy}
                    aria-invalid={linkError ? true : undefined}
                    className="h-9 text-sm"
                />
                <p className={linkError ? "text-danger text-xs" : "text-ink-3 text-xs"}>
                    {linkError ??
                        "Kept as the way back to it. A claude.ai link can't be read from here, so bring the code itself above."}
                </p>
            </div>

            <div className="flex items-center justify-between gap-3">
                <span className="text-ink-3 font-mono text-xs">
                    {tooBig
                        ? "Over 10 MB — too large for one artifact"
                        : `${content.length.toLocaleString()} chars`}
                </span>
                <Button
                    type="button"
                    disabled={busy || !content.trim() || Boolean(linkError) || tooBig}
                    onClick={() => void submit()}
                >
                    {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    Add as source
                </Button>
            </div>

            {legacy.length > 0 && (
                <div className="border-line bg-panel-2 flex flex-wrap items-center gap-3 rounded-lg border p-3">
                    <p className="text-ink-2 min-w-[min(100%,240px)] flex-1 text-xs leading-relaxed">
                        <span className="text-ink font-medium">
                            {legacy.length} artifact{legacy.length === 1 ? "" : "s"} from before
                        </span>{" "}
                        they were sources. Add them to &ldquo;{category}&rdquo; to search and cite
                        them; the old copies move to Settings → Archive.
                    </p>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={moving !== null}
                        onClick={() => void moveAll()}
                    >
                        {moving ? (
                            <>
                                <Loader2 className="size-4 animate-spin" aria-hidden />
                                {moving.done} of {moving.total}
                            </>
                        ) : legacy.length === 1 ? (
                            "Add it as a source"
                        ) : (
                            `Add all ${legacy.length} as sources`
                        )}
                    </Button>
                </div>
            )}
        </div>
    );
}

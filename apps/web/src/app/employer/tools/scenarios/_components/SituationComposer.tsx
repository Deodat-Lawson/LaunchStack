"use client";

import { FileUp, FolderOpen, Lightbulb, Paperclip } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import type { ScenarioFileOption } from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import { SITUATION_STARTERS } from "../_lib/files";
import type { UploadItem } from "../_lib/useUploads";
import { ArrivingFile, AttachedFile, UploadingFile } from "./FileBits";

/** A picked file as the box shows it: known to the file list, or just uploaded and not listed yet. */
export type PickedFile =
    | { id: number; file: ScenarioFileOption }
    | { id: number; file: null; name: string };

function hasFiles(e: DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes("Files");
}

/**
 * "What happens if…": the situation in plain words, and the files it is
 * about, in one box — typed, dropped onto, uploaded into, or filled from the
 * workspace's files. The files are what the people are built from first.
 */
export function SituationComposer({
    value,
    onChange,
    max,
    picked,
    uploads,
    filesMax,
    canUpload,
    onFiles,
    onUpload,
    onChoose,
    onRemove,
    onDismissUpload,
}: {
    value: string;
    onChange: (value: string) => void;
    max: number;
    picked: PickedFile[];
    uploads: UploadItem[];
    filesMax: number;
    canUpload: boolean;
    /** Files dropped on the box. */
    onFiles: (files: File[]) => void;
    /** Opens the file chooser. */
    onUpload: () => void;
    onChoose: () => void;
    onRemove: (id: number) => void;
    onDismissUpload: (key: string) => void;
}) {
    const depth = useRef(0);
    const [over, setOver] = useState(false);
    const count = picked.length + uploads.filter(u => u.state === "uploading").length;
    const tooLong = value.length > max;

    const drop = canUpload
        ? {
              onDragEnter: (e: DragEvent) => {
                  if (!hasFiles(e)) return;
                  e.preventDefault();
                  depth.current++;
                  setOver(true);
              },
              onDragOver: (e: DragEvent) => {
                  if (!hasFiles(e)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
              },
              onDragLeave: (e: DragEvent) => {
                  if (!hasFiles(e)) return;
                  depth.current = Math.max(0, depth.current - 1);
                  if (depth.current === 0) setOver(false);
              },
              onDrop: (e: DragEvent) => {
                  if (!hasFiles(e)) return;
                  e.preventDefault();
                  depth.current = 0;
                  setOver(false);
                  onFiles(Array.from(e.dataTransfer.files));
              },
          }
        : {};

    return (
        <div className="flex flex-col gap-1.5">
            <div
                {...drop}
                className={cn(
                    "bg-panel focus-within:border-brand focus-within:ring-brand/30 shadow-1 relative rounded-xl border transition-[border-color,box-shadow] focus-within:ring-[3px]",
                    tooLong ? "border-danger" : "border-line",
                    over && "border-brand ring-brand/30 ring-[3px]"
                )}
            >
                <div className="px-4 pt-3.5">
                    <Label
                        htmlFor="scenario-subject"
                        className="text-brand-ink text-[13px] font-semibold"
                    >
                        What happens if…
                    </Label>
                    <Textarea
                        id="scenario-subject"
                        value={value}
                        onChange={e => onChange(e.target.value)}
                        rows={3}
                        placeholder="What could happen — a launch, a price change, a new policy — and, if it helps, the plan behind it, the actions you would take and where things stand now…"
                        className="mt-1 max-h-[45vh] min-h-[84px] overflow-y-auto rounded-none border-0 bg-transparent px-0 py-0 leading-[1.55] shadow-none [field-sizing:content] focus-visible:ring-0 md:text-[15px] dark:bg-transparent"
                        aria-invalid={tooLong || undefined}
                        aria-describedby="scenario-subject-help"
                    />
                </div>

                {!value.trim() && (
                    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 pt-1">
                        <span className="text-ink-3 inline-flex items-center gap-1 text-xs">
                            <Lightbulb className="size-3" aria-hidden />
                            Try
                        </span>
                        {SITUATION_STARTERS.map((s, i) => (
                            <button
                                key={s}
                                type="button"
                                onClick={() => onChange(s)}
                                className={cn(
                                    "border-line text-ink-2 hover:border-brand hover:text-brand-ink focus-visible:ring-brand/50 rounded-full border px-2.5 py-0.5 text-left text-xs outline-none transition-colors focus-visible:ring-2",
                                    // Two are enough on a phone.
                                    i >= 2 && "@max-sm:hidden"
                                )}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                )}

                {(picked.length > 0 || uploads.length > 0) && (
                    <ul
                        className="@max-md:grid-cols-1 grid grid-cols-2 gap-2 px-3 pb-3"
                        aria-label="Attached files"
                        aria-live="polite"
                    >
                        {picked.map(p =>
                            p.file ? (
                                <AttachedFile
                                    key={p.id}
                                    file={p.file}
                                    onRemove={() => onRemove(p.id)}
                                />
                            ) : (
                                <ArrivingFile
                                    key={p.id}
                                    name={p.name}
                                    onRemove={() => onRemove(p.id)}
                                />
                            )
                        )}
                        {uploads.map(u => (
                            <UploadingFile
                                key={u.key}
                                item={u}
                                onDismiss={() => onDismissUpload(u.key)}
                            />
                        ))}
                    </ul>
                )}

                <div className="border-line-2 flex flex-wrap items-center gap-1 border-t px-2 py-1.5">
                    {canUpload && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-ink-2"
                            onClick={onUpload}
                            disabled={count >= filesMax}
                        >
                            <Paperclip />
                            Upload files
                        </Button>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-ink-2"
                        onClick={onChoose}
                    >
                        <FolderOpen />
                        Choose from your files
                    </Button>
                    <span className="flex-1" />
                    <span className="text-ink-3 px-1.5 text-[11px] tabular-nums">
                        {count}/{filesMax} files
                    </span>
                    <span
                        className={cn(
                            "px-1.5 font-mono text-[11px] tabular-nums",
                            tooLong ? "text-danger" : "text-ink-3"
                        )}
                    >
                        {value.length.toLocaleString()}/{max.toLocaleString()}
                    </span>
                </div>

                {over && (
                    <div
                        aria-hidden
                        className="bg-panel/90 border-brand pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed backdrop-blur-[1px]"
                    >
                        <FileUp className="text-brand-ink size-6" />
                        <span className="text-ink text-sm font-medium">
                            Drop to add to the scenario
                        </span>
                        <span className="text-ink-3 text-xs">
                            Saved to your Company folder and read before the run starts
                        </span>
                    </div>
                )}
            </div>
            <p id="scenario-subject-help" className="text-ink-3 text-xs leading-relaxed">
                One situation, in plain words — a line, or a few paragraphs on the plan, the actions
                and the current cases. Attach what it is about: a business plan, an action plan,
                case notes, a pricing page
                {canUpload ? "; drop files on the box to upload them." : "."}
            </p>
        </div>
    );
}
